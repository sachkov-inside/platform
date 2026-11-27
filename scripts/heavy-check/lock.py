"""Machine-wide admission and supervision for local heavy commands."""
import fcntl
import json
import os
from pathlib import Path
import random
import select
import signal
import subprocess
import sys
import time

from processes import adopt_orphans, process_row, process_snapshot, darwin_group_exited

OWNER = 'INSIDE_HEAVY_CHECK_OWNER'
EXCLUSIVE = 'INSIDE_HEAVY_CHECK_EXCLUSIVE'
WAIT_SECONDS = 2
CLEANUP_POLL_SECONDS = 0.25
STOP_SECONDS = 5
MAC_DEADLINE_SECONDS = 900
PRESSURE_POLL_SECONDS = 2


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
        except PermissionError:
            # Darwin returns EPERM for an extant group with only unreaped zombies.
            # Exit can race the caller's census. Prove native exit for every member;
            # missing BSD info alone cannot distinguish zombies from restricted live PIDs.
            if sys.platform != 'darwin' or not darwin_group_exited(group):
                raise


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


class AdmissionQueue:
    """Serialize ticket registration and let only the oldest live ticket claim a slot."""
    def __init__(self, directory):
        self.directory = directory / 'waiters'
        self.directory.mkdir(exist_ok=True)
        self.mutex = open(directory / 'queue.lock', 'a')
        self.ticket = None

    def acquire(self, slots, exclusive, ready):
        try:
            fcntl.flock(self.mutex, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return None
        try:
            tickets = sorted(self.directory.iterdir(), key=lambda path: int(path.name))
            if self.ticket is None:
                number = int(tickets[-1].name) + 1 if tickets else 0
                self.ticket = open(self.directory / str(number), 'x')
                fcntl.flock(self.ticket, fcntl.LOCK_EX)
                tickets.append(Path(self.ticket.name))
            for path in tickets:
                if path == Path(self.ticket.name):
                    break
                with open(path, 'r') as older:
                    try:
                        fcntl.flock(older, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        return None
                    # The kernel releases ticket ownership even after supervisor SIGKILL.
                    path.unlink()
            if not ready():
                return False
            acquired = []
            for slot in slots:
                try:
                    fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    if exclusive:
                        break
                    continue
                acquired.append(slot)
                if not exclusive or len(acquired) == len(slots):
                    break
            if acquired and (not exclusive or len(acquired) == len(slots)):
                Path(self.ticket.name).unlink()
                self.ticket.close()
                self.ticket = None
                return acquired
            for slot in acquired:
                fcntl.flock(slot, fcntl.LOCK_UN)
            return None
        finally:
            fcntl.flock(self.mutex, fcntl.LOCK_UN)

    def close(self):
        if self.ticket is not None:
            # A later admission removes the unlocked ticket under the queue mutex.
            self.ticket.close()
        self.mutex.close()


def pressure():
    if sys.platform != 'darwin':
        return 1
    try:
        result = subprocess.run(
            ['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'],
            capture_output=True, text=True, timeout=1, check=True,
        )
        # The public sysctl returns NOTE_MEMORYSTATUS_PRESSURE_* masks.
        return {1: 1, 2: 2, 4: 4}.get(int(result.stdout))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def record_stop(directory, reason, pid, elapsed):
    print(f'heavy-check: {reason} (elapsed={elapsed}s, pid={pid})',
          file=sys.stderr, flush=True)
    try:
        path = directory / 'last-stop.json'
        path.write_text(json.dumps({
            'reason': reason,
            'pid': pid,
            'elapsedSeconds': elapsed,
            'unixSeconds': int(time.time()),
        }) + '\n')
    except OSError:
        print('heavy-check: could not save stop receipt', file=sys.stderr, flush=True)


def supervise(read_fd, command, parents, exclusive, timeout):
    directory = Path(os.environ.get(
        'INSIDE_HEAVY_CHECK_DIRECTORY',
        str(Path.home() / '.cache/inside-platform/heavy-check'),
    ))
    directory.mkdir(parents=True, exist_ok=True)
    slots = [open(directory / f'slot-{index}.lock', 'a') for index in range(2)]
    events = ExitEvents(read_fd, parents)
    admission = AdmissionQueue(directory)
    process = None
    tracked = {}
    known_groups = set()
    try:
        waiting = False
        while not events.wait(0):
            admitted = admission.acquire(slots, exclusive, lambda: pressure() == 1)
            if admitted:
                names = ', '.join(slot.name for slot in admitted)
                print(f'heavy-check: acquired {names}', file=sys.stderr, flush=True)
                environment = dict(os.environ, **{OWNER: str(os.getpid()), EXCLUSIVE: str(int(exclusive))})
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
                # Registration can already report exit. NOTE_EXIT can also precede
                # waitpid readiness: never wait for a second exit event.
                started = time.monotonic()
                sample_at = started + PRESSURE_POLL_SECONDS
                deadline = started + timeout if timeout else float('inf')
                while process.pid not in events.dead and process.poll() is None:
                    now = time.monotonic()
                    if now >= deadline:
                        record_stop(directory, 'deadline exceeded', process.pid, int(now - started))
                        return 124
                    if sys.platform == 'darwin' and now >= sample_at:
                        level = pressure()
                        if level == 4:
                            elapsed = int(time.monotonic() - started)
                            record_stop(directory, 'critical memory pressure', process.pid, elapsed)
                            return 125
                        sample_at = time.monotonic() + PRESSURE_POLL_SECONDS
                    wake = min(deadline, sample_at) if sys.platform == 'darwin' else deadline
                    if events.wait(None if wake == float('inf') else max(0, wake - time.monotonic())):
                        return 143
                    if events.tree_changed:
                        events.tree_changed = False
                        track_descendants(process, tracked, known_groups)
                        for pid in tracked:
                            events.watch(pid, forks=True)
                returncode = process.wait()
                return returncode if returncode >= 0 else 128 - returncode
            reason = 'for normal memory pressure' if admitted is False else 'for local capacity'
            if reason != waiting and admission.ticket is not None:
                print(f'heavy-check: waiting {reason}', file=sys.stderr, flush=True)
                waiting = reason
            if events.wait(random.uniform(WAIT_SECONDS * 0.75, WAIT_SECONDS * 1.25)):
                return 143
        return 143
    finally:
        if process is not None:
            stop_groups(process, tracked, known_groups)
        events.close()
        admission.close()
        for slot in slots:
            slot.close()
        os.close(read_fd)


def main():
    command = sys.argv[1:]
    isolated_test = (
        os.environ.get('INSIDE_HEAVY_CHECK_TWO_SLOTS') == '1'
        and 'INSIDE_HEAVY_CHECK_DIRECTORY' in os.environ
    )
    exclusive = sys.platform == 'darwin' and not isolated_test
    timeout = MAC_DEADLINE_SECONDS if exclusive else 0
    if command and command[0] == '--exclusive':
        exclusive = True
        command = command[1:]
    if command and command[0] == '--timeout':
        if len(command) < 3 or not command[1].isdecimal() or int(command[1]) < 1:
            print('heavy-check: --timeout must be a positive number of seconds', file=sys.stderr)
            return 2
        timeout = int(command[1])
        command = command[2:]
    if command == ['--owns']:
        return 0 if owner_alive(ancestors()) else 1
    if not command:
        print('usage: heavy-check.sh [--exclusive] [--timeout SECONDS] COMMAND [ARG ...]', file=sys.stderr)
        return 2
    parents = ancestors()
    if owner_alive(parents):
        if exclusive and os.environ.get(EXCLUSIVE) != '1':
            print('heavy-check: an exclusive run cannot reuse a shared slot', file=sys.stderr)
            return 2
        os.execvp(command[0], command)
    read_fd, write_fd = os.pipe()
    interrupted = 0

    def interrupt(signum, _frame):
        nonlocal interrupted, write_fd
        interrupted = signum
        if write_fd is not None:
            os.close(write_fd)
            write_fd = None

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupt)
    # The supervisor may report waiting before the parent returns from fork.
    child = os.fork()
    if child == 0:
        # pnpm 12 kills the script's whole process group when its parent exits.
        # Keep the supervisor alive to drain detached children before releasing its slot.
        os.setsid()
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, signal.SIG_IGN)
        if write_fd is not None:
            os.close(write_fd)
        try:
            status = supervise(read_fd, command, parents, exclusive, timeout)
        except Exception as error:
            print(f'heavy-check: {error}', file=sys.stderr, flush=True)
            status = 1
        os._exit(status)
    os.close(read_fd)
    _, status = os.waitpid(child, 0)
    if write_fd is not None:
        os.close(write_fd)
    return 128 + interrupted if interrupted else os.waitstatus_to_exitcode(status)


if __name__ == '__main__':
    sys.exit(main())
