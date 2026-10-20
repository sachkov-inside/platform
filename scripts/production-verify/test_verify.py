import unittest
from verify import verify_release

class SqlSetupDiagnosticsTests(unittest.TestCase):
    def test_setup_failure_reports_captured_docker_stderr(self):
        import subprocess
        import contextlib
        import io
        from unittest.mock import patch
        from test_sql import SqlContractTests

        failure = subprocess.CalledProcessError(125, ['docker', 'run'], stderr='registry refused the requested manifest')
        removed = subprocess.CompletedProcess(['docker', 'rm'], 0)
        diagnostic = io.StringIO()
        with contextlib.redirect_stderr(diagnostic), patch('test_sql.subprocess.run', side_effect=[failure, removed]):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                SqlContractTests.setUpClass()
        self.assertIs(caught.exception, failure)
        self.assertIn('registry refused the requested manifest', diagnostic.getvalue())

    def test_cleanup_failure_preserves_the_setup_failure(self):
        import subprocess
        import contextlib
        import io
        from unittest.mock import patch
        from test_sql import SqlContractTests

        failure = subprocess.CalledProcessError(125, ['docker', 'run'], stderr='manifest download failed')
        cleanup = subprocess.CalledProcessError(1, ['docker', 'rm'], stderr='No such container')
        diagnostic = io.StringIO()
        with contextlib.redirect_stderr(diagnostic), patch('test_sql.subprocess.run', side_effect=[failure, cleanup]):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                SqlContractTests.setUpClass()
        self.assertIs(caught.exception, failure)
        self.assertIn('manifest download failed', diagnostic.getvalue())
        self.assertIn('SQL setup cleanup failed:', diagnostic.getvalue())

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
    def test_bank_rejection_probe_carries_its_marker_over_loopback_https(self):
        from unittest.mock import patch
        from subprocess import CompletedProcess
        from verify import http
        with patch('verify.subprocess.run', return_value=CompletedProcess(['curl'], 0, 'invalid_notification\n400', '')) as execute:
            self.assertEqual(http('https://inside.sachkov.dev/billing/tbank/notification', 'POST',
                                  'inside.sachkov.dev', bank_rejection_probe=True), (400, 'invalid_notification'))
        args = execute.call_args.args[0]
        self.assertIn('x-inside-production-verify: bank-webhook-rejection', args)
        self.assertIn('inside.sachkov.dev:443:127.0.0.1', args)
        self.assertNotIn('--data', args)

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
                                    cohort_body={'items': [{'productId': product_id, 'startsOn': date,
                                                           'name': 'Synthetic cohort', 'stage': 'between',
                                                           'nextEvent': 'Synthetic event', 'revision': 1}]})
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

class PublicRouteTests(unittest.TestCase):
    def test_cutover_checks_new_web_and_old_provider_urls(self):
        from unittest.mock import patch
        from verify import verify_public_routes
        def response(url, method='GET', origin=None, *, redirect=False, bank_rejection_probe=False):
            if '/communications/visit?' in url:
                if origin == 'sachkov.dev':
                    return 404, 'Ссылка не найдена.'
                return 302, url.replace('https://inside.sachkov.dev', 'https://sachkov.dev')
            if '/billing/cohorts' in url:
                return 200, '{"items":[]}'
            if '/billing/tbank/notification' in url:
                return 400, 'invalid_notification'
            return 401, 'unauthorized'
        checks = []
        with patch('verify.http', side_effect=response) as read:
            verify_public_routes(checks)
        self.assertTrue(all(item['status'] == 'passed' for item in checks))
        read.assert_any_call('https://sachkov.dev/communications/visit?token=' + 'A' * 43, 'GET', 'sachkov.dev')
        read.assert_any_call('https://inside.sachkov.dev/billing/tbank/notification', 'POST', 'inside.sachkov.dev', bank_rejection_probe=True)
        read.assert_any_call('https://inside.sachkov.dev/communications/visit?token=' + 'A' * 43, origin='inside.sachkov.dev', redirect=True)

    def test_old_web_redirect_to_wrong_host_fails(self):
        from unittest.mock import patch
        from verify import verify_public_routes
        checks = []
        with patch('verify.http', return_value=(302, 'https://landing.invalid/')):
            verify_public_routes(checks)
        self.assertEqual(checks[-1]['status'], 'failed')


