import unittest
from verify import verify_release

class ReleaseTests(unittest.TestCase):
    def test_incompatible_previous_release_is_a_valid_disabled_rollback(self):
        result = verify_release({
            'current': {'version': 'v22', 'sourceSha': 'source', 'schemaIdentity': 'schema'},
            'rollback': {'targetVersion': 'v21', 'compatible': False},
        }, {
            'version': 'v22', 'source': {'sha': 'source'}, 'schema': {'identity': 'schema'},
            'rollback': {'previous': {'version': 'v21', 'compatible': False}},
        })
        self.assertEqual(result[-1]['status'], 'passed')


class CatalogTests(unittest.TestCase):
    def test_empty_catalog_is_valid_without_historical_format_table(self):
        from verify import verify_catalog
        result = verify_catalog({'newSchemas': 2, 'oldSchemas': 0, 'oldPhysicalNames': [],
                                 'membershipAccessRows': 0, 'oldCapabilitiesRows': 0,
                                 'oldPaidSourceRefs': 0, 'materialFormats': {'guide': 22}})
        self.assertTrue(all(item['status'] == 'passed' for item in result))

class TelegramTests(unittest.TestCase):
    def test_logical_identity_is_not_a_numeric_telegram_id(self):
        from verify import verify_bot_identity
        self.assertEqual(verify_bot_identity('inside', '12345:private', {'id': 12345, 'is_bot': True})['status'], 'passed')

    def test_wrong_token_identity_fails_without_leaking_token(self):
        from verify import verify_bot_identity
        result = verify_bot_identity('inside', '12345:private', {'id': 999, 'is_bot': True})
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('private', str(result))

    def test_optional_cohorts_are_not_claimed_as_passed(self):
        from verify import verify_cohort_config
        result = verify_cohort_config({})
        self.assertEqual(result['status'], 'not_checked')

    def test_partial_cohort_config_is_a_real_failure(self):
        from verify import verify_cohort_config
        self.assertEqual(verify_cohort_config({'PLATFORM_COHORTS_URL': 'https://example.invalid/billing/cohorts'})['status'], 'failed')

class FailureTests(unittest.TestCase):
    def test_rollback_disagreement_is_not_hidden(self):
        from verify import verify_release
        checks = verify_release({'current': {'version': 'v22', 'sourceSha': 'source', 'schemaIdentity': 'schema'},
                                 'rollback': {'targetVersion': 'v21', 'compatible': True}},
                                {'version': 'v22', 'source': {'sha': 'source'}, 'schema': {'identity': 'schema'},
                                 'rollback': {'previous': {'version': 'v21', 'compatible': False}}})
        self.assertEqual(checks[-1]['status'], 'failed')

    def test_missing_previous_release_accepts_null_rollback(self):
        from verify import verify_release
        checks = verify_release({'current': {'version': 'v1', 'sourceSha': 'source', 'schemaIdentity': 'schema'}, 'rollback': None},
                                {'version': 'v1', 'source': {'sha': 'source'}, 'schema': {'identity': 'schema'},
                                 'rollback': {'previous': None}})
        self.assertEqual(checks[-1]['status'], 'passed')

    def test_wrong_source_is_a_real_failure(self):
        from verify import verify_release
        checks = verify_release({'current': {'version': 'v9', 'sourceSha': 'wrong', 'image': 'image', 'migrationsIdentity': 'migrations'}},
                                {'version': 'v9', 'source': {'sha': 'source'}, 'image': 'image', 'migrations': {'identity': 'migrations'}})
        self.assertEqual(checks[0]['status'], 'failed')

    def test_stale_schema_in_live_readiness_fails(self):
        from verify import verify_readiness
        checks = verify_readiness({'process': 'api', 'status': 'ready', 'release': {'release': 'v22', 'sourceSha': 'source'},
                                   'schema': {'identity': 'old'}},
                                  {'version': 'v22', 'source': {'sha': 'source'}, 'schema': {'identity': 'current'}}, 'api')
        self.assertEqual(checks['status'], 'failed')

    def test_running_process_with_unhealthy_image_is_not_ready(self):
        from verify import verify_container
        result = verify_container({'State': {'Running': True, 'Health': {'Status': 'unhealthy'}, 'OOMKilled': False},
                                   'RestartCount': 0, 'Config': {'Image': 'digest'}, 'revision': 'source'}, 'digest', 'source')
        self.assertEqual(result[0]['status'], 'failed')

    def test_domain_table_column_with_legacy_name_fails(self):
        from verify import verify_catalog
        result = verify_catalog({'newSchemas': 2, 'oldSchemas': 0,
                                 'oldPhysicalNames': [{'schema': 'materials', 'kind': 'column', 'name': 'guide_id'}],
                                 'membershipAccessRows': 0, 'oldCapabilitiesRows': 0, 'oldPaidSourceRefs': 0, 'materialFormats': {}})
        self.assertEqual(result[1]['status'], 'failed')

    def test_first_failed_assertion_stops_before_another_read(self):
        from verify import Checks, VerificationFailed
        checks = Checks()
        with self.assertRaises(VerificationFailed):
            checks.extend([{'name': 'first', 'status': 'failed'}, {'name': 'second', 'status': 'passed'}])
        self.assertEqual(len(checks), 1)

    def test_command_errors_do_not_leak_private_stderr(self):
        import sys
        from verify import run
        with self.assertRaisesRegex(RuntimeError, '^read command failed$'):
            run([sys.executable, '-c', 'import sys; print("private-token", file=sys.stderr);sys.exit(1)'])

    def test_failed_read_is_nonpassing_and_retains_successful_checks(self):
        from unittest.mock import patch
        from verify import verify_host
        with patch('verify.pathlib.Path.read_bytes', side_effect=OSError('private path')):
            result = verify_host('platform', 'v22')
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks'][0]['status'], 'not_checked')
        self.assertNotIn('private path', str(result))

class HttpBoundaryTests(unittest.TestCase):
    def test_empty_404_body_preserves_status_from_the_same_response(self):
        from unittest.mock import patch
        from subprocess import CompletedProcess
        from verify import http
        with patch('verify.subprocess.run', return_value=CompletedProcess(['curl'], 0, '\n404', '')):
            self.assertEqual(http('https://telegram.example.invalid/ready'), (404, ''))
