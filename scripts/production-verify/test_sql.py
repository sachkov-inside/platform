"""SQL contracts on a disposable PostgreSQL. Requires the coordinator's Docker slot."""
import json
import os
import pathlib
import subprocess
import sys
import unittest
import uuid
from queries import DOMAIN_CATALOG, logto_secret_inventory


@unittest.skipUnless(os.environ.get('PRODUCTION_VERIFY_SQL_TEST') == '1', 'isolated SQL test requires a Docker slot')
class SqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = 'inside-production-verify-test-' + uuid.uuid4().hex[:12]
        try:
            subprocess.run(['docker', 'run', '--detach', '--name', cls.container, '--label', 'inside.owner=production-verify-test',
                            '--env', 'POSTGRES_PASSWORD=synthetic-test-only', '--health-cmd', 'pg_isready -h 127.0.0.1 -U postgres',
                            '--health-interval', '1s', '--health-retries', '30', 'public.ecr.aws/docker/library/postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e'],
                           check=True, capture_output=True, text=True, timeout=120)
            # TCP health excludes the temporary socket-only server used by image initialization.
            # The budget only bounds a stuck start.
            import time
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                state = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Health.Status}}', cls.container], text=True).strip()
                if state == 'healthy':
                    break
                if state == 'unhealthy':
                    raise RuntimeError('test database unhealthy')
                time.sleep(0.1)
            else:
                raise RuntimeError('test database start timeout')
            cls.execute(pathlib.Path(__file__).with_name('sql-fixture.sql').read_text(), readonly=False)
        except BaseException as error:
            if isinstance(error, subprocess.CalledProcessError) and error.stderr:
                print('SQL setup Docker stderr: ' + error.stderr, file=sys.stderr)
            try:
                cls.tearDownClass()
            except Exception as cleanup_error:
                print('SQL setup cleanup failed: ' + str(cleanup_error), file=sys.stderr)
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['docker', 'rm', '--force', '--volumes', cls.container], check=True, capture_output=True, timeout=30)

    @classmethod
    def execute(cls, query, readonly=True):
        env = ['--env', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000'] if readonly else []
        result = subprocess.run(['docker', 'exec', '-i', '--env', 'PGPASSWORD=synthetic-test-only', *env, cls.container, 'psql', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
                                 '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-At'], input=query, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def test_index_attribute_alias_is_not_a_table_column(self):
        facts = json.loads(self.execute(DOMAIN_CATALOG))
        self.assertEqual(facts['oldPhysicalNames'], [])
        self.assertEqual(facts['materialFormats'], {'guide': 1})

    def test_actual_table_legacy_column_remains_a_failure(self):
        from verify import verify_catalog
        self.execute('ALTER TABLE materials.materials ADD COLUMN guide_id uuid;', readonly=False)
        try:
            facts = json.loads(self.execute(DOMAIN_CATALOG))
            self.assertEqual(verify_catalog(facts)[1]['status'], 'failed')
        finally:
            self.execute('ALTER TABLE materials.materials DROP COLUMN guide_id;', readonly=False)

    def test_timestamp_expiry_accepts_future_and_null_but_excludes_expired(self):
        facts = json.loads(self.execute(logto_secret_inventory('test-app')))
        self.assertEqual(facts['activeSecrets'], 2)
        self.assertEqual(facts['applications'], 1)
        self.assertFalse(facts['legacySecretPresent'])
        self.assertNotIn('secret-value', str(facts))

    def test_readonly_transaction_rejects_writes(self):
        with self.assertRaises(RuntimeError):
            self.execute("UPDATE materials.materials SET access='membership';")
