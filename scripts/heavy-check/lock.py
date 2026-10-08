"""Machine-wide two-slot admission for local heavy commands (macOS/Linux)."""
import fcntl
import os
from pathlib import Path
import random
import select
import signal
import subprocess
import sys
import time

from processes import adopt_orphans, process_row, process_snapshot

OWNER = 'INSIDE_HEAVY_CHECK_OWNER'
WAIT_SECONDS = 2
CLEANUP_POLL_SECONDS = 0.25
STOP_SECONDS = 5


def ancestors():
    result = []
    ancestor = os.getppid()
    while ancestor > 1 and ancestor not in result:
        result.append(ancestor)
        row = process_row(ancestor)
        ancestor = row[0] if row is not None else 1
    return result


def owner_alive(parents):
    value = os.environ.get(OWNER, '')
    return value.isdecimal() and int(value) in parents


class ExitEvents:
    """Wait for cancellation or process exit, including unreaped zombie parents."""
    def __init__(self, read_fd, parents):
        self.read_fd = read_fd
        self.parents = set(parents)
        self.dead = set()
        self.pidfds = {}
        self.watched = set()
        self.tree_changed = False
        self.queue = select.kqueue() if hasattr(select, 'kqueue') else None
        if self.queue is not None:
            self.queue.control([select.kevent(read_fd, filter=select.KQ_FILTER_READ,
                                              flags=select.KQ_EV_ADD)], 0, 0)
        try:
            for pid in parents:
                self.watch(pid)
        except BaseException:
            self.close()
            raise

    def watch(self, pid, forks=False):
        if pid in self.watched:
            return
        try:
            if self.queue is not None:
                self.queue.control([select.kevent(
                    pid, filter=select.KQ_FILTER_PROC,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                    fflags=select.KQ_NOTE_EXIT | (select.KQ_NOTE_FORK if forks else 0),
                )], 0, 0)
            else:
                self.pidfds[os.pidfd_open(pid)] = pid
            self.dead.discard(pid)
            self.watched.add(pid)
        except ProcessLookupError:
            self.dead.add(pid)

    def wait(self, timeout=None):
        if self.queue is not None:
            events = self.queue.control([], len(self.watched) + 1, timeout)
            for event in events:
                if event.filter == select.KQ_FILTER_READ:
                    return True
                if event.fflags & select.KQ_NOTE_EXIT:
                    self.dead.add(event.ident)
                    self.watched.discard(event.ident)
                if event.fflags & select.KQ_NOTE_FORK:
                    self.tree_changed = True
        else:
            ready, _, _ = select.select([self.read_fd, *self.pidfds], [], [], timeout)
            if self.read_fd in ready:
                return True
            for fd in ready:
                pid = self.pidfds.pop(fd)
                self.dead.add(pid)
                self.watched.discard(pid)
                os.close(fd)
        return bool(self.dead & self.parents)

    def close(self):
        if self.queue is not None:
            self.queue.close()
        for fd in self.pidfds:
            os.close(fd)


def track_descendants(process, tracked, known_groups):
    snapshot = process_snapshot()
    # Start time prevents signalling an unrelated process if a saved PID is reused.
    live = {
        pid for pid, started in tracked.items()
        if pid in snapshot and snapshot[pid][3] == started
    }
    for group in list(known_groups):
        leader = snapshot.get(group)
        if leader is not None and group in tracked and leader[3] != tracked[group]:
            known_groups.remove(group)
    # A group outlives its leader. Reparented, newly spawned members still belong to it.
    live.update(pid for pid, row in snapshot.items() if row[1] in known_groups)
    if not tracked and process.poll() is None:
        live.add(process.pid)
    if sys.platform == 'linux':
        # Subreaper ownership includes detached children whose parents already exited.
        live.update(pid for pid, row in snapshot.items() if row[0] == os.getpid())
    while True:
        descendants = {
            pid for pid, (parent, _group, _state, _started) in snapshot.items()
            if parent in live
        }
        if descendants <= live:
            break
        live.update(descendants)
    for pid in live:
        if pid in snapshot:
            tracked[pid] = snapshot[pid][3]
    groups = {
        snapshot[pid][1] for pid in live
        if pid in snapshot and 'Z' not in snapshot[pid][2]
    }
    known_groups.clear()
    known_groups.update(groups)
    return groups


