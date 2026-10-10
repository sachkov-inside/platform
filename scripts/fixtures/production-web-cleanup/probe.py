"""Exercise the shipped production launcher and API with an installed synthetic Next command."""
import argparse
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

READY_SECONDS = 10
SHUTDOWN_SECONDS = 15  # Includes the shipped API's five-second TERM grace and KILL/reap budget.
CLEANUP_SECONDS = 5
STATE_PROBE_SECONDS = 0.05

# Only the negative fixture replaces the API boundary. The launcher source stays unchanged.
RAW_API = """
import { spawn } from 'node:child_process';
const stops = new WeakMap();
export function spawnOwned(command, args = [], options = {}) {
  return spawn(command, args, { ...options, detached: true });
}
export function stopOwned(child) {
  if (stops.has(child)) return stops.get(child);
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined)
    return Promise.resolve();
  const stopping = new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGKILL');
  });
  stops.set(child, stopping);
  return stopping;
}
"""

LOAD = """
const { createServer } = require('node:net');
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});
const server = createServer(() => {});
server.listen(0, '127.0.0.1', () => process.send({ pid: process.pid, port: server.address().port }));
"""

NEXT = """
const { spawn } = require('node:child_process');
if (!process.argv.includes('start')) throw new Error('Expected the real next start command');
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});
const load = spawn(process.execPath, ['-e', LOAD_SOURCE], {
  detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
load.once('error', error => { console.error(error); process.exit(1); });
load.once('message', ready => console.log('READY', process.pid, ready.pid, ready.port));
""".replace('LOAD_SOURCE', json.dumps(LOAD))


class ControllerInterrupted(Exception):
    def __init__(self, signum):
        super().__init__(f'Controller received signal {signum}')
        self.signum = signum


def interrupted(signum, _frame):
    raise ControllerInterrupted(signum)


def install(base, source, mode):
    app = base / 'apps/web'
    support = app / 'test/support'
    support.mkdir(parents=True)
    launcher_source = source / 'apps/web/test/support/production-web.mjs'
    launcher = support / 'production-web.mjs'
    shutil.copyfile(launcher_source, launcher)
    if launcher.read_bytes() != launcher_source.read_bytes():
        raise AssertionError('Fixture changed the shipped launcher source')
    if mode == 'missing-group-cleanup':
        (base / 'scripts').mkdir()
        (base / 'scripts/owned-process.mjs').write_text(RAW_API)
    else:
        # Preserve the real API, Python supervisor and its native ownership dependencies together.
        (base / 'scripts').symlink_to(source / 'scripts', target_is_directory=True)
    (app / 'package.json').write_text('{"name":"cleanup-fixture","private":true,"type":"module"}')
    package = app / 'node_modules/next'
    executable = package / 'dist/bin/next'
    executable.parent.mkdir(parents=True)
    (package / 'package.json').write_text(json.dumps({
        'name': 'next', 'type': 'commonjs', 'exports': {'./dist/bin/next': './dist/bin/next'},
    }))
    executable.write_text(NEXT)
    return app, launcher


def remaining(deadline, label):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise RuntimeError(f'Timed out waiting for {label}')
    return seconds


def ready(process):
    deadline = time.monotonic() + READY_SECONDS
    line = b''
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            if not selector.select(remaining(deadline, 'listening load readiness')):
                raise RuntimeError('Readiness timeout')
            byte = os.read(process.stdout.fileno(), 1)
            if not byte:
                raise RuntimeError(f'Launcher exited before readiness: {line.decode(errors="replace")}')
            line += byte
            if byte == b'\n':
                if line.startswith(b'READY '):
                    fields = line.split()
                    if len(fields) != 4:
                        raise RuntimeError(f'Invalid readiness: {line!r}')
                    pids_and_port = tuple(map(int, fields[1:]))
                    if any(value <= 0 for value in pids_and_port):
                        raise RuntimeError(f'Invalid readiness: {line!r}')
                    return pids_and_port
                line = b''


def census(root_pid, owned, groups, process_snapshot):
    # Census only at readiness and fallback cleanup; state waits inspect the recorded PIDs.
    rows = process_snapshot()
    discovered = {root_pid, *owned}
    while True:
        children = {pid for pid, row in rows.items() if row[0] in discovered}
        if children <= discovered:
            break
        discovered.update(children)
    for pid in discovered:
        row = rows.get(pid)
        if row is not None and (pid not in owned or owned[pid] == row[3]):
            owned[pid] = row[3]
            groups.add(row[1])


