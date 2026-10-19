"""Preparation boundary writes private inputs without starting any processes."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare', pathlib.Path(__file__).with_name('prepare.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class IsolatedInputs(unittest.TestCase):
    def test_only_query_is_published_and_has_no_database_credentials_mount(self):
        with tempfile.TemporaryDirectory() as parent:
            output = pathlib.Path(parent) / 'new-private'
            prepare.prepare(output)
            plan = json.loads((output / 'compose.json').read_text())
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in output.iterdir()))
            self.assertNotIn('ports', plan['services']['db'])
            self.assertNotIn('ports', plan['services']['umami'])
            self.assertEqual(plan['services']['query']['ports'], ['127.0.0.1:13301:3001'])
            self.assertEqual(plan['networks'], {'private': {'internal': True}})
            self.assertEqual(plan['services']['query']['volumes'][1], str(output / 'reader.key') + ':/private/reader.key:ro')
            self.assertTrue(all('@sha256:' in item['image'] for item in plan['services'].values()))
            with self.assertRaises(FileExistsError):
                prepare.prepare(output)

    def test_invalid_lock_has_no_output_side_effects(self):
        import copy
        with tempfile.TemporaryDirectory() as parent:
            root = pathlib.Path(parent)
            valid = json.loads(prepare.LOCK.read_text())
            invalid = []
            for field, value in [('schema', True), ('images', []), ('upstream_commit', '../bad'), ('sources', [{'path': '../bad', 'url': 'https://invalid', 'sha256': '0'*64}])]:
                candidate = copy.deepcopy(valid)
                candidate[field] = value
                invalid.append(candidate)
            candidate = copy.deepcopy(valid)
            candidate['images']['umami'] = 'arbitrary/image:latest\nsecret'
            invalid.append(candidate)
            for number, candidate in enumerate(invalid):
                lock = root / f'lock-{number}.json'
                lock.write_text(json.dumps(candidate))
                output = root / f'output-{number}'
                with self.subTest(number=number), self.assertRaises(ValueError):
                    prepare.prepare(output, lock_path=lock)
                self.assertFalse(output.exists())
