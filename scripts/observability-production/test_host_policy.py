"""Negative fixtures for the checked-in Prometheus relabel admission policy.

These expressions use the shared ASCII regex subset of Python and RE2. This is a policy
contract, not a claim that Python executes Alloy's complete relabeling pipeline.
"""
import json
from pathlib import Path
import re
import unittest


class ContainerOwnership(unittest.TestCase):
    def test_remote_write_wal_explicit_range_satisfies_pinned_runtime_validation(self):
        # Pinned Alloy1.21 requires min<max; its implicit minimum is five minutes.
        # Native RED/GREEN proved that validate alone did not exercise this construction.
        config = (Path(__file__).resolve().parents[2] / 'infra/observability/production/host.alloy').read_text()
        wal = re.search(r'wal\s*\{([^}]+)\}', config).group(1)
        limits = dict((key, int(value)) for key,value in re.findall(r'(min|max)_keepalive_time\s*=\s*"([0-9]+)m"', wal))
        self.assertEqual(set(limits), {'min', 'max'})
        self.assertGreater(limits['min'], 0)
        self.assertLess(limits['min'], limits['max'])
        self.assertLessEqual(limits['max'], 5)

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
        rule = config.split('prometheus.relabel "owner_cache" {', 1)[1].split('rule {', 1)[1].split('\n  }', 1)[0]
        expression = json.loads(re.search(r'regex = ("[^\n]+")', rule).group(1))
        for key in ('purchases', 'fulfillment', 'backup_success_full', 'source_platform_database', 'telegram_update_failed_reset'):
            self.assertIsNotNone(re.fullmatch(expression, 'inside_watchdog_value;' + key + ';;;'))
        for key in ('person@example.invalid', 'account_123', 'unrecognized', ''):
            self.assertIsNone(re.fullmatch(expression, 'inside_watchdog_value;' + key + ';;;'))

    def test_native_cache_has_one_five_second_stream_and_closed_source_identity(self):
        config = (Path(__file__).resolve().parents[2] / 'infra/observability/production/host.alloy').read_text()
        self.assertNotIn('textfile', config.split('prometheus.exporter.cadvisor', 1)[0])
        cache = config.split('prometheus.scrape "owner_cache" {', 1)[1].split('\n}', 1)[0]
        self.assertIn('scrape_interval = "5s"', cache)
        rule = config.split('prometheus.relabel "owner_cache" {', 1)[1].split('rule {', 1)[1].split('\n  }', 1)[0]
        expression = json.loads(re.search(r'regex = ("[^\n]+")', rule).group(1))
        for value, accepted in (
                ('inside_production_source_available;;postgresql;;', True),
                ('inside_production_source_available;;caddy;;', True),
                ('inside_production_source_available;;private-person;;', False),
                ('inside_postgresql_server_waiting_locks;;;;', True),
                ('inside_postgresql_server_query_text;;;;', False),
                ('caddy_http_requests_total;;;public;subroute', True),
                ('caddy_http_requests_total;;;srv0;subroute', False),
                ('caddy_http_requests_total;;;public;metrics', False)):
            with self.subTest(value=value):
                self.assertEqual(re.fullmatch(expression, value) is not None, accepted)


if __name__ == '__main__':
    unittest.main()
