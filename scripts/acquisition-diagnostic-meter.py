"""Private #1324 meter: systemd owns the privileged leaf, never the SDK command."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import secrets
import selectors
import signal
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / 'heavy-check'))
from processes import process_row, process_snapshot, adopt_orphans, BsdInfo, LIBPROC
from lock import track_descendants

COMMAND_SECONDS_MAXIMUM = 10
METER_CLEANUP_RESERVE_SECONDS = 2
TERM_SECONDS_MAXIMUM = 0.5
UNIT_STOP_SECONDS_MAXIMUM = 0.5


def fingerprint(pid):
    row = process_row(pid)
    if row is None:
        return None
    if sys.platform == 'linux':
        fields = Path(f'/proc/{pid}/status').read_text().splitlines()
        uids = [int(value) for line in fields if line.startswith('Uid:') for value in line.split()[1:]]
        sid = int(Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[3])
    else:
        info = BsdInfo()
        assert LIBPROC.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) == ctypes.sizeof(info)
        uids = [info.ruid, info.uid, info.svuid]
        sid = os.getsid(pid)
    return {'pid': pid, 'ppid': row[0], 'pgid': row[1], 'state': row[2],
            'birth': list(row[3]) if isinstance(row[3], tuple) else row[3], 'uids': uids, 'sid': sid}


def same_process(saved):
    current = fingerprint(saved['pid'])
    return current is not None and current['birth'] == saved['birth'] and current['uids'] == saved['uids']


def save(directory, name, value, owner_uid):
    # Exclusive files inside the caller's verified private directory; no overwritten links.
    descriptor = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.geteuid() == 0:
            os.fchown(descriptor, owner_uid, -1)
        with os.fdopen(descriptor, 'w', closefd=False) as file:
            json.dump(value, file)
    finally:
        os.close(descriptor)


def worker(directory, request, command, expected_uid):
    """One private leaf; nonprivileged supplied commands are only a maintained test seam."""
    assert os.getuid() == expected_uid
    owner = request['owner']
    assert same_process(owner), 'caller identity changed before launch'
    assert directory.stat().st_uid == owner['uids'][0] and not directory.is_symlink()
    deadline = request['deadlineMonotonic']
    assert 0 < deadline - time.monotonic() <= COMMAND_SECONDS_MAXIMUM
    control = os.open(directory / 'control', os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    adopt_orphans()
    process = None
    tracked = {}
    groups = set()
    identities = {}
    buffers = [bytearray(), bytearray()]
    reason = None
    result = {'helper': fingerprint(os.getpid()), 'command': command, 'owner': owner, 'unit': request['unit'], 'pending': 'meter cleanup unproven'}
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        own = fingerprint(process.pid)
        assert own['pgid'] == process.pid and own['uids'][0] == expected_uid
        groups.add(process.pid)
        identities[process.pid] = own
        track_descendants(process, tracked, groups)
        save(directory, 'started.json', {'leaf': own, 'helper': fingerprint(os.getpid())}, owner['uids'][0])
        with selectors.DefaultSelector() as intake:
            intake.register(control, selectors.EVENT_READ, None)
            intake.register(process.stdout, selectors.EVENT_READ, 0)
            intake.register(process.stderr, selectors.EVENT_READ, 1)
            while process.poll() is None or len(intake.get_map()) > 1:
                live = track_descendants(process, tracked, groups)
                for pid, birth in tracked.items():
                    current = fingerprint(pid)
                    if current is not None and current['birth'] == (list(birth) if isinstance(birth, tuple) else birth):
                        identities[pid] = current
                try:
                    eof = os.read(control, 1) == b''
                except BlockingIOError:
                    eof = False
                if eof:
                    reason = 'owner EOF'
                    break
                if not same_process(owner):
                    reason = 'owner exited'
                    break
                if time.monotonic() >= deadline - METER_CLEANUP_RESERVE_SECONDS:
                    reason = 'command timeout'
                    break
                for key, _event in intake.select(timeout=0.02):
                    chunk = os.read(key.fd, 65536)
                    if key.data is None:
                        if not chunk:
                            reason = 'owner EOF'
                            break
                        continue
                    if not chunk:
                        intake.unregister(key.fileobj)
                        continue
                    capacity = request['diagnosticCapacityBytes'] - sum(map(len, buffers))
                    buffers[key.data].extend(chunk[:capacity])
                    if len(chunk) > capacity:
                        reason = 'diagnostics budget'
                        break
                if reason is not None:
                    break
    finally:
        # The privileged helper, not an unprivileged sudo client, closes verified leaf groups.
        term_end = min(deadline - 0.5, time.monotonic() + TERM_SECONDS_MAXIMUM)
        while process is not None:
            process.poll()
            for pid in list(tracked):
                if pid != process.pid and sys.platform == 'linux':
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
            live = track_descendants(process, tracked, groups)
            if not live:
                process.wait(timeout=max(0.01, deadline - time.monotonic()))
                break
            assert time.monotonic() < deadline - 0.25, 'meter native cleanup deadline'
            snapshot = process_snapshot()
            for group in live:
                members = {pid: row for pid, row in snapshot.items() if row[1] == group and row[2] != 'Z'}
                for pid, row in members.items():
                    assert pid in tracked and row[3] == tracked[pid], 'foreign group member'
                    current = fingerprint(pid)
                    assert current['uids'][0] == expected_uid, 'meter UID boundary differs'
                    identities[pid] = current
                try:
                    os.killpg(group, signal.SIGKILL if time.monotonic() >= term_end else signal.SIGTERM)
                except ProcessLookupError:
                    pass
            time.sleep(0.02)
        os.close(control)
        if process is not None:
            for pipe in (process.stdout, process.stderr):
                pipe.close()
        result.update(nativeExit=process.returncode if process is not None else None,
                      stopReason=reason, stdout=buffers[0].decode(errors='ignore'),
                      stderr=buffers[1].decode(errors='ignore'), fingerprints=list(identities.values()))
        assert not any(same_process(value) for value in identities.values()), 'meter child still exists'
        result['pending'] = 0
        save(directory, 'result.json', result, owner['uids'][0])
    return result


def launch_unit(directory, request):
    # Register systemd's independent cgroup cleaner BEFORE the privileged leaf can start.
    # The service is detached from the unprivileged owned-process ancestry/group.
    remaining = max(0.1, request['deadlineMonotonic'] - time.monotonic() - UNIT_STOP_SECONDS_MAXIMUM)
    command = ['sudo', '-n', 'systemd-run', '--quiet', '--no-block',
               '--collect', '--unit=' + request['unit'], '--property=Type=exec', '--property=KillMode=control-group',
               '--property=RuntimeMaxSec=' + str(remaining), '--property=TimeoutStopSec=' + str(UNIT_STOP_SECONDS_MAXIMUM),
               sys.executable, str(Path(__file__).resolve()), '--worker', str(directory)]
    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   check=True, timeout=max(0.01, request['deadlineMonotonic'] - time.monotonic()))


def measure(paths, output, timeout, capacity, *, launch=launch_unit, fixture=False, cancelled=lambda: False):
    assert 0 < timeout <= COMMAND_SECONDS_MAXIMUM and 0 <= capacity <= 1024**2
    directory = output / ('meter-' + secrets.token_hex(12))
    directory.mkdir(mode=0o700)
    os.mkfifo(directory / 'control', 0o600)
    control = os.open(directory / 'control', os.O_RDWR | os.O_NONBLOCK)
    request = {'owner': fingerprint(os.getpid()), 'paths': [str(path) for path in paths],
               'unit': 'inside-1324-meter-' + secrets.token_hex(12),
               'deadlineMonotonic': time.monotonic() + timeout, 'diagnosticCapacityBytes': capacity,
               'fixture': fixture}
    save(directory, 'request.json', request, os.getuid())
    cleanup_proven = False
    try:
        launch(directory, request)
        while not (directory / 'result.json').exists():
            if cancelled() and control is not None:
                os.close(control)
                control = None
            if time.monotonic() >= request['deadlineMonotonic'] - 0.1:
                raise subprocess.TimeoutExpired(['du', '-sk', *request['paths']], timeout)
            time.sleep(0.02)
        result = json.loads((directory / 'result.json').read_text())
        while same_process(result['helper']):
            assert time.monotonic() < request['deadlineMonotonic'], 'meter helper native exit unproven'
            time.sleep(0.02)
        assert result['pending'] == 0 and not any(same_process(value) for value in result['fingerprints'])
        cleanup_proven = True
        if result['stopReason'] == 'command timeout':
            error = subprocess.TimeoutExpired(result['command'], timeout, result['stdout'], result['stderr'])
            error.meter_receipt = result
            raise error
        if result['stopReason'] is not None or result['nativeExit'] != 0:
            error = subprocess.CalledProcessError(result['nativeExit'] or 1, result['command'], result['stdout'], result['stderr'])
            error.meter_receipt = result
            raise error
        return result
    except BaseException as error:
        error.meter_cleanup_pending = not cleanup_proven
        error.meter_directory = str(directory)
        raise
    finally:
        if control is not None:
            os.close(control)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', required=True)
    args = parser.parse_args()
    assert sys.platform == 'linux' and os.getuid() == 0, 'Root-owned ephemeral meter required'
    directory = Path(args.worker)
    assert not directory.is_symlink()
    request = json.loads((directory / 'request.json').read_text())
    command = ['du', '-sk', *request['paths']]
    if request['fixture']:
        command = [sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("native meter ready",flush=True); time.sleep(60)']
    worker(directory, request, command, 0)


if __name__ == '__main__':
    main()
