"""Owned plan/configuration boundary, with Docker/cache transport supplied as a double."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import fixture


class Fixture(unittest.TestCase):
    def test_cache_rejects_mutable_wrong_source_and_unknown_inputs_before_output(self):
        valid = {'schema': 1, 'source': 'a'*40, 'owner': 'inside-platform-production-smoke-cache-resource', 'backend': 'sha256:'+'b'*64, 'foundation': 'sha256:'+'c'*64}
        self.assertEqual(fixture.images(valid, 'a'*40), valid)
        for key, value in [('source', 'd'*40), ('backend', 'image:latest'), ('extra', True), ('schema', True), ('foundation', valid['backend'])]:
            invalid = {**valid, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                fixture.images(invalid, 'a'*40)

    def test_only_sdk_switch_changes_between_modes_and_unknown_mode_has_no_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'compose.json'
            plan = {'services': {'api': {'environment': {'INSIDE_OTEL_ENABLED': 'false', 'DATABASE_URL': 'private'}}}}
            path.write_text(json.dumps(plan))
            fixture.mode(path, 'on')
            expected = copy.deepcopy(plan)
            expected['services']['api']['environment']['INSIDE_OTEL_ENABLED'] = 'true'
            self.assertEqual(json.loads(path.read_text()), expected)
            with self.assertRaises(ValueError):
                fixture.mode(path, 'foreign')
            self.assertEqual(json.loads(path.read_text()), expected)

    def test_shared_private_configuration_does_not_run_smoke_or_load_dotenv(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            fixture.configuration(output, 'a'*40)
            env = (output/'runtime/api.env').read_text()
            self.assertIn('DATABASE_URL=postgresql://platform:', env)
            self.assertIn('LOGTO_ISSUER=https://identity.resource.test/oidc', env)
            self.assertIn('LOGTO_JWKS_URL=http://provider:8081/oidc/jwks', env)
            self.assertNotIn('sachkov.dev', env)
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in (output/'runtime').iterdir()))
