"""Machine-wide two-slot admission for local heavy commands (macOS/Linux)."""
import fcntl
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

OWNER = 'INSIDE_HEAVY_CHECK_OWNER'
POLL_SECONDS = 0.25
STOP_SECONDS = 5


def ancestors():
    result = []
    ancestor = os.getppid()
    while ancestor > 1:
        result.append(ancestor)
        parent = subprocess.run(
            ['ps', '-o', 'ppid=', '-p', str(ancestor)],
            capture_output=True, text=True, check=False,
        ).stdout.strip()
        if not parent.isdecimal():
            break
        ancestor = int(parent)
    return result


def owner_alive(parents):
    value = os.environ.get(OWNER, '')
    return value.isdecimal() and int(value) in parents


def parents_alive(parents):
    result = subprocess.run(
        ['ps', '-o', 'pid=,stat=', '-p', ','.join(map(str, parents))],
        capture_output=True, text=True, check=False,
    )
    live = set()
    for line in result.stdout.splitlines():
        pid, state = line.split()
        # kill(pid, 0) still succeeds for a killed parent awaiting waitpid.
        if 'Z' not in state:
            live.add(int(pid))
    return all(parent in live for parent in parents)


def cancelled(read_fd, timeout=0):
    return bool(select.select([read_fd], [], [], timeout)[0])


def process_snapshot():
    result = subprocess.run(
        ['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart='],
        capture_output=True, text=True, check=True,
    )
    snapshot = {}
    for line in result.stdout.splitlines():
        pid, parent, group, state, started = line.split(maxsplit=4)
        snapshot[int(pid)] = (int(parent), int(group), state, started)
    return snapshot


def track_descendants(process, tracked):
    snapshot = process_snapshot()
    # Start time prevents signalling an unrelated process if a saved PID is reused.
    live = {
        pid for pid, started in tracked.items()
        if pid in snapshot and snapshot[pid][3] == started
    }
    if not tracked and process.poll() is None:
        live.add(process.pid)
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
    return {
        snapshot[pid][1] for pid in live
        if pid in snapshot and 'Z' not in snapshot[pid][2]
    }


def signal_groups(groups, signum):
    for group in groups:
        try:
            os.killpg(group, signum)
        except ProcessLookupError:
            pass


def stop_groups(process, tracked):
    groups = track_descendants(process, tracked)
    signal_groups(groups, signal.SIGTERM)
    deadline = time.monotonic() + STOP_SECONDS
    signalled = set(groups)
    while groups:
        process.poll()
        groups = track_descendants(process, tracked)
        if time.monotonic() >= deadline:
            signal_groups(groups, signal.SIGKILL)
        else:
            # Signal each group once, so graceful shutdown handlers can finish.
            signal_groups(groups - signalled, signal.SIGTERM)
            signalled.update(groups)
        if groups:
            time.sleep(POLL_SECONDS)
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
    process = None
    tracked = {}
    try:
        waiting = False
        while not cancelled(read_fd) and parents_alive(parents):
            for slot in slots:
                try:
                    fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                print(f'heavy-check: acquired {slot.name}', file=sys.stderr, flush=True)
                environment = dict(os.environ, **{OWNER: str(os.getpid())})
                process = subprocess.Popen(
                    command, env=environment, start_new_session=True,
                    preexec_fn=command_signals,
                )
                while process.poll() is None:
                    track_descendants(process, tracked)
                    if cancelled(read_fd, POLL_SECONDS) or not parents_alive(parents):
                        return 143
                returncode = process.returncode
                return returncode if returncode >= 0 else 128 - returncode
            if not waiting:
                print('heavy-check: waiting for one of two local slots', file=sys.stderr, flush=True)
                waiting = True
            cancelled(read_fd, POLL_SECONDS)
        return 143
    finally:
        if process is not None:
            stop_groups(process, tracked)
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
