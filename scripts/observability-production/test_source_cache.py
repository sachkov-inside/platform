"""Finite source projection refuses malformed/insufficient reads, emits no raw diagnostics."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import source_cache
sys.path.insert(0, str(source_cache.ROOT / 'scripts/observability-caddy-storage'))
from test_native_source import wire


def pg():
    return (json.dumps({'schema': 1, 'fields': [{'name': n, 'oid': oid} for n, oid in source_cache.frame.FIELDS],
        'rows': [['180004', 'on', 'on', 'on', True, True, True, '100000000', '10000000', '20000000', '3', '0', '0']]}) + '\n').encode()


class Sources(unittest.TestCase):
    def test_fixed_ordinary_role_contract_and_native_cache_contain_only_closed_observations(self):
        sql = source_cache.postgres_sql()
        self.assertIn("(current_database() = 'inside')", sql)
        self.assertIn('BEGIN READ ONLY', sql)
        self.assertIn("SET LOCAL statement_timeout = '2000ms'", sql)
        self.assertNotIn("(current_database() = 'tracking')", sql)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            result = source_cache.sample(output, postgres_read=lambda actual: pg(),
                caddy_read=lambda: wire() + b'process_start_time_seconds 10\n', caddy_server='srv0', clock=lambda: 100)
            self.assertEqual(result, {'postgresql': 'observed', 'caddy': 'observed'})
            text = (output / 'postgresql-source.prom').read_text()
            self.assertIn('inside_postgresql_server_waiting_locks 0\n', text)
            self.assertIn('inside_postgresql_server_statistics_reset_time_microseconds 20000000\n', text)
            caddy = (output / 'caddy-source.prom').read_text()
            self.assertIn('caddy_http_requests_total{server="public",handler="subroute"} 3\n', caddy)
            self.assertIn('caddy_process_start_time_seconds 10\n', caddy)
            self.assertNotIn('srv0', caddy)

    def test_read_failures_and_insufficient_role_never_publish_old_counts_or_raw_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            source_cache.sample(output, postgres_read=lambda sql: pg(), caddy_read=lambda: wire() + b'process_start_time_seconds 10\n', caddy_server='srv0', clock=lambda: 100)
            bad = json.loads(pg()); bad['rows'][0][4] = False
            def unavailable(): raise RuntimeError('private-sentinel email/person?token=secret')
            result = source_cache.sample(output, postgres_read=lambda sql: (json.dumps(bad) + '\n').encode(),
                caddy_read=unavailable, caddy_server='srv0', clock=lambda: 101)
            self.assertEqual(set(result.values()), {'unavailable'})
            for path in output.iterdir():
                text = path.read_text()
                self.assertNotIn('private-sentinel', text)
                self.assertNotIn('waiting_locks', text)
                self.assertNotIn('caddy_http', text)
                self.assertIn('} 0\n', text)

    def test_selected_partition_unknown_epoch_and_private_excluded_labels_refuse(self):
        raw = wire() + b'process_start_time_seconds 10\n'
        self.assertIn('requests_total', source_cache.caddy_projection(raw, 'srv0', 100))
        for body, server in ((wire(), 'srv0'), (raw, 'srv64'), (raw, 'private-person'),
                (raw.replace(b'process_start_time_seconds 10', b'process_start_time_seconds 101'), 'srv0'),
                (raw + b'caddy_http_requests_total{server="srv2",handler="subroute",host="private"} 1\n', 'srv0')):
            with self.subTest(server=server), self.assertRaises(ValueError): source_cache.caddy_projection(body, server, 100)


if __name__ == '__main__': unittest.main()
