"""The HTTP observation must prove the expected value in its captured response."""
import json
import io
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest

import check
import production


class QueryReadiness(unittest.TestCase):
    def test_only_assigned_pull_request_and_exact_marker_select_technical_ci(self):
        marker = '<!-- observability-scope: technical -->'
        for number, body, expected in ((1716, marker, 'technical'), (1717, marker, 'full'),
                                       (1716, marker.upper(), 'full'), (1716, '', 'full'),
                                       ('1716', marker, 'full'), (True, marker, 'full'),
                                       (1716, None, 'full')):
            with self.subTest(number=number, body=body):
                self.assertEqual(production.select_ci_scope({'number': number, 'pull_request': {'body': body}}), expected)
        self.assertEqual(production.select_ci_scope({}), 'full')

    def test_collection_refuses_relabelled_preparation_and_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            output, metadata, public = base / 'technical', base / 'metadata', base / 'public'
            check.prepare(output, scope='technical')
            metadata.mkdir()
            (metadata / 'source.json').write_text(json.dumps({'production_scope': 'technical'}))
            (output / 'evidence.json').write_text(json.dumps({'production_scope': 'full'}))
            with self.assertRaisesRegex(ValueError, 'scope_mismatch'):
                check.collect(output, metadata, public, scope='technical')
            self.assertFalse(public.exists())
            (output / 'evidence.json').write_text(json.dumps({'production_scope': 'technical'}))
            with self.assertRaisesRegex(ValueError, 'scope_mismatch'):
                check.collect(output, metadata, public, scope='full')
            check.collect(output, metadata, public, scope='technical')
            self.assertEqual(json.loads((public / 'source.json').read_text())['production_scope'], 'technical')
            self.assertNotIn('reader.key', {path.name for path in public.iterdir()})

    def test_prepared_scope_is_explicit_source_bound_and_refuses_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve() / 'technical'
            check.prepare(output, scope='technical')
            self.assertEqual(production.prepared_scope(output), 'technical')
            self.assertEqual(production.prepared_scope(output, scope='technical'), 'technical')
            with self.assertRaisesRegex(ValueError, 'scope_mismatch'):
                production.prepared_scope(output, scope='full')
            record = json.loads((output / 'inputs.json').read_text())
            record['inputs']['scripts/observability-production/production.py'] = '0' * 64
            (output / 'inputs.json').write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, 'source_changed'):
                production.prepared_scope(output)

    def test_collection_preserves_early_supervisor_failure_with_bound_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            output, metadata, public = base / 'technical', base / 'metadata', base / 'public'
            check.prepare(output, scope='technical')
            metadata.mkdir()
            (metadata / 'source.json').write_text(json.dumps({'production_scope': 'technical'}))
            (output / 'evidence.json').write_text(json.dumps({'status': 'failed',
                'scope': 'two repeated synthetic technical production topology measurements; production_scope=technical'}))
            check.collect(output, metadata, public, scope='technical')
            self.assertEqual(json.loads((public / 'evidence.json').read_text())['status'], 'failed')

    def test_prepared_scope_cannot_relabel_generated_analytics_or_technical_dashboard(self):
        for scope in ('full', 'technical'):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve() / 'configuration'
                check.prepare(output, scope=scope)
                record = json.loads((output / 'inputs.json').read_text())
                record['scope'] = 'technical' if scope == 'full' else 'full'
                (output / 'inputs.json').write_text(json.dumps(record))
                with self.assertRaisesRegex(ValueError, 'scope_artifacts_mismatch'):
                    production.prepared_scope(output)

    def test_requires_successful_expected_query_body_in_the_same_capture(self):
        scalar = {'status': 'success', 'data': {'resultType': 'scalar', 'result': [1_000, '1']}}
        vector = {'status': 'success', 'data': {'resultType': 'vector', 'result': [{'metric': {}, 'value': [1_000, '1']}]}}
        self.assertTrue(check.query_one((200, json.dumps(scalar))))
        self.assertTrue(check.query_one((200, json.dumps(vector))))
        for response in ((503, json.dumps(scalar)), (200, 'not-json'),
                         (200, '{"status":"error"}'),
                         (200, '{"status":"success","data":{"resultType":"scalar","result":[1000,"2"]}}'),
                         (200, '{"status":"success","data":{"resultType":"vector","result":[]}}')):
            with self.subTest(response=response):
                self.assertFalse(check.query_one(response))

    def test_startup_output_projects_only_closed_cause_and_never_private_text(self):
        for raw, cause in ((b'failed to get cgroup private-sentinel', 'cgroup_mount_missing'),
                           (b'building component private-sentinel Permission denied', 'permission_denied'),
                           (b'private-sentinel unknown reason', 'unknown')):
            self.assertEqual(check.startup_cause(raw), cause)
        with self.assertRaises(ValueError): check.startup_cause(b'x' * 4097)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path/'production-measurements.json').write_text(json.dumps({'host_startup_diagnostic': {'cause':'permission_denied', 'exit_code':1},'private':'private-sentinel'}))
            captured=io.StringIO()
            with redirect_stdout(captured): check.feedback(path)
            self.assertNotIn('private-sentinel',captured.getvalue())
            self.assertIn('permission_denied',captured.getvalue())

    def test_job_feedback_does_not_publish_provider_or_exception_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'readiness.json').write_text(json.dumps([{'probe': 'measured_platform-host',
                'outcome': 'timed_out', 'last_http_status': None, 'body': 'private-sentinel'}]))
            (path / 'container-states.json').write_text(json.dumps([{'service': 'host-agent',
                'state': 'restarting', 'exit_code': 0, 'Error': 'private-sentinel',
                'native_failure_state': 'observed', 'actual_exit_code': 137, 'oom_killed': True,
                'restart_count': 4, 'runtime_error_present': False, 'has_process': False}]))
            captured = io.StringIO()
            with redirect_stdout(captured): check.feedback(path)
            self.assertNotIn('private-sentinel', captured.getvalue())
            self.assertIn('host-agent', captured.getvalue())
            self.assertIn('\"actual_exit_code\": 137', captured.getvalue())
            (path / 'readiness.json').write_text(json.dumps([{'probe': 'private-sentinel'}]))
            with self.assertRaises(ValueError), redirect_stdout(io.StringIO()): check.feedback(path)


if __name__ == '__main__':
    unittest.main()
