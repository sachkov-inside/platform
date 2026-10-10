"""One Root-authorized acquisition-only run on an otherwise idle ephemeral Linux runner."""
import argparse
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time


def main():
    # Admission, external commands, intake and shutdown share one monotonic deadline.
    deadline = time.monotonic() + 180
    work_deadline = deadline - 60
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, exist_ok=False)
    receipt = {'sourceSha': args.source_sha, 'logicalAcquisitionsMaximum': 3,
               'applicationRetries': 0, 'runtimeSecondsMaximum': 180,
               'growthBytesMaximum': 2 * 1024**3, 'diagnosticBytesMaximum': 1024**2}
    process = None
    interrupted = False
    daemon_owned = False
    initial = None
    paths = None

    def stop(_signal, _frame):
        nonlocal interrupted
        interrupted = True

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)

    def free_bytes():
        value = os.statvfs(root)
        return value.f_bavail * value.f_frsize

    def remaining(end, maximum=10):
        seconds = min(maximum, end - time.monotonic())
        if seconds <= 0:
            raise subprocess.TimeoutExpired('whole acquisition deadline', 180)
        return seconds

    def native(command):
        return subprocess.check_output(command, cwd=root, text=True,
                                       timeout=remaining(work_deadline)).strip()

    def owned_paths():
        # Re-evaluate optional paths, including a cache created after admission.
        current = [daemon, output]
        for path in (containerd, cache):
            if path.exists():
                current.append(path)
            ancestor = path
            while not ancestor.exists():
                ancestor = ancestor.parent
            assert ancestor.resolve().stat().st_dev == root.stat().st_dev, 'one filesystem required'
        assert all(path.resolve().stat().st_dev == root.stat().st_dev for path in current), 'one filesystem required'
        assert all(not path.is_symlink() for path in current), 'owned directory symlink forbidden'
        return current

    def allocated(paths, end):
        # Privileged Docker data belongs entirely to this ephemeral runner. Preserve du failure.
        result = subprocess.run(['sudo', '-n', 'du', '-sk', *map(str, paths)],
                                capture_output=True, text=True, timeout=remaining(end), check=True)
        return sum(int(line.split()[0]) * 1024 for line in result.stdout.splitlines())

    def sample(end, final=False):
        size = allocated(owned_paths(), end)
        growth = size - initial
        free = free_bytes()
        receipt['maximumGrowthBytes'] = max(receipt.get('maximumGrowthBytes', 0), growth)
        receipt['minimumFreeBytes'] = min(receipt.get('minimumFreeBytes', admission), free)
        if final:
            receipt.update(finalAllocatedBytes=size, finalFreeBytes=free)
        if growth >= 2 * 1024**3 - 256 * 1024**2:
            return 'growth early margin'
        if free < 15 * 1024**3 + 256 * 1024**2:
            return 'free-space early margin'
        return None

    try:
        assert os.uname().sysname == 'Linux', 'Linux required'
        assert len(args.source_sha) == 40 and all(c in '0123456789abcdef' for c in args.source_sha)
        assert native(['git', 'rev-parse', 'HEAD']) == args.source_sha, 'source SHA differs'
        subprocess.run(['git', 'diff', '--quiet'], cwd=root, check=True, timeout=remaining(work_deadline))
        subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=root, check=True, timeout=remaining(work_deadline))
        assert os.environ.get('ACQUISITION_DIAGNOSTIC_EPHEMERAL') == '1', 'Root ephemeral grant required'
        assert not native(['docker', 'ps', '-aq']), 'runner already has containers'
        daemon_owned = True
        daemon = Path(native(['docker', 'info', '--format', '{{.DockerRootDir}}']))
        cache = root / 'apps/backend/node_modules/.cache'
        containerd = Path('/var/lib/containerd')
        paths = owned_paths()
        initial = allocated(paths, work_deadline)
        admission = free_bytes()
        assert admission >= 20 * 1024**3, '20 GiB admission required'
        receipt.update(admissionFreeBytes=admission, baselineAllocatedBytes=initial)
        environment = {**os.environ, 'DEBUG': 'testcontainers:pull', 'DEBUG_COLORS': '0',
                       'RYUK_CONTAINER_IMAGE': 'ghcr.io/testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0'}
        command = ['node', 'scripts/owned-node.mjs', 'apps/backend/node_modules/tsx/dist/cli.mjs',
                   'apps/backend/test/contracts/fixtures/ci-acquisition-diagnostic.mts']
        receipt['command'] = command
        remaining(work_deadline)
        with (output / 'diagnostic.jsonl').open('xb') as log:
            process = subprocess.Popen(command, cwd=root, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            receipt['supervisorPid'] = process.pid
            reason = None
            with selectors.DefaultSelector() as intake:
                intake.register(process.stdout, selectors.EVENT_READ)
                # Pipe backpressure bounds unread DEBUG too; the child never owns the file.
                while intake.get_map():
                    if interrupted:
                        reason = 'interrupted'
                    elif time.monotonic() >= work_deadline:
                        reason = 'runtime budget'
                    else:
                        reason = sample(work_deadline)
                    if reason is not None:
                        break
                    for key, _events in intake.select(timeout=remaining(work_deadline, 0.1)):
                        chunk = os.read(key.fd, 65536)
                        if not chunk:
                            intake.unregister(key.fileobj)
                            continue
                        capacity = 1024**2 - log.tell()
                        log.write(chunk[:capacity])
                        if len(chunk) > capacity:
                            reason = 'diagnostics budget'
                            break
                    if reason is not None:
                        break
                receipt['diagnosticBytes'] = log.tell()
            if reason is not None:
                receipt['stopReason'] = reason
            else:
                receipt['nativeExit'] = process.wait(timeout=remaining(work_deadline))
    except Exception as error:
        receipt['guardFailureType'] = type(error).__name__
    finally:
        receipt['pending'] = 0
        try:
            if process is not None:
                if process.poll() is None:
                    try:
                        # Let owned-node close its detached descendants through its control pipe.
                        process.send_signal(signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    process.wait(timeout=remaining(deadline - 42))
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=remaining(deadline - 32))
                receipt['supervisorExit'] = process.returncode
        except Exception as error:
            receipt['processCleanupFailureType'] = type(error).__name__
            receipt['pending'] = 'process cleanup unproven'
        finally:
            try:
                if process is not None and process.stdout is not None:
                    process.stdout.close()
            except Exception as error:
                receipt['processCleanupFailureType'] = type(error).__name__
                receipt['pending'] = 'process cleanup unproven'
        # Independent cleanup: a process race/timeout cannot cancel daemon shutdown or receipt.
        try:
            if daemon_owned:
                shutdown = subprocess.run(['sudo', '-n', 'systemctl', 'stop', 'docker.service', 'docker.socket', 'containerd.service'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          timeout=remaining(deadline - 12, 30))
                receipt['daemonShutdownExit'] = shutdown.returncode
                if shutdown.returncode != 0:
                    receipt['pending'] = 'daemon shutdown unproven'
        except Exception as error:
            receipt['daemonShutdownFailureType'] = type(error).__name__
            receipt['pending'] = 'daemon shutdown unproven'
        finally:
            try:
                if initial is not None:
                    final_reason = sample(deadline - 2, final=True)
                    if final_reason is not None:
                        receipt.setdefault('stopReason', final_reason)
            except Exception as error:
                receipt['finalSampleFailureType'] = type(error).__name__
            finally:
                (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    failed = any(key in receipt for key in ('stopReason', 'guardFailureType', 'processCleanupFailureType',
                                            'daemonShutdownFailureType', 'finalSampleFailureType'))
    return receipt.get('nativeExit', 1) if not failed and receipt.get('pending') == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
