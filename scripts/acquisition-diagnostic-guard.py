"""One Root-authorized acquisition-only run on an otherwise idle ephemeral Linux runner."""
import argparse
import importlib.util
import sys
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

EXPERIMENT_SECONDS_MAXIMUM = 180
CLEANUP_RESERVE_SECONDS = 60
NATIVE_COMMAND_TIMEOUT_SECONDS = 10
INTAKE_SAMPLE_INTERVAL_SECONDS = 0.1
DAEMON_SHUTDOWN_SECONDS_MAXIMUM = 30
FORCED_PROCESS_STOP_SECONDS_MAXIMUM = 10
RECEIPT_RESERVE_SECONDS = 2
FINAL_SAMPLE_RESERVE_SECONDS = NATIVE_COMMAND_TIMEOUT_SECONDS + RECEIPT_RESERVE_SECONDS

_meter_spec = importlib.util.spec_from_file_location('acquisition_meter', Path(__file__).with_name('acquisition-diagnostic-meter.py'))
meter = importlib.util.module_from_spec(_meter_spec)
_meter_spec.loader.exec_module(meter)


def bounded_command(command, cwd, timeout, capacity):
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    chunks = [bytearray(), bytearray()]
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as intake:
            intake.register(process.stdout, selectors.EVENT_READ, 0)
            intake.register(process.stderr, selectors.EVENT_READ, 1)
            while intake.get_map():
                if time.monotonic() >= deadline - 0.5:
                    raise subprocess.TimeoutExpired(command, timeout, bytes(chunks[0]), bytes(chunks[1]))
                for key, _event in intake.select(timeout=min(0.05, deadline-time.monotonic())):
                    data = os.read(key.fd, 65536)
                    if not data:
                        intake.unregister(key.fileobj)
                        continue
                    available = capacity - sum(map(len, chunks))
                    chunks[key.data].extend(data[:available])
                    if len(data) > available:
                        raise subprocess.CalledProcessError(1, command, bytes(chunks[0]), bytes(chunks[1]))
        process.wait(timeout=max(0.01, deadline-time.monotonic()))
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command, bytes(chunks[0]), bytes(chunks[1]))
        return subprocess.CompletedProcess(command, 0, chunks[0].decode(errors='ignore'), chunks[1].decode(errors='ignore'))
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=max(0.01, deadline-time.monotonic()))
        process.stdout.close()
        process.stderr.close()


