"""Exercise the command boundary, using readiness and exit as barriers."""
import json
import fcntl
import os
import shlex
from pathlib import Path
import selectors
import ctypes
import time
import signal
import subprocess
import sys
import tempfile
import unittest

from processes import process_snapshot

WRAPPER = Path(__file__).resolve().parents[1] / 'heavy-check.sh'
FIXTURE = "import os,sys; print('READY', os.getpid(), flush=True); sys.stdin.readline()"


def cpu_seconds(pid):
    """OS counters include CPU spent by reaped subprocesses such as ps."""
    if sys.platform == 'darwin':
        # rusage_info_v2, sys/resource.h: UUID followed by 18 uint64 fields.
        class Usage(ctypes.Structure):
            _fields_ = [('uuid', ctypes.c_uint8 * 16), ('values', ctypes.c_uint64 * 18)]
        libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        usage = Usage()
        if libproc.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
            raise OSError(ctypes.get_errno(), 'proc_pid_rusage')
        # ri_*_time uses Mach absolute-time units, not nanoseconds.
        class Timebase(ctypes.Structure):
            _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
        system = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
        system.mach_timebase_info.argtypes = [ctypes.c_void_p]
        timebase = Timebase()
        if system.mach_timebase_info(ctypes.byref(timebase)) != 0:
            raise RuntimeError('mach_timebase_info failed')
        ticks = sum(usage.values[index] for index in (0, 1, 10, 11))
        return ticks * timebase.numer / timebase.denom / 1_000_000_000
    fields = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
    return sum(int(fields[index]) for index in (11, 12, 13, 14)) / os.sysconf('SC_CLK_TCK')


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
        lines = [self.line(first, ''), self.line(first, '')]
        self.assertTrue(any(line.startswith('READY ') for line in lines))
        pid = int(next(line for line in lines if line.startswith('DETACHED ')).split()[-1])
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

    def test_three_waiters_receive_slots_in_registration_order(self):
        holders = self.holders()
        waiters = []
        for _ in range(3):
            waiter = self.start()
            self.line(waiter, 'waiting')
            waiters.append(waiter)
        snapshot = process_snapshot()
        supervisor = next(pid for pid, row in snapshot.items()
                          if row[0] == waiters[0].pid)
        self.addCleanup(self.resume, supervisor)
        os.kill(supervisor, signal.SIGSTOP)
        deadline = time.monotonic() + 10
        while 'T' not in process_snapshot()[supervisor][2]:
            self.assertLess(time.monotonic(), deadline, 'waiting for supervisor SIGSTOP')
            time.sleep(0.01)
        self.release_fork(holders[0])
        self.assertEqual(holders[0].wait(timeout=10), 0)
        # Older admission is paused: a younger waiter must not take its free slot.
        with selectors.DefaultSelector() as selector:
            for waiter in waiters[1:]:
                selector.register(waiter.stdout, selectors.EVENT_READ)
            self.assertFalse(selector.select(timeout=3))
        self.resume(supervisor)
        for waiter in waiters:
            self.line(waiter, 'acquired')
            self.line(waiter, 'READY')
            with selectors.DefaultSelector() as selector:
                for younger in waiters[waiters.index(waiter) + 1:]:
                    selector.register(younger.stdout, selectors.EVENT_READ)
                self.assertFalse(selector.select(timeout=0))
            self.release_fork(waiter)
            self.assertEqual(waiter.wait(timeout=10), 0)

    def test_cancelled_waiter_does_not_block_followers(self):
        for cancellation in ('terminate', 'kill-wrapper', 'kill-supervisor'):
            with self.subTest(cancellation=cancellation):
                holders = self.holders()
                cancelled = self.start()
                self.line(cancelled, 'waiting')
                follower = self.start()
                self.line(follower, 'waiting')
                if cancellation == 'terminate':
                    cancelled.terminate()
                elif cancellation == 'kill-wrapper':
                    cancelled.kill()
                else:
                    snapshot = process_snapshot()
                    supervisor = next(pid for pid, row in snapshot.items()
                                      if row[0] == cancelled.pid)
                    os.kill(supervisor, signal.SIGKILL)
                self.assertNotEqual(cancelled.wait(timeout=10), 0)
                self.release_fork(holders[0])
                self.assertEqual(holders[0].wait(timeout=10), 0)
                self.line(follower, 'acquired')
                self.line(follower, 'READY')
                self.release_fork(follower)
                self.assertEqual(follower.wait(timeout=10), 0)
                self.release_fork(holders[1])
                self.assertEqual(holders[1].wait(timeout=10), 0)

    def test_legacy_waiters_share_slot_locks_with_fifo_waiters(self):
        # Model the pre-FIFO protocol: the same persistent slot files, no queue files.
        slots = [open(Path(self.directory.name) / f'slot-{index}.lock', 'a')
                 for index in range(2)]
        for slot in slots:
            self.addCleanup(slot.close)
            fcntl.flock(slot, fcntl.LOCK_EX)
        legacy = self.start(launcher=[sys.executable, '-c', """
import fcntl, os, pathlib, sys, time
directory = pathlib.Path(os.environ['INSIDE_HEAVY_CHECK_DIRECTORY'])
slots = [open(directory / f'slot-{index}.lock', 'a') for index in range(2)]
print('waiting', flush=True)
while True:
    for slot in slots:
        try:
            fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            continue
        print('acquired', flush=True)
        print('READY', flush=True)
        sys.stdin.readline()
        sys.exit(0)
    time.sleep(0.05)
"""])
        self.line(legacy, 'waiting')
        waiter = self.start()
        self.line(waiter, 'waiting')
        fcntl.flock(slots[0], fcntl.LOCK_UN)
        with selectors.DefaultSelector() as selector:
            for process in (legacy, waiter):
                selector.register(process.stdout, selectors.EVENT_READ, process)
            ready = selector.select(timeout=10)
            self.assertTrue(ready, 'waiting for legacy or FIFO admission')
            first = ready[0][0].data
        second = waiter if first is legacy else legacy
        for process in (first, second):
            self.line(process, 'acquired')
            self.line(process, 'READY')
            with self.assertRaises(BlockingIOError):
                fcntl.flock(slots[0], fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.release_fork(process)
            self.assertEqual(process.wait(timeout=10), 0)
        fcntl.flock(slots[0], fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_eight_waiters_use_less_than_point_two_cpu_seconds_over_three_seconds(self):
        holders = self.holders()
        waiters = [self.start([sys.executable, '-c',
                              "print('READY', flush=True)"]) for _ in range(8)]
        for waiter in waiters:
            self.line(waiter, 'waiting')
        snapshot = process_snapshot()
        wrappers = {process.pid for process in [*waiters, *holders]}
        pids = wrappers | {pid for pid, row in snapshot.items() if row[0] in wrappers}
        self.assertEqual(len(pids), 20)
        before = sum(cpu_seconds(pid) for pid in pids)
        # A quiet window proves admission stays blocked and measures idle CPU.
        started = time.monotonic()
        with selectors.DefaultSelector() as selector:
            for waiter in waiters:
                selector.register(waiter.stdout, selectors.EVENT_READ)
            self.assertFalse(selector.select(timeout=3))
        elapsed = time.monotonic() - started
        cpu = sum(cpu_seconds(pid) for pid in pids) - before
        print(f'8 waiters + 2 holders: {cpu:.6f} CPU seconds; '
              f'{elapsed:.3f} seconds blocked', flush=True)
        for holder in holders:
            holder.stdin.write(b'\n')
            holder.stdin.flush()
            self.assertEqual(holder.wait(timeout=10), 0)
        for waiter in waiters:
            self.line(waiter, 'acquired')
            self.line(waiter, 'READY')
            self.assertEqual(waiter.wait(timeout=10), 0)
        self.assertLess(cpu, 0.2)

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
        # Hold the parent inside fork until the supervisor reports waiting.
        # This makes cancellation precede any post-fork handler registration.
        launcher = """
import os, sys
sys.path.insert(0, sys.argv.pop(1))
import lock
fork = os.fork
def gated_fork():
    child = fork()
    if child:
        print('FORK_PARENT', flush=True)
        sys.stdin.readline()
    return child
os.fork = gated_fork
sys.exit(lock.main())
"""
        waiting = self.start(launcher=[sys.executable, '-c', launcher,
                                      str(WRAPPER.parent / 'heavy-check'),
                                      sys.executable, '-c', FIXTURE])
        self.addCleanup(self.release_fork, waiting)
        lines = [self.line(waiting, ''), self.line(waiting, '')]
        self.assertTrue(any('FORK_PARENT' in line for line in lines))
        self.assertTrue(any('waiting' in line for line in lines))
        self.addCleanup(self.resume, waiting.pid)
        os.kill(waiting.pid, signal.SIGSTOP)
        deadline = time.monotonic() + 10
        while True:
            pid, status = os.waitpid(waiting.pid, os.WUNTRACED | os.WNOHANG)
            if pid:
                break
            self.assertLess(time.monotonic(), deadline, 'waiting for parent SIGSTOP')
            # Poll the OS stop fact; elapsed time only bounds a stuck barrier.
            time.sleep(0.01)
        self.assertTrue(os.WIFSTOPPED(status))
        waiting.terminate()
        self.release_fork(waiting)
        self.resume(waiting.pid)
        self.assertEqual(waiting.wait(timeout=10), 143)

    @staticmethod
    def release_fork(process):
        try:
            process.stdin.write(b'\n')
            process.stdin.flush()
        except BrokenPipeError:
            pass

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
