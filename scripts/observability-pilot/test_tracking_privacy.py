"""Tracking owner source contracts; these do not claim native stored evidence."""
import json
import re
import unittest

import privacy_config


class TrackingPrivacyContract(unittest.TestCase):
    def test_tracking_has_one_closed_owner_without_reclassifying_jobs(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy.get('tracking'), {
            'operations': ['deliver'], 'outcomes': ['completed', 'failed'],
            'metrics': ['inside.tracking.operations', 'inside.tracking.duration']})
        self.assertNotIn('deliver', policy['operations'])
        actual = privacy_config.render()
        metric_filter = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)`\]', actual)[1]
        expression = json.loads(metric_filter)
        for name in ('inside.tracking.operations', 'inside.tracking.duration'):
            self.assertRegex(name, expression)
        for name in ('inside.tracking.private', 'inside.tracking.operations.private', 'insideXtrackingXoperations'):
            self.assertIsNone(re.fullmatch(expression, name))

    def test_tracking_span_is_closed_before_name_reconstruction(self):
        span = privacy_config.render().split('context = "span"', 1)[1].split('metric_statements', 1)[0]
        statements = re.findall(r'`([^`]+)`', span)
        keep = 'keep_keys(attributes, ["tracking.operation", "tracking.outcome"]) where (attributes["tracking.operation"] != nil or attributes["tracking.outcome"] != nil)'
        self.assertIn(keep, statements)
        for key, values in (('tracking.operation', ['deliver']), ('tracking.outcome', ['completed', 'failed'])):
            rules = [rule for rule in statements if rule.startswith('set(attributes["'+key+'"], "_OTHER")')]
            self.assertEqual(len(rules), 2)
            enum = next(rule for rule in rules if 'not IsMatch' in rule)
            expression = json.loads(re.search(r'not IsMatch\(attributes\["'+key+r'"\], ("(?:\\.|[^"\\])*")\)', enum)[1])
            for value in values:
                self.assertRegex(value, expression)
            for value in ('private_tracking_token', 'tick', 'resolve', 'retry', '', 'completed/private'):
                if value not in values:
                    self.assertIsNone(re.fullmatch(expression, value))
            self.assertTrue(any('not IsString' in rule for rule in rules))
        rename = 'set(name, Concat(["tracking", attributes["tracking.operation"]], " ")) where attributes["tracking.operation"] != nil'
        self.assertIn(rename, statements)
        self.assertLess(statements.index(keep), statements.index(rename))

    def test_tracking_metric_labels_are_only_operation_and_outcome(self):
        points = privacy_config.render().split('context = "datapoint"', 1)[1].split('log_statements', 1)[0]
        statements = re.findall(r'`([^`]+)`', points)
        rules = [rule for rule in statements if 'tracking' in rule and 'not (IsMatch' not in rule]
        self.assertEqual(len(rules), 5)
        self.assertTrue(any(rule.startswith('keep_keys(attributes, ["operation", "outcome"])') for rule in rules))
        for key in ('operation', 'outcome'):
            self.assertEqual(sum(rule.startswith('set(attributes["'+key+'"], "_OTHER")') for rule in rules), 2)
        generic = next(rule for rule in statements if rule.startswith('keep_keys(attributes, ["http.route"'))
        self.assertIn('and not (IsMatch(metric.name, "^(inside\\\\.tracking\\\\.operations|inside\\\\.tracking\\\\.duration)$"))', generic)


if __name__ == '__main__':
    unittest.main()
