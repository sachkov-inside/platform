"""Negative fixtures for the checked-in Prometheus relabel admission policy.

These expressions use the shared ASCII regex subset of Python and RE2. This is a policy
contract, not a claim that Python executes Alloy's complete relabeling pipeline.
"""
import json
from pathlib import Path
import re
import unittest


class ContainerOwnership(unittest.TestCase):
    def test_rejects_unlabeled_cgroups_before_dropping_their_identity(self):
        config = (Path(__file__).resolve().parents[2] / 'infra/observability/production/host.alloy').read_text()
        section = config.split('prometheus.relabel "containers" {', 1)[1]
        rule = section.split('rule {', 1)[1].split('\n  }', 1)[0]
        self.assertIn('["__name__", "container_label_com_docker_compose_service", "container_label_com_docker_compose_project"]', rule)
        encoded = re.search(r'regex = ("[^\n]+")', rule).group(1)
        expression = json.loads(encoded)
        fixtures = [
            ('container_memory_usage_bytes;;', False),
            ('container_memory_usage_bytes;;', False),
            ('container_memory_usage_bytes;api;', False),
            ('container_memory_usage_bytes;unknown;inside-production', False),
            ('container_memory_usage_bytes;api;inside-production', True),
            ('up;;', True)]
        for index, (value, admitted) in enumerate(fixtures):
            with self.subTest(case=index):
                self.assertEqual(re.fullmatch(expression, value) is not None, admitted)

    def test_owner_cache_admission_refuses_arbitrary_labels_before_projection(self):
        config = (Path(__file__).resolve().parents[2] / 'infra/observability/production/host.alloy').read_text()
        rule = config.split('prometheus.relabel "host" {', 1)[1].split('rule {', 1)[1].split('\n  }', 1)[0]
        expression = json.loads(re.search(r'regex = ("[^\n]+")', rule).group(1))
        for key in ('purchases', 'fulfillment', 'backup_success_full', 'source_platform_database', 'telegram_update_failed_reset'):
            self.assertIsNotNone(re.fullmatch(expression, 'inside_watchdog_value;' + key))
        for key in ('person@example.invalid', 'account_123', 'unrecognized', ''):
            self.assertIsNone(re.fullmatch(expression, 'inside_watchdog_value;' + key))


if __name__ == '__main__':
    unittest.main()
