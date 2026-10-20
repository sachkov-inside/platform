"""Owned Node child/loopback cleanup, with real exit, timeout and bounded output."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import sdk_storage


class NativeChild(unittest.TestCase):
    def assert_gone(self, filename):
        pid, port = json.loads(Path(filename).read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', port))

    def code(self, filename, ending):
        return ('const h=require("node:http");const f=require("node:fs");'
                'const s=h.createServer();s.listen(0,"127.0.0.1",()=>{'
                'f.writeFileSync('+json.dumps(filename)+',JSON.stringify([process.pid,s.address().port]));'+ending+'});')

    def test_success_failure_timeout_and_oversize_reap_owned_native_listener(self):
        cases = {'success': 's.close(()=>{process.stdout.write("{}");});',
                 'failure': 'process.exit(2);',
                 'timeout': 'process.on("SIGTERM",()=>{});',
                 'oversize': 'process.stdout.write("x".repeat(524289));'}
        for name, ending in cases.items():
            with self.subTest(case=name), tempfile.TemporaryDirectory() as directory:
                filename = str(Path(directory)/'owned.json')
                argv = ['node', '-e', self.code(filename, ending)]
                if name == 'success':
                    self.assertEqual(sdk_storage.emitter(argv=argv, budget=1), {})
                else:
                    with self.assertRaises((RuntimeError, ValueError, TimeoutError, subprocess.TimeoutExpired)):
                        sdk_storage.emitter(argv=argv, budget=1)
                self.assert_gone(filename)

    def test_keyboard_interrupt_preserves_interrupt_and_reaps_child(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = str(Path(directory)/'owned.json')
            argv = ['node', '-e', self.code(filename, '')]
            original_select = sdk_storage.selectors.DefaultSelector.select
            def interrupted(selector, timeout):
                # First real read barrier supplies committed listener ownership, not a pause.
                result = original_select(selector, timeout)
                raise KeyboardInterrupt()
            # The owned child writes an output byte only after registering pid/port.
            argv = ['node', '-e', self.code(filename, 'process.stdout.write("x");')]
            with patch.object(sdk_storage.selectors.DefaultSelector, 'select', interrupted):
                with self.assertRaises(KeyboardInterrupt):
                    sdk_storage.emitter(argv=argv, budget=1)
            self.assert_gone(filename)


class ProducerWitness(unittest.TestCase):
    def test_unrelated_loaded_modules_cannot_claim_production_s3_execution(self):
        value = {'schema': 1, 'trace_id': 'a'*32, 'root_id': 'b'*16, 'provider_requests': 1,
                 'body_read': 'passed', 'runtime_modules': {'node_modules/unrelated'+str(i)+'.js': 'a'*64 for i in range(4)}}
        with self.assertRaisesRegex(ValueError, 'production module witness missing'):
            sdk_storage.witness(value)
