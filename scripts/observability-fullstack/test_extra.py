"""Private prepared topology and fail-closed existing invocation callback boundary."""
import json
from pathlib import Path
import tempfile
import unittest
import extra


def plan():
    return {'services': {'postgres': {'environment': {'LOGTO_DATABASE_PASSWORD': 'synthetic-private-database-password'}}},
            'networks': {'pilot': {'internal': True}}, 'volumes': {}}


class Extra(unittest.TestCase):
    def test_real_source_logto_and_tls_caddy_have_no_host_or_external_ingress(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory); value = plan()
            extra.configure(output, value, {'logto': 'sha256:' + 'a' * 64})
            self.assertEqual(set(value['services']) - {'postgres'}, set(extra.SERVICES))
            for name in extra.SERVICES:
                item = value['services'][name]
                self.assertNotIn('ports', item)
                self.assertNotIn('privileged', item)
                self.assertNotIn('restart', item)
                self.assertEqual(item['pull_policy'], 'never')
            self.assertEqual(value['services']['logto']['image'], 'sha256:' + 'a' * 64)
            self.assertEqual(value['services']['logto-migrations']['command'], ['sh', '-c', extra.MIGRATION])
            self.assertEqual(value['services']['logto']['entrypoint'], ['/foundation/entrypoint.sh'])
            self.assertEqual(value['services']['caddy']['cap_add'], ['NET_BIND_SERVICE'])
            config = (output / 'extra/Caddyfile').read_text()
            self.assertIn('admin off', config)
            self.assertIn('skip_install_trust', config)
            self.assertEqual(config.count('tls internal'), 2)
            self.assertNotIn('synthetic-private', config)
            self.assertNotIn('root.key', extra.CA_READ)

    def test_refuses_mutable_or_foreign_plan_before_writing_configuration(self):
        for mutation in ('image', 'network', 'existing', 'password'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                output = Path(directory); value = plan(); images = {'logto': 'sha256:' + 'a' * 64}
                if mutation == 'image': images['logto'] = 'logto:latest'
                if mutation == 'network': value['networks']['pilot']['internal'] = False
                if mutation == 'existing': value['services']['caddy'] = {'preserve': True}
                if mutation == 'password': value['services']['postgres']['environment'].pop('LOGTO_DATABASE_PASSWORD')
                with self.assertRaises(ValueError): extra.configure(output, value, images)
                self.assertFalse((output / 'extra').exists())

    def test_initialization_copies_only_public_ca_and_never_overwrites_prior_trust(self):
        ca = (extra.ROOT / 'infra/tls/russian-trusted-root-ca.pem').read_text()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory); (output / 'provider').mkdir(); calls = []
            def invoke(compose, args, **options):
                calls.append(args)
                return ca if args[0] == 'exec' else ''
            extra.initialize(output, ['owned'], invoke)
            path = output / 'provider/caddy-root.pem'
            self.assertEqual(path.read_text(), ca)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(all('root.key' not in json.dumps(args) for args in calls))
            with self.assertRaises(FileExistsError): extra.initialize(output, ['owned'], invoke)
            self.assertEqual(path.read_text(), ca)

    def test_initialization_failure_never_creates_trust_or_continues_to_later_actions(self):
        for failed in ('migration', 'start', 'ca', 'malformed_ca'):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as directory:
                output = Path(directory); (output / 'provider').mkdir(); calls = []
                primary = RuntimeError('controlled native failure')
                def invoke(compose, args, **options):
                    calls.append(args)
                    index = {'migration': 1, 'start': 2, 'ca': 3}.get(failed)
                    if len(calls) == index: raise primary
                    return 'not public CA' if args[0] == 'exec' else ''
                with self.assertRaises((RuntimeError, ValueError)):
                    extra.initialize(output, ['docker', 'compose', '-p', 'owned'], invoke)
                self.assertEqual(len(calls), {'migration': 1, 'start': 2, 'ca': 3, 'malformed_ca': 3}[failed])
                self.assertFalse((output / 'provider/caddy-root.pem').exists())


if __name__ == '__main__': unittest.main()
