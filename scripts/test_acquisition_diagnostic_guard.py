"""Focused guard contracts: native stdout/stderr only, all external commands doubled."""
import importlib.util
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('guard', ROOT/'scripts/acquisition-diagnostic-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
sys.path.insert(0, str(ROOT / 'scripts/owned-process'))
from ownership import TOKEN_PREFIX

PROCESS_ADAPTER_BUDGET_SECONDS = 5
PROCESS_ADAPTER_CLEANUP_SECONDS = 5


@contextmanager
def process_contract_deadline():
    # An OS timer stays independent of the guard's supplied monotonic clock.
    previous_handler = signal.getsignal(signal.SIGALRM)

    def expired(_signal, _frame):
        raise TimeoutError('Native process contract deadline')

    signal.signal(signal.SIGALRM, expired)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, PROCESS_ADAPTER_BUDGET_SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)
        signal.signal(signal.SIGALRM, previous_handler)


class GuardContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Uncatchable test-owner termination requires the external repository supervisor.
        if not any(key.startswith(TOKEN_PREFIX) for key in os.environ):
            raise RuntimeError('Run guard contracts through node scripts/owned-node.mjs --command python3')

    def exercise(self, payload='', *, growth=False, cleanup_error=False, git_expiry=False,
                 late_cache=False, cache_symlink=False, daemon_error=False, forced_timeout=False, final_meter_spill=False):
        with process_contract_deadline(), tempfile.TemporaryDirectory() as temporary:
            temporary = str(Path(temporary).resolve())
            output = Path(temporary)/'result'
            daemon = Path(temporary)/'daemon'
            daemon.mkdir()
            cache = Path(temporary)/'apps/backend/node_modules/.cache'
            actual_popen = subprocess.Popen
            process = None
            calls = []
            du_count = 0
            shutdown = False
            clock = [0.0]

            def run(command, **kwargs):
                nonlocal du_count, shutdown
                calls.append((command, kwargs.get('timeout')))
                if command[:3] == ['sudo', '-n', 'du']:
                    du_count += 1
                    # Excess exists only after shutdown: earlier samples cannot catch it.
                    size = 2*1024**2 if growth and shutdown else 0
                    if str(cache) in command:
                        size = 2*1024**2
                    return subprocess.CompletedProcess(command, 0, f'{size}\t{daemon}\n', '')
                if 'systemctl' in command and daemon_error:
                    raise OSError('shutdown fault')
                if 'systemctl' in command:
                    shutdown = True
                if command[0] == 'git' and git_expiry:
                    clock[0] = 121
                    raise subprocess.TimeoutExpired(command, kwargs['timeout'], output=b'partial-native-out', stderr=b'partial-native-err')
                return subprocess.CompletedProcess(command, 0, '', '')

            def measure(paths, _output, timeout, _capacity, **_kwargs):
                result = run(['sudo', '-n', 'du', '-sk', *map(str, paths)], timeout=timeout)
                text = ('0\t' + 'm'*1021 + '\n') if final_meter_spill and shutdown else ('0\tx\n' if final_meter_spill else result.stdout)
                if len(text.encode()) > _capacity:
                    raise subprocess.CalledProcessError(1, ['du', '-sk'], text[:_capacity], '')
                return {'stdout': text, 'stderr': result.stderr, 'nativeExit': 0, 'pending': 0}

            def bounded(command, _cwd, timeout, _capacity):
                if command[:2] == ['git', 'diff']:
                    return run(command, timeout=timeout)
                return subprocess.CompletedProcess(command, 0, check_output(command, timeout=timeout), '')

            def check_output(command, **kwargs):
                calls.append((command, kwargs.get('timeout')))
                if command[0] == 'git':
                    return 'a'*40
                if command[1] == 'ps':
                    return ''
                return str(daemon)

            def popen(_command, **kwargs):
                nonlocal process
                if late_cache or cache_symlink:
                    cache.parent.mkdir(parents=True)
                    if cache_symlink:
                        cache.symlink_to(daemon, target_is_directory=True)
                    else:
                        cache.mkdir()
                process = actual_popen([sys.executable, '-c', payload or 'pass'],
                                       stdout=kwargs['stdout'], stderr=kwargs['stderr'],
                                       start_new_session=True)
                if cleanup_error:
                    process.wait = lambda **_kwargs: (_ for _ in ()).throw(RuntimeError('cleanup fault'))
                if forced_timeout:
                    process.wait = lambda **_kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired('child', 10))
                return process

            try:
                with patch.object(sys, 'argv', ['guard', '--source-sha', 'a'*40, '--output', str(output)]), \
                     patch.object(guard, '__file__', str(Path(temporary)/'scripts/guard.py')), \
                     patch.object(guard.os, 'uname', return_value=type('Linux', (), {'sysname':'Linux'})()), \
                     patch.dict(os.environ, {'ACQUISITION_DIAGNOSTIC_EPHEMERAL':'1'}), \
                     patch.object(guard.os, 'statvfs', return_value=type('Fs', (), {'f_bavail':30*1024**3, 'f_frsize':1})()), \
                     patch.object(guard, 'bounded_command', side_effect=bounded), \
                     patch.object(guard.meter, 'measure', side_effect=measure), \
                     patch.object(guard.subprocess, 'run', side_effect=run), \
                     patch.object(guard.subprocess, 'Popen', side_effect=popen), \
                     patch.object(guard.time, 'monotonic', side_effect=lambda:clock[0]):
                    exit_code = guard.main()
                receipt = json.loads((output/'receipt.json').read_text())
                size = (output/'diagnostic.jsonl').stat().st_size if (output/'diagnostic.jsonl').exists() else 0
                return exit_code, receipt, size, calls
            finally:
                if process is not None:
                    process.wait = subprocess.Popen.wait.__get__(process)
                    if process.poll() is None:
                        os.killpg(process.pid, 9)
                    process.wait(timeout=PROCESS_ADAPTER_CLEANUP_SECONDS)
                    if process.stdout is not None:
                        process.stdout.close()

    def test_combined_stdout_stderr_ceiling_and_final_exit(self):
        status, receipt, size, _ = self.exercise("import os; os.write(1,b'x'*600000); os.write(2,b'y'*600000)")
        self.assertLessEqual(size, 1024**2)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['stopReason'], 'diagnostics budget')

    def test_final_meter_and_sdk_share_one_total_intake_budget(self):
        status, receipt, size, _ = self.exercise("import os; os.write(1,b'x'*(1024**2-512))", final_meter_spill=True)
        self.assertLessEqual(size + receipt['commandDiagnosticBytes'], 1024**2)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['daemonShutdownExit'], 0)

    def test_primary_timeout_survives_native_wait_cleanup_failure(self):
        actual_popen = subprocess.Popen
        owned = []
        command = [sys.executable, '-c', 'import time; print("partial-primary",flush=True); time.sleep(30)']
        def launch(*args, **kwargs):
            child = actual_popen(*args, **kwargs)
            owned.append(child)
            child.wait = lambda **_kwargs: (_ for _ in ()).throw(RuntimeError('wait cleanup failure'))
            return child
        try:
            with patch.object(guard.subprocess, 'Popen', side_effect=launch):
                with self.assertRaises(subprocess.TimeoutExpired) as raised:
                    guard.bounded_command(command, ROOT, 1, 4096)
            self.assertEqual(raised.exception.cmd, command)
            self.assertIn(b'partial-primary', raised.exception.output)
            self.assertEqual(raised.exception.command_cleanup_failure, 'RuntimeError')
            self.assertTrue(raised.exception.native_cleanup_pending)
        finally:
            for child in owned:
                child.wait = subprocess.Popen.wait.__get__(child)
                try:
                    child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=PROCESS_ADAPTER_CLEANUP_SECONDS)
                for pipe in (child.stdout, child.stderr):
                    pipe.close()

    def test_final_growth_cannot_report_success(self):
        status, receipt, _, _ = self.exercise(growth=True)
        self.assertNotEqual(status, 0)
        self.assertGreaterEqual(receipt['maximumGrowthBytes'], 2*1024**3)

    def test_cache_created_after_admission_counts_against_budget(self):
        status, receipt, _, _ = self.exercise(late_cache=True)
        self.assertNotEqual(status, 0)
        self.assertGreaterEqual(receipt['maximumGrowthBytes'], 2*1024**3)

    def test_late_cache_symlink_is_rejected(self):
        status, receipt, _, _ = self.exercise(cache_symlink=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['guardFailureType'], 'AssertionError')
        self.assertEqual(receipt['daemonShutdownExit'], 0)

    def test_daemon_exception_still_saves_failure_receipt(self):
        status, receipt, _, _ = self.exercise(daemon_error=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['daemonShutdownFailureType'], 'OSError')
        self.assertNotEqual(receipt['pending'], 0)

    def test_forced_wait_timeout_does_not_cancel_daemon_shutdown(self):
        status, receipt, _, _ = self.exercise(forced_timeout=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['processCleanupFailureType'], 'TimeoutExpired')
        self.assertEqual(receipt['daemonShutdownExit'], 0)

    def test_cleanup_exception_still_shuts_daemon_and_saves_receipt(self):
        status, receipt, _, calls = self.exercise(cleanup_error=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['processCleanupFailureType'], 'RuntimeError')
        self.assertEqual(receipt['daemonShutdownExit'], 0)
        self.assertTrue(any('systemctl' in command for command, _ in calls))

    def test_git_diff_has_remaining_deadline_timeout(self):
        status, receipt, _, calls = self.exercise(git_expiry=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['guardFailureType'], 'TimeoutExpired')
        self.assertTrue(all(timeout is not None and timeout <= 120 for _, timeout in calls))

    def test_command_timeout_keeps_primary_before_cleanup(self):
        status, receipt, _, _ = self.exercise(git_expiry=True)
        self.assertNotEqual(status, 0)
        primary = receipt['primaryFailure']
        self.assertEqual(primary['stage'], 'git-diff')
        self.assertEqual(primary['command'], ['git', 'diff', '--quiet'])
        self.assertEqual(primary['stdout'], 'partial-native-out')
        self.assertEqual(primary['stderr'], 'partial-native-err')
        self.assertLessEqual(primary['timeoutSeconds'], 10)
        self.assertIn('startMonotonic', primary)
        self.assertIn('deadlineMonotonic', primary)

    def test_normal_exit_is_preserved_with_final_sample(self):
        status, receipt, _, _ = self.exercise()
        self.assertEqual(status, 0)
        self.assertEqual(receipt['nativeExit'], 0)
        self.assertIn('finalAllocatedBytes', receipt)

    def test_native_deadline_stops_a_child_with_frozen_guard_clock(self):
        status, receipt, _, _ = self.exercise('import signal; signal.pause()')
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['guardFailureType'], 'TimeoutError')
        self.assertEqual(receipt['daemonShutdownExit'], 0)


if __name__ == '__main__':
    unittest.main()
