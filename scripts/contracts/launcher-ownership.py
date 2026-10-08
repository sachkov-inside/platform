"""Run real web/backend launchers with installed fake external process boundaries."""
import argparse
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import socket
import subprocess
import tempfile
import time

READY_SECONDS = 15
STOP_SECONDS = 20

# This provider owns both a real listening HTTP socket and an independent control TCP connection.
# HTTP responses stay pending so the unchanged backend test is executing when its runner is killed.
PROVIDER = """
import { createServer } from 'node:http';
import { connect } from 'node:net';

process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
let control;
let healthRequested = false;
const server = createServer((request, _response) => {
  if (request.url === '/health') {
    healthRequested = true;
    if (control?.readyState === 'open')
      control.write(JSON.stringify({ event: 'health-request' }) + '\\n');
  }
});
server.listen(Number(process.env.API_PORT ?? process.env.PRODUCTION_WEB_PORT), '127.0.0.1', () => {
  control = connect(Number(process.env.LAUNCHER_CONTRACT_CONTROL_PORT), '127.0.0.1');
  control.once('connect', () => {
    control.write(JSON.stringify({
      event: 'ready', pid: process.pid,
      launcherPid: Number(process.env.LAUNCHER_CONTRACT_LAUNCHER_PID),
      surface: process.env.LAUNCHER_CONTRACT_SURFACE,
      port: server.address().port,
    }) + '\\n');
    if (healthRequested)
      control.write(JSON.stringify({ event: 'health-request' }) + '\\n');
  });
  control.on('error', error => { console.error(error); process.exit(1); });
});
"""

# The fake Next/pnpm executable creates a detached child with its own process group. Its pipes are
# captured deliberately: owner stdout EOF cannot be used as evidence that this child stopped.
COMMAND = """
const { spawn } = require('node:child_process');
const { join } = require('node:path');
if (process.argv.includes('build')) process.exit(0);
if (!process.argv.includes('start') && !process.argv.includes('dev:api'))
  throw new Error('Unexpected fixture command: ' + process.argv.slice(2).join(' '));
const child = spawn(process.execPath, [join(process.env.LAUNCHER_CONTRACT_ROOT, 'provider.mjs')], {
  detached: true,
  env: { ...process.env, LAUNCHER_CONTRACT_LAUNCHER_PID: String(process.pid) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr])
  stream.on('data', data => process.stderr.write(data));
child.once('error', error => { console.error(error); process.exit(1); });
child.once('exit', code => process.exit(code ?? 1));
"""


def install(root, source, node, vitest):
    web = root / 'apps/web'
    backend = root / 'apps/backend'
    for directory in (web / 'test/support', backend / 'test/support',
                      backend / 'src/migrations', backend / 'node_modules', root / 'bin'):
        directory.mkdir(parents=True, exist_ok=True)
    # No launcher rewriting: each runtime runs the same bytes as the repository source.
    for name in ('apps/web/test/support/production-web.mjs',
                 'apps/backend/test/dev-api.smoke.test.ts',
                 'apps/backend/test/support/matchers.ts'):
        shutil.copyfile(source / name, root / name)
        if (source / name).read_bytes() != (root / name).read_bytes():
            raise AssertionError(f'Fixture changed the real source: {name}')
    # The repository owns supervision. In particular, this fixture supplies no substitute API.
    (root / 'scripts').symlink_to(source / 'scripts', target_is_directory=True)
    (root / 'provider.mjs').write_text(PROVIDER)
    pnpm = root / 'bin/pnpm'
    pnpm.write_text(f'#!{node}\n' + COMMAND)
    pnpm.chmod(0o755)
    next_package = web / 'node_modules/next'
    (next_package / 'dist/bin').mkdir(parents=True)
    (next_package / 'package.json').write_text(json.dumps({
        'name': 'next', 'type': 'commonjs', 'exports': {'./dist/bin/next': './dist/bin/next'},
    }))
    (next_package / 'dist/bin/next').write_text(COMMAND)
    (backend / 'package.json').write_text('{"type":"module"}')
    # Vitest itself is real and already installed. Only application/provider/migration data is fake.
    (backend / 'node_modules/vitest').symlink_to(vitest.parent, target_is_directory=True)
    (backend / 'src/migrations/index.ts').write_text(
        "export const platformMigrations = [{ id: 'launcher-contract-migration' }] as const;\n")
    (backend / 'vitest.config.mts').write_text("""
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['test/dev-api.smoke.test.ts'], pool: 'forks', maxWorkers: 1,
  fileParallelism: false, testTimeout: 30_000, hookTimeout: 10_000,
}});
""")
    return web, backend, pnpm


