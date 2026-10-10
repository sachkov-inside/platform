"""Actual unprivileged meter leaves; the mixed-UID Linux gate stays separate."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('meter', Path(__file__).with_name('acquisition-diagnostic-meter.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


class MeterContracts(unittest.TestCase):
    def test_partial_result_waits_for_committed_receipt_without_a_process(self):
        receipt = {'pending': 0, 'helper': {'pid': 424242}, 'fingerprints': [],
                   'stopReason': 'command timeout', 'nativeExit': -signal.SIGKILL,
                   'command': ['du', '-sk'], 'stdout': 'partial-out', 'stderr': 'partial-err'}
        reads = []
        def read(path, *args, **kwargs):
            self.assertEqual(path.name, 'result.json')
            reads.append(path)
            return '{"pending":' if len(reads) == 1 else json.dumps(receipt)
        def launch(directory, _request):
            # A supplied producer publishes only the file first; no child is started.
            (directory / 'result.json').touch()
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(meter, 'fingerprint', return_value={'pid': 424241}), \
                patch.object(meter, 'same_process', return_value=False), \
                patch.object(meter.Path, 'read_text', read), \
                patch.object(meter.time, 'monotonic', return_value=1000), \
                patch.object(meter.time, 'sleep'):
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                meter.measure([], Path(directory), 3, 4096, launch=launch)
        self.assertEqual(len(reads), 2)
        self.assertEqual(raised.exception.meter_receipt, receipt)
        self.assertFalse(raised.exception.meter_cleanup_pending)

    def test_incomplete_receipt_keeps_original_deadline_without_a_process(self):
        def launch(directory, _request):
            (directory / 'result.json').touch()
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(meter, 'fingerprint', return_value={'pid': 424241}), \
                patch.object(meter.Path, 'read_text', return_value='{"pending":'), \
                patch.object(meter.time, 'monotonic', side_effect=[1000, 1001, 1003]), \
                patch.object(meter.time, 'sleep'):
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                meter.measure([], Path(directory), 3, 4096, launch=launch)
        self.assertEqual(raised.exception.timeout, 3)
        self.assertTrue(raised.exception.meter_cleanup_pending)

    def test_privileged_service_client_has_its_own_root_timeout(self):
        calls = []
        def run(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0)
        with patch.object(meter.subprocess, 'run', side_effect=run):
            meter.launch_unit(Path('/private/fixture'), {'unit':'inside-fixture', 'deadlineMonotonic':time.monotonic()+10})
            meter.shutdown_daemon(30)
        for (command, options), client in zip(calls, ['systemd-run', 'systemctl'], strict=True):
            with self.subTest(client=client):
                self.assertEqual(command[:3], ['sudo', '-n', 'timeout'])
                self.assertNotIn('--foreground', command)
                self.assertIn('--signal=TERM', command)
                self.assertEqual(command[6], client)
                self.assertLessEqual(float(command[5]) + float(command[4].split('=')[1]), options['timeout'])

    def launch(self, directory, request):
        # Supplied service transport; actual worker/pipe/groups/signals/reap are unchanged.
        command = [sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("partial-out",flush=True); print("partial-err",file=__import__("sys").stderr,flush=True); time.sleep(30)']
        body = 'import importlib.util,json,os,sys; from pathlib import Path; s=importlib.util.spec_from_file_location("meter",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); d=Path(sys.argv[2]); m.worker(d,json.loads((d/"request.json").read_text()),json.loads(sys.argv[3]),os.getuid())'
        self.worker = subprocess.Popen([sys.executable, '-c', body, str(Path(meter.__file__)), str(directory), json.dumps(command)], start_new_session=True)
        self.reaper = threading.Thread(target=self.worker.wait)
        self.reaper.start()

    def tearDown(self):
        if hasattr(self, 'worker'):
            if self.worker.poll() is None:
                self.worker.kill()
            self.worker.wait(timeout=5)
            self.reaper.join(timeout=5)
            self.assertFalse(self.reaper.is_alive())

    def test_native_timeout_preserves_partial_output_and_reaps_owned_leaf(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                meter.measure([], output, 3, 4096, launch=self.launch)
            receipt = raised.exception.meter_receipt
            self.assertEqual(receipt['pending'], 0)
            self.assertEqual(receipt['nativeExit'], -signal.SIGKILL)
            self.assertIn('partial-out', receipt['stdout'])
            self.assertIn('partial-err', receipt['stderr'])
            self.assertTrue(receipt['fingerprints'])
            for owned in receipt['fingerprints']:
                self.assertEqual(owned['uids'][0], os.getuid())
                self.assertFalse(meter.same_process(owned))

    def test_control_eof_cancels_before_timeout_and_closes_leaf(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            start = time.monotonic()
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                meter.measure([], output, 5, 4096, launch=self.launch, cancelled=lambda: time.monotonic()-start > 0.2)
            receipt = raised.exception.meter_receipt
            self.assertEqual(receipt['stopReason'], 'owner EOF')
            self.assertEqual(receipt['pending'], 0)
            self.assertLess(time.monotonic()-start, 3)
            self.assertTrue(all(not meter.same_process(row) for row in receipt['fingerprints']))

    def test_output_budget_is_shared_by_both_pipes(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                meter.measure([], Path(directory), 5, 8, launch=self.launch)
            receipt = raised.exception.meter_receipt
            self.assertEqual(receipt['stopReason'], 'diagnostics budget')
            self.assertLessEqual(len(receipt['stdout'].encode()) + len(receipt['stderr'].encode()), 8)
            self.assertEqual(receipt['pending'], 0)


if __name__ == '__main__':
    unittest.main()
