"""The HTTP observation must prove the expected value in its captured response."""
import json
import io
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest

import check


class QueryReadiness(unittest.TestCase):
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
