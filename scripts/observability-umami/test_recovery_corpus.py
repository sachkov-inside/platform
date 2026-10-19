"""Callback continuity through the owning corpus; SQL/Docker are bounded external fakes."""
import json
from pathlib import Path
import tempfile
import subprocess
import unittest

import recovery
import recovery_runtime as runner
import retention_fixture
from test_retention import batch


class CorpusCallbackContinuity(unittest.TestCase):
    def run_corpus(self, failure=None, *, whole_controller=False, reject_create_service='all'):
        project = recovery.PROJECT_PREFIX + 'a' * 12
        image = json.loads(recovery.CACHE_LOCK.read_text())['image']
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            runner.prepare_bound_inputs(output)
            plan = json.loads((output / 'compose.json').read_text())
            destination = plan['volumes']['recovery']['name']
            states = {'db': 'running'}
            identifiers = {name: format(index, '064x') for index, name in enumerate(recovery.SERVICES, 1)}
            services = {identity: name for name, identity in identifiers.items()}
            operations = []
            backup_commands = []
            calls = []
            batches = iter([batch(1), batch(0)])
            recovery_checks = 0
            def execute(base, args, *, payload=None, timeout=60, fixture_phase=None):
                nonlocal recovery_checks
                calls.append(args)
                self.assertLess(len(calls), 160, 'bounded fake command budget exhausted')
                if args[0] == 'create' and (reject_create_service == 'all' or args[-1] == reject_create_service):
                    if '--no-deps' in args:
                        raise runner.runtime.FixtureCommandFailed(returncode=1)
                if args[0] == 'create' and args[-1] == 'restore':
                    if failure == 'create':
                        raise subprocess.CalledProcessError(7, ['private-sentinel'], stderr='private-sentinel')
                    if failure == 'timeout':
                        raise subprocess.TimeoutExpired(['private-sentinel'], 90)
                if args == ['create', 'recovered'] and failure == 'postmaster_create':
                    raise subprocess.CalledProcessError(11, ['private-sentinel'], stderr='private-sentinel')
                if args == ['start', 'recovered'] and failure == 'postmaster_start':
                    raise runner.runtime.FixtureCommandFailed(returncode=17)
                if 'pg_isready' in args and 'recovered' in args and failure == 'postmaster_ready_timeout':
                    raise subprocess.TimeoutExpired(['private-sentinel'], timeout)
                if args[:2] == ['image', 'inspect']:
                    return json.dumps({'id': image, 'architecture': 'arm64', 'os': 'linux'})
                if args[:2] == ['volume', 'ls']:
                    return ''
                if payload is not None and 'recovered' in args:
                    if "'recovery_ended'" in payload:
                        recovery_checks += 1
                        if failure == 'postmaster_ready_json' and recovery_checks == 1:
                            return 'private-sentinel'
                        if failure == 'postmaster_recovery_ended' and recovery_checks == 2:
                            return json.dumps({'recovery_ended': False})
                    for key, condition in (('postmaster_cluster', "'version_num'"),
                            ('postmaster_platform', "'platform_rows'"), ('postmaster_role', "'bounded_role'"),
                            ('postmaster_events', "'deleted_event_reappeared'")):
                        if failure == key and condition in payload:
                            return 'private-sentinel'
                    if failure == 'postmaster_lineage' and "'version_num'" in payload:
                        return json.dumps({'version_num': 180004, 'system_identifier': '9999999999999999999',
                            'archive_mode': 'off', 'archive_command': 'pgbackrest --stanza=production archive-push %p'})
                    if failure == 'postmaster_later' and "'remaining'" in payload:
                        return 'private-sentinel'
                if payload is not None:
                    if 'SELECT 1/0' in payload:
                        raise runner.runtime.FixtureCommandFailed(returncode=1)
                    if "'platform_rows'" in payload:
                        return json.dumps({'platform_rows': 1, 'platform_untouched': True})
                    if "'bounded_role'" in payload:
                        return json.dumps({'bounded_role': True, 'connection_limit': 8,
                            'statement_timeout': '5s', 'idle_timeout': '10s', 'platform_connect_denied': True,
                            'logto_connect_denied': True, 'no_role_membership': True, 'own_database': True})
                    if "'version_num'" in payload:
                        return json.dumps({'version_num': 180004, 'system_identifier': '1234567890123456789',
                            'archive_mode': 'on' if 'recovered' not in states else 'off', 'archive_command': 'pgbackrest --stanza=production archive-push %p'})
                    if "'deleted_event_reappeared'" in payload:
                        return json.dumps({'deleted_event_reappeared': 1, 'expired_events_reappeared': 502})
                    if "'recovery_ended'" in payload:
                        return json.dumps({'recovery_ended': True})
                    if "'cutoff_age_seconds'" in payload:
                        return next(batches)
                    if "'remaining'" in payload:
                        return json.dumps({'remaining': 0})
                    if "'boundary_event_rows'" in payload:
                        return json.dumps({**retention_fixture.EXPECTED, 'boundary_event_rows': 0})
                    if "'expired_event_rows'" in payload:
                        return json.dumps({'cutoff': '2025-10-19T12:00:00.000000Z', 'expired_event_rows': 502})
                    return ''  # Preparation writes are not a persistence proof in this contract.
                if 'pg_isready' in args:
                    return ''
                if 'pgbackrest' in args and args[-1] == 'version':
                    return 'pgBackRest 2.57.0'
                if args[-1] in ('stanza-create', 'check'):
                    backup_commands.append(args[-1])
                    return ''
                if args[-1] == 'info':
                    return json.dumps([{'name': 'production', 'cipher': 'aes-256-cbc', 'status': {'code': 0},
                        'backup': [{'label': '20261019-120000F', 'type': 'full',
                            'timestamp': {'start': 1792411200, 'stop': 1792411201},
                            'database-ref': [{'name': 'inside', 'oid': 16384}, {'name': 'umami', 'oid': 16400}]}]}])
                if args[0] in ('up', 'start', 'create', 'stop'):
                    service = args[-1]
                    states[service] = ('created' if args[0] == 'create' else 'exited' if args[0] == 'stop'
                        or service in ('repo-init', 'backup', 'restore', 'reader', 'ingest') else 'running')
                    return ''
                if args[0] == 'wait':
                    self.assertEqual(states[services[args[-1]] if base == ['docker'] else args[-1]], 'exited')
                    return '0\n'
                if args[:3] == ['ps', '--all', '-q']:
                    if args == ['ps', '--all', '-q', 'recovered'] and failure == 'postmaster_identity':
                        return 'private-sentinel'
                    if failure == 'postmaster_readers' and 'recovered' in states and recovery_checks >= 2 and args[-3:] == ['read-db', 'reader', 'ingest']:
                        return 'private-sentinel'
                    if args[-1] == 'restore' and failure == 'identity':
                        return 'private-sentinel'
                    return '\n'.join(identifiers[name] for name in args[3:] if name in states)
                if args[0] == 'inspect':
                    service = services[args[1]]
                    state = states[service]
                    if service == 'recovered' and failure == 'postmaster_inspect':
                        return 'private-sentinel'
                    if service == 'recovered' and failure == 'postmaster_stopped':
                        state = 'running'
                    if service == 'restore' and failure == 'inspect_command':
                        raise runner.runtime.FixtureCommandFailed(returncode=17)
                    if service == 'restore' and failure == 'inspect':
                        return 'private-sentinel'
                    return json.dumps({'id': args[1], 'image': image, 'labels': {'com.docker.compose.project': 'foreign' if (service == 'restore' and failure == 'owner') or (service == 'recovered' and failure == 'postmaster_owner') else project,
                        'com.docker.compose.service': service}, 'ports': None,
                        'network': project + '_private' if service == 'read-db' or (service == 'restore' and failure == 'offline') or (service == 'recovered' and failure == 'postmaster_offline') else 'none',
                        'mounts': [{'Type': 'volume', 'Name': project + '_database' if (service == 'restore' and failure == 'mounts') or (service == 'recovered' and failure == 'postmaster_mount') else destination, 'Destination': '/var/lib/postgresql', 'RW': True},
                                   {'Type': 'volume', 'Name': project + '_repository', 'Destination': '/backup', 'RW': False}],
                        'state': {'status': state, 'running': state == 'running',
                            'pid': 42 if state == 'running' else 0, 'exit_code': 0}})
                if args[:2] == ['volume', 'inspect']:
                    if failure == 'volume_command':
                        raise runner.runtime.FixtureCommandFailed(returncode=9)
                    if failure == 'volume':
                        return 'private-sentinel'
                    return json.dumps({'Name': destination, 'Driver': 'local', 'Scope': 'local', 'Options': None,
                        'Labels': {'com.docker.compose.project': project, 'com.docker.compose.volume': 'foreign' if failure == 'ownership' else 'recovery'}})
                if args[0] == 'logs':
                    return json.dumps({'reader_rows': 2, 'blocked_rows': 0} if args[-1] == 'reader' else {'ingest_rows': 1})
                self.fail('unsupported external command in callback contract')
            if whole_controller:
                try:
                    runner.exercise(output, ['docker', 'compose'], project, execute=execute)
                except RuntimeError:
                    if failure is None:
                        raise
                return json.loads((output / 'recovery-proof.json').read_text()), calls
            report = {'reader_gate': 'closed'}
            result = runner._database_corpus(output, ['docker', 'compose'], project, plan,
                {'system_identifier': '1234567890123456789'}, report, lambda: None, execute,
                lambda value: operations.append(json.loads(json.dumps(value))))
            self.assertEqual(backup_commands, ['stanza-create', 'check'])
            self.assertEqual([value['service'] for value in operations if value['outcome'] == 'passed'],
                             ['backup', 'restore', 'reader', 'ingest'])
            self.assertEqual(result['state'], 'passed')
            self.assertEqual(result['reader_gate'], 'opened_after_replay_and_current_ttl')

    def test_pg_diag_01_diagnostic_callback_survives_stanza_check_backup_restore_and_sql_actors(self):
        self.run_corpus()

    def test_create_services_use_supported_cli_contract_without_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            runner.prepare_bound_inputs(output)
            plan = json.loads((output / 'compose.json').read_text())
            self.assertTrue(all('depends_on' not in service for service in plan['services'].values()))
        for service in ('restore', 'recovered', 'read-db'):
            with self.subTest(service=service):
                report, calls = self.run_corpus(whole_controller=True, reject_create_service=service)
                self.assertEqual(report['state'], 'passed')
                self.assertEqual([args for args in calls if args[0] == 'create'],
                    [['create', 'restore'], ['create', 'recovered'], ['create', 'read-db']])
                created_reader = calls.index(['create', 'read-db'])
                self.assertIn(['stop', '--timeout', str(runner.STOP_SECONDS), 'recovered'], calls[:created_reader])

    def test_completed_controller_retains_repo_init_comparison_after_all_later_operations(self):
        report, _ = self.run_corpus(whole_controller=True)
        self.assertEqual(report['state'], 'passed')
        self.assertEqual(report['operation']['service'], 'ingest')
        self.assertEqual(report['repo_init_wait_comparison'], {
            'compose': {'outcome': 'passed', 'returncode': 0},
            'engine': {'outcome': 'passed', 'returncode': 0, 'container_exit_code': 0},
            'same_owned_id_exited_zero': True})
        self.assertEqual(report['destination_operation']['outcome'], 'passed')
        self.assertEqual(report['recovered_postmaster']['outcome'], 'passed')
        self.assertEqual(report['recovered_postmaster']['step'], 'readers_absent')

    def test_each_destination_failure_is_closed_and_preserves_initial_comparison_before_restore(self):
        cases = [('create', 'create', 'command_failed', 7), ('timeout', 'create', 'timeout', None),
            ('volume', 'volume_inspect', 'invalid_json', None),
            ('volume_command', 'volume_inspect', 'command_failed', 9),
            ('identity', 'container_identity', 'invalid_identity', None),
            ('inspect', 'container_inspect', 'invalid_json', None),
            ('inspect_command', 'container_inspect', 'command_failed', 17),
            ('owner', 'container_inspect', 'inspection_mismatch', None),
            ('offline', 'offline', 'offline_mismatch', None),
            ('ownership', 'ownership_mounts', 'ownership_mounts_mismatch', None),
            ('mounts', 'ownership_mounts', 'ownership_mounts_mismatch', None)]
        for failure, step, category, code in cases:
            with self.subTest(failure=failure):
                report, calls = self.run_corpus(failure, whole_controller=True)
                self.assertEqual(report['stage'], 'restore_destination')
                self.assertEqual(report['reader_gate'], 'closed')
                self.assertEqual(report['state'], 'failed')
                self.assertEqual(report['destination_operation'], {'schema': 1, 'step': step,
                    'outcome': 'failed', 'error': category, 'returncode': code})
                self.assertTrue(report['repo_init_wait_comparison']['same_owned_id_exited_zero'])
                self.assertEqual(report['operation']['service'], 'backup')
                self.assertFalse(any(args[0] in ('up', 'start') and args[-1] in
                    ('restore', 'recovered', 'read-db', 'reader', 'ingest') for args in calls))
                self.assertNotIn('private-sentinel', json.dumps(report))
                self.assertLess(len(json.dumps(report['destination_operation']).encode()), 1024)

    def test_each_recovered_postmaster_failure_keeps_reader_gate_closed_after_successful_restore(self):
        cases = [('create', 'create', 'command_failed', 11),
            ('identity', 'container_identity', 'invalid_identity', None),
            ('inspect', 'container_inspect', 'invalid_json', None),
            ('owner', 'container_inspect', 'inspection_mismatch', None),
            ('stopped', 'stopped', 'stopped_mismatch', None),
            ('mount', 'mount', 'mount_mismatch', None),
            ('offline', 'offline', 'offline_mismatch', None),
            ('start', 'start', 'command_failed', 17),
            ('ready_timeout', 'sql_ready', 'timeout', None),
            ('ready_json', 'sql_ready', 'invalid_json', None),
            ('recovery_ended', 'recovery_ended', 'proof_mismatch', None),
            ('cluster', 'cluster', 'invalid_json', None),
            ('lineage', 'lineage', 'lineage_mismatch', None),
            ('platform', 'platform', 'invalid_json', None),
            ('role', 'role', 'invalid_json', None),
            ('events', 'events', 'invalid_json', None),
            ('readers', 'readers_absent', 'readers_present', None)]
        for failure, step, category, code in cases:
            with self.subTest(failure=failure):
                report, calls = self.run_corpus('postmaster_' + failure, whole_controller=True)
                self.assertEqual(report['state'], 'failed')
                self.assertEqual(report['stage'], 'offline_restore')
                self.assertEqual(report['reader_gate'], 'closed')
                self.assertEqual(report['operation']['service'], 'restore')
                self.assertEqual(report['operation']['outcome'], 'passed')
                self.assertTrue(report['repo_init_wait_comparison']['same_owned_id_exited_zero'])
                self.assertEqual(report['recovered_postmaster'], {'schema': 1, 'step': step,
                    'outcome': 'failed', 'error': category, 'returncode': code})
                self.assertFalse(any(args[0] in ('create', 'up', 'start') and args[-1] in
                    ('read-db', 'reader', 'ingest') for args in calls))
                self.assertNotIn('private-sentinel', json.dumps(report))
                self.assertLess(len(json.dumps(report['recovered_postmaster']).encode()), 1024)

    def test_recovered_postmaster_proof_survives_later_maintenance_failure(self):
        report, calls = self.run_corpus('postmaster_later', whole_controller=True)
        self.assertEqual(report['state'], 'failed')
        self.assertEqual(report['stage'], 'current_replay_and_ttl')
        self.assertEqual(report['reader_gate'], 'closed')
        self.assertEqual(report['recovered_postmaster'], {'schema': 1, 'step': 'readers_absent',
            'outcome': 'passed', 'error': None, 'returncode': 0})
        self.assertFalse(any(args[0] in ('create', 'up', 'start') and args[-1] in
            ('read-db', 'reader', 'ingest') for args in calls))
