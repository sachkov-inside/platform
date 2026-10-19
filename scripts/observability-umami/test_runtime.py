"""Umami public runtime preparation boundaries; Docker is never invoked by these tests."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('umami_runtime', Path(__file__).with_name('runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class NativeInputBoundary(unittest.TestCase):
    def test_wrong_native_lock_is_rejected_before_acquisition(self):
        for value in [None, {'lockfileVersion': 3, 'packages': {'node_modules/@umami/mcp': True}}, {'lockfileVersion': 3, 'packages': {}}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.native_lock(value)

    def test_native_mcp_must_return_the_fixture_count(self):
        site = '00000000-0000-4000-8000-000000000001'
        result = {'content': [{'type': 'text', 'text': json.dumps({'websiteId': site, 'current': {'pageviews': 0}})}]}
        with self.assertRaises(RuntimeError):
            runtime.native_result(result, site)
        result['content'][0]['text'] = json.dumps({'websiteId': site, 'current': {'pageviews': 1}})
        self.assertIsNone(runtime.native_result(result, site))

    def test_checked_in_native_dependency_graph_is_fully_integrity_locked(self):
        lock = json.loads((runtime.CONFIG / 'mcp/package-lock.json').read_text())
        self.assertIs(runtime.native_lock(lock), lock)
        lock['packages']['node_modules/@umami/api-client']['resolved'] = 'https://foreign.invalid/package.tgz'
        with self.assertRaises(ValueError):
            runtime.native_lock(lock)

    def test_fixture_proof_cannot_publish_an_extra_provider_field(self):
        raw = {'synthetic_pageviews':1, 'gateway_mutation_corpus':'passed', 'native_team_reset_denied':True,
               'revoked_key_denied':True, 'stored_fixture_privacy':'passed', 'native_stdio_mcp':'pending',
               'retention_restore_runtime':'pending', 'key':'sentinel-private-key'}
        with self.assertRaises(ValueError):
            runtime.fixture_proof(raw)
        del raw['key']
        self.assertIs(runtime.fixture_proof(raw), raw)
