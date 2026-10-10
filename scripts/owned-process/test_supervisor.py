"""Behavioral ownership contracts use real launchers and signal-resistant load."""
import json
import os
from pathlib import Path
import selectors
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/heavy-check'))
from processes import process_row, process_snapshot, LIBPROC
from lock import signal_groups
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


def read_ready(process, budget_seconds=5):
    deadline = time.monotonic() + budget_seconds
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

    def test_abort_during_stop_waits_for_supervisor(self):
        source = f"""
        import {{spawnOwned,stopOwned}} from {json.dumps(API)};
        const controller=new AbortController();
        const child=spawnOwned(process.execPath,['-e',{json.dumps(LOAD)}],
          {{signal:controller.signal,stdio:['ignore','pipe','inherit']}});
        const errors=[];
        child.on('error',error=>errors.push(error.code));
        child.stdout.once('data',async data=>{{
          console.log(data.toString().trim(),child.pid);
          const stopping=stopOwned(child,1000);
          controller.abort();
          await stopping;
          console.log('READY',child.exitCode??-1,errors.length);
        }});
        """
        process = subprocess.Popen(['node', '--input-type=module', '-e', source],
                                   cwd=ROOT, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        pids = []
        try:
            pids = read_ready(process)
            # This barrier follows stopOwned resolution, before waiting for the owner's exit.
            status, errors = read_ready(process, budget_seconds=12)
            self.assertEqual(status, 143, 'stop resolved before actual supervisor exit')
            self.assertEqual(errors, 1, 'the abort must emit its error during active stop')
            for pid in pids:
                row = process_row(pid)
                self.assertTrue(row is None or row[2] == 'Z',
                                f'owned process {pid} survived stop resolution: {row}')
            _stdout, stderr = process.communicate(timeout=12)
            self.assertEqual(process.returncode, 0, stderr.decode())
        finally:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    def test_synchronous_owned_cli_deadline_cleans_descendants(self):
        load = LOAD.replace("console.log('READY',process.pid,pid)",
                            "console.log('READY',process.pid,pid,process.ppid)")
        command = ['node', str(ROOT / 'scripts/owned-node.mjs'),
                   '--command', 'node', '-e', load]
        source = f"""
        const {{spawnSync}}=require('node:child_process');
        const [command,...args]={json.dumps(command)};
        const result=spawnSync(command,args,
          {{encoding:'utf8',timeout:2000,killSignal:'SIGTERM'}});
        process.stdout.write(result.stdout);
        console.log('RESULT',result.error?.code,result.status,result.signal);
        """
        process = subprocess.Popen(['node', '-e', source], cwd=ROOT,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        pids = []
        try:
            # The outer synchronous call has returned before it forwards captured readiness.
            pids = read_ready(process, budget_seconds=15)
            for pid in pids:
                row = process_row(pid)
                self.assertTrue(row is None or row[2] == 'Z',
                                f'owned load {pid} survived sync return: {row}')
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr.decode())
            self.assertIn(b'RESULT ETIMEDOUT 143 null', stdout)
        finally:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

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

    def test_cleanup_of_exited_unreaped_group_preserves_sigkill(self):
        process = subprocess.Popen(
            [sys.executable, '-c',
             "import os,sys; print('READY',os.getpid(),flush=True); sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            read_ready(process)
            identity = process_row(process.pid)
            self.assertIsNotNone(identity)
            os.killpg(process.pid, signal.SIGKILL)
            # Observe kernel exit without reaping: cleanup holds a stale census group.
            deadline = time.monotonic() + 5
            while os.waitid(os.P_PID, process.pid,
                            os.WEXITED | os.WNOWAIT | os.WNOHANG) is None:
                self.assertLess(time.monotonic(), deadline, 'command did not exit')
                time.sleep(0.01)
            signal_groups({process.pid}, signal.SIGKILL)
            self.assertEqual(process.wait(timeout=5), -signal.SIGKILL)
            self.assertTrue(stopped(process.pid))
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    def test_cleanup_does_not_hide_permission_failure_for_live_group(self):
        process = subprocess.Popen(
            [sys.executable, '-c',
             "import os,sys; print('READY',os.getpid(),flush=True); sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            read_ready(process)
            # Supply a denied syscall; census still observes a real owned live member.
            with patch('lock.os.killpg', side_effect=PermissionError(1, 'denied')):
                with self.assertRaises(PermissionError):
                    signal_groups({process.pid}, signal.SIGKILL)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    def test_cleanup_does_not_hide_live_group_missing_from_census(self):
        process = subprocess.Popen(
            [sys.executable, '-c',
             "import os,sys; print('READY',os.getpid(),flush=True); sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            read_ready(process)
            # proc_pidinfo may omit a live member when its UID denies inspection.
            with patch('lock.process_snapshot', return_value={}):
                with patch('lock.os.killpg', side_effect=PermissionError(1, 'denied')):
                    with self.assertRaises(PermissionError):
                        signal_groups({process.pid}, signal.SIGKILL)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS native group exit adapter')
    def test_cleanup_rejects_kqueue_error_receipt_as_exit(self):
        process = subprocess.Popen(
            [sys.executable, '-c',
             "import os,sys; print('READY',os.getpid(),flush=True); sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            read_ready(process)
            receipt = select.kevent(process.pid, filter=select.KQ_FILTER_PROC,
                                    flags=select.KQ_EV_ERROR,
                                    fflags=select.KQ_NOTE_EXIT, data=1)
            with patch('processes.select.kqueue') as queue:
                queue.return_value.control.return_value = [receipt]
                with patch('lock.os.killpg', side_effect=PermissionError(1, 'denied')):
                    with self.assertRaises(PermissionError):
                        signal_groups({process.pid}, signal.SIGKILL)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS native group exit adapter')
    def test_cleanup_rechecks_members_forked_after_group_census(self):
        source = """
import os, signal, sys
print('READY', os.getpid(), flush=True)
sys.stdin.readline()
r, w = os.pipe()
if os.fork() == 0:
    os.close(r)
    print('READY', os.getpid(), flush=True)
    os.write(w, b'1')
    os.close(w)
    while True:
        signal.pause()
os.close(w)
os.read(r, 1)
os._exit(0)
"""
        process = subprocess.Popen([sys.executable, '-c', source],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        listed = LIBPROC.proc_listpids
        changed = False

        def fork_after_census(kind, group, buffer, size):
            nonlocal changed
            result = listed(kind, group, buffer, size)
            if buffer is not None and not changed:
                changed = True
                process.stdin.write(b'fork\n')
                process.stdin.flush()
                read_ready(process)
                deadline = time.monotonic() + 5
                while os.waitid(os.P_PID, process.pid,
                                os.WEXITED | os.WNOWAIT | os.WNOHANG) is None:
                    self.assertLess(time.monotonic(), deadline, 'forking leader did not exit')
                    time.sleep(0.01)
            return result

        try:
            read_ready(process)
            with patch('processes.LIBPROC.proc_listpids', side_effect=fork_after_census):
                with patch('lock.os.killpg', side_effect=PermissionError(1, 'denied')):
                    with self.assertRaises(PermissionError):
                        signal_groups({process.pid}, signal.SIGKILL)
            self.assertTrue(changed, 'fork barrier was not exercised')
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            process.communicate(timeout=5)

    def test_native_node_test_runner_sigkill(self):
        self.native_runner(signal.SIGKILL)

    def test_native_node_test_runner_sigkill_with_exited_cleanup_group(self):
        self.native_runner(signal.SIGKILL, exited_cleanup_group=True)

    def test_native_node_test_runner_sigterm(self):
        self.native_runner(signal.SIGTERM)

    def test_native_node_test_runner_sigint(self):
        self.native_runner(signal.SIGINT)

    def native_runner(self, signum, exited_cleanup_group=False):
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
            if exited_cleanup_group:
                # A real unreaped owned group pins the census-to-signal exit race.
                # Load this adapter only in the spawned supervisors, not this test runner.
                adapter = Path(directory) / 'sitecustomize.py'
                adapter.write_text(f"""
import os, signal, subprocess, sys, time
sys.path.insert(0, {str(ROOT / 'scripts/heavy-check')!r})
import lock
original = lock.signal_groups
injected = False
def signal_groups(groups, signum):
    global injected
    if injected or not groups:
        return original(groups, signum)
    injected = True
    child = subprocess.Popen([sys.executable, '-S', '-c', 'pass'], start_new_session=True)
    try:
        deadline = time.monotonic() + 5
        while os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG) is None:
            if time.monotonic() >= deadline:
                raise RuntimeError('cleanup fixture did not exit')
            time.sleep(0.01)
        print('EXITED_CLEANUP_GROUP', child.pid, file=sys.stderr, flush=True)
        return original(groups | {{child.pid}}, signum)
    finally:
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        child.wait(timeout=5)
lock.signal_groups = signal_groups
""")
                environment['PYTHONPATH'] = directory
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
                _stdout, stderr = process.communicate(timeout=12)
                # Node's test CLI handles INT/TERM as a canceled test (status 1).
                expected = 128 + signum if signum == signal.SIGKILL else 1
                self.assertEqual(process.returncode, expected, stderr.decode())
                if exited_cleanup_group:
                    self.assertIn(b'EXITED_CLEANUP_GROUP', stderr)
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
