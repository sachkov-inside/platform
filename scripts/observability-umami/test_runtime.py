"""Umami public runtime preparation boundaries; Docker is never invoked by these tests."""
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
import socket
import os
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('umami_runtime', Path(__file__).with_name('runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class NativeInputBoundary(unittest.TestCase):
    def test_failed_seed_retains_only_closed_substage_and_http_status(self):
        report = {'phase': 'seed', 'step': 'privacy_config', 'error': 'http_status', 'http_status': 403}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'init.sql').write_text('private-sentinel')
            def completed(args, **kwargs):
                if args[-1] == 'seed':
                    return SimpleNamespace(returncode=1, stdout='credential-sentinel', stderr=json.dumps(report))
                return SimpleNamespace(returncode=0, stdout='', stderr='')
            with patch.object(runtime.pilot, 'command'), patch.object(runtime.pilot, 'assert_docker_identity'), \
                    patch.object(runtime.pilot, 'docker_args', side_effect=lambda args: args), \
                    patch.object(runtime.subprocess, 'run', side_effect=completed):
                with self.assertRaises(RuntimeError):
                    runtime.smoke(output, ['docker', 'compose'])
            result = json.loads((output / 'readiness.json').read_text())
            self.assertEqual(result.get('fixture'), report)
            self.assertNotIn('sentinel', json.dumps(result))

    def test_fixture_stderr_rejects_unknown_fields_values_status_and_oversize(self):
        valid = {'phase': 'seed', 'step': 'team_create', 'error': 'invalid_response', 'http_status': 200}
        invalid = [json.dumps({**valid, 'body': 'sentinel-private-body'}), 'sentinel-private-error',
                   json.dumps({**valid, 'phase': 'sentinel-private-phase'}),
                   json.dumps({**valid, 'step': 'sentinel-private-step'}),
                   json.dumps({**valid, 'error': 'sentinel-private-error'}),
                   json.dumps({**valid, 'http_status': True}), json.dumps({**valid, 'http_status': 600}),
                   json.dumps(valid) + ' ' * runtime.fixture.FAILURE_REPORT_BYTES]
        for stderr in invalid:
            with self.subTest(stderr=stderr[:30]), \
                    patch.object(runtime.pilot, 'assert_docker_identity'), \
                    patch.object(runtime.pilot, 'docker_args', side_effect=lambda args: args), \
                    patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='sentinel-token', stderr=stderr)):
                with self.assertRaises(runtime.FixtureCommandFailed) as failed:
                    runtime.invoke(['docker', 'compose'], ['exec', '-T', 'query', 'python', '/pilot/fixture.py', 'seed'], fixture_phase='seed')
                self.assertIsNone(failed.exception.diagnostic)
                self.assertNotIn('sentinel', str(failed.exception))
        with patch.object(runtime.pilot, 'assert_docker_identity'), \
                patch.object(runtime.pilot, 'docker_args', side_effect=lambda args: args), \
                patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr=json.dumps(valid))):
            with self.assertRaises(runtime.FixtureCommandFailed) as failed:
                runtime.invoke(['docker', 'compose'], ['exec', '-T', 'db', 'psql'])
            self.assertIsNone(failed.exception.diagnostic)

    def test_fixture_deadline_covers_identity_preflight_and_subprocess_together(self):
        with tempfile.TemporaryDirectory() as directory:
            endpoint = Path(directory) / 'docker.sock'
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(str(endpoint))
            def metadata(args, **kwargs):
                if args[-1] == 'show':
                    return 'owned'
                if 'inspect' in args:
                    return 'unix://' + str(endpoint)
                return json.dumps({'ID': 'owned', 'DockerRootDir': directory})
            try:
                with patch.dict(os.environ, {}, clear=True):
                    identity = runtime.pilot.daemon.identify(metadata)
                    for finished, expected_timeout in ((104, 6), (111, None)):
                        with self.subTest(finished=finished), \
                                patch.object(runtime.pilot, 'FROZEN_DOCKER_IDENTITY', identity), \
                                patch.object(runtime.pilot, '_raw_command', side_effect=metadata), \
                                patch.object(runtime.time, 'monotonic', side_effect=[100, 101, 102, 103, finished]), \
                                patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='', stderr='')) as command:
                            if expected_timeout is None:
                                with self.assertRaises(TimeoutError):
                                    runtime.invoke(['docker', 'compose'], ['exec', '-T', 'db', 'psql'], timeout=10)
                                command.assert_not_called()
                            else:
                                runtime.invoke(['docker', 'compose'], ['exec', '-T', 'db', 'psql'], timeout=10)
                                self.assertEqual(command.call_args.kwargs['timeout'], expected_timeout)
            finally:
                listener.close()

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