class TelegramObservationTests(unittest.TestCase):
    def snapshot(self):
        from verify import TELEGRAM_ERROR_COUNTERS, TELEGRAM_HEALTH_GAUGES
        return {'containerId': 'app', 'startedAt': '2026-10-15T07:50:32Z',
                'restartCount': 0, 'ready': True,
                'metrics': dict.fromkeys(TELEGRAM_ERROR_COUNTERS + TELEGRAM_HEALTH_GAUGES, 0)}

    def test_recovered_interval_does_not_clear_historical_counter_failure(self):
        from verify import telegram_observation_checks, telegram_error_check
        before = self.snapshot()
        before['metrics']['inside_telegram_reconciliation_failure_total'] = 4
        before['metrics']['inside_telegram_reconciliation_degraded_total'] = 4
        after = self.snapshot()
        after['metrics'].update(before['metrics'])
        self.assertTrue(all(item['status'] == 'passed' for item in telegram_observation_checks(before, after, '')))
        self.assertEqual(telegram_error_check(200, after['metrics'])['status'], 'failed')

    def test_settled_confirmation_rejection_is_not_an_unresolved_queue(self):
        from verify import telegram_observation_checks
        before, after = self.snapshot(), self.snapshot()
        before['metrics']['inside_telegram_waitlist_confirmation_rejected'] = 3
        after['metrics']['inside_telegram_waitlist_confirmation_rejected'] = 3
        self.assertTrue(all(item['status'] == 'passed' for item in telegram_observation_checks(before, after, '')))

    def test_increment_reset_missing_nonfinite_and_negative_counters_fail(self):
        from verify import telegram_observation_checks
        for value in [5, 3, None, float('nan'), float('inf'), -1]:
            with self.subTest(value=str(value)):
                before, after = self.snapshot(), self.snapshot()
                name = 'inside_telegram_reconciliation_failure_total'
                before['metrics'][name] = 4
                if value is None:
                    del after['metrics'][name]
                else:
                    after['metrics'][name] = value
                self.assertTrue(any(item['status'] == 'failed' for item in telegram_observation_checks(before, after, '')))

    def test_restart_replacement_readiness_backlog_unknown_and_logs_fail(self):
        from verify import telegram_observation_checks
        for field, value in [('containerId', 'replacement'), ('startedAt', 'later'),
                             ('restartCount', 1), ('ready', False)]:
            with self.subTest(field=field):
                before, after = self.snapshot(), self.snapshot()
                after[field] = value
                self.assertTrue(any(item['status'] == 'failed' for item in telegram_observation_checks(before, after, '')))
        for name in ['inside_telegram_reconciliation_due', 'inside_telegram_community_effects_unknown',
                     'inside_telegram_waitlist_confirmation_pending', 'inside_telegram_waitlist_confirmation_unknown']:
            before, after = self.snapshot(), self.snapshot()
            before['metrics'][name] = 1
            self.assertTrue(any(item['status'] == 'failed' for item in telegram_observation_checks(before, after, '')))
        self.assertTrue(any(item['status'] == 'failed' for item in telegram_observation_checks(
            self.snapshot(), self.snapshot(), '{"level":"error","private":"secret"}')))

    def test_observation_read_failure_is_private_and_nonpassing(self):
        from unittest.mock import patch
        from verify import observe_telegram
        with patch('verify.telegram_snapshot', side_effect=RuntimeError('private-token')):
            result = observe_telegram(1)
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks'][0]['status'], 'not_checked')
        self.assertNotIn('private-token', str(result))

    def test_interval_uses_pinned_container_and_bounded_logs(self):
        from unittest.mock import patch
        from verify import observe_telegram
        with patch('verify.telegram_snapshot', side_effect=[self.snapshot(), self.snapshot()]), \
             patch('verify.time.sleep') as sleep, patch('verify.read_logs', return_value='') as execute:
            result = observe_telegram(1)
        self.assertTrue(result['passed'])
        sleep.assert_called_once_with(1)
        self.assertEqual(execute.call_args.args[0], {'Id': 'app'})
        self.assertEqual(execute.call_args.kwargs, {'since': result['startedAt'], 'until': result['finishedAt']})


