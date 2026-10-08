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
POLL_SECONDS = 0.1
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
    for parent in parents:
        try:
            os.kill(parent, 0)
        except ProcessLookupError:
            return False
    return True


def cancelled(read_fd, timeout=0):
    return bool(select.select([read_fd], [], [], timeout)[0])


def stop_group(process):
    # Stop descendants even when the command itself already exited.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + STOP_SECONDS
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(POLL_SECONDS)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
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
            stop_group(process)
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
