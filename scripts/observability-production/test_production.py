"""Preparation boundary: private files, explicit opt-in and separated trust networks."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import production
import check


class Preparation(unittest.TestCase):
    def test_scope_selector_cli_uses_event_file_and_ignores_requested_override(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            for number, expected in ((1716, 'technical'), (1717, 'full')):
                event.write_text(json.dumps({'number': number, 'pull_request': {
                    'body': '<!-- observability-scope: technical -->'}}))
                result = subprocess.run([sys.executable, '-B', str(production.HERE / 'production.py'),
                    'select-scope', '--scope', 'technical'],
                    env={**os.environ, 'GITHUB_EVENT_PATH': str(event)},
                    capture_output=True, text=True, check=True, timeout=5)
                self.assertEqual(result.stdout, 'scope=' + expected + '\n')

    def test_full_is_the_legacy_default_and_invalid_scopes_never_create_output(self):
        self.assertEqual(production.dashboard(), production.dashboard(scope='full'))
        for scope in (True, False, None, '', 'unknown', '../technical', Path('technical')):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve() / 'invalid'
                with self.assertRaises(ValueError):
                    production.prepare(output, data=Path(directory).resolve() / 'data', scope=scope)
                self.assertFalse(output.exists())
                with self.assertRaises(ValueError):
                    production.dashboard(scope=scope)

    def test_technical_preparation_excludes_deferred_files_and_keeps_secure_core(self):
        with tempfile.TemporaryDirectory() as parent:
            base = Path(parent).resolve()
            output = base / 'technical'
            production.prepare(output, data=base / 'data', scope='technical')
            self.assertEqual(json.loads((output / 'inputs.json').read_text())['scope'], 'technical')
            self.assertFalse(list(output.glob('umami*')))
            stack = json.loads((output / 'compose.json').read_text())
            self.assertEqual(set(stack['services']), set(production.SERVICES))
            self.assertEqual(len(json.loads((output / 'auth.json').read_text())['users']), 2)
            view = json.loads((output / 'owner-overview/dashboard.json').read_text())
            self.assertNotIn('Umami', json.dumps(view))
            self.assertNotIn('observability-investigation.md', json.dumps(view))
            self.assertIn('production-diagnostics.md', json.dumps(view))
            self.assertIn('vector(-1)', json.dumps(view))
            with self.assertRaisesRegex(ValueError, 'scope_mismatch'):
                production.preflight(output, application_data=base, scope='full')

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

    def test_dependency_failure_panel_selects_the_actual_sdk_failure_outcome(self):
        import re
        root = Path(__file__).resolve().parents[2]
        sdk = (root / 'apps/backend/src/infrastructure/observability/technical-telemetry.ts').read_text()
        emitted = re.search(r'outcome: failed \? "([^"]+)" : "([^"]+)"', sdk)
        self.assertIsNotNone(emitted)
        panel = next(panel for panel in production.dashboard()['dashboard']['panels']
                     if panel['title'] == 'Dependency failures (observed)')
        selector = re.search(r'outcome(=~|=)"([^"]+)"', panel['targets'][0]['expr'])
        self.assertIsNotNone(selector)
        matches = lambda value: (re.fullmatch(selector[2], value) is not None
                                 if selector[1] == '=~' else value == selector[2])
        self.assertTrue(matches(emitted[1]), 'actual failed SDK operations must be visible')
        self.assertFalse(matches(emitted[2]), 'completed operations are not failures')

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
            self.assertEqual(json.loads((output / 'inputs.json').read_text())['scope'], 'full')
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
