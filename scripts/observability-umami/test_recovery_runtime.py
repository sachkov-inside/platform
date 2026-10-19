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


class PublicMacPreparationBinding(unittest.TestCase):
    def run_public_cycle(self, mutation=None):
        """Real public prepare/augmentation, with OS admission and worker spawn boundaries replaced."""
        from contextlib import nullcontext, redirect_stdout
        import io
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        import subprocess
        pilot = recovery_runtime.pilot
        with tempfile.TemporaryDirectory() as directory:
            backing = Path(directory) / 'owned.raw'
            backing.touch()
            output = Path(directory) / 'owned-output'
            identity = {'context': 'orbstack', 'endpoint': 'unix:///fixture/docker.sock',
                'daemon_id': 'owned', 'storage': '/var/lib/docker', 'socket_device': 1, 'socket_inode': 2,
                'backing': {'path': str(backing), 'device': 1, 'inode': 2}}
            docker = Mock(return_value=json.dumps({'id': 'sha256:' + '0' * 64, 'architecture': 'arm64', 'os': 'linux'}))
            def command(args, **kwargs):
                if args[-2:] == ['status', '--porcelain']:
                    return ''
                if args[-2:] == ['rev-parse', 'HEAD']:
                    return 'a' * 40
                if args == ['docker', 'context', 'show']:
                    return 'orbstack'
                if args == ['docker', 'compose', 'ls', '--format', 'json']:
                    return '[]'
                self.fail('unexpected external command in public preparation')
            def worker(_argv, compose, path, project, **kwargs):
                plan = json.loads((path / 'compose.json').read_text())
                self.assertIn('storage-probe', plan['services'])
                if mutation is not None:
                    mutation(path, plan)
                with self.assertRaises(RuntimeError):
                    recovery_runtime.exercise(path, compose, project, execute=docker)
                return 1  # Stop before any container acquisition, never a successful runtime proof.
            with patch.object(pilot, 'command', side_effect=command), \
                    patch.object(pilot.platform, 'system', return_value='Darwin'), \
                    patch.object(pilot.platform, 'machine', return_value='arm64'), \
                    patch.object(pilot.orbstack, 'identify', return_value=identity), \
                    patch.object(pilot.orbstack, 'host_budget', return_value=nullcontext()), \
                    patch.object(pilot.shutil, 'disk_usage', return_value=SimpleNamespace(total=100*1024**3, free=80*1024**3)), \
                    patch.object(pilot, 'supervise_worker', side_effect=worker), \
                    patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', None), \
                    patch.object(pilot, 'FROZEN_DOCKER_ENDPOINT', None), redirect_stdout(io.StringIO()):
                with self.assertRaises(subprocess.CalledProcessError):
                    pilot.run(output, prepare_inputs=recovery_runtime.prepare_bound_inputs,
                              worker_script=Path(recovery_runtime.__file__), ports=(),
                              project_prefix=recovery.PROJECT_PREFIX, services=recovery.SERVICES)
            return docker.call_count

    def test_pg_bind_1_public_mac_augmentation_reaches_worker_image_admission(self):
        self.assertEqual(self.run_public_cycle(), 1)

    def test_mac_augmentation_never_admits_unexpected_composition_or_private_input_edits(self):
        for case in ('additional_service', 'source_mount', 'probe_mount', 'probe_writable',
                     'probe_missing', 'configuration', 'initial_roles'):
            def mutate(path, plan):
                if case == 'configuration':
                    with (path / 'pgbackrest.conf').open('a') as config:
                        config.write('\n# unexpected edit\n')
                    return
                if case == 'initial_roles':
                    with (path / 'init.sql').open('a') as roles:
                        roles.write('\nCREATE ROLE unexpected_admin SUPERUSER;\n')
                    return
                if case == 'additional_service':
                    plan['services']['unexpected'] = {'image': 'foreign:latest'}
                elif case == 'source_mount':
                    plan['services']['db']['volumes'][0] = 'foreign:/var/lib/postgresql'
                elif case == 'probe_mount':
                    plan['services']['storage-probe']['volumes'][0]['source'] = '/foreign'
                elif case == 'probe_writable':
                    plan['services']['storage-probe']['volumes'][0]['read_only'] = False
                elif case == 'probe_missing':
                    del plan['services']['storage-probe']
                recovery_runtime.pilot.write_json(path / 'compose.json', plan)
            with self.subTest(case=case):
                self.assertEqual(self.run_public_cycle(mutate), 0)
