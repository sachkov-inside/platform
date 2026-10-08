"""Exercise the real launcher with an installed synthetic Next command and its load."""
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import tempfile
import time


def descendants(root_pid, owned, groups):
    rows = [tuple(map(int, row.split())) for row in subprocess.check_output(
        ['ps', '-Ao', 'pid=,ppid=,pgid='], text=True, timeout=2,
    ).splitlines()]
    owned.add(root_pid)
    while True:
        children = {pid for pid, parent, _group in rows if parent in owned}
        if children <= owned:
            break
        owned.update(children)
    groups.update(group for pid, _parent, group in rows if pid in owned)


def ready(process):
    deadline = time.monotonic() + 5
    line = b''
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise RuntimeError('readiness timeout')
            byte = os.read(process.stdout.fileno(), 1)
            if not byte:
                raise RuntimeError('launcher exited before readiness')
            line += byte
            if byte == b'\n':
                if line.startswith(b'READY '):
                    return
                line = b''


def stopped(pid):
    deadline = time.monotonic() + 2
    while True:
        state = subprocess.run(
            ['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True,
            text=True, timeout=2,
        ).stdout.strip()
        if not state or 'Z' in state:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(f'owned process {pid} is still running: {state}')
        # Sample an observed exit state; the interval does not establish completion.
        time.sleep(0.01)


root = Path.cwd()
with tempfile.TemporaryDirectory(prefix='platform-1153-launcher-') as directory:
    base = Path(directory)
    app = base / 'apps/web'
    support = app / 'test/support'
    support.mkdir(parents=True)
    (base / 'scripts').mkdir()
    (app / 'node_modules/.bin').mkdir(parents=True)
    shutil.copy2(root / 'apps/web/test/support/production-web.mjs', support / 'production-web.mjs')
    shutil.copy2(root / 'scripts/process-group-signal.mjs', base / 'scripts/process-group-signal.mjs')
    (app / 'package.json').write_text(json.dumps({
        'name': 'cleanup-fixture', 'private': True,
        'packageManager': json.loads((root / 'package.json').read_text())['packageManager'],
    }))
    executable = app / 'node_modules/next/dist/bin/next'
    executable.parent.mkdir(parents=True)
    (app / 'node_modules/next/package.json').write_text('{"name":"next","bin":{"next":"dist/bin/next"}}')
    (app / 'node_modules/.bin/next').symlink_to('../next/dist/bin/next')
    executable.write_text("""#!/usr/bin/env node
import {spawn} from 'node:child_process';
const load=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});
console.log('READY',process.pid,load.pid);
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
""")
    executable.chmod(0o755)
    env = dict(os.environ, PRODUCTION_WEB_SKIP_BUILD='1', PRODUCTION_WEB_PORT='28753',
               PRODUCTION_WEB_BACKEND_URL='http://127.0.0.1:1')
    process = subprocess.Popen(
        ['/bin/sh', '-c', 'node test/support/production-web.mjs'], cwd=app, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, bufsize=0,
    )
    groups = {process.pid}
    owned = {process.pid}
    try:
        ready(process)
        descendants(process.pid, owned, groups)
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=2)
        if process.returncode != 143:
            raise RuntimeError('SIGTERM status was masked')
        for pid in owned:
            stopped(pid)
    finally:
        # Also discover groups when readiness fails, before terminating their launcher.
        try:
            descendants(process.pid, owned, groups)
        finally:
            for group in groups:
                try:
                    os.killpg(group, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            process.wait(timeout=5)
            for pid in owned:
                stopped(pid)
