"""Preparation boundary: private files, explicit opt-in and separated trust networks."""
import json
from pathlib import Path
import tempfile
import unittest

import production
import check


class Preparation(unittest.TestCase):
    def test_prepares_disabled_application_overlays_and_private_read_keys(self):
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent).resolve() / 'configuration'
            production.prepare(output, data=Path(parent).resolve() / 'data', project='inside-observability-review')
            stack = json.loads((output / 'compose.json').read_text())
            overlay = json.loads((output / 'platform.compose.json').read_text())
            self.assertEqual(stack['name'], 'inside-observability-review')
            self.assertEqual(stack['services']['gateway']['ports'], ['127.0.0.1:18427:8080'])
            self.assertNotIn('ports', stack['services']['metrics'])
            self.assertNotIn('ports', stack['services']['logs'])
            self.assertNotIn('ports', stack['services']['traces'])
            self.assertEqual(overlay['services']['api']['environment']['INSIDE_OTEL_ENABLED'], '${INSIDE_OTEL_ENABLED:-false}')
            self.assertEqual(overlay['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED'], '${INSIDE_OTEL_ENABLED:-false}')
            self.assertEqual(overlay['services']['web']['networks'], {'telemetry': {'aliases': ['inside-web-http']}})
            self.assertNotIn('ports', overlay['services']['web'])
            self.assertIn('inside-web-http:9420', (output / 'config.alloy').read_text())
            self.assertEqual(overlay['services']['api']['logging']['options']['cache-disabled'], 'true')
            self.assertEqual((output / 'reader.key').stat().st_mode & 0o777, 0o600)
            self.assertNotIn((output / 'reader.key').read_text().strip(), (output / 'compose.json').read_text())
            self.assertEqual(stack['networks']['telemetry']['internal'], True)
            self.assertNotIn('storage', overlay['networks'])
            self.assertNotIn('/var/run/docker.sock', json.dumps(stack['services']['alloy']))

    def test_runtime_fixture_keeps_grafana_secret_reader_identity(self):
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent).resolve() / 'configuration'
            check.prepare(output)
            stack = json.loads((output / 'compose.json').read_text())
            secret = (output / 'grafana.password').stat()
            self.assertEqual(stack['services']['grafana']['user'], f'{secret.st_uid}:{secret.st_gid}')
            self.assertEqual(secret.st_mode & 0o777, 0o600)

    def test_overview_has_every_expected_source_and_owner_business_projection(self):
        view = production.dashboard()['dashboard']
        content = json.dumps(view)
        self.assertIn('inside-telegram', view['templating']['list'][0]['query'])
        self.assertIn('inside_watchdog_value', content)
        self.assertIn('backup_last_success_timestamp_seconds', content)
        self.assertIn('vector(-1)', content)
        self.assertIn('source_platform_database', content)
        self.assertIn('sales-funnel', content)
        self.assertIn('Native Umami read-only', content)
        self.assertEqual(len({p['id'] for p in view['panels']}), len(view['panels']))

    def test_refuses_replacing_existing_configuration_or_following_a_symlink(self):
        with tempfile.TemporaryDirectory() as parent:
            base = Path(parent).resolve()
            output = base / 'configuration'
            output.mkdir()
            secret = output / 'reader.key'
            secret.write_text('preserve-existing-reader')
            with self.assertRaises(ValueError):
                production.prepare(output, data=base / 'data')
            self.assertEqual(secret.read_text(), 'preserve-existing-reader')
            (base / 'linked').symlink_to(output, target_is_directory=True)
            with self.assertRaises(ValueError):
                production.prepare(base / 'linked' / 'child', data=base / 'data')

    def test_optional_analytics_uses_existing_database_and_closed_query_gateway(self):
        with tempfile.TemporaryDirectory() as parent:
            base = Path(parent).resolve()
            output = base / 'configuration'
            production.prepare(output, data=base / 'data')
            analytics = json.loads((output / 'umami.compose.json').read_text())
            self.assertEqual(analytics['services']['umami']['profiles'], ['analytics'])
            self.assertNotIn('ports', analytics['services']['umami'])
            self.assertNotIn('db', analytics['services'])
            self.assertEqual(analytics['networks']['database']['external'], True)
            self.assertEqual(analytics['services']['query']['ports'], ['127.0.0.1:13301:3001'])
            self.assertEqual((output / 'umami.reader.key').read_text(), '')
            self.assertEqual((output / 'umami.database.password').stat().st_mode & 0o777, 0o600)
            self.assertIn('connection_limit=8', (output / 'umami.env').read_text())


if __name__ == '__main__':
    unittest.main()
