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
        value = {'schema': 2, 'trace_id': 'a'*32, 'root_id': 'b'*16, 'provider_requests': 1,
                 'body_read': 'passed', 'runtime_modules': [{'path': 'node_modules/unrelated'+str(i)+'.js', 'sha256': 'a'*64} for i in range(4)]}
        with self.assertRaisesRegex(ValueError, 'production module witness missing'):
            sdk_storage.witness(value)


class PrivateWireWitness(unittest.TestCase):
    def wire(self, count=4, path_size=None):
        required = [
            'apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js',
            'apps/backend/dist/infrastructure/observability/technical-telemetry.js',
            'apps/backend/dist/infrastructure/object-storage/s3-object-storage.js',
            'apps/backend/dist/infrastructure/object-storage/s3-request-observation.js',
        ]
        rows = [{'path': name, 'sha256': 'a'*64} for name in required]
        for index in range(count-4):
            name = 'node_modules/module-'+str(index)+'.js'
            if path_size is not None:
                prefix = 'node_modules/'+str(index)+'-'
                name = prefix+'x'*(path_size-len(prefix))
            rows.append({'path': name, 'sha256': 'a'*64})
        return {'schema': 2, 'trace_id': 'a'*32, 'root_id': 'b'*16,
                'provider_requests': 1, 'body_read': 'passed', 'runtime_modules': rows}

    def parse(self, value):
        return sdk_storage.witness(sdk_storage.oracle.decode(json.dumps(value)))

    def test_fixed_rows_normalize_only_after_validation_and_keep_input_unchanged(self):
        value = self.wire()
        original = json.dumps(value)
        normalized = self.parse(value)
        self.assertEqual(normalized['runtime_modules'], {row['path']: 'a'*64 for row in value['runtime_modules']})
        self.assertEqual(json.dumps(value), original)
        self.assertIs(type(value['runtime_modules']), list)

    def test_compiled_contract_package_is_bound_without_admitting_other_documents(self):
        path = 'docs/contracts/dist/runtime/diagnostic-error.js'
        value = self.wire()
        value['runtime_modules'].append({'path': path, 'sha256': 'b'*64})
        self.assertEqual(self.parse(value)['runtime_modules'][path], 'b'*64)
        selected = {str(item.relative_to(sdk_storage.pilot.ROOT)) for item in sdk_storage.source_inputs()}
        self.assertTrue({'docs/contracts/runtime/diagnostic-error.ts',
                         'docs/contracts/tsconfig.build.json', 'docs/contracts/package.json'} <= selected)
        for rejected in ('docs/legal/privacy-v5.md', 'docs/contracts/runtime/diagnostic-error.ts',
                         'docs/contracts/dist-other/module.js', 'docs/contracts/dist/../private.js',
                         'docs/contracts/dist/sdk-storage-private.js'):
            with self.subTest(path=rejected):
                invalid = self.wire()
                invalid['runtime_modules'].append({'path': rejected, 'sha256': 'b'*64})
                with self.assertRaises(ValueError):
                    self.parse(invalid)

    def test_module_count_and_path_size_boundaries(self):
        self.assertEqual(len(self.parse(self.wire(1000))['runtime_modules']), 1000)
        self.assertEqual(len(self.parse(self.wire(5, 512))['runtime_modules']), 5)
        too_few = self.wire()
        too_few['runtime_modules'].pop()
        for value in (self.wire(1001), self.wire(5, 513), too_few):
            with self.assertRaises(ValueError):
                self.parse(value)

    def test_duplicate_paths_rejected_even_with_identical_digest_before_projection(self):
        for digest in ('a'*64, 'b'*64):
            for where in ('first', 'last', 'partial'):
                with self.subTest(digest='same' if digest[0] == 'a' else 'contradictory', position=where):
                    value = self.wire()
                    duplicate = {**value['runtime_modules'][0], 'sha256': digest}
                    if where == 'first':
                        value['runtime_modules'].insert(0, duplicate)
                    elif where == 'last':
                        value['runtime_modules'].append(duplicate)
                    else:
                        value['runtime_modules'][-1] = duplicate
                    with self.assertRaisesRegex(ValueError, '^duplicate module witness$'):
                        self.parse(value)

    def test_missing_required_module_rejected_with_valid_unrelated_replacement(self):
        value = self.wire()
        value['runtime_modules'][-1]['path'] = 'node_modules/unrelated.js'
        with self.assertRaisesRegex(ValueError, '^production module witness missing$'):
            self.parse(value)

    def test_unknown_schema_root_fields_types_and_identity_are_rejected(self):
        for field, item in (('schema', 1), ('schema', 3), ('schema', True), ('schema', 2.0),
                            ('schema', '2'), ('schema', None), ('provider_requests', True),
                            ('provider_requests', 2), ('trace_id', '0'*32), ('root_id', '0'*16),
                            ('trace_id', []), ('body_read', False), ('unknown', 'private-value'),
                            ('runtime_modules', {}), ('runtime_modules', None), ('runtime_modules', [])):
            with self.subTest(field=field, type=type(item).__name__, value=str(item)):
                value = self.wire()
                value[field] = item
                with self.assertRaises(ValueError):
                    self.parse(value)

    def test_exact_row_keys_path_and_digest_types_and_privacy(self):
        variants = (
            None, [], True,
            {'path': 'node_modules/module.js'},
            {'path': 'node_modules/module.js', 'sha256': 'a'*64, 'unknown': 'value'},
            {'path': None, 'sha256': 'a'*64},
            {'path': [], 'sha256': 'a'*64},
            {'path': '/absolute/module.js', 'sha256': 'a'*64},
            {'path': 'node_modules/../module.js', 'sha256': 'a'*64},
            {'path': 'other/module.js', 'sha256': 'a'*64},
            {'path': 'node_modules/sdk-storage-private.js', 'sha256': 'a'*64},
            {'path': 'node_modules/module.js', 'sha256': None},
            {'path': 'node_modules/module.js', 'sha256': True},
            {'path': 'node_modules/module.js', 'sha256': 'a'*63},
            {'path': 'node_modules/module.js', 'sha256': 'a'*65},
            {'path': 'node_modules/module.js', 'sha256': 'A'*64},
        )
        for index, row in enumerate(variants):
            with self.subTest(case=index):
                value = self.wire()
                value['runtime_modules'].append(row)
                with self.assertRaises(ValueError):
                    self.parse(value)
        private = self.wire()
        private['runtime_modules'].append({'path': 'node_modules/sdk-storage-private.js', 'sha256': 'a'*64})
        with self.assertRaises(ValueError):
            sdk_storage.witness(private)

    def test_duplicate_json_and_escaped_private_values_remain_rejected(self):
        encoded = json.dumps(self.wire())
        duplicate_root = encoded.replace('{"schema": 2,', '{"schema": 2, "schema": 2,', 1)
        duplicate_escaped_root = encoded.replace('{"schema": 2,', '{"schem\\u0061": 2, "schema": 2,', 1)
        duplicate_row = encoded.replace('{"path": ', '{"path": "node_modules/unrelated.js", "path": ', 1)
        duplicate_escaped_row = encoded.replace('{"path": ', '{"\\u0070ath": "node_modules/unrelated.js", "path": ', 1)
        private = self.wire()
        private['runtime_modules'].append({'path': 'node_modules/sdk-storage-private.js', 'sha256': 'a'*64})
        escaped = json.dumps(private).replace('sdk-storage-private', '\\u0073dk-storage-private')
        for case, raw in enumerate((duplicate_root, duplicate_escaped_root, duplicate_row, duplicate_escaped_row, escaped)):
            with self.subTest(case=case):
                with self.assertRaises(ValueError):
                    sdk_storage.witness(sdk_storage.oracle.decode(raw))

    def test_shared_json_key_depth_and_array_limits_are_not_expanded(self):
        self.assertEqual(sdk_storage.oracle.decode(json.dumps({'x'*128: 0})), {'x'*128: 0})
        for value in ({'x'*129: 0}, {'rows': [0]*1001}, {'a': {'b': {'c': {'d': {'e': {'f': {'g': {'h': {'i': {'j': {'k': {'l': {'m': {'n': {'o': {'p': {'q': 0}}}}}}}}}}}}}}}}}):
            with self.assertRaises(ValueError):
                sdk_storage.oracle.decode(json.dumps(value))

    def test_combined_child_byte_cap_rejects_individually_valid_count_and_paths(self):
        value = self.wire(1000, 512)
        self.assertEqual(len(self.parse(value)['runtime_modules']), 1000)
        raw = json.dumps(value)
        self.assertGreater(len(raw.encode()), sdk_storage.CHILD_BYTES)
        real_popen = subprocess.Popen
        children = []
        def owned_child(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'module-rows.json'
            source.write_text(raw)
            source.chmod(0o600)
            with patch.object(sdk_storage.subprocess, 'Popen', owned_child):
                with self.assertRaises(ValueError):
                    sdk_storage.emitter(argv=['node', '-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', str(source)], budget=3)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
        with self.assertRaises(ProcessLookupError):
            os.kill(children[0].pid, 0)
