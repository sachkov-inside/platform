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
from lock import (ExitEvents, adopt_orphans, ancestors, track_descendants, signal_groups,
                  command_signals, process_snapshot)
from ownership import ProcessOwnership

SIGNAL_WAIT_SECONDS = 0.5


class LifecycleTrace:
    """Opt-in bounded facts; never capture commands, environment or command output."""
    def __init__(self):
        self.started = time.monotonic()
        self.output = None
        destination = os.environ.pop('INSIDE_OWNED_PROCESS_TRACE', None)
        if destination:
            try:
                descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC |
                                     os.O_NOFOLLOW, 0o600)
                self.output = os.fdopen(descriptor, 'w')
            except OSError:
                print('owned-process: lifecycle trace unavailable', file=sys.stderr)

    def record(self, phase, status=None):
        if self.output is None:
            return
        row = dict(phase=phase, elapsedMs=round((time.monotonic() - self.started) * 1000, 3))
        if status is not None:
            row['status'] = status
        try:
            self.output.write(json.dumps(row) + '\n')
            self.output.flush()
        except OSError:
            self.close()
            self.output = None

    def close(self):
        if self.output is not None:
            try:
                self.output.close()
            except OSError:
                pass


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
    trace = LifecycleTrace()
    trace.record('supervisor-start')
    ownership = ProcessOwnership()
    try:
        command = json.loads(sys.argv[1])
        parents = ancestors()
        # A Node test worker can outlive its CLI runner. Retain the launcher's PID
        # from the JS boundary even if it exits before Python enumerates ancestry.
        launching_parent = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        if launching_parent > 1 and launching_parent not in parents:
            parents.append(launching_parent)
        events = ExitEvents(3, parents)
        if events.wait(0):
            return 143
        adopt_orphans()
        process = subprocess.Popen(command, start_new_session=True,
                                   preexec_fn=command_signals, env=ownership.environment)
        trace.record('command-start')
        groups.add(process.pid)
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
                if events.dead & events.parents:
                    return 143
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
        trace.record('command-exit', status)
        return status if status >= 0 else 128 - status
    except OSError as error:
        print(f'owned-process: {error}', file=sys.stderr, flush=True)
        return 127
    finally:
        try:
            if process is not None:
                trace.record('cleanup-start')
                stop_tree(process, tracked, groups, grace, ownership)
                trace.record('cleanup-complete', process.returncode)
        finally:
            if events is not None:
                events.close()
            trace.close()


if __name__ == '__main__':
    sys.exit(main())