def wait_readable(channel, deadline, label):
    remaining = deadline - time.monotonic()
    with selectors.DefaultSelector() as selector:
        selector.register(channel, selectors.EVENT_READ)
        if remaining <= 0 or not selector.select(remaining):
            raise AssertionError(f'Timed out waiting for {label}')


def ready_connection(listener, surface):
    deadline = time.monotonic() + READY_SECONDS
    wait_readable(listener, deadline, 'the real detached child connection')
    connection, _address = listener.accept()
    ready = None
    requested = False
    buffer = b''
    try:
        while ready is None or (surface == 'dev-api-vitest' and not requested):
            wait_readable(connection, deadline, 'child ready and backend health request')
            chunk = connection.recv(65536)
            if not chunk:
                raise AssertionError('Child closed before its readiness barrier')
            buffer += chunk
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                event = json.loads(line)
                if not isinstance(event, dict):
                    raise AssertionError('Invalid child event')
                if event.get('event') == 'ready':
                    for key in ('pid', 'launcherPid', 'port'):
                        if type(event.get(key)) is not int or event[key] <= 0:
                            raise AssertionError(f'Invalid child {key}')
                    if event.get('surface') != surface:
                        raise AssertionError('Wrong launcher created the child')
                    if os.getpgid(event['pid']) != event['pid']:
                        raise AssertionError('Fixture child is not actually detached')
                    ready = event
                elif event.get('event') == 'health-request':
                    requested = True
        return connection, ready
    except BaseException:
        connection.close()
        raise


def wait_child_closed(connection, deadline):
    while True:
        wait_readable(connection, deadline, 'detached child TCP close after owner signal')
        if not connection.recv(65536):
            return


def kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def exercise(options):
    source = options.root.resolve()
    vitest = options.vitest.resolve()
    with tempfile.TemporaryDirectory(prefix='inside-launcher-contract-') as directory:
        root = Path(directory)
        web, backend, pnpm = install(root, source, options.node, vitest)
        with socket.socket() as listener, (root / 'owner.log').open('w+b') as log:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            environment = {
                **os.environ,
                'PATH': str(root / 'bin') + os.pathsep + os.environ.get('PATH', ''),
                'npm_execpath': str(pnpm),
                'LAUNCHER_CONTRACT_ROOT': str(root),
                'LAUNCHER_CONTRACT_CONTROL_PORT': str(listener.getsockname()[1]),
                'LAUNCHER_CONTRACT_SURFACE': options.surface,
                'PRODUCTION_WEB_PORT': '0',
                'PRODUCTION_WEB_BACKEND_URL': 'http://127.0.0.1:1',
                'PRODUCTION_WEB_SKIP_BUILD': '1',
            }
            command = ([options.node, str(web / 'test/support/production-web.mjs')]
                       if options.surface == 'production-web' else
                       [options.node, str(vitest), 'run', '--config', 'vitest.config.mts'])
            owner = subprocess.Popen(command, cwd=web if options.surface == 'production-web' else backend,
                                     env=environment, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            connection = None
            ready = None
            child_closed = False
            try:
                connection, ready = ready_connection(listener, options.surface)
                if owner.poll() is not None:
                    raise AssertionError('Real owner exited before the observed child readiness')
                # Kill only the actual launcher/runner PID, after the committed readiness facts.
                os.kill(owner.pid, getattr(signal, options.signal))
                shutdown_deadline = time.monotonic() + STOP_SECONDS
                wait_child_closed(connection, shutdown_deadline)
                child_closed = True
                owner.wait(timeout=max(0, shutdown_deadline - time.monotonic()))
                if options.signal == 'SIGKILL' and owner.returncode != -signal.SIGKILL:
                    raise AssertionError(f'Runner was not killed: {owner.returncode}')
                print(f'{options.surface} {options.signal}: child ready, owner signalled, child TCP closed')
            except BaseException as error:
                log.seek(0)
                output = log.read().decode(errors='replace')[-12000:]
                raise AssertionError(f'{options.surface} {options.signal}: {error}\n{output}') from error
            finally:
                # These groups belong only to this disposable fixture; cleanup does not prove the test.
                if ready is not None and not child_closed:
                    kill_group(ready['pid'])
                kill_group(owner.pid)
                if ready is not None:
                    kill_group(ready['launcherPid'])
                if connection is not None:
                    connection.close()
                owner.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--vitest', type=Path, required=True)
    parser.add_argument('--surface', choices=('production-web', 'dev-api-vitest'), required=True)
    parser.add_argument('--signal', choices=('SIGINT', 'SIGTERM', 'SIGKILL'), required=True)
    exercise(parser.parse_args())
