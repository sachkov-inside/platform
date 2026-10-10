"""Focused guard contracts: native stdout/stderr only, all external commands doubled."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('guard', ROOT/'scripts/acquisition-diagnostic-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardContracts(unittest.TestCase):
    def exercise(self, payload='', *, growth=False, cleanup_error=False, git_expiry=False,
                 late_cache=False, cache_symlink=False, daemon_error=False, forced_timeout=False):
        with tempfile.TemporaryDirectory() as temporary:
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
                    raise subprocess.TimeoutExpired(command, kwargs['timeout'])
                return subprocess.CompletedProcess(command, 0, '', '')

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
                     patch.object(guard.subprocess, 'check_output', side_effect=check_output), \
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
                    process.wait(timeout=5)
                    if process.stdout is not None:
                        process.stdout.close()

    def test_combined_stdout_stderr_ceiling_and_final_exit(self):
        status, receipt, size, _ = self.exercise("import os; os.write(1,b'x'*600000); os.write(2,b'y'*600000)")
        self.assertLessEqual(size, 1024**2)
        self.assertNotEqual(status, 0)
        self.assertEqual(receipt['stopReason'], 'diagnostics budget')

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

    def test_normal_exit_is_preserved_with_final_sample(self):
        status, receipt, _, _ = self.exercise()
        self.assertEqual(status, 0)
        self.assertEqual(receipt['nativeExit'], 0)
        self.assertIn('finalAllocatedBytes', receipt)


if __name__ == '__main__':
    unittest.main()
