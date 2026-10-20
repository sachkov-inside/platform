"""Email catalog admission source contracts; no claim of retained collector execution."""
import json
import re
import unittest
import privacy_config


class EmailCatalog(unittest.TestCase):
    def test_closed_email_catalog_separates_logical_completions_from_actual_smtp_outcomes(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        email = policy['email']
        self.assertEqual(email['operations'], ['publishMaterial','receiveMaterial','dispatchMaterial',
            'publishSubscription','receiveSubscription','dispatchSubscription','publishResult','receiveResult','projectResult'])
        self.assertEqual(email['smtp_outcomes'], ['sent','not_sent','failed','unknown'])
        self.assertEqual(email['metrics'], ['inside.email.operations','inside.email.duration'])
        self.assertEqual(email['lanes'], ['emailMaterial','emailSubscription','emailResult'])
        self.assertNotIn('dispatchResult', email['operations'])
        self.assertNotIn('projectMaterial', email['operations'])
        actual = privacy_config.render()
        metric_rule = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)',actual)[1]
        allowed = json.loads(metric_rule)
        for name in email['metrics']:
            self.assertIsNotNone(re.fullmatch(allowed, name))
        for name in ('inside.email.private', 'inside.email.operations.private', 'smtp.message.id'):
            self.assertIsNone(re.fullmatch(allowed, name))
        points = actual.split('context = "datapoint"',1)[1].split('log_statements',1)[0]
        self.assertIn('keep_keys(attributes, ["operation", "outcome"]) where (IsMatch(metric.name, "^(inside\\\\.email', points)
        self.assertIn('smtpSend', points)
        self.assertIn('not_sent', points)
        self.assertIn('email.lane', actual)
        self.assertIn('email_operation_failed', actual)
        span = actual.split('context = "span"',1)[1].split('metric_statements',1)[0]
        closed = [line for line in re.findall(r'`([^`]+)`',span) if line.startswith('keep_keys') and ('email.lane' in line or 'where (attributes["dependency.name"] == "smtp")' in line)]
        self.assertEqual(len(closed),3)
        for line in closed[1:]:
            for forbidden in ('messaging.message.id','pgboss.job.retry_count','http.route','authorization','user.email'):
                self.assertNotIn('"'+forbidden+'"',line)
        self.assertIn('and (not ((IsMatch(attributes["operation"]', points)
        self.assertIn('set(attributes["outcome"], "_OTHER") where', points)
        self.assertIn('not IsString(attributes["operation"])', points)
        self.assertIn('not IsString(attributes["outcome"])', points)
        # Email admission preserves Materials and the independently reviewed generic dependency catalog.
        self.assertEqual(policy['notifications']['operations'], ['publish','receive','audience'])
        self.assertEqual(policy['dependencies']['names'], ['kinescope','postgresql','tbank','logto','telegram','s3'])
        self.assertNotIn('smtp', policy['dependencies']['names'])
        self.assertEqual(policy['dependencies']['outcomes'], ['completed','failed'])
