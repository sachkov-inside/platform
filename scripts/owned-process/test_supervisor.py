"""Behavioral ownership contracts use real launchers and signal-resistant load."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
API = (ROOT / 'scripts/owned-process.mjs').as_uri()
LOAD = """
const {spawn} = require('node:child_process');
const load = spawn(process.execPath, ['-e',
  "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid)"
], {stdio:['ignore','inherit','inherit','ipc']});
process.on('SIGTERM',()=>{});
process.once('SIGUSR1',()=>process.exit(19));
load.once('message', pid => console.log('READY',process.pid,pid));
setInterval(()=>{},1000);
"""


def read_ready(process):
    deadline = time.monotonic() + 5
    line = b''
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise RuntimeError('command readiness timeout')
            byte = os.read(process.stdout.fileno(), 1)
            if not byte:
                raise RuntimeError('owner exited before readiness')
            line += byte
            if byte == b'\n':
                if line.startswith(b'READY '):
                    return [int(value) for value in line.split()[1:]]
                line = b''


def stopped(pid):
    deadline = time.monotonic() + 2
    while True:
        state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)],
                               capture_output=True, text=True, timeout=2).stdout.strip()
        if not state or 'Z' in state:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.01)


class Ownership(unittest.TestCase):
    def exercise(self, action):
        owner_source = f"""
        import {{spawnOwned,stopOwned}} from {json.dumps(API)};
        const child=spawnOwned(process.execPath,['-e',{json.dumps(LOAD)}],
          {{stdio:['ignore','pipe','inherit']}});
        child.stdout.pipe(process.stdout);
        child.once('exit',code=>{{process.exitCode=code}});
        child.once('error',error=>{{console.error(error);process.exit(1)}});
        for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{{
          await stopOwned(child,100);process.exit(signal==='SIGINT'?130:143);
        }});
        process.stdin.once('data',async data=>{{
          if(data.toString().trim()==='exit') process.exit(0);
          else {{await stopOwned(child,100);await stopOwned(child,100);process.exit(0)}}
        }});
        """
        process = subprocess.Popen(['node', '--input-type=module', '-e', owner_source],
                                   cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        pids = []
        try:
            pids = read_ready(process)
            if action == 'command-exit':
                os.kill(pids[0], signal.SIGUSR1)
            elif isinstance(action, int):
                os.kill(process.pid, action)
            else:
                process.stdin.write((action + '\n').encode())
                process.stdin.flush()
            _stdout, stderr = process.communicate(timeout=12)
            expected = -action if action == signal.SIGKILL else (
                128 + action if isinstance(action, int) else
                19 if action == 'command-exit' else 0)
            self.assertEqual(process.returncode, expected, stderr.decode())
            for pid in pids:
                self.assertTrue(stopped(pid), f'owned load {pid} survived {action}')
        finally:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    def test_explicit_stop_is_idempotent(self):
        self.exercise('stop')

    def test_normal_owner_exit(self):
        self.exercise('exit')

    def test_owner_sigint(self):
        self.exercise(signal.SIGINT)

    def test_owner_sigterm(self):
        self.exercise(signal.SIGTERM)

    def test_owner_sigkill(self):
        self.exercise(signal.SIGKILL)

    def test_completed_command_cleans_remaining_descendants(self):
        self.exercise('command-exit')

    def test_command_failure_preserves_status(self):
        for command, expected in ((['node', '-e', 'process.exit(19)'], 19),
                                  (['/missing/command'], 127)):
            source = f"""
            import {{spawnOwned,stopOwned}} from {json.dumps(API)};
            const child=spawnOwned({json.dumps(command[0])},{json.dumps(command[1:])},{{stdio:'inherit'}});
            child.once('exit',async code=>{{await stopOwned(child);process.exit(code)}});
            """
            process = subprocess.run(['node', '--input-type=module', '-e', source],
                                     cwd=ROOT, capture_output=True, timeout=10)
            self.assertEqual(process.returncode, expected, process.stderr.decode())


if __name__ == '__main__':
    unittest.main()
