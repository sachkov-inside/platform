"""Behavioral ownership contracts use real launchers and signal-resistant load."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/heavy-check'))
from processes import process_row, process_snapshot
sys.path.insert(0, str(ROOT / 'scripts/owned-process'))
from ownership import ProcessOwnership

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
DETACHED_LOAD = """
const {spawn} = require('node:child_process');
const load = spawn(process.execPath, ['-e',
  "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid)"
], {detached:true, stdio:['ignore','ignore','ignore','ipc']});
load.once('message', pid => {
  console.log('READY',process.pid,pid);
  process.exit(0);
});
"""
INTERMEDIATE_LOAD = f"""
const {{spawn}} = require('node:child_process');
const intermediate = spawn(process.execPath, ['-e', {json.dumps(DETACHED_LOAD)}],
  {{stdio:['ignore','pipe','inherit']}});
intermediate.stdout.pipe(process.stdout);
intermediate.once('exit',()=>process.exit(0));
"""
NESTED_LOAD = f"""
import({json.dumps(API)}).then(({{spawnOwned}})=>{{
  const child=spawnOwned(process.execPath,['-e',{json.dumps(LOAD)}],
    {{env:{{PATH:process.env.PATH}},stdio:['ignore','pipe','inherit']}});
  child.stdout.once('data',data=>console.log(data.toString().trim(),process.pid));
  child.once('error',()=>process.exit(1));
}});
process.on('SIGTERM',()=>{{}});
setInterval(()=>{{}},1000);
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
                observed = line.lstrip(b'# ')
                if observed.startswith(b'READY '):
                    return [int(value) for value in observed.split()[1:]]
                line = b''


def stopped(pid, deadline=None):
    if deadline is None:
        deadline = time.monotonic() + 2
    while True:
        row = process_row(pid)
        if row is None or row[2] == 'Z':
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)


class Ownership(unittest.TestCase):
    def exercise(self, action, load=LOAD):
        command = ['node', '-e', load]
        if action == 'exec-exit':
            command = ['/bin/sh', '-c', 'exec "$@"', 'owned-exec', *command]
        owner_source = f"""
        import {{spawnOwned,stopOwned}} from {json.dumps(API)};
        const [command,...args]={json.dumps(command)};
        const child=spawnOwned(command,args,
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
            if action in ('detached-exit', 'exec-exit', 'intermediate-exit'):
                # The launcher exits as soon as its detached child reports readiness.
                pass
            elif action == 'command-exit':
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

    def test_fast_launcher_exit_cleans_detached_descendant(self):
        self.exercise('detached-exit', DETACHED_LOAD)

    def test_exec_launcher_cleans_detached_descendant(self):
        self.exercise('exec-exit', DETACHED_LOAD)

    def test_reaped_intermediate_cleans_detached_leaf(self):
        self.exercise('intermediate-exit', INTERMEDIATE_LOAD)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS ownership marker adapter')
    def test_marker_discovers_leaf_after_unobserved_ancestors_are_reaped(self):
        ownership = ProcessOwnership()
        process = subprocess.Popen(['node', '-e', INTERMEDIATE_LOAD], cwd=ROOT,
                                   env=ownership.environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        pids = []
        try:
            pids = read_ready(process)
            _stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr.decode())
            self.assertIsNone(process_row(process.pid))
            self.assertTrue(stopped(pids[0]), 'intermediate must exit before discovery')
            leaf = process_row(pids[1])
            self.assertIsNotNone(leaf)
            self.assertEqual(leaf[1], pids[1], 'leaf must own a detached group')
            self.assertNotEqual(leaf[2], 'Z')
            # No ancestry snapshot was taken before the two launchers were reaped.
            tracked = {}
            groups = set()
            ownership.include(process_snapshot(), tracked, groups)
            self.assertIn(pids[1], tracked)
            self.assertIn(pids[1], groups)
        finally:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    def test_nested_owner_retains_outer_ownership(self):
        self.exercise('stop', NESTED_LOAD)

    def test_unrelated_cookie_does_not_grant_ownership(self):
        foreign = subprocess.Popen(
            ['node', '-e', "console.log('READY',process.pid);setInterval(()=>{},1000)"],
            env=dict(os.environ, INSIDE_OWNED_PROCESS_foreign='1'),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
        )
        try:
            read_ready(foreign)
            self.exercise('stop')
            self.assertIsNone(foreign.poll())
            os.kill(foreign.pid, 0)
        finally:
            if foreign.poll() is None:
                os.killpg(foreign.pid, signal.SIGKILL)
            foreign.communicate(timeout=5)

    def test_native_node_test_runner_sigkill(self):
        self.native_runner(signal.SIGKILL)

    def test_native_node_test_runner_sigterm(self):
        self.native_runner(signal.SIGTERM)

    def test_native_node_test_runner_sigint(self):
        self.native_runner(signal.SIGINT)

    def native_runner(self, signum):
        source = f"""
        import {{test}} from 'node:test';
        import {{spawnOwned,stopOwned}} from {json.dumps(API)};
        test('owned native load',async t=>{{
          const child=spawnOwned(process.execPath,['-e',{json.dumps(LOAD)}],
            {{stdio:['ignore','pipe','inherit']}});
          t.after(()=>stopOwned(child,100));
          child.stdout.once('data',data=>console.log(data.toString().trim(),process.pid,child.pid,process.ppid));
          await new Promise(()=>{{}});
        }});
        """
        with tempfile.TemporaryDirectory(prefix='owned-native-runner-') as directory:
            fixture = Path(directory) / 'runner.test.mjs'
            fixture.write_text(source)
            # This is a new CLI runner, not a worker of the outer Node test harness.
            environment = {key: value for key, value in os.environ.items()
                           if key != 'NODE_TEST_CONTEXT'}
            process = subprocess.Popen(['node', str(ROOT / 'scripts/owned-node.mjs'),
                                        '--test', '--test-reporter=tap', str(fixture)],
                                       cwd=ROOT, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       start_new_session=True)
            pids = []
            try:
                pids = read_ready(process)
                shutdown_deadline = time.monotonic() + 12
                # Kill the real CLI runner. Its external owner must also stop its test worker.
                os.kill(pids[-1], signum)
                process.communicate(timeout=12)
                # Node's test CLI handles INT/TERM as a canceled test (status 1).
                expected = 128 + signum if signum == signal.SIGKILL else 1
                self.assertEqual(process.returncode, expected)
                for pid in pids:
                    self.assertTrue(stopped(pid, shutdown_deadline),
                                    f'native runner load {pid} survived: '
                                    f'ready(root,leaf,worker,supervisor,runner)={pids}, '
                                    f'row={process_row(pid)}')
            finally:
                for pid in pids:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=5)

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
