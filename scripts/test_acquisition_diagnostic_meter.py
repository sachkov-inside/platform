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

native_spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('acquisition-diagnostic-meter-native.py'))
native = importlib.util.module_from_spec(native_spec)
native_spec.loader.exec_module(native)


class NativeReceiptContracts(unittest.TestCase):
    def test_signal_exit_preserves_native_status_and_encodes_caller_status(self):
        def run(command, **_kwargs):
            raise subprocess.CalledProcessError(-signal.SIGKILL, command)
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL='1'), \
                patch.object(native.time, 'monotonic', return_value=1000), \
                patch.object(native.subprocess, 'run', side_effect=run):
            exit_code = native.client_caller('systemd-run', Path(directory))
            receipt = json.loads((Path(directory) / 'transport-exit.json').read_text())
        self.assertEqual(receipt['nativeExit'], -signal.SIGKILL)
        self.assertEqual(receipt['failureType'], 'CalledProcessError')
        self.assertEqual(exit_code, 128 + signal.SIGKILL)

    def record(self, client='systemd-run', action='command-timeout'):
        def row(pid, parent, birth):
            return {'pid': pid, 'ppid': parent, 'pgid': 100, 'sid': 99,
                    'birth': birth, 'uids': [0, 0, 0, 0]}
        identities = {'monitor': row(100, 99, 10), 'client': row(101, 100, 11), 'child': row(102, 101, 12)}
        return {'client': client, 'case': action, 'pending': 0, 'fingerprints': identities,
                'kernelReady': json.loads(json.dumps(identities)), 'callerExit': 137,
                'transportExit': {'nativeExit': -signal.SIGKILL, 'failureType': 'CalledProcessError', 'transportElapsedSeconds': 2.6},
                'transport': {'productionCommand': ['sudo', '-n', 'timeout', '--signal=TERM', '--kill-after=0.5', '2', client],
                              'timeoutSeconds': 3}}

    def test_timeout_needs_expired_timer_and_validated_native_absence(self):
        for client in ('systemd-run', 'systemctl'):
            for code in (-signal.SIGKILL, 128 + signal.SIGKILL):
                with self.subTest(client=client, native_exit=code):
                    record = self.record(client)
                    record['transportExit']['nativeExit'] = code
                    native.qualify_client_case(record, client, 'command-timeout', lambda _pid: None)
                    self.assertEqual(record['kernelAbsence'], {'monitor': None, 'client': None, 'child': None})

    def test_invalid_timeout_receipts_cannot_qualify(self):
        mutations = {
            'pending': lambda r: r.update(pending='unproven'),
            'boolean-pending': lambda r: r.update(pending=False),
            'missing-case': lambda r: r.pop('case'),
            'foreign-client': lambda r: r.update(client='foreign-client'),
            'missing-identity': lambda r: r['fingerprints'].pop('child'),
            'missing-kernel-ready': lambda r: r.pop('kernelReady'),
            'wrong-birth': lambda r: r['fingerprints']['child'].update(birth=999),
            'foreign-uid': lambda r: r['fingerprints']['child'].update(uids=[1001] * 4),
            'foreign-group': lambda r: r['fingerprints']['child'].update(pgid=999),
            'nonexpired-timer': lambda r: r['transportExit'].update(transportElapsedSeconds=1.9),
            'outer-budget-exceeded': lambda r: r['transportExit'].update(transportElapsedSeconds=3.1),
            'outer-timeout': lambda r: r['transportExit'].update(failureType='TimeoutExpired'),
            'wrong-exit-pair': lambda r: r.update(callerExit=247),
            'unexpected-term-exit': lambda r: (r.update(callerExit=124), r['transportExit'].update(nativeExit=124)),
            'foreign-transport': lambda r: r['transport']['productionCommand'].__setitem__(6, 'systemctl'),
        }
        for name, mutate in mutations.items():
            with self.subTest(case=name):
                record = self.record()
                mutate(record)
                with self.assertRaises((AssertionError, KeyError, TypeError)):
                    native.qualify_client_case(record, 'systemd-run', 'command-timeout', lambda _pid: None)
        for name in ('client', 'child', 'monitor'):
            with self.subTest(live_root=name):
                record = self.record()
                live = record['fingerprints'][name]
                with self.assertRaises(AssertionError):
                    native.qualify_client_case(record, 'systemd-run', 'command-timeout', lambda pid: live if pid == live['pid'] else None)

    def test_intentional_exits_still_require_native_absence(self):
        for action, caller_exit, transport_exit in [('ordinary-exit', 29, 29), ('sudo-sigkill', 137, -signal.SIGKILL), ('caller-sigkill', -signal.SIGKILL, None)]:
            with self.subTest(case=action):
                record = self.record(action=action)
                record['callerExit'] = caller_exit
                record['transportExit']['nativeExit'] = transport_exit
                native.qualify_client_case(record, 'systemd-run', action, lambda _pid: None)
                live = record['fingerprints']['child']
                with self.assertRaises(AssertionError):
                    native.qualify_client_case(record, 'systemd-run', action, lambda pid: live if pid == live['pid'] else None)


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
