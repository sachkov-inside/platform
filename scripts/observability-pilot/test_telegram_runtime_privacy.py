"""Telegram collector source contracts, not native Alloy or stored evidence."""
import json
import hashlib
import re
import unittest
import privacy_config

SERVICE = 'resource.attributes["service.name"] == "inside-telegram"'
ROUTES = ['/health', '/ready', '/metrics', '/webhooks/telegram', '/integrations/platform/v1/telegram-contacts', '/integrations/platform/v1/community-entitlements', '/integrations/platform/v1/identity-links', '/integrations/platform/v1/identity-links/:linkTransactionRef/confirm', '/integrations/identity/v1/sign-in', '/integrations/identity/v1/sign-in/:requestRef/status', '/integrations/identity/v1/sign-in/:requestRef/consume', '/integrations/identity/v1/sign-in/:requestRef/account-link', '/integrations/platform/v1/communications']
METRICS = ['inside.telegram.operations', 'inside.telegram.duration', 'http.server.request.count', 'http.server.request.duration', 'http.server.active_requests', 'telemetry.trace.dropped', 'telemetry.trace.export.failures', 'telemetry.metric.export.failures', 'telemetry.trace.sampling.ratio']

class TelegramRuntimePrivacyContract(unittest.TestCase):
    def test_one_explicit_service_partition_has_the_actual_sdk_catalog(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy['services'].count('inside-telegram'), 1)
        telegram = policy['telegram_runtime']
        self.assertEqual(telegram['operations'], ['receipt', 'authorization', 'attempt', 'sendMessage'])
        self.assertEqual(telegram['outcomes'], ['completed', 'failed', 'accepted', 'suppressed', 'unavailable', 'delivered', 'api_rejected', 'api_retryable', 'transport_unknown'])
        self.assertEqual(telegram['routes'], ROUTES)
        self.assertEqual(telegram['methods'], ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
        self.assertEqual(telegram['metrics'], METRICS)
        self.assertNotIn('/webhooks/telegram', policy['routes'])
        actual = privacy_config.render()
        self.assertIn('('+SERVICE+') and not IsMatch(name, '+privacy_config.literal(privacy_config.pattern(METRICS))+')', actual)
        self.assertIn('not ('+SERVICE+')', actual)

    def test_span_families_are_closed_and_remove_all_link_metadata_and_coordinates_only_for_telegram(self):
        actual = privacy_config.render()
        spans = re.findall(r'`([^`]+)`', actual.split('context = "span"', 1)[1].split('metric_statements', 1)[0])
        for statement in ['set(links, nil)', 'set(events, nil)', 'set(trace_state, "")', 'set(status.message, "")']:
            self.assertIn(privacy_config.only(statement, SERVICE), spans)
        generic = next(rule for rule in spans if rule.startswith('keep_keys(attributes, ["http.route"'))
        self.assertIn('not ('+SERVICE+')', generic)
        self.assertIn(privacy_config.only('set(name, "waitlist receipt")', SERVICE+' and attributes["telegram.operation"] == "receipt"'), spans)
        self.assertIn(privacy_config.only('set(name, "telegram sendMessage")', SERVICE+' and attributes["telegram.operation"] == "sendMessage"'), spans)
        self.assertTrue(any(rule.startswith('keep_keys(attributes, ["telegram.operation", "telegram.outcome", "http.response.status_code"])') and SERVICE in rule for rule in spans))
        self.assertTrue(any(rule.startswith('delete_key(attributes, "http.response.status_code")') and 'attributes["telegram.operation"] != "authorization"' in rule for rule in spans))

    def test_backend_instruction_order_and_predicates_are_byte_equivalent_after_service_partition(self):
        # Literal digest of the pre-partition B program, including accepted ROOT48.
        # This compares source instructions, not execution by pinned Alloy.
        expected = {'span': (60, 'e9d97d2f76aa8c1944daba7d1c7b08c112deb288776594219bf05cb396ca4ab0'), 'datapoint': (42, 'a3ce885937e0faeadbbdc5956ba6b31ae4d8f7e9482892ae6faae04e84a02660')}
        prefix = '(not ('+SERVICE+'))'
        actual = privacy_config.render()
        for context, (count, digest) in expected.items():
            body = actual.split('context = "'+context+'"', 1)[1].split('    ]', 1)[0]
            backend = []
            for rule in re.findall(r'`([^`]+)`', body):
                command, separator, predicate = rule.partition(' where ')
                if predicate == prefix:
                    backend.append(command)
                elif predicate.startswith(prefix+' and (') and predicate.endswith(')'):
                    backend.append(command+' where '+predicate[len(prefix+' and ('):-1])
                elif rule == 'set(exemplars, nil)' and context == 'datapoint':
                    backend.append(rule)
                else:
                    self.assertIn(SERVICE, predicate, 'every non-Telegram instruction requires an explicit service guard')
                    self.assertFalse(predicate.startswith(prefix))
            self.assertEqual(len(backend), count)
            self.assertEqual(hashlib.sha256(json.dumps(backend,separators=(',',':')).encode()).hexdigest(), digest)

    def test_metric_operation_http_and_health_families_do_not_share_labels(self):
        actual = privacy_config.render()
        points = re.findall(r'`([^`]+)`', actual.split('context = "datapoint"', 1)[1].split('log_statements', 1)[0])
        own = [rule for rule in points if SERVICE in rule and 'not ('+SERVICE+')' not in rule]
        self.assertTrue(any(rule.startswith('keep_keys(attributes, ["operation", "outcome"])') for rule in own))
        self.assertTrue(any(rule.startswith('keep_keys(attributes, ["http.request.method", "http.route", "http.request.outcome"])') for rule in own))
        self.assertTrue(any(rule.startswith('keep_keys(attributes, [])') for rule in own))
        for rule in own:
            self.assertNotIn('http.response.status_code', rule)
            self.assertNotIn('dependency', rule)
        self.assertIn('set(exemplars, nil)', points)

if __name__ == '__main__': unittest.main()
