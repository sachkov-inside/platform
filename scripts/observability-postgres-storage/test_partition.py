"""Actual generated finite-service Boolean filter, not native Alloy execution."""
import json
from pathlib import Path
import re
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import privacy_config
from test_telegram_runtime_privacy import generated_metric_drops

NAMES=['inside.postgresql.server.'+suffix for suffix in ('backends','waiting_locks','deadlocks_since_reset',
       'postmaster_start_time_microseconds','statistics_reset_time_microseconds','sample_time_microseconds','available')]
SERVICE='resource.attributes["service.name"] == "inside-postgresql-source"'


class SourcePartition(unittest.TestCase):
    def test_new_source_admits_exact_seven_families_and_other_services_reject_them(self):
        for name in NAMES:
            self.assertFalse(generated_metric_drops('inside-postgresql-source',name))
            for service in ('platform-api','inside-telegram','foreign','',None):
                self.assertTrue(generated_metric_drops(service,name))
        for name in ('inside.dependency.operations','inside.postgresql.pool.total','inside.telegram.operations',
                     'http.server.request.count','private.metric',NAMES[0]+'.private'):
            self.assertTrue(generated_metric_drops('inside-postgresql-source',name))

    def test_all_source_traces_logs_drop_and_points_have_no_attributes_or_exemplars(self):
        actual=privacy_config.render()
        catalog=actual.split('otelcol.processor.filter "catalog" {',1)[1].split('  output {',1)[0]
        self.assertIn('span = [`'+SERVICE+'`]',catalog)
        self.assertIn('log_record = [`'+SERVICE+'`]',catalog)
        source=actual.split('otelcol.processor.transform "postgres_source" {',1)[1]
        self.assertIn(privacy_config.only('keep_keys(attributes, [])',SERVICE),source)
        self.assertIn(privacy_config.only('set(exemplars, nil)',SERVICE),source)
        self.assertIn('metrics = [otelcol.processor.transform.postgres_source.input]',actual)
        self.assertEqual(json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())['postgres_server']['metrics'],NAMES)