def main():
    # Admission, external commands, intake and shutdown share one monotonic deadline.
    deadline = time.monotonic() + EXPERIMENT_SECONDS_MAXIMUM
    work_deadline = deadline - CLEANUP_RESERVE_SECONDS
    daemon_deadline = deadline - FINAL_SAMPLE_RESERVE_SECONDS
    process_deadline = daemon_deadline - DAEMON_SHUTDOWN_SECONDS_MAXIMUM
    graceful_process_deadline = process_deadline - FORCED_PROCESS_STOP_SECONDS_MAXIMUM
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, exist_ok=False)
    receipt = {'sourceSha': args.source_sha, 'logicalAcquisitionsMaximum': 3,
               'applicationRetries': 0, 'runtimeSecondsMaximum': EXPERIMENT_SECONDS_MAXIMUM,
               'growthBytesMaximum': 2 * 1024**3, 'diagnosticBytesMaximum': 1024**2}
    process = None
    interrupted = False
    daemon_owned = False
    initial = None
    paths = None
    command_bytes = 0
    measurement_pending = False

    def stop(_signal, _frame):
        nonlocal interrupted
        interrupted = True

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)

    def free_bytes():
        value = os.statvfs(root)
        return value.f_bavail * value.f_frsize

    def remaining(end, maximum=NATIVE_COMMAND_TIMEOUT_SECONDS):
        seconds = min(maximum, end - time.monotonic())
        if seconds <= 0:
            raise subprocess.TimeoutExpired('whole acquisition deadline', EXPERIMENT_SECONDS_MAXIMUM)
        return seconds

    def command_record(command, stage, end):
        timeout = remaining(end)
        record = {'stage': stage, 'command': command, 'startMonotonic': time.monotonic(),
                  'deadlineMonotonic': min(end, time.monotonic() + timeout), 'timeoutSeconds': timeout}
        receipt['lastCommand'] = record
        (output / 'command-stage.json').write_text(json.dumps(record))
        return record

    def command_failure(error, record):
        nonlocal command_bytes, measurement_pending
        def bounded(value):
            nonlocal command_bytes
            value = value.encode() if isinstance(value, str) else value or b''
            value = value[:max(0, 1024**2 - command_bytes)]
            command_bytes += len(value)
            return value.decode(errors='ignore')
        primary = {**record, 'failureType': type(error).__name__,
                   'command': getattr(error, 'cmd', record['command']),
                   'timeoutSeconds': getattr(error, 'timeout', record['timeoutSeconds']),
                   'nativeExit': getattr(error, 'returncode', 124 if isinstance(error, subprocess.TimeoutExpired) else 1),
                   'stdout': bounded(getattr(error, 'output', None)), 'stderr': bounded(getattr(error, 'stderr', None))}
        measurement_pending = measurement_pending or getattr(error, 'meter_cleanup_pending', False)
        if hasattr(error, 'meter_receipt'):
            primary['meterReceipt'] = error.meter_receipt
            receipt.setdefault('meters', []).append(error.meter_receipt)
        if hasattr(error, 'meter_directory'):
            primary['meterDirectory'] = error.meter_directory
        if 'primaryFailure' not in receipt:
            receipt['primaryFailure'] = primary
            (output / 'primary-failure.json').write_text(json.dumps(primary))
        receipt['commandDiagnosticBytes'] = command_bytes

    def native(command, stage, end=work_deadline):
        nonlocal command_bytes
        record = command_record(command, stage, end)
        try:
            result = bounded_command(command, root, record['timeoutSeconds'], max(0, 1024**2-command_bytes))
            command_bytes += len(result.stdout.encode()) + len(result.stderr.encode())
            receipt['commandDiagnosticBytes'] = command_bytes
            return result.stdout.strip()
        except Exception as error:
            command_failure(error, record)
            raise

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
        nonlocal command_bytes
        command = ['du', '-sk', *map(str, paths)]
        record = command_record(command, 'privileged-measurement', end)
        try:
            result = meter.measure(paths, output, record['timeoutSeconds'], max(0, 1024**2-command_bytes),
                                   cancelled=lambda: interrupted)
            receipt['lastMeter'] = result
            receipt.setdefault('meters', []).append(result)
            command_bytes += len(result['stdout'].encode()) + len(result['stderr'].encode())
            receipt['commandDiagnosticBytes'] = command_bytes
            return sum(int(line.split()[0]) * 1024 for line in result['stdout'].splitlines())
        except Exception as error:
            command_failure(error, record)
            raise

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
        assert native(['git', 'rev-parse', 'HEAD'], 'git-head') == args.source_sha, 'source SHA differs'
        native(['git', 'diff', '--quiet'], 'git-diff')
        native(['git', 'diff', '--cached', '--quiet'], 'git-diff-cached')
        assert os.environ.get('ACQUISITION_DIAGNOSTIC_EPHEMERAL') == '1', 'Root ephemeral grant required'
        assert not native(['docker', 'ps', '-aq'], 'docker-ps'), 'runner already has containers'
        daemon_owned = True
        daemon = Path(native(['docker', 'info', '--format', '{{.DockerRootDir}}'], 'docker-info'))
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
                    for key, _events in intake.select(timeout=remaining(work_deadline, INTAKE_SAMPLE_INTERVAL_SECONDS)):
                        chunk = os.read(key.fd, 65536)
                        if not chunk:
                            intake.unregister(key.fileobj)
                            continue
                        capacity = max(0, 1024**2 - command_bytes - log.tell())
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
        receipt['pending'] = 'measurement cleanup unproven' if measurement_pending else 0
        try:
            if process is not None:
                if process.poll() is None:
                    try:
                        # Let owned-node close its detached descendants through its control pipe.
                        process.send_signal(signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    process.wait(timeout=remaining(graceful_process_deadline))
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=remaining(process_deadline, FORCED_PROCESS_STOP_SECONDS_MAXIMUM))
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
                                          timeout=remaining(daemon_deadline, DAEMON_SHUTDOWN_SECONDS_MAXIMUM))
                receipt['daemonShutdownExit'] = shutdown.returncode
                if shutdown.returncode != 0:
                    receipt['pending'] = 'daemon shutdown unproven'
        except Exception as error:
            receipt['daemonShutdownFailureType'] = type(error).__name__
            receipt['pending'] = 'daemon shutdown unproven'
        finally:
            try:
                if initial is not None:
                    final_reason = sample(deadline - RECEIPT_RESERVE_SECONDS, final=True)
                    if final_reason is not None:
                        receipt.setdefault('stopReason', final_reason)
            except Exception as error:
                receipt['finalSampleFailureType'] = type(error).__name__
                if measurement_pending:
                    receipt['pending'] = 'measurement cleanup unproven'
            finally:
                (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    failed = any(key in receipt for key in ('stopReason', 'guardFailureType', 'processCleanupFailureType',
                                            'daemonShutdownFailureType', 'finalSampleFailureType'))
    return receipt.get('nativeExit', 1) if not failed and receipt.get('pending') == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
