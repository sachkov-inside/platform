"""Historical foundation bytes exercise the unchanged cache validator, without Docker."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import recovery
import recovery_runtime


class HistoricalFoundationSource(unittest.TestCase):
    def test_historical_bytes_reach_the_real_validator_and_every_runtime_binding_read(self):
        from recovery_test_source import historical_foundation_source
        lock = json.loads(recovery.CACHE_LOCK.read_text())
        with historical_foundation_source() as files, tempfile.TemporaryDirectory() as directory:
            self.assertEqual(set(files), set(recovery.FOUNDATION_INPUTS))
            self.assertIs(recovery.validate_cache(lock), lock)
            for relative, temporary in files.items():
                self.assertEqual(hashlib.sha256(temporary.read_bytes()).hexdigest(), lock['inputs'][relative])
                self.assertEqual((recovery.ROOT/relative).read_bytes(), temporary.read_bytes())
                self.assertEqual((recovery.ROOT/relative).read_text(), temporary.read_text())
            output = Path(directory)/'owned'
            recovery_runtime.prepare_bound_inputs(output)
            binding = json.loads((output/'recovery-inputs.json').read_text())
            for relative in recovery_runtime.BINDING_INPUTS:
                self.assertEqual(binding['inputs'][relative],
                                 hashlib.sha256((recovery_runtime.ROOT/relative).read_bytes()).hexdigest())
            self.assertEqual(binding['foundation_source'], lock['source'])
            self.assertEqual(binding['foundation_image'], lock['image'])
            temporary = files['infra/production/database/Dockerfile']
            temporary.write_bytes(temporary.read_bytes() + b'\n# unexpected source mutation\n')
            with self.assertRaisesRegex(ValueError, 'foundation_cache_source_changed'):
                recovery.validate_cache(lock)
            docker = Mock(side_effect=AssertionError('changed source reached acquisition'))
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], recovery.PROJECT_PREFIX+'a'*12, execute=docker)
            docker.assert_not_called()

    def test_current_source_refuses_historical_cache_before_preparation_or_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(recovery, 'prepare_inputs') as prepare, \
                patch.object(recovery_runtime.runtime, 'invoke') as acquire:
            output = Path(directory)/'owned'
            with self.assertRaisesRegex(ValueError, 'foundation_cache_source_changed'):
                recovery_runtime.prepare_bound_inputs(output)
            prepare.assert_not_called()
            acquire.assert_not_called()
            self.assertFalse(output.exists())

    def test_missing_each_historical_file_reaches_the_actual_filesystem_error(self):
        from recovery_test_source import historical_foundation_source
        lock = json.loads(recovery.CACHE_LOCK.read_text())
        for relative in recovery.FOUNDATION_INPUTS:
            with self.subTest(path=relative), historical_foundation_source() as files:
                files[relative].unlink()
                with self.assertRaises(FileNotFoundError):
                    recovery.validate_cache(lock)

    def test_unlisted_reads_delegate_arguments_and_errors_and_exception_restores_methods(self):
        from recovery_test_source import historical_foundation_source
        read_bytes, read_text = Path.read_bytes, Path.read_text
        roots = (recovery.ROOT, recovery.FOUNDATION, recovery.CACHE_LOCK, recovery_runtime.ROOT,
                 recovery_runtime.BINDING_INPUTS)
        lock_bytes = recovery.CACHE_LOCK.read_bytes()
        current = recovery.ROOT/'infra/production/database/libpq-version.c'
        current_bytes = current.read_bytes()
        temporary = None
        with tempfile.TemporaryDirectory() as directory:
            unlisted = Path(directory)/'unlisted'
            unlisted.write_bytes(b'\xff\r\n')
            with self.assertRaisesRegex(RuntimeError, 'test_context_exit'):
                with historical_foundation_source() as files:
                    temporary = next(iter(files.values()))
                    self.assertEqual(recovery.CACHE_LOCK.read_bytes(), lock_bytes)
                    self.assertEqual(current.read_bytes(), current_bytes)
                    self.assertEqual(unlisted.read_bytes(), b'\xff\r\n')
                    self.assertEqual(unlisted.read_text(encoding='latin-1'), '\xff\n')
                    with self.assertRaises(UnicodeDecodeError):
                        unlisted.read_text(encoding='utf-8', errors='strict')
                    with self.assertRaises(FileNotFoundError):
                        (Path(directory)/'absent').read_bytes()
                    raise RuntimeError('test_context_exit')
        self.assertIs(Path.read_bytes, read_bytes)
        self.assertIs(Path.read_text, read_text)
        self.assertEqual(roots, (recovery.ROOT, recovery.FOUNDATION, recovery.CACHE_LOCK,
                                 recovery_runtime.ROOT, recovery_runtime.BINDING_INPUTS))
        self.assertFalse(temporary.exists())

    def test_changed_fixture_or_provenance_fails_before_installing_any_read_patch(self):
        import recovery_test_source
        original_bytes, original_text = Path.read_bytes, Path.read_text
        fixtures = recovery_test_source.FIXTURES
        for case in ('source', 'input_set', 'expected_hash', 'fixture_bytes'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                temporary = Path(directory)
                for path in fixtures.iterdir():
                    (temporary/path.name).write_bytes(path.read_bytes())
                provenance = json.loads((temporary/'provenance.json').read_text())
                if case == 'source':
                    provenance['source'] = '0'*40
                elif case == 'input_set':
                    provenance['inputs'].pop('infra/production/database/Dockerfile')
                elif case == 'expected_hash':
                    provenance['inputs']['infra/production/database/Dockerfile'] = '0'*64
                else:
                    (temporary/'Dockerfile').write_bytes(b'changed fixture bytes')
                (temporary/'provenance.json').write_text(json.dumps(provenance))
                with patch.object(recovery_test_source, 'FIXTURES', temporary), self.assertRaises(ValueError):
                    with recovery_test_source.historical_foundation_source():
                        self.fail('invalid fixture reached projected source')
                self.assertIs(Path.read_bytes, original_bytes)
                self.assertIs(Path.read_text, original_text)
