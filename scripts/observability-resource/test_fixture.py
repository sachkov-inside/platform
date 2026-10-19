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
            self.assertTrue('DATABASE_URL=postgresql://platform:' in env, 'private database target')
            self.assertTrue('LOGTO_ISSUER=https://identity.resource.test/oidc' in env, 'synthetic issuer')
            self.assertTrue('LOGTO_JWKS_URL=https://provider:8081/oidc/jwks' in env, 'production JWKS requires HTTPS')
            self.assertFalse('sachkov.dev' in env, 'synthetic origins')
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in (output/'runtime').iterdir()))

    def test_owned_provider_certificate_is_private_and_generation_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            fixture.certificates(output)
            self.assertEqual((output/'provider-tls/server.key').stat().st_mode & 0o777,0o600)
            self.assertEqual((output/'provider-tls').stat().st_mode & 0o777,0o700)
            self.assertEqual((output/'trust').stat().st_mode & 0o777,0o755)
            self.assertEqual((output/'trust/provider.pem').stat().st_mode & 0o777,0o444)
            self.assertEqual((output/'trust/provider.pem').read_bytes(),(output/'provider-tls/server.pem').read_bytes())
        with tempfile.TemporaryDirectory() as directory, patch.object(fixture.subprocess,'run',side_effect=fixture.subprocess.TimeoutExpired('openssl',5)) as command:
            with self.assertRaisesRegex(RuntimeError,'private_certificate_generation_failed'):
                fixture.certificates(Path(directory))
            self.assertEqual(command.call_args.kwargs['timeout'],5)
            self.assertEqual(command.call_count,1)
            self.assertIn('subjectAltName=DNS:provider',command.call_args.args[0])

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
            api=plan['services']['api']
            self.assertEqual(api['environment']['NODE_EXTRA_CA_CERTS'],'/trust/provider.pem')
            self.assertEqual(api['volumes'],[str(output/'trust')+':/trust:ro'])
            self.assertIn(str(output/'provider-tls')+':/provider-tls:ro',plan['services']['provider']['volumes'])
            for name in plan['services']:
                if name!='api':
                    self.assertNotIn('NODE_EXTRA_CA_CERTS',plan['services'][name].get('environment',{}))
                    self.assertNotIn('/trust:',json.dumps(plan['services'][name]))
                if name!='provider':
                    self.assertNotIn('/provider-tls:',json.dumps(plan['services'][name]))
            self.assertNotIn('NODE_TLS_REJECT_UNAUTHORIZED',json.dumps(plan))
            self.assertEqual((output/'query/key').stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads((output/'resource-source.json').read_text())['commit'],pins['source'])
