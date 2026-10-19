"""Public isolated recovery preparation and reader gate contracts; no Docker calls."""
import json
from pathlib import Path
import tempfile
import unittest

import recovery

IMAGE = 'sha256:' + 'a' * 64


class RecoveryPreparation(unittest.TestCase):
    def test_recovery_destination_is_new_private_and_readers_are_explicitly_gated(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'inputs'
            recovery.prepare_inputs(output, foundation_image=IMAGE)
            plan = json.loads((output / 'compose.json').read_text())
            services = plan['services']
            self.assertTrue(plan['volumes']['recovery']['name'].startswith(
                'inside-production-postgres-data-recovery-'))
            for name in ('restore', 'recovered'):
                self.assertEqual(services[name]['network_mode'], 'none')
            for name in ('read-db', 'reader', 'ingest'):
                self.assertEqual(services[name]['profiles'], ['readers-after-replay'])
            self.assertFalse(any('ports' in service for service in services.values()))
            self.assertNotIn('build', json.dumps(plan))
            for service in services.values():
                self.assertEqual(service['pull_policy'], 'never')
            self.assertEqual(services['db']['image'], IMAGE)
            self.assertIn('recovery:/var/lib/postgresql', services['restore']['volumes'])
            self.assertIn('repository:/backup:ro', services['restore']['volumes'])
            self.assertIn('database:/var/lib/postgresql', services['db']['volumes'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((output / 'compose.json').stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                recovery.prepare_inputs(output, foundation_image=IMAGE)


class DestructiveDestination(unittest.TestCase):
    def test_existing_volume_or_foreign_mount_can_never_authorize_restore(self):
        project = recovery.PROJECT_PREFIX + 'a' * 12
        name = recovery.RECOVERY_PREFIX + 'b' * 32
        volume = {'Name': name, 'Driver': 'local', 'Scope': 'local', 'Options': None,
                  'Labels': {'com.docker.compose.project': project, 'com.docker.compose.volume': 'recovery'}}
        container = {'image': IMAGE, 'state': {'status': 'created', 'running': False, 'pid': 0}, 'labels': {'com.docker.compose.project': project, 'com.docker.compose.service': 'restore'},
                     'mounts': [{'Type': 'volume', 'Name': name, 'Destination': '/var/lib/postgresql', 'RW': True},
                                {'Type': 'volume', 'Name': project + '_repository', 'Destination': '/backup', 'RW': False}]}
        import copy
        invalid = []
        for field, value in [('Name', 'production-data'), ('Driver', 'nfs'), ('Options', {'device': '/foreign'})]:
            changed = copy.deepcopy(volume)
            changed[field] = value
            invalid.append((changed, container, True))
        changed = copy.deepcopy(container)
        changed['mounts'][0]['Name'] = project + '_database'
        invalid.append((volume, changed, True))
        changed = copy.deepcopy(container)
        changed['mounts'][1]['RW'] = True
        invalid.append((volume, changed, True))
        changed = copy.deepcopy(container)
        changed['labels']['com.docker.compose.project'] = 'foreign'
        invalid.append((volume, changed, True))
        changed = copy.deepcopy(container)
        changed['state']['running'] = True
        invalid.append((volume, changed, True))
        invalid.append((volume, container, False))
        for candidate, process, fresh in invalid:
            with self.subTest(candidate=candidate, process=process, fresh=fresh), self.assertRaises(ValueError):
                recovery.confirm_destination(project, name, IMAGE, candidate, process, absent_before_acquisition=fresh)
        self.assertEqual(recovery.confirm_destination(project, name, IMAGE, volume, container,
            absent_before_acquisition=True), {'fresh_owned_volume': True, 'actual_restore_mount_confirmed': True,
                                             'repository_read_only': True})


class ClosedReaderGate(unittest.TestCase):
    def test_partial_or_failed_maintenance_cannot_start_reader_or_ingestion(self):
        from unittest.mock import Mock
        manifest = {'schema': 1, 'scope': 'synthetic_only', 'event_ids': ['00000000-0000-4000-8000-000000000001']}
        for response in ('private-secret-error', json.dumps({'replayed': 0})):
            execute = Mock(return_value=response)
            opened = Mock()
            records = []
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                recovery.restore_gate(execute, manifest, opened, records.append)
            opened.assert_not_called()
            self.assertEqual(records[-1]['reader_gate'], 'closed')
            self.assertEqual(records[-1]['state'], 'failed')
            self.assertNotIn('secret', json.dumps(records))

    def test_unbounded_or_foreign_deletion_manifest_is_rejected_before_sql(self):
        from unittest.mock import Mock
        for value in ({'schema': 1, 'scope': 'production', 'event_ids': []},
                      {'schema': 1, 'scope': 'synthetic_only', 'event_ids': ['x']},
                      {'schema': True, 'scope': 'synthetic_only', 'event_ids': []}):
            execute, opened = Mock(), Mock()
            with self.subTest(value=value), self.assertRaises(ValueError):
                recovery.restore_gate(execute, value, opened, lambda result: None)
            execute.assert_not_called()
            opened.assert_not_called()

    def test_partial_drain_and_lost_commit_response_keep_gate_closed(self):
        from unittest.mock import Mock
        import test_retention
        manifest = {'schema': 1, 'scope': 'synthetic_only', 'event_ids': ['00000000-0000-4000-8000-000000000001']}
        execute = Mock(side_effect=[json.dumps({'remaining': 0})] + [test_retention.batch(500, remaining=1)] * 20)
        opened = Mock()
        records = []
        with self.assertRaises(RuntimeError):
            recovery.restore_gate(execute, manifest, opened, records.append)
        opened.assert_not_called()
        self.assertEqual(records[-1]['retention']['state'], 'partial')
        self.assertEqual(records[-1]['reader_gate'], 'closed')

    def test_success_uses_current_db_cutoff_and_only_then_transitions_both_actors(self):
        from unittest.mock import Mock
        import test_retention
        manifest = {'schema': 1, 'scope': 'synthetic_only', 'event_ids': ['00000000-0000-4000-8000-000000000001']}
        responses = iter([json.dumps({'remaining': 0}), test_retention.batch(1), test_retention.batch(0), json.dumps({'remaining': 0})])
        observed = []
        def execute(sql, *, timeout):
            observed.append(sql)
            return next(responses)
        opened = Mock()
        result = recovery.restore_gate(execute, manifest, opened, lambda value: None)
        opened.assert_called_once_with()
        self.assertEqual(result['reader_gate'], 'opened_after_replay_and_current_ttl')
        self.assertIn("NULLIF('', '')", observed[1])
        self.assertEqual(result['production_deletion_authority'], 'unknown')
