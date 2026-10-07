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
        self.assertEqual(verify_bot_identity({'identityMatches': True})['status'], 'passed')

    def test_wrong_token_identity_fails_without_leaking_token(self):
        from verify import verify_bot_identity
        result = verify_bot_identity({'identityMatches': False})
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('private', str(result))

    def test_optional_cohorts_are_not_claimed_as_passed(self):
        from verify import verify_cohort_config
        result = verify_cohort_config({'configured': False})
        self.assertEqual(result['status'], 'not_checked')

    def test_configured_cohort_read_failure_is_a_real_failure(self):
        from verify import verify_cohort_config
        self.assertEqual(verify_cohort_config({'configured': True, 'readPassed': False})['status'], 'failed')

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

class CredentialInventoryTests(unittest.TestCase):
    def test_expired_only_credentials_fail_without_returning_values(self):
        from verify import verify_logto_inventory
        result = verify_logto_inventory({'applications': 1, 'activeSecrets': 0, 'legacySecretPresent': False})
        self.assertEqual(result['status'], 'failed')

class RepairStateTests(unittest.TestCase):
    def test_forward_repair_after_rollback_can_leave_rollback_disabled(self):
        from verify import verify_release
        result = verify_release({'current': {'version': 'v3', 'sourceSha': 'source', 'schemaIdentity': 'schema'},
                                 'previous': {'version': 'v1'}, 'rollback': None},
                                {'version': 'v3', 'source': {'sha': 'source'}, 'schema': {'identity': 'schema'},
                                 'rollback': {'previous': {'version': 'v2', 'compatible': True}}})
        self.assertEqual(result[-1]['status'], 'passed')


