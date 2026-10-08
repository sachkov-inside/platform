"""Exercise the command boundary, using readiness and exit as barriers."""
import json
import os
import shlex
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().parents[1] / 'heavy-check.sh'
FIXTURE = "import os,sys; print('READY', os.getpid(), flush=True); sys.stdin.readline()"


class LockTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = dict(os.environ, INSIDE_HEAVY_CHECK_DIRECTORY=self.directory.name)
        self.environment.pop('CI', None)
        self.environment.pop('INSIDE_HEAVY_CHECK_OWNER', None)

    def start(self, command=None, environment=None, cwd=None, launcher=None):
        process = subprocess.Popen(
            launcher or ['bash', str(WRAPPER), *(command or [sys.executable, '-c', FIXTURE])],
            env=environment or self.environment, cwd=cwd, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0,
        )
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        process.stdin.close()
        process.stdout.close()

    @staticmethod
    def kill_process(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def assert_stopped(self, pid):
        state = subprocess.run(
            ['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True,
            text=True, check=False,
        ).stdout.strip()
        self.assertTrue(not state or 'Z' in state, f'{pid} is still running: {state}')

    def line(self, process, expected):
        line = b''
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while not line.endswith(b'\n'):
                self.assertTrue(selector.select(timeout=10), f'waiting for {expected}')
                byte = os.read(process.stdout.fileno(), 1)
                self.assertTrue(byte, f'EOF waiting for {expected}: {line!r}')
                line += byte
        line = line.decode().strip()
        self.assertIn(expected, line)
        return line

    def test_two_worktrees_share_capacity_and_kill_releases_slot(self):
        first_cwd = Path(self.directory.name) / 'worktree-a'
        second_cwd = Path(self.directory.name) / 'worktree-b'
        first_cwd.mkdir()
        second_cwd.mkdir()
        first = self.start(cwd=first_cwd)
        self.line(first, 'acquired')
        pid = int(self.line(first, 'READY').split()[-1])
        second = self.start(cwd=second_cwd)
        self.line(second, 'acquired')
        self.line(second, 'READY')
        third = self.start(cwd=second_cwd)
        self.line(third, 'waiting')
        first.kill()
        # Do not reap the killed caller until admission has advanced.
        self.line(third, 'acquired')
        self.line(third, 'READY')
        first.wait(timeout=10)
        self.assert_stopped(pid)

    def pnpm_worktree(self, name):
        cwd = Path(self.directory.name) / name
        cwd.mkdir()
        command = shlex.join(['bash', str(WRAPPER), sys.executable, '-c', FIXTURE])
        (cwd / 'package.json').write_text(json.dumps({'scripts': {'check': command}}))
        process = self.start(cwd=cwd, launcher=['pnpm', 'check'])
        while 'acquired' not in self.line(process, ''):
            pass
        return process

    def test_two_pnpm_worktrees_and_killing_pnpm_parent(self):
        first = self.pnpm_worktree('pnpm-worktree-a')
        pid = int(self.line(first, 'READY').split()[-1])
        second = self.pnpm_worktree('pnpm-worktree-b')
        self.line(second, 'READY')
        third = self.start()
        self.line(third, 'waiting')
        first.kill()
        # Do not reap the killed caller until admission has advanced.
        self.line(third, 'acquired')
        self.line(third, 'READY')
        first.wait(timeout=10)
        self.assert_stopped(pid)

    def test_detached_sigterm_resistant_descendant_stops_before_slot_release(self):
        fixture = WRAPPER.parent / 'fixtures/heavy-check/detached.mjs'
        first = self.start(['node', str(fixture)])
        self.line(first, 'acquired')
        self.line(first, 'READY')
        pid = int(self.line(first, 'DETACHED').split()[-1])
        self.addCleanup(self.kill_process, pid)
        second = self.start()
        self.line(second, 'acquired')
        self.line(second, 'READY')
        third = self.start()
        self.line(third, 'waiting')
        first.kill()
        self.line(third, 'acquired')
        self.line(third, 'READY')
        first.wait(timeout=10)
        self.assert_stopped(pid)

    def test_original_group_survives_reap_of_unobserved_parent(self):
        fixture = WRAPPER.parent / 'fixtures/heavy-check/orphan.mjs'
        first = self.start(['node', str(fixture)])
        self.line(first, 'acquired')
        supervisor = int(self.line(first, 'READY').split()[-1])
        os.kill(supervisor, signal.SIGSTOP)
        self.addCleanup(self.resume, supervisor)
        first.stdin.write(b'\n')
        first.stdin.flush()
        pid = int(self.line(first, 'ORPHAN').split()[-1])
        self.addCleanup(self.kill_process, pid)
        os.kill(supervisor, signal.SIGCONT)
        self.assertEqual(first.wait(timeout=10), 0)
        self.assert_stopped(pid)

    @staticmethod
    def resume(pid):
        try:
            os.kill(pid, signal.SIGCONT)
        except ProcessLookupError:
            pass

    def holders(self):
        holders = []
        for _ in range(2):
            process = self.start()
            self.line(process, 'acquired')
            self.line(process, 'READY')
            holders.append(process)
        return holders

    def test_nested_command_uses_outer_slot(self):
        holders = self.holders()
        waiting = self.start(['bash', str(WRAPPER), sys.executable, '-c', FIXTURE])
        self.line(waiting, 'waiting')
        # Release one holder: the nested wrapper must not need the second occupied slot.
        holder = holders[0]
        holder.stdin.write(b'\n')
        holder.stdin.flush()
        holder.wait(timeout=10)
        self.line(waiting, 'acquired')
        self.line(waiting, 'READY')

    def test_ci_bypasses_slots(self):
        self.holders()
        process = self.start(environment=dict(self.environment, CI='true'))
        self.line(process, 'READY')

    def test_waiter_can_be_cancelled(self):
        self.holders()
        waiting = self.start()
        self.line(waiting, 'waiting')
        waiting.terminate()
        self.assertEqual(waiting.wait(timeout=10), 143)

    def test_exit_code_and_release_after_failure(self):
        failed = self.start([sys.executable, '-c', 'raise SystemExit(17)'])
        self.line(failed, 'acquired')
        self.assertEqual(failed.wait(timeout=10), 17)
        self.holders()

    def test_interrupt_stops_command_and_releases_slot(self):
        process = self.start()
        self.line(process, 'acquired')
        pid = int(self.line(process, 'READY').split()[-1])
        process.send_signal(signal.SIGINT)
        self.assertEqual(process.wait(timeout=10), 130)
        self.assert_stopped(pid)
        self.holders()


if __name__ == '__main__':
    unittest.main()
