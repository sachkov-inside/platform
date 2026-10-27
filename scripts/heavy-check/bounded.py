"""Finite owned command boundary shared by native source reads and pinned guard acquisition."""
import os
import selectors
import signal
import subprocess
import sys
import time
from lock import signal_groups


def execute(args, *, timeout, payload=None, observe_failure=None):
    """Bound both pipes while reading; always reap this command and kill its own group."""
    if observe_failure is not None and not callable(observe_failure):
        raise ValueError('native_source_command_observer')
    if timeout <= 0 or payload is not None and (type(payload) is not bytes or len(payload) > 65536):
        raise ValueError('native_source_command_input')
    deadline = time.monotonic() + timeout
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE if observe_failure is None else subprocess.STDOUT, start_new_session=True,
        env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'})
    output = bytearray()
    counts = {'stdout': 0, 'stderr': 0}
    pending = memoryview(payload or b'')
    try:
        with selectors.DefaultSelector() as selector:
            for stream, name in ((process.stdout, 'stdout'), (process.stderr, 'stderr')):
                if stream is None: continue
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            if pending:
                os.set_blocking(process.stdin.fileno(), False)
                selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
            else:
                process.stdin.close()
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('native_source_command_deadline')
                for key, _ in selector.select(remaining):
                    if key.data == 'stdin':
                        try:
                            pending = pending[os.write(key.fd, pending):]
                        except BrokenPipeError:
                            pending = pending[:0]
                        if not pending:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        continue
                    chunk = os.read(key.fd, 4097 - counts[key.data])
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    counts[key.data] += len(chunk)
                    if key.data == 'stdout': output.extend(chunk[:4096 - len(output)])
                    if counts[key.data] > 4096:
                        raise ValueError('native_source_command_size')
            # Observe exit without reaping. The zombie leader retains this PGID until
            # finally kills the owned group, so PID reuse cannot target a foreign group.
            while True:
                status = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if status is not None:
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('native_source_command_deadline')
                time.sleep(min(.01, remaining))
            if status.si_code != os.CLD_EXITED or status.si_status != 0:
                raise RuntimeError('native_source_command_exit')
            return bytes(output)
    finally:
        primary = sys.exc_info()
        signal_groups({process.pid}, signal.SIGKILL)
        process.wait(timeout=1)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None: stream.close()
        if observe_failure is not None:
            try: observe_failure(bytes(output), process.returncode)
            except BaseException:
                if primary[1] is None: raise
                BaseException.__traceback__.__set__(primary[1], primary[2])
