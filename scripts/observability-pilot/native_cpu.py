"""One stdlib helper, one native MCP child, one closed numeric CPU sidechannel."""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import resource
import select
import signal
import stat
import subprocess
import sys
import time

METADATA_MAX_BYTES = 512
METADATA_TIMEOUT_SECONDS = 1
CPU_SANITY_MAX_SECONDS = 86_400
HELPER_LIFETIME_SECONDS = 60
TERMINATE_GRACE_SECONDS = .25
REAP_DEADLINE_SECONDS = .5
WAIT_INTERVAL_SECONDS = .05
PARENT_REAP_SECONDS = 2


def _unknown():
    return {'cpu_seconds': None, 'cpu_measurement': 'unavailable'}


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate CPU field')
        value[key] = item
    return value


def decode_metadata(payload):
    """Only an exact, finite, nonnegative numeric record becomes public evidence."""
    if len(payload) > METADATA_MAX_BYTES:
        return _unknown()
    try:
        value = json.loads(payload, object_pairs_hook=_object)
        if (not isinstance(value, dict) or set(value) != {'schema', 'user_seconds', 'system_seconds'}
                or type(value['schema']) is not int or value['schema'] != 1):
            return _unknown()
        numbers = [value['user_seconds'], value['system_seconds']]
        if any(type(number) not in (int, float) or not math.isfinite(number)
               or not 0 <= number <= CPU_SANITY_MAX_SECONDS for number in numbers):
            return _unknown()
        total = sum(numbers)
        if total > CPU_SANITY_MAX_SECONDS:
            return _unknown()
        return {'cpu_seconds': total, 'cpu_measurement': 'isolated_reaped_child_cpu'}
    except (ValueError, UnicodeError, TypeError, OverflowError):
        return _unknown()


def has_measurements(records, expected):
    if not isinstance(records, dict) or set(records) != set(expected):
        return False
    for record in records.values():
        if not isinstance(record, dict) or record.get('cpu_measurement') != 'isolated_reaped_child_cpu':
            return False
        number = record.get('cpu_seconds')
        try:
            if type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= CPU_SANITY_MAX_SECONDS:
                return False
        except OverflowError:
            return False
    return True


def read_metadata(descriptor):
    deadline = time.monotonic() + METADATA_TIMEOUT_SECONDS
    payload = b''
    while time.monotonic() < deadline:
        ready, _, _ = select.select([descriptor], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        chunk = os.read(descriptor, METADATA_MAX_BYTES + 1 - len(payload))
        if not chunk:
            return decode_metadata(payload)
        payload += chunk
        if len(payload) > METADATA_MAX_BYTES:
            break
    # A valid prefix without EOF is not a closed accounting record.
    return _unknown()


@contextmanager
def measured_process(argv, environment):
    read_fd, write_fd = os.pipe()
    try:
        process = subprocess.Popen([sys.executable, '-I', '-S', str(Path(__file__).resolve()), str(write_fd), *argv],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=environment, pass_fds=(write_fd,))
    except BaseException as error:
        os.close(read_fd)
        if isinstance(error, OSError):
            raise RuntimeError('native MCP accounting startup failed') from None
        raise
    finally:
        os.close(write_fd)
    measurement = _unknown()
    try:
        yield process, measurement
    finally:
        try:
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass
        finally:
            try:
                process.terminate()
                try:
                    process.wait(timeout=PARENT_REAP_SECONDS)
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:
                        process.wait(timeout=PARENT_REAP_SECONDS)
                    except subprocess.TimeoutExpired:
                        raise RuntimeError('native MCP accounting cleanup deadline') from None
            finally:
                process.stdout.close()
                try:
                    measurement.update(read_metadata(read_fd))
                finally:
                    os.close(read_fd)


def _helper(descriptor, argv):
    if descriptor < 3 or not stat.S_ISFIFO(os.fstat(descriptor).st_mode) or not argv:
        return 1
    requested = False
    def interrupted(_signum, _frame):
        nonlocal requested
        requested = True
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, interrupted)
    child = None
    try:
        # Do not create a new session/group: the existing external pilot supervisor owns this tree.
        # close_fds prevents the native executable from writing/holding the private accounting pipe.
        if requested:
            return 1
        child = subprocess.Popen(argv, stderr=subprocess.DEVNULL, close_fds=True)
        lifetime = time.monotonic() + HELPER_LIFETIME_SECONDS
        stop_at = None
        killed = False
        while True:
            try:
                child.wait(timeout=WAIT_INTERVAL_SECONDS)
                break
            except subprocess.TimeoutExpired:
                now = time.monotonic()
                if (requested or now >= lifetime) and stop_at is None:
                    stop_at = now
                    try:
                        child.terminate()
                    except ProcessLookupError:
                        pass
                if stop_at is not None and now >= stop_at + TERMINATE_GRACE_SECONDS and not killed:
                    try:
                        child.kill()
                    except ProcessLookupError:
                        pass
                    killed = True
                if stop_at is not None and now >= stop_at + TERMINATE_GRACE_SECONDS + REAP_DEADLINE_SECONDS:
                    return 1
        # This helper has created and reaped exactly one child; concurrent parent probes are unrelated.
        usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        payload = json.dumps({'schema': 1, 'user_seconds': usage.ru_utime, 'system_seconds': usage.ru_stime}).encode()
        if len(payload) <= METADATA_MAX_BYTES:
            os.write(descriptor, payload)
        return 0
    except (OSError, ValueError, subprocess.SubprocessError):
        return 1
    finally:
        try:
            if child is not None and child.poll() is None:
                try:
                    child.kill()
                except ProcessLookupError:
                    pass
                child.wait(timeout=REAP_DEADLINE_SECONDS)
        except (OSError, subprocess.SubprocessError):
            # The external group owner remains the last cleanup boundary; emit no CPU claim.
            pass
        finally:
            os.close(descriptor)


if __name__ == '__main__':
    try:
        status = _helper(int(sys.argv[1]), sys.argv[2:])
    except (OSError, ValueError, IndexError):
        status = 1
    sys.exit(status)
