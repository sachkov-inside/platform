"""Supervise one command tree while its Node owner holds control fd 3 open."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / 'heavy-check'))
sys.path.insert(0, str(Path(__file__).parent / 'owned-process'))
from lock import (ExitEvents, adopt_orphans, track_descendants, signal_groups,
                  command_signals, process_snapshot)
from ownership import ProcessOwnership

SIGNAL_WAIT_SECONDS = 0.5


def reap_descendants(process, tracked):
    if sys.platform == 'linux':
        for pid in list(tracked):
            if pid != process.pid:
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass


def track_tree(process, tracked, groups, ownership):
    if ownership.library is not None:
        ownership.include(process_snapshot(), tracked, groups)
    return track_descendants(process, tracked, groups)


def stop_tree(process, tracked, groups, grace, ownership):
    deadline = time.monotonic() + grace
    kill_deadline = deadline + 5
    signalled = set()
    while True:
        process.poll()
        reap_descendants(process, tracked)
        live = track_tree(process, tracked, groups, ownership)
        if not live:
            reap_descendants(process, tracked)
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
    events = None
    tracked = {}
    groups = set()
    grace = 5
    ownership = ProcessOwnership()
    try:
        command = json.loads(sys.argv[1])
        adopt_orphans()
        process = subprocess.Popen(command, start_new_session=True,
                                   preexec_fn=command_signals, env=ownership.environment)
        groups.add(process.pid)
        events = ExitEvents(3, [])
        events.watch(process.pid, forks=True)
        track_tree(process, tracked, groups, ownership)
        for pid in tracked:
            events.watch(pid, forks=True)
        while process.pid not in events.dead and process.poll() is None:
            if stopping:
                return 143
            # The timeout only lets Python observe its signal handler; ownership census
            # is driven by native fork/exit events, not by a process-table polling loop.
            if events.wait(SIGNAL_WAIT_SECONDS):
                # EOF also detects normal exit and SIGKILL of the Node owner.
                request = os.read(3, 4096)
                if request:
                    grace = max(0, float(request.decode().strip()) / 1000)
                return 143
            if events.tree_changed:
                events.tree_changed = False
                track_tree(process, tracked, groups, ownership)
                for pid in tracked:
                    events.watch(pid, forks=True)
        status = process.wait()
        return status if status >= 0 else 128 - status
    except OSError as error:
        print(f'owned-process: {error}', file=sys.stderr, flush=True)
        return 127
    finally:
        try:
            if process is not None:
                stop_tree(process, tracked, groups, grace, ownership)
        finally:
            if events is not None:
                events.close()


if __name__ == '__main__':
    sys.exit(main())
