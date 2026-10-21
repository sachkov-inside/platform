"""Telegram collector source contracts, not native Alloy or stored evidence."""
import ast
import json
import hashlib
import re
import unittest
import privacy_config

SERVICE = 'resource.attributes["service.name"] == "inside-telegram"'
ROUTES = ['/health', '/ready', '/metrics', '/webhooks/telegram', '/integrations/platform/v1/telegram-contacts', '/integrations/platform/v1/community-entitlements', '/integrations/platform/v1/identity-links', '/integrations/platform/v1/identity-links/:linkTransactionRef/confirm', '/integrations/identity/v1/sign-in', '/integrations/identity/v1/sign-in/:requestRef/status', '/integrations/identity/v1/sign-in/:requestRef/consume', '/integrations/identity/v1/sign-in/:requestRef/account-link', '/integrations/platform/v1/communications']
METRICS = ['inside.telegram.operations', 'inside.telegram.duration', 'http.server.request.count', 'http.server.request.duration', 'http.server.active_requests', 'telemetry.trace.dropped', 'telemetry.trace.export.failures', 'telemetry.metric.export.failures', 'telemetry.trace.sampling.ratio']

def generated_metric_drops(service, name):
    """Worked Boolean/regex semantics of the actual filter, not sanitized output or native Alloy."""
    actual = privacy_config.render()
    expression = re.search(r'metric = \[`([^`]+)`\]', actual)[1]
    expression = re.sub(r'IsMatch\(name, ("(?:\\.|[^"\\])*")\)',
                        lambda match: str(re.search(json.loads(match[1]), name) is not None), expression)
    expression = expression.replace(SERVICE, str(service == 'inside-telegram'))
    expression = expression.replace('resource.attributes["service.name"] == "inside-postgresql-source"', str(service == 'inside-postgresql-source'))
    def value(node):
        if isinstance(node, ast.Constant) and type(node.value) is bool: return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not): return not value(node.operand)
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And): return all(value(item) for item in node.values)
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or): return any(value(item) for item in node.values)
        raise AssertionError('Unexpected generated filter syntax')
    return value(ast.parse(expression, mode='eval').body)

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

    def test_actual_generated_filter_rejects_telegram_families_on_every_nontelegram_service(self):
        for service in ('platform-api', 'platform-worker', 'foreign-service', '', None):
            for name in ('inside.telegram.operations', 'inside.telegram.duration'):
                with self.subTest(service=service, metric=name):
                    self.assertTrue(generated_metric_drops(service, name))

    def test_actual_generated_filter_keeps_old_catalog_and_exclusively_selects_telegram_catalog(self):
        backend = ['pilot_requests', 'messaging.client.sent.messages', 'pgboss.queue.jobs',
                   'inside.notification.operations', 'inside.dependency.duration',
                   'inside.postgresql.pool.total', 'inside.email.operations',
                   'inside.tracking.duration', 'inside.waitlist.operations']
        for service in ('platform-api', 'platform-worker', 'foreign-service', '', None):
            for name in backend + ['http.server.request.count', 'telemetry.trace.dropped']:
                with self.subTest(service=service, metric=name):
                    self.assertFalse(generated_metric_drops(service, name))
        for name in METRICS:
            self.assertFalse(generated_metric_drops('inside-telegram', name))
        for name in backend:
            self.assertTrue(generated_metric_drops('inside-telegram', name))
        for service in ('inside-telegram', 'platform-api', 'foreign-service', None):
            for name in ('inside.telegram.operations.private', 'private.metric', 'inside.notification.private'):
                self.assertTrue(generated_metric_drops(service, name))

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

    def test_backend_instruction_order_and_predicates_preserve_prepartition_B_with_explicit_authorize_enum(self):
        # Literal digest of the pre-partition B program, including the explicit authorize enum.
        # Accepted ROOT b512 has deliver-only enums; this is not a byte-equivalence claim to ROOT.
        # This compares source instructions, not execution by pinned Alloy.
        expected = {'span': (60, 'e9d97d2f76aa8c1944daba7d1c7b08c112deb288776594219bf05cb396ca4ab0'), 'datapoint': (42, 'a3ce885937e0faeadbbdc5956ba6b31ae4d8f7e9482892ae6faae04e84a02660')}
        import copy
        from pathlib import Path
        import tempfile
        from unittest.mock import patch
        prefix = '(not ('+SERVICE+'))'
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        route = '/authoring/import/materials/publication'
        queue = 'membership-activity.retention'
        projected_policy = copy.deepcopy(policy)
        for key, addition in (('routes', route), ('queues', queue)):
            self.assertEqual(projected_policy[key].count(addition), 1)
            projected_policy[key].remove(addition)
        actual = privacy_config.render()
        with tempfile.TemporaryDirectory(prefix='core-catalogue-') as directory:
            temporary = Path(directory)
            def render_policy(value):
                target = temporary/'privacy-policy.json'
                target.write_text(json.dumps(value));target.chmod(0o600)
                with patch.object(privacy_config, 'CONFIG', temporary):return privacy_config.render()
            projected = render_policy(projected_policy)
            poisoned = []
            for key, neighbour in (('routes', route+'/private'), ('queues', queue+'.private')):
                changed = copy.deepcopy(projected_policy);changed[key].append(neighbour)
                poisoned.append(render_policy(changed))

        def rules(text, context):
            body = text.split('context = "'+context+'"', 1)[1].split('    ]', 1)[0]
            return re.findall(r'`([^`]+)`', body)

        normalized = actual
        for key, catalogue in (('http.route', 'routes'), ('messaging.destination.name', 'queues')):
            current = 'IsMatch(attributes['+privacy_config.literal(key)+'], '+privacy_config.literal(privacy_config.pattern(policy[catalogue]))+')'
            previous = 'IsMatch(attributes['+privacy_config.literal(key)+'], '+privacy_config.literal(privacy_config.pattern(projected_policy[catalogue]))+')'
            self.assertNotEqual(current, previous)
            self.assertEqual(actual.count(current), 2)
            for context in expected:
                self.assertEqual(sum(current in rule for rule in rules(actual, context)), 1)
            normalized = normalized.replace(current, previous)
        # Nothing except the two fixed enum operands in each context may differ anywhere in Alloy.
        self.assertEqual(normalized, projected)
        queue_expression = privacy_config.pattern(policy['queues'])
        self.assertIsNotNone(re.fullmatch(queue_expression, queue))
        self.assertIsNotNone(re.fullmatch(queue_expression, '_OTHER'))
        for rejected in (queue+'.private', queue+'/private-person@example.test', queue+'?token=SECRET', queue+'._OTHER'):
            self.assertIsNone(re.fullmatch(queue_expression, rejected))
        self.assertTrue(privacy_config.enum_rule('messaging.destination.name', policy['queues']).startswith(
            'set(attributes["messaging.destination.name"], "_OTHER") where '))

        def require_original(text):
            for context, (count, digest) in expected.items():
                backend = []
                for rule in rules(text, context):
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
        require_original(projected)
        # Feed changes to actual rendered source into the same retained literal contract.
        old_rules = rules(projected, 'span')
        first, second = ('`'+rule+'`' for rule in old_rules[:2])
        pair = first+',\n      '+second
        self.assertIn(pair, projected)
        changed_predicate = projected.replace(first, first[:-1]+' and true`', 1)
        reordered = projected.replace(pair, second+',\n      '+first, 1)
        for changed in [changed_predicate, reordered, *poisoned]:
            with self.assertRaises(AssertionError):require_original(changed)

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
