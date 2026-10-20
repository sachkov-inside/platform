"""Actual owned native listener/IPC diagnostics; no API/PG/provider execution."""
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-sdk-storage'))
import sdk_storage
import diagnostics
import producer_protocol


class NativeDiagnostics(unittest.TestCase):
    def test_native_exit_is_closed_and_reaped_after_listener_acquisition(self):
        for scope, capture in (('sdk', sdk_storage.emitter), ('tracking', producer_protocol.capture)):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'listener.json'
                code = ('const f=require("node:fs"),h=require("node:http");const s=h.createServer();'
                        's.listen(0,"127.0.0.1",()=>{const report='+json.dumps(str(path))+';f.writeFileSync(report+".tmp"'
                        ',JSON.stringify([process.pid,s.address().port]));f.renameSync(report+".tmp",report);'
                        'process.stderr.write("private-diagnostic-child-sentinel");process.exit(2);});')
                value = diagnostics.Diagnostic(scope)
                with self.assertRaises(RuntimeError): capture(argv=['node','-e',code], budget=1, diagnostic=value)
                pid, port = json.loads(path.read_text())
                with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
                with socket.socket() as listener: listener.bind(('127.0.0.1', port))
                self.assertEqual(value.snapshot()['reason'], 'native_exit')
                self.assertNotIn('private-diagnostic', json.dumps(value.snapshot()))


class NativeOutcomes(unittest.TestCase):
    def test_success_protocol_cap_decode_deadline_and_interruption_keep_closed_state_and_cleanup(self):
        from unittest.mock import patch
        for scope, capture, module in (('sdk', sdk_storage.emitter, sdk_storage), ('tracking', producer_protocol.capture, producer_protocol)):
            for case, ending, reason in (
                ('success', 's.close(()=>process.stdout.write("null"));', 'none'),
                ('decode', 's.close(()=>process.stdout.write("{private-diagnostic-sentinel"));', 'protocol_decode'),
                ('cap', 'process.stdout.write("x".repeat(1048577));', 'protocol_cap'),
                ('deadline', 'process.on("SIGTERM",()=>{});', 'deadline'),
                ('interrupt', 'process.stdout.write("x");', 'interrupted'),
            ):
                with self.subTest(scope=scope, case=case), tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / 'listener.json'
                    code = ('const f=require("node:fs"),h=require("node:http");const s=h.createServer();'
                            's.listen(0,"127.0.0.1",()=>{const report='+json.dumps(str(path))+';f.writeFileSync(report+".tmp"'
                            ',JSON.stringify([process.pid,s.address().port]));f.renameSync(report+".tmp",report);'
                            'process.stderr.write("private-diagnostic-child-sentinel");'+ending+'});')
                    value = diagnostics.Diagnostic(scope)
                    def run(): return capture(argv=['node','-e',code], budget=1, diagnostic=value)
                    if case == 'success': self.assertIsNone(run())
                    elif case == 'interrupt':
                        original = module.selectors.DefaultSelector.select
                        def interrupted(selector, timeout):
                            original(selector, timeout)
                            raise KeyboardInterrupt()
                        with patch.object(module.selectors.DefaultSelector, 'select', interrupted):
                            with self.assertRaises(KeyboardInterrupt): run()
                    else:
                        with self.assertRaises((ValueError, TimeoutError)): run()
                    pid, port = json.loads(path.read_text())
                    with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
                    with socket.socket() as listener: listener.bind(('127.0.0.1', port))
                    self.assertEqual(value.snapshot()['reason'], reason)
                    self.assertNotIn('private-diagnostic', json.dumps(value.snapshot()))


if __name__ == '__main__': unittest.main()
