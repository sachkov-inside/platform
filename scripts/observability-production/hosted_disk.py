#!/usr/bin/env python3
"""Prepare only the preinstalled Android SDK on this job's fresh hosted VM."""
import json
import os
import platform
import re
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys

DELETE_TIMEOUT_SECONDS = 120
DELETE_KILL_AFTER_SECONDS = 5
DELETE_WAIT_SECONDS = 135


def canonical_directory(path):
    if (not path.is_absolute() or '..' in path.parts or path.resolve(strict=True) != path
            or any(not stat.S_ISDIR(parent.lstat().st_mode) for parent in (path, *path.parents))):
        raise ValueError('guard_rejected')


def verified_sdk():
    root, sdk, docker = Path('/usr/local/lib/android'), Path('/usr/local/lib/android/sdk'), Path('/var/lib/docker')
    canonical_directory(root.parent)
    canonical_directory(docker)
    present = []
    for path in (root, sdk):
        try:
            path.lstat()
        except FileNotFoundError:
            present.append(False)
        else:
            canonical_directory(path)
            present.append(True)
    if present[0] != present[1]:
        raise ValueError('guard_rejected')
    if (root if present[0] else root.parent).lstat().st_dev != docker.lstat().st_dev:
        raise ValueError('guard_rejected')
    for name in ('GITHUB_WORKSPACE', 'RUNNER_TEMP'):
        value = os.environ.get(name, '')
        path = Path(value)
        if value != str(path) or path.is_relative_to(root) or root.is_relative_to(path):
            raise ValueError('guard_rejected')
        canonical_directory(path)
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        if (len(fields) < 10 or fields.count('-') != 1 or fields.index('-') < 6
                or len(fields) != fields.index('-') + 4
                or not fields[0].isdigit() or not fields[1].isdigit()
                or not re.fullmatch(r'[0-9]+:[0-9]+', fields[2])):
            raise ValueError('guard_rejected')
        paths = []
        for raw in fields[3:5]:
            if re.search(r'\\(?!040|011|012|134)', raw):
                raise ValueError('guard_rejected')
            decoded = re.sub(r'\\(040|011|012|134)', lambda match: chr(int(match[1], 8)), raw)
            path = Path(decoded)
            if not path.is_absolute() or str(path) != decoded or '..' in path.parts:
                raise ValueError('guard_rejected')
            paths.append(path)
        mounts.append((fields[2], *paths))
    roots = [mount for mount in mounts if mount[2] == Path('/')]
    if len(roots) != 1 or roots[0][1] != Path('/'):
        raise ValueError('guard_rejected')
    # A fresh standard VM keeps both paths on its ordinary root mount. Reject
    # subtree/bind aliases of that device, parents, the SDK itself and descendants.
    for device, mount_root, point in mounts:
        if point != Path('/') and (device == roots[0][0] or root.is_relative_to(point)
                or point.is_relative_to(root) or docker.is_relative_to(point)
                or mount_root.is_relative_to(root) or (root.is_relative_to(mount_root) and mount_root != Path('/'))):
            raise ValueError('guard_rejected')
    return present[0]


def remove_preinstalled_sdk():
    process = None
    interrupted = 0

    def forward_term():
        if process is not None:
            try:
                # sudo forwards TERM to the privileged timeout owner. Python
                # cannot promise to kill a root child; that owner keeps its timer.
                process.send_signal(signal.SIGTERM)
            except OSError:
                pass

    def interrupt(signum, _frame):
        nonlocal interrupted
        if not interrupted:
            interrupted = signum
            forward_term()

    previous = {signum: signal.signal(signum, interrupt)
                for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        process = subprocess.Popen(
            ['/usr/bin/sudo', '-n', '/usr/bin/timeout', '--signal=TERM', f'--kill-after={DELETE_KILL_AFTER_SECONDS}s',
             f'{DELETE_TIMEOUT_SECONDS}s', '/usr/bin/rm', '-rf', '--one-file-system', '--', '/usr/local/lib/android'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True)
        if interrupted:
            forward_term()
        status = process.wait(timeout=DELETE_WAIT_SECONDS)
        status = status if status >= 0 else 128 - status
        outcome = 'prepared' if status == 0 else 'command_timeout' if status in (124, 137) else 'command_failed'
    except subprocess.TimeoutExpired:
        forward_term()
        try:
            process.wait(timeout=DELETE_KILL_AFTER_SECONDS)
        except (subprocess.TimeoutExpired, OSError):
            # No privileged fallback. The bounded root timeout and fresh VM own
            # final cleanup, including an uninterruptible kernel operation.
            pass
        outcome, status = 'command_timeout', 124
    except OSError:
        outcome, status = 'command_failed', 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    return ('interrupted', 128 + interrupted) if interrupted else (outcome, status)


def main(argv=None):
    expected = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
                'ANDROID_HOME': '/usr/local/lib/android/sdk',
                'ANDROID_SDK_ROOT': '/usr/local/lib/android/sdk'}
    try:
        if (argv if argv is not None else sys.argv[1:]) or any(
                os.environ.get(key) != value for key, value in expected.items()):
            raise ValueError('guard_rejected')
        if platform.system() != 'Linux' or platform.machine() != 'x86_64':
            raise ValueError('guard_rejected')
        release = platform.freedesktop_os_release()
        if release.get('ID') != 'ubuntu' or release.get('VERSION_ID') != '24.04':
            raise ValueError('guard_rejected')
        present = verified_sdk()
        before = shutil.disk_usage('/var/lib/docker').free
    except (ValueError, OSError):
        print(json.dumps({'outcome': 'guard_rejected'}))
        return 1
    outcome, status = remove_preinstalled_sdk() if present else ('already_absent', 0)
    report = {'outcome': outcome, 'free_before_bytes': before}
    try:
        report['free_after_bytes'] = shutil.disk_usage('/var/lib/docker').free
    except OSError:
        if status == 0:
            report['outcome'], status = 'measurement_failed', 1
    print(json.dumps(report))
    return status


if __name__ == '__main__':
    sys.exit(main())