class TelegramObservationVerdictTests(unittest.TestCase):
    def test_passing_interval_cannot_override_failed_release_check(self):
        import json
        import hashlib
        from unittest.mock import patch
        from verify import verify_host, check
        raw = json.dumps({'version': 'v19', 'source': {'sha': 'source'}}).encode()
        state = {'current': {'manifestSha256': 'sha256:' + hashlib.sha256(raw).hexdigest()}}
        def fail(manifest, state, record):
            record.append(check('Telegram error counters', False, 'historical errors'))
        with patch('verify.pathlib.Path.read_bytes', return_value=raw), \
             patch('verify.pathlib.Path.read_text', return_value=json.dumps(state)), \
             patch('verify.validate_context'), patch('verify.verify_telegram', side_effect=fail), \
             patch('verify.observe_telegram', return_value={'passed': True, 'checks': []}):
            result = verify_host('telegram', 'v19', telegram_observe_seconds=1)
        self.assertFalse(result['passed'])
        self.assertTrue(result['telegramObservation']['passed'])
        self.assertEqual(result['checks'][-1]['status'], 'failed')

    def test_failed_interval_cannot_produce_green_release_verdict(self):
        import json
        import hashlib
        from unittest.mock import patch
        from verify import verify_host
        raw = json.dumps({'version': 'v19', 'source': {'sha': 'source'}}).encode()
        state = {'current': {'manifestSha256': 'sha256:' + hashlib.sha256(raw).hexdigest()}}
        with patch('verify.pathlib.Path.read_bytes', return_value=raw), \
             patch('verify.pathlib.Path.read_text', return_value=json.dumps(state)), \
             patch('verify.validate_context'), patch('verify.verify_telegram'), \
             patch('verify.observe_telegram', return_value={'passed': False, 'checks': []}):
            result = verify_host('telegram', 'v19', telegram_observe_seconds=1)
        self.assertFalse(result['passed'])

    def test_cli_rejects_invalid_interval_before_server_access(self):
        import contextlib
        import io
        from unittest.mock import patch
        from verify import main
        for application, seconds in [('platform', '1'), ('telegram', '0'), ('telegram', '61')]:
            with self.subTest(application=application, seconds=seconds), \
                 patch('sys.argv', ['verify.py', '--host', 'example', '--application', application,
                                    '--version', 'v19', '--telegram-observe-seconds', seconds]), \
                 contextlib.redirect_stderr(io.StringIO()), patch('verify.run') as execute:
                with self.assertRaises(SystemExit) as caught:
                    main()
                self.assertEqual(caught.exception.code, 2)
                execute.assert_not_called()


class TelegramSnapshotBoundaryTests(unittest.TestCase):
    def app(self):
        return {'Id': 'app', 'RestartCount': 0, 'State': {'StartedAt': 'start', 'Running': True,
                                                       'Health': {'Status': 'healthy'}}}

    def test_restarts_during_http_reads_invalidate_the_snapshot(self):
        from unittest.mock import patch
        from verify import telegram_snapshot, TELEGRAM_ERROR_COUNTERS, TELEGRAM_HEALTH_GAUGES
        replacement = self.app()
        replacement['State']['StartedAt'] = 'new-start'
        with patch('verify.collect_containers', side_effect=[{'app': self.app()}, {'app': replacement}]), \
             patch('verify.telegram_metrics', return_value=(200, dict.fromkeys(TELEGRAM_ERROR_COUNTERS + TELEGRAM_HEALTH_GAUGES, 0))), \
             patch('verify.http', return_value=(200, '{"status":"ready"}')):
            with self.assertRaisesRegex(RuntimeError, 'process changed'):
                telegram_snapshot()

    def test_missing_and_nonfinite_metrics_invalidate_the_snapshot(self):
        from unittest.mock import patch
        from verify import telegram_snapshot, TELEGRAM_ERROR_COUNTERS, TELEGRAM_HEALTH_GAUGES
        for value in [None, float('nan'), float('inf'), -1]:
            values = dict.fromkeys(TELEGRAM_ERROR_COUNTERS + TELEGRAM_HEALTH_GAUGES, 0)
            if value is None:
                del values[TELEGRAM_ERROR_COUNTERS[0]]
            else:
                values[TELEGRAM_ERROR_COUNTERS[0]] = value
            with self.subTest(value=str(value)), patch('verify.collect_containers', return_value={'app': self.app()}), \
                 patch('verify.telegram_metrics', return_value=(200, values)):
                with self.assertRaisesRegex(RuntimeError, 'metrics unavailable'):
                    telegram_snapshot()

    def test_bounded_docker_log_read_merges_stderr_without_exposing_it(self):
        from subprocess import CompletedProcess
        from unittest.mock import patch
        from verify import read_logs
        with patch('verify.subprocess.run', return_value=CompletedProcess([], 0, 'log-lines')) as execute:
            self.assertEqual(read_logs({'Id': 'app'}, since='start', until='end'), 'log-lines')
        self.assertEqual(execute.call_args.args[0], ['docker', 'logs', '--since', 'start', '--until', 'end', 'app'])
        with patch('verify.subprocess.run', return_value=CompletedProcess([], 1, 'private-token')):
            with self.assertRaisesRegex(RuntimeError, '^logs read failed$'):
                read_logs({'Id': 'app'}, since='start', until='end')
