"""Supplied native boundary doubles; no Docker, systemctl or provider calls."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('hosted', Path(__file__).with_name('acquisition-diagnostic-hosted.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)


class NativeClosureContracts(unittest.TestCase):
    def qualify(self, snapshot=None, receipt=None, state=('inactive', '0')):
        return hosted.qualify_closure(
            Path('/workspace'), receipt or {'pending': 0, 'daemonShutdownExit': 0, 'supervisorExit': 29},
            snapshot or {}, lambda _pid: Path('/workspace/apps/backend'), lambda _unit: state)

    def test_failed_acquisition_can_have_proven_native_closure(self):
        self.assertEqual(self.qualify()['pending'], 0)
        self.assertEqual(self.qualify()['supervisorExit'], 29)

    def test_live_workspace_child_is_not_closed(self):
        self.assertNotEqual(self.qualify({424242: (1, 424242, 'S', 100)})['pending'], 0)

    def test_daemon_or_missing_guard_receipt_cannot_prove_closure(self):
        for state in [('active', '42'), ('inactive', '42'), ('failed', '0')]:
            with self.subTest(state=state):
                self.assertNotEqual(self.qualify(state=state)['pending'], 0)
        for receipt in [{'pending': 0}, {'pending': 0, 'daemonShutdownExit': 1, 'supervisorExit': 0}]:
            with self.subTest(receipt=receipt):
                self.assertNotEqual(self.qualify(receipt=receipt)['pending'], 0)


if __name__ == '__main__':
    unittest.main()