def signal_groups(groups, signum):
    for group in groups:
        try:
            os.killpg(group, signum)
        except ProcessLookupError:
            pass


def stop_groups(process, tracked, known_groups):
    groups = track_descendants(process, tracked, known_groups)
    signal_groups(groups, signal.SIGTERM)
    deadline = time.monotonic() + STOP_SECONDS
    signalled = set(groups)
    while groups:
        process.poll()
        if sys.platform == 'linux':
            for pid in list(tracked):
                if pid != process.pid:
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
        groups = track_descendants(process, tracked, known_groups)
        if time.monotonic() >= deadline:
            signal_groups(groups, signal.SIGKILL)
        else:
            # Signal each group once, so graceful shutdown handlers can finish.
            signal_groups(groups - signalled, signal.SIGTERM)
            signalled.update(groups)
        if groups:
            time.sleep(CLEANUP_POLL_SECONDS)
    process.wait()


def command_signals():
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, signal.SIG_DFL)


def supervise(read_fd, command, parents):
    directory = Path(os.environ.get(
        'INSIDE_HEAVY_CHECK_DIRECTORY',
        str(Path.home() / '.cache/inside-platform/heavy-check'),
    ))
    directory.mkdir(parents=True, exist_ok=True)
    slots = [open(directory / f'slot-{index}.lock', 'a') for index in range(2)]
    events = ExitEvents(read_fd, parents)
    process = None
    tracked = {}
    known_groups = set()
    try:
        waiting = False
        while not events.wait(0):
            for slot in slots:
                try:
                    fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                print(f'heavy-check: acquired {slot.name}', file=sys.stderr, flush=True)
                environment = dict(os.environ, **{OWNER: str(os.getpid())})
                adopt_orphans()
                process = subprocess.Popen(
                    command, env=environment, start_new_session=True,
                    preexec_fn=command_signals,
                )
                known_groups.add(process.pid)
                events.watch(process.pid, forks=True)
                track_descendants(process, tracked, known_groups)
                for pid in tracked:
                    events.watch(pid, forks=True)
                while process.poll() is None:
                    if events.wait():
                        return 143
                    if events.tree_changed:
                        events.tree_changed = False
                        track_descendants(process, tracked, known_groups)
                        for pid in tracked:
                            events.watch(pid, forks=True)
                    if process.pid in events.dead:
                        # NOTE_EXIT precedes waitpid readiness on macOS. Never wait
                        # for a second exit event after consuming the first one.
                        break
                returncode = process.wait()
                return returncode if returncode >= 0 else 128 - returncode
            if not waiting:
                print('heavy-check: waiting for one of two local slots', file=sys.stderr, flush=True)
                waiting = True
            if events.wait(random.uniform(WAIT_SECONDS * 0.75, WAIT_SECONDS * 1.25)):
                return 143
        return 143
    finally:
        if process is not None:
            stop_groups(process, tracked, known_groups)
        events.close()
        for slot in slots:
            slot.close()
        os.close(read_fd)


def main():
    command = sys.argv[1:]
    if not command:
        print('usage: heavy-check.sh COMMAND [ARG ...]', file=sys.stderr)
        return 2
    parents = ancestors()
    if owner_alive(parents):
        os.execvp(command[0], command)
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, signal.SIG_IGN)
        os.close(write_fd)
        try:
            status = supervise(read_fd, command, parents)
        except Exception as error:
            print(f'heavy-check: {error}', file=sys.stderr, flush=True)
            status = 1
        os._exit(status)
    os.close(read_fd)
    interrupted = 0

    def interrupt(signum, _frame):
        nonlocal interrupted, write_fd
        interrupted = signum
        if write_fd is not None:
            os.close(write_fd)
            write_fd = None

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupt)
    _, status = os.waitpid(child, 0)
    if write_fd is not None:
        os.close(write_fd)
    return 128 + interrupted if interrupted else os.waitstatus_to_exitcode(status)


if __name__ == '__main__':
    sys.exit(main())
