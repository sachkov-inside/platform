"""Callback continuity through the owning corpus; SQL/Docker are bounded external fakes."""
import json
from pathlib import Path
import tempfile
import unittest

import recovery
import recovery_runtime as runner
import retention_fixture
from test_retention import batch


class CorpusCallbackContinuity(unittest.TestCase):
    def test_pg_diag_01_diagnostic_callback_survives_stanza_check_backup_restore_and_sql_actors(self):
        project = recovery.PROJECT_PREFIX + 'a' * 12
        image = 'sha256:' + 'b' * 64
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'owned'
            recovery.prepare_inputs(output, foundation_image=image)
            plan = json.loads((output / 'compose.json').read_text())
            destination = plan['volumes']['recovery']['name']
            states = {'db': 'running'}
            identifiers = {name: format(index, '064x') for index, name in enumerate(recovery.SERVICES, 1)}
            services = {identity: name for name, identity in identifiers.items()}
            operations = []
            backup_commands = []
            calls = []
            batches = iter([batch(1), batch(0)])
            def execute(base, args, *, payload=None, timeout=60):
                calls.append(args)
                self.assertLess(len(calls), 100, 'bounded fake command budget exhausted')
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
                            'archive_mode': 'off', 'archive_command': 'pgbackrest --stanza=production archive-push %p'})
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
                        or service in ('backup', 'restore', 'reader', 'ingest') else 'running')
                    return ''
                if args[0] == 'wait':
                    self.assertEqual(states[services[args[-1]]], 'exited')
                    return '0\n'
                if args[:3] == ['ps', '--all', '-q']:
                    return '\n'.join(identifiers[name] for name in args[3:] if name in states)
                if args[0] == 'inspect':
                    service = services[args[1]]
                    state = states[service]
                    return json.dumps({'id': args[1], 'image': image, 'labels': {'com.docker.compose.project': project,
                        'com.docker.compose.service': service}, 'ports': None,
                        'network': project + '_private' if service == 'read-db' else 'none',
                        'mounts': [{'Type': 'volume', 'Name': destination, 'Destination': '/var/lib/postgresql', 'RW': True},
                                   {'Type': 'volume', 'Name': project + '_repository', 'Destination': '/backup', 'RW': False}],
                        'state': {'status': state, 'running': state == 'running',
                            'pid': 42 if state == 'running' else 0, 'exit_code': 0}})
                if args[:2] == ['volume', 'inspect']:
                    return json.dumps({'Name': destination, 'Driver': 'local', 'Scope': 'local', 'Options': None,
                        'Labels': {'com.docker.compose.project': project, 'com.docker.compose.volume': 'recovery'}})
                if args[0] == 'logs':
                    return json.dumps({'reader_rows': 2, 'blocked_rows': 0} if args[-1] == 'reader' else {'ingest_rows': 1})
                self.fail('unsupported external command in callback contract')
            report = {'reader_gate': 'closed'}
            result = runner._database_corpus(output, ['docker', 'compose'], project, plan,
                {'system_identifier': '1234567890123456789'}, report, lambda: None, execute,
                lambda value: operations.append(json.loads(json.dumps(value))))
            self.assertEqual(backup_commands, ['stanza-create', 'check'])
            self.assertEqual([value['service'] for value in operations if value['outcome'] == 'passed'],
                             ['backup', 'restore', 'reader', 'ingest'])
            self.assertEqual(result['state'], 'passed')
            self.assertEqual(result['reader_gate'], 'opened_after_replay_and_current_ttl')
