"""Bound the scratch COPY command using the repository's existing tree supervisor."""
import json
import math
import os
from pathlib import Path
import signal
import sys
import threading


def main():
    budget = float(os.environ.get('LOCAL_CONTEXT_BUILD_TIMEOUT_SECONDS', '60'))
    if not math.isfinite(budget) or not 0 < budget <= 60:
        raise ValueError('Context build budget must be positive and at most 60 seconds')
    context, output = sys.argv[1:]
    command = ['docker', 'buildx', 'build', '--network=none', '--pull=false',
               '--progress=plain', '--output', f'type=local,dest={output}', context]
    read_fd, write_fd = os.pipe()
    supervisor = os.fork()
    if supervisor == 0:
        os.close(write_fd)
        # Survive termination of the command's owner/group to finish descendant cleanup.
        os.setsid()
        if read_fd != 3:
            os.dup2(read_fd, 3)
            os.close(read_fd)
        os.set_inheritable(3, True)
        runner = Path(__file__).with_name('owned-process.py')
        os.execv(sys.executable, [sys.executable, str(runner),
                                 json.dumps(command), str(os.getppid())])
    os.close(read_fd)
    interrupted = None
    expired = False

    def stop():
        try:
            # Zero grace makes the deadline request force termination of the owned tree.
            os.write(write_fd, b'0\n')
        except BrokenPipeError:
            pass  # The supervisor has already completed tree cleanup.

    def interrupt(signum, _frame):
        nonlocal interrupted
        interrupted = signum
        stop()

    def deadline():
        nonlocal expired
        expired = True
        stop()

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupt)
    timer = threading.Timer(budget, deadline)
    try:
        timer.start()
        _, status = os.waitpid(supervisor, 0)
        result = os.waitstatus_to_exitcode(status)
        if interrupted is not None:
            return 128 + interrupted
        if expired and result == 143:
            print('Context build exceeded its execution budget', file=sys.stderr)
            return 124
        return result if result >= 0 else 128 - result
    finally:
        timer.cancel()
        timer.join()
        os.close(write_fd)
        try:
            os.waitpid(supervisor, 0)
        except ChildProcessError:
            pass  # Normal completion already reaped the supervisor.


if __name__ == '__main__':
    sys.exit(main())