def live_rows(owned, process_row):
    return {pid: row for pid, birth in owned.items()
            if (row := process_row(pid)) is not None and row[3] == birth and row[2] != 'Z'}


def stopped(owned, deadline, process_row):
    while live := live_rows(owned, process_row):
        seconds = remaining(deadline, f'owned processes to stop: {live}')
        # The observed non-running state ends the wait; the cadence does not prove completion.
        time.sleep(min(STATE_PROBE_SECONDS, seconds))


def tcp_closed(connection, deadline):
    with selectors.DefaultSelector() as selector:
        selector.register(connection, selectors.EVENT_READ)
        if not selector.select(remaining(deadline, 'owned load TCP close')):
            raise RuntimeError('Owned load TCP connection stayed open')
        if connection.recv(1):
            raise RuntimeError('Unexpected data from owned load')


def exercise(options, process_row, process_snapshot):
    source = options.root.resolve()
    with tempfile.TemporaryDirectory(prefix='platform-production-cleanup-') as directory:
        base = Path(directory)
        app, launcher = install(base, source, options.mode)
        env = dict(os.environ, PRODUCTION_WEB_SKIP_BUILD='1', PRODUCTION_WEB_PORT='0',
                   PRODUCTION_WEB_BACKEND_URL='http://127.0.0.1:1')
        process = subprocess.Popen(
            [options.node, str(launcher)], cwd=app, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, bufsize=0)
        owned = {}
        groups = {process.pid}
        connection = None
        try:
            next_pid, load_pid, port = ready(process)
            census(process.pid, owned, groups, process_snapshot)
            if not {process.pid, next_pid, load_pid} <= owned.keys():
                raise RuntimeError('Native census did not observe the ready launcher and load')
            load_row = process_row(load_pid)
            if load_row is None or load_row[1] != load_pid or load_row[2] == 'Z':
                raise RuntimeError('Ready load exited or is not actually detached')
            connection = socket.create_connection(('127.0.0.1', port), timeout=READY_SECONDS)
            print('GROUPS', *sorted(groups), flush=True)
            status = 0
            if options.mode == 'controller-signal':
                try:
                    os.kill(os.getpid(), signal.SIGTERM)
                except ControllerInterrupted as error:
                    status = 128 + error.signum
            # Signal the real launcher only after the ready process census and live TCP connection.
            os.killpg(process.pid, signal.SIGTERM)
            deadline = time.monotonic() + SHUTDOWN_SECONDS
            process.wait(timeout=remaining(deadline, 'launcher exit'))
            if process.returncode != 128 + signal.SIGTERM:
                raise RuntimeError(f'SIGTERM status was masked: {process.returncode}')
            try:
                process.communicate(timeout=remaining(deadline, 'launcher capture pipe close'))
            except subprocess.TimeoutExpired as error:
                if options.mode == 'missing-group-cleanup' and load_pid in live_rows(owned, process_row):
                    raise RuntimeError('owned load survived launcher-only shutdown') from error
                raise RuntimeError('launcher pipes stayed open after readiness and SIGTERM') from error
            tcp_closed(connection, deadline)
            stopped(owned, deadline, process_row)
            # This fact is emitted before fallback cleanup, including for controller interruption.
            print('STOPPED', flush=True)
            return status
        finally:
            census(process.pid, owned, groups, process_snapshot)
            print('GROUPS', *sorted(groups), flush=True)
            for group in {row[1] for row in live_rows(owned, process_row).values()} | {process.pid}:
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=CLEANUP_SECONDS)
            stopped(owned, time.monotonic() + CLEANUP_SECONDS, process_row)
            if connection is not None:
                connection.close()
            if process.stdout is not None:
                process.stdout.close()
            print('CLEANED', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('launcher-signal', 'controller-signal', 'missing-group-cleanup'))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--node', required=True)
    options = parser.parse_args()
    sys.path.insert(0, str(options.root / 'scripts/heavy-check'))
    from processes import process_row, process_snapshot
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    sys.exit(exercise(options, process_row, process_snapshot))
