"""Supervise one command tree while its Node owner holds control fd 3 open."""
import json
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / 'heavy-check'))
from lock import track_descendants, signal_groups, command_signals, POLL_SECONDS


def stop_tree(process, tracked, groups, grace):
    deadline = time.monotonic() + grace
    kill_deadline = deadline + 5
    signalled = set()
    while True:
        process.poll()
        live = track_descendants(process, tracked, groups)
        if not live:
            process.wait()
            return
        if time.monotonic() >= deadline:
            signal_groups(live, signal.SIGKILL)
        else:
            signal_groups(live - signalled, signal.SIGTERM)
            signalled.update(live)
        if time.monotonic() >= kill_deadline:
            raise RuntimeError(f'command groups survived SIGKILL: {sorted(live)}')
        time.sleep(0.05)


def main():
    stopping = False

    def interrupt(_signum, _frame):
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, interrupt)
    process = None
    tracked = {}
    groups = set()
    grace = 5
    try:
        command = json.loads(sys.argv[1])
        process = subprocess.Popen(command, start_new_session=True,
                                   preexec_fn=command_signals)
        groups.add(process.pid)
        while process.poll() is None:
            track_descendants(process, tracked, groups)
            if stopping:
                return 143
            if select.select([3], [], [], POLL_SECONDS)[0]:
                # EOF also detects normal exit and SIGKILL of the Node owner.
                import os
                request = os.read(3, 4096)
                if request:
                    grace = max(0, float(request.decode().strip()) / 1000)
                return 143
        return process.returncode if process.returncode >= 0 else 128 - process.returncode
    except OSError as error:
        print(f'owned-process: {error}', file=sys.stderr, flush=True)
        return 127
    finally:
        if process is not None:
            stop_tree(process, tracked, groups, grace)


if __name__ == '__main__':
    sys.exit(main())
