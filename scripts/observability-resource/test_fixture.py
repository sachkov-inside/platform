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

    def test_prepared_single_project_has_no_application_egress_ports_or_foreign_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'owned'
            pins={'schema':1,'source':'a'*40,'owner':'inside-platform-production-smoke-cache-resource','backend':'sha256:'+'b'*64,'foundation':'sha256:'+'c'*64}
            def command(args,**kwargs):
                if args[0]=='git':
                    return 'a'*40
                return pins['foundation'] if '-foundation:local' in ' '.join(args) else pins['backend']
            with patch.object(fixture.pilot,'command',side_effect=command),patch.object(fixture.pilot,'assert_docker_identity'):
                fixture.prepare(output,pins)
            plan=json.loads((output/'compose.json').read_text())
            for name in ('api','provider','loadgen','postgres','migrations'):
                self.assertEqual(plan['services'][name]['networks'],['pilot'])
                self.assertNotIn('ports',plan['services'][name])
                self.assertEqual(plan['services'][name]['pull_policy'],'never')
            self.assertEqual(plan['networks']['pilot'],{'internal':True})
            self.assertTrue(all('name' not in volume and 'external' not in volume for volume in plan['volumes'].values()))
            self.assertNotIn('/query',json.dumps(plan['services']['provider']))
            self.assertIn('/query:ro',json.dumps(plan['services']['loadgen']))
            self.assertTrue(all('/var/run/docker.sock' not in json.dumps(service) for service in plan['services'].values()))
            self.assertEqual((output/'query/key').stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads((output/'resource-source.json').read_text())['commit'],pins['source'])
