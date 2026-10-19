"""Docker boundary contracts for the executable recovery controller, without a daemon."""
import json
from pathlib import Path
import tempfile
import unittest

import recovery
import recovery_runtime


class SourceAdmission(unittest.TestCase):
    def test_wrong_cached_image_never_acquires_a_container_or_volume(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery_runtime.prepare_bound_inputs(output)
            calls = []
            def docker(base, args, **kwargs):
                calls.append((base, args))
                return json.dumps({'id': 'sha256:' + '0' * 64, 'architecture': 'arm64', 'os': 'linux'})
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], recovery.PROJECT_PREFIX + 'a' * 12, execute=docker)
            self.assertTrue(calls)
            self.assertTrue(all(args[:2] == ['image', 'inspect'] for _, args in calls))
            proof = json.loads((output / 'recovery-proof.json').read_text())
            self.assertEqual(proof['stage'], 'cache_admission')
            self.assertEqual(proof['reader_gate'], 'closed')
            self.assertEqual(proof['state'], 'failed')

    def test_preexisting_destination_never_reaches_compose_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery_runtime.prepare_bound_inputs(output)
            plan = json.loads((output / 'compose.json').read_text())
            name = plan['volumes']['recovery']['name']
            cache = recovery.validate_cache(json.loads(recovery.CACHE_LOCK.read_text()))
            calls = []
            def docker(base, args, **kwargs):
                calls.append((base, args))
                if args[:2] == ['image', 'inspect']:
                    return json.dumps({'id': cache['image'], 'architecture': 'arm64', 'os': 'linux'})
                if args[:2] == ['volume', 'ls']:
                    return name + '\n'
                self.fail('preexisting destination reached acquisition')
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], recovery.PROJECT_PREFIX + 'a' * 12, execute=docker)
            self.assertEqual(json.loads((output / 'recovery-proof.json').read_text())['stage'], 'fresh_destination')
            self.assertFalse(any('up' in args or 'create' in args for _, args in calls))

    def test_changed_private_compose_is_rejected_before_any_docker_io(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery_runtime.prepare_bound_inputs(output)
            (output / 'compose.json').write_text('{"services":{"db":{"volumes":["foreign:/var/lib/postgresql"]}}}')
            docker = Mock(side_effect=AssertionError('changed inputs reached Docker'))
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], recovery.PROJECT_PREFIX + 'a' * 12, execute=docker)
            docker.assert_not_called()


class ReaderTransition(unittest.TestCase):
    def test_running_offline_postmaster_refuses_second_server_and_both_sql_actors(self):
        calls = []
        project = recovery.PROJECT_PREFIX + 'a' * 12
        def docker(base, args, **kwargs):
            calls.append(args)
            if args[:2] == ['stop', '--timeout']:
                return ''
            if args[:3] == ['ps', '--all', '-q']:
                return 'a' * 64
            if args[:1] == ['inspect']:
                return json.dumps({'image': 'unused', 'labels': {'com.docker.compose.project': project,
                    'com.docker.compose.service': 'recovered'},
                    'state': {'status': 'running', 'running': True, 'pid': 42}})
            self.fail('second postmaster or SQL actor started before stop was confirmed')
        with self.assertRaises(RuntimeError):
            recovery_runtime.open_sql_actors(['docker', 'compose'], project, 'unused', execute=docker)
        self.assertFalse(any('up' in args or 'start' in args or 'create' in args for args in calls))

    def test_repository_initializer_failure_cannot_start_database_or_reader(self):
        cache = recovery.validate_cache(json.loads(recovery.CACHE_LOCK.read_text()))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery_runtime.prepare_bound_inputs(output)
            calls = []
            def docker(base, args, **kwargs):
                calls.append(args)
                if args[:2] == ['image', 'inspect']:
                    return json.dumps({'id': cache['image'], 'architecture': 'arm64', 'os': 'linux'})
                if args[:2] == ['volume', 'ls']:
                    return ''
                if args == ['up', '-d', '--no-deps', 'repo-init']:
                    raise TimeoutError('private-initializer-sentinel')
                self.fail('failed initializer reached another acquisition')
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], recovery.PROJECT_PREFIX + 'a' * 12, execute=docker)
            report = json.loads((output / 'recovery-proof.json').read_text())
            self.assertEqual(report['stage'], 'repository_initialize')
            self.assertEqual(report['reader_gate'], 'closed')
            self.assertNotIn('sentinel', json.dumps(report))

    def test_unexpected_postgres_version_cannot_be_misreported_as_pg18_4_backup(self):
        cache = recovery.validate_cache(json.loads(recovery.CACHE_LOCK.read_text()))
        project = recovery.PROJECT_PREFIX + 'a' * 12
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery_runtime.prepare_bound_inputs(output)
            calls = []
            def docker(base, args, **kwargs):
                calls.append(args)
                if args[:2] == ['image', 'inspect']:
                    return json.dumps({'id': cache['image'], 'architecture': 'arm64', 'os': 'linux'})
                if args[:2] == ['volume', 'ls']:
                    return ''
                if args[:1] in (['up'], ['wait']):
                    return ''
                if args[:3] == ['ps', '--all', '-q']:
                    return 'a' * 64
                if args[:1] == ['inspect']:
                    return json.dumps({'labels': {'com.docker.compose.project': project,
                        'com.docker.compose.service': 'repo-init'},
                        'state': {'status': 'exited', 'running': False, 'pid': 0, 'exit_code': 0}})
                if 'pg_isready' in args:
                    return ''
                if 'psql' in args:
                    return json.dumps({'version_num': 180006, 'system_identifier': '1234567890123456789',
                                       'archive_mode': 'on', 'archive_command': 'pgbackrest --stanza=production archive-push %p'})
                self.fail('invalid server version reached backup or restoration')
            with self.assertRaises(RuntimeError):
                recovery_runtime.exercise(output, ['docker', 'compose'], project, execute=docker)
            report = json.loads((output / 'recovery-proof.json').read_text())
            self.assertEqual(report['stage'], 'source_database')
            self.assertFalse(any('backup' in args or 'restore' in args or 'reader' in args for args in calls))


class PublicRecoveryEntryPoint(unittest.TestCase):
    def test_help_is_available_without_starting_docker_or_a_supervisor(self):
        import contextlib
        import io
        import sys
        from unittest.mock import patch
        captured = io.StringIO()
        with patch.object(sys, 'argv', ['recovery_runtime.py', '--help']), \
                patch.object(recovery_runtime.pilot, 'run') as run, contextlib.redirect_stdout(captured):
            with self.assertRaises(SystemExit) as exit_code:
                recovery_runtime.main()
            self.assertEqual(exit_code.exception.code, 0)
            run.assert_not_called()
        self.assertIn('recover', captured.getvalue())

    def test_run_uses_public_supervisor_and_registered_services_without_host_ports(self):
        import sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(sys, 'argv', ['recovery_runtime.py', 'run', '--output', directory]), \
                patch.object(recovery_runtime.pilot, 'run', return_value={}) as run:
            recovery_runtime.main()
        self.assertEqual(run.call_args.kwargs['ports'], ())
        self.assertEqual(run.call_args.kwargs['services'], recovery.SERVICES)
        self.assertEqual(run.call_args.kwargs['project_prefix'], recovery.PROJECT_PREFIX)
        self.assertEqual(run.call_args.kwargs['worker_script'], Path(recovery_runtime.__file__).resolve())
