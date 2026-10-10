"""One Root-authorized acquisition-only run on an otherwise idle ephemeral Linux runner."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def main():
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

    def stop(_signal, _frame):
        nonlocal interrupted
        interrupted = True

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)

    def free_bytes():
        value = os.statvfs(root)
        return value.f_bavail * value.f_frsize

    def native(command):
        return subprocess.check_output(command, cwd=root, text=True, timeout=10).strip()

    def allocated(paths):
        # Privileged Docker data belongs entirely to this ephemeral runner. Preserve du failure.
        result = subprocess.run(['sudo', '-n', 'du', '-sk', *map(str, paths)],
                                capture_output=True, text=True, timeout=10, check=True)
        return sum(int(line.split()[0]) * 1024 for line in result.stdout.splitlines())

    try:
        assert os.uname().sysname == 'Linux', 'Linux required'
        assert len(args.source_sha) == 40 and all(c in '0123456789abcdef' for c in args.source_sha)
        assert native(['git', 'rev-parse', 'HEAD']) == args.source_sha, 'source SHA differs'
        subprocess.run(['git', 'diff', '--quiet'], cwd=root, check=True)
        subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=root, check=True)
        assert os.environ.get('ACQUISITION_DIAGNOSTIC_EPHEMERAL') == '1', 'Root ephemeral grant required'
        assert not native(['docker', 'ps', '-aq']), 'runner already has containers'
        daemon_owned = True
        daemon = Path(native(['docker', 'info', '--format', '{{.DockerRootDir}}']))
        cache = root / 'apps/backend/node_modules/.cache'
        containerd = Path('/var/lib/containerd')
        paths = [daemon, output] + ([containerd] if containerd.exists() else []) + ([cache] if cache.exists() else [])
        assert all(path.stat().st_dev == root.stat().st_dev for path in paths), 'one filesystem required'
        initial = allocated(paths)
        admission = free_bytes()
        assert admission >= 20 * 1024**3, '20 GiB admission required'
        receipt.update(admissionFreeBytes=admission, baselineAllocatedBytes=initial)
        environment = {**os.environ, 'DEBUG': 'testcontainers:pull', 'DEBUG_COLORS': '0',
                       'RYUK_CONTAINER_IMAGE': 'ghcr.io/testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0'}
        command = ['node', 'scripts/owned-node.mjs', 'apps/backend/node_modules/tsx/dist/cli.mjs',
                   'apps/backend/test/contracts/fixtures/ci-acquisition-diagnostic.mts']
        receipt['command'] = command
        started = time.monotonic()
        with (output / 'diagnostic.jsonl').open('xb') as log:
            process = subprocess.Popen(command, cwd=root, env=environment,
                                       stdout=log, stderr=log, start_new_session=True)
            receipt['supervisorPid'] = process.pid
            reason = None
            while process.poll() is None:
                growth = allocated(paths) - initial
                free = free_bytes()
                receipt['maximumGrowthBytes'] = max(receipt.get('maximumGrowthBytes', 0), growth)
                receipt['minimumFreeBytes'] = min(receipt.get('minimumFreeBytes', admission), free)
                if interrupted:
                    reason = 'interrupted'
                elif time.monotonic() - started >= 120:
                    reason = 'runtime budget'
                elif growth >= 2 * 1024**3 - 256 * 1024**2:
                    reason = 'growth early margin'
                elif free < 15 * 1024**3 + 256 * 1024**2:
                    reason = 'free-space early margin'
                elif log.tell() >= 1024**2 - 65536:
                    reason = 'diagnostics early margin'
                if reason is not None:
                    break
                # Sampling bounds resources, never delays or retries a provider request.
                time.sleep(0.1)
            if reason is not None:
                receipt['stopReason'] = reason
            else:
                receipt['nativeExit'] = process.wait()
    except Exception as error:
        receipt['guardFailureType'] = type(error).__name__
    finally:
        if process is not None:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
            receipt['supervisorExit'] = process.returncode
        # Root grants the whole ephemeral daemon; shutting it down also cancels server-side pulls.
        receipt['pending'] = 0
        if daemon_owned:
            try:
                shutdown = subprocess.run(['sudo', '-n', 'systemctl', 'stop', 'docker.service', 'docker.socket', 'containerd.service'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                receipt['daemonShutdownExit'] = shutdown.returncode
                if shutdown.returncode != 0:
                    receipt['pending'] = 'daemon shutdown unproven'
            except subprocess.TimeoutExpired:
                receipt['pending'] = 'daemon shutdown timed out'
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    return receipt.get('nativeExit', 1) if receipt.get('pending') == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
