"""Waitlist owner source contracts; these do not claim native stored evidence."""
import json
import re
import unittest

import privacy_config


class WaitlistPrivacyContract(unittest.TestCase):
    def test_waitlist_has_one_closed_owner_without_reclassifying_jobs(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy.get('waitlist'), {
            'operations': ['deliver', 'authorize'], 'outcomes': ['completed', 'failed'],
            'metrics': ['inside.waitlist.operations', 'inside.waitlist.duration']})
        self.assertNotIn('deliver', policy['operations'])
        actual = privacy_config.render()
        metric_filter = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)', actual)[1]
        expression = json.loads(metric_filter)
        for name in ('inside.waitlist.operations', 'inside.waitlist.duration'):
            self.assertRegex(name, expression)
        for name in ('inside.waitlist.private', 'inside.waitlist.operations.private', 'insideXwaitlistXoperations'):
            self.assertIsNone(re.fullmatch(expression, name))

    def test_waitlist_span_is_closed_before_name_reconstruction(self):
        span = privacy_config.render().split('context = "span"', 1)[1].split('metric_statements', 1)[0]
        statements = re.findall(r'`([^`]+)`', span)
        keep = 'keep_keys(attributes, ["waitlist.operation", "waitlist.outcome"]) where (attributes["waitlist.operation"] != nil or attributes["waitlist.outcome"] != nil)'
        keep = privacy_config.only(keep, 'not ('+privacy_config.TELEGRAM_SERVICE+')')
        self.assertIn(keep, statements)
        for key, values in (('waitlist.operation', ['deliver', 'authorize']), ('waitlist.outcome', ['completed', 'failed'])):
            rules = [rule for rule in statements if rule.startswith('set(attributes["'+key+'"], "_OTHER")')]
            self.assertEqual(len(rules), 2)
            enum = next(rule for rule in rules if 'not IsMatch' in rule)
            expression = json.loads(re.search(r'not IsMatch\(attributes\["'+key+r'"\], ("(?:\\.|[^"\\])*")\)', enum)[1])
            for value in values:
                self.assertRegex(value, expression)
            for value in ('private_waitlist_token', 'tick', 'resolve', 'retry', '', 'completed/private'):
                if value not in values:
                    self.assertIsNone(re.fullmatch(expression, value))
            self.assertTrue(any('not IsString' in rule for rule in rules))
        rename = 'set(name, Concat(["waitlist", attributes["waitlist.operation"]], " ")) where attributes["waitlist.operation"] != nil'
        rename = privacy_config.only(rename, 'not ('+privacy_config.TELEGRAM_SERVICE+')')
        self.assertIn(rename, statements)
        self.assertLess(statements.index(keep), statements.index(rename))

    def test_waitlist_metric_labels_are_only_operation_and_outcome(self):
        points = privacy_config.render().split('context = "datapoint"', 1)[1].split('log_statements', 1)[0]
        statements = re.findall(r'`([^`]+)`', points)
        rules = [rule for rule in statements if 'inside\\\\.waitlist' in rule and 'not (IsMatch' not in rule]
        self.assertEqual(len(rules), 5)
        self.assertTrue(any(rule.startswith('keep_keys(attributes, ["operation", "outcome"])') for rule in rules))
        for key in ('operation', 'outcome'):
            self.assertEqual(sum(rule.startswith('set(attributes["'+key+'"], "_OTHER")') for rule in rules), 2)
        generic = next(rule for rule in statements if rule.startswith('keep_keys(attributes, ["http.route"'))
        self.assertIn('and not (IsMatch(metric.name, "^(inside\\\\.waitlist\\\\.operations|inside\\\\.waitlist\\\\.duration)$"))', generic)


if __name__ == '__main__':
    unittest.main()