class DeployedTelegramProbeTests(unittest.TestCase):
    def probe(self, extra=None, bot_id=12345, cohort_body=None):
        import json
        import pathlib
        import subprocess
        from verify import TELEGRAM_READ
        root = pathlib.Path(__file__).resolve().parents[2]
        env = {'DATABASE_URL': 'postgresql://inside:inside@127.0.0.1:5432/inside',
               'PLATFORM_INTEGRATION_SECRET': 'synthetic_platform_secret_for_tests_only',
               'TELEGRAM_BOT_IDENTITY': 'inside', 'TELEGRAM_BOT_TOKEN': '12345:synthetic-token',
               'TELEGRAM_CANONICAL_CHAT_ID': '-1000000000000', 'TELEGRAM_LINK_RECEIPT_TEXT': 'receipt',
               'TELEGRAM_LINKED_MEMBER_TEXT': 'member', 'TELEGRAM_LINKED_NON_MEMBER_TEXT': 'nonmember',
               'TELEGRAM_LINKED_UNAVAILABLE_TEXT': 'unavailable', 'TELEGRAM_WELCOME_TEXT': 'welcome',
               'TELEGRAM_WEBHOOK_SECRET': 'synthetic_webhook_secret_for_tests_only'}
        env.update(extra or {})
        fixtures = {'getMe': {'id': bot_id, 'is_bot': True}, 'getWebhookInfo': {'url': 'https://telegram.sachkov.dev:88/webhooks/telegram',
                    'ip_address': '127.0.0.1', 'pending_update_count': 0, 'allowed_updates': []},
                    'getChat': {'type': 'supergroup'}, 'getChatMember': {'status': 'administrator', 'can_invite_users': True,
                    'can_restrict_members': True}}
        prelude = 'process.env=' + json.dumps(env) + ';\nconst fixtures=' + json.dumps(fixtures) + ';\n'
        prelude += 'const cohortFixture=' + json.dumps(cohort_body or {'items': []}) + ';\n'
        # Mock only the fetch boundary; the deployed probe and owning adapter run unchanged.
        prelude += "globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('api.telegram.org') ? {ok:true,result:fixtures[String(url).split('/').at(-1)]} : cohortFixture),{headers:{'content-type':'application/json'}});\n"
        source = TELEGRAM_READ.replace('/app/dist/config/application-config.js', (root / 'apps/telegram/src/config/application-config.ts').as_uri())
        source = source.replace('/app/dist/adapters/platform/http-platform-cohort.adapter.js', (root / 'apps/telegram/src/adapters/platform/http-platform-cohort.adapter.ts').as_uri())
        return subprocess.run(['node', str(root / 'apps/telegram/node_modules/tsx/dist/cli.mjs'), '--input-type=module', '-'],
                              input=prelude + source, text=True, capture_output=True, timeout=30)

    def test_actual_config_and_probe_accept_logical_identity_with_empty_cohorts(self):
        import json
        from verify import verify_bot_identity, verify_cohort_config
        result = self.probe({'PLATFORM_COHORTS_URL': '', 'PLATFORM_COHORT_PRODUCT_ID': ''})
        self.assertEqual(result.returncode, 0, result.stderr)
        facts = json.loads(result.stdout)
        self.assertEqual(verify_bot_identity(facts)['status'], 'passed')
        self.assertEqual(verify_cohort_config(facts['cohorts'])['status'], 'not_checked')
        self.assertNotIn('synthetic-token', result.stdout)

    def test_probe_rejects_numeric_id_that_does_not_match_token(self):
        import json
        from verify import verify_bot_identity
        result = self.probe(bot_id=999)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(verify_bot_identity(json.loads(result.stdout))['status'], 'failed')

    def test_owning_config_rejects_invalid_cohort_url_uuid_and_partial_pair(self):
        for extra in [{'PLATFORM_COHORTS_URL': 'https://example.invalid/billing/cohorts'},
                      {'PLATFORM_COHORTS_URL': 'https://user:secret@example.invalid/cohorts',
                       'PLATFORM_COHORT_PRODUCT_ID': '00000000-0000-4000-8000-000000000001'},
                      {'PLATFORM_COHORTS_URL': 'https://example.invalid/cohorts', 'PLATFORM_COHORT_PRODUCT_ID': 'invalid'}]:
            with self.subTest(extra=extra):
                self.assertNotEqual(self.probe(extra).returncode, 0)

    def test_legacy_cohort_variable_uses_the_owning_config_and_new_header(self):
        import json
        from verify import verify_cohort_config
        result = self.probe({'PLATFORM_COHORTS_URL': 'https://example.invalid/billing/cohorts',
                             'PLATFORM_COHORT_GUIDE_ID': '00000000-0000-4000-8000-000000000001'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(verify_cohort_config(json.loads(result.stdout)['cohorts'])['status'], 'passed')

    def test_selected_cohort_date_must_be_accepted_by_the_owning_adapter(self):
        import json
        from verify import verify_cohort_config
        product_id = '00000000-0000-4000-8000-000000000001'
        for date, expected in [('invalid', 'failed'), ('2026-02-30', 'failed'),
                               ('2026-10-08', 'passed'), (None, 'passed')]:
            with self.subTest(date=date):
                result = self.probe({'PLATFORM_COHORTS_URL': 'https://example.invalid/cohorts',
                                     'PLATFORM_COHORT_PRODUCT_ID': product_id},
                                    cohort_body={'items': [{'productId': product_id, 'startsOn': date}]})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(verify_cohort_config(json.loads(result.stdout)['cohorts'])['status'], expected)

    def test_selected_cohort_without_date_field_is_a_contract_failure(self):
        import json
        from verify import verify_cohort_config
        product_id = '00000000-0000-4000-8000-000000000001'
        result = self.probe({'PLATFORM_COHORTS_URL': 'https://example.invalid/cohorts',
                             'PLATFORM_COHORT_PRODUCT_ID': product_id},
                            cohort_body={'items': [{'productId': product_id}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(verify_cohort_config(json.loads(result.stdout)['cohorts'])['status'], 'failed')
