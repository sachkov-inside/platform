"""Authoritative deletion requests survive restore and precede reader transitions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import maintenance
from test_retention import batch

SITE='00000000-0000-4000-8000-000000001566'
TARGET='00000000-0000-4000-8000-000000001567'
REQUEST='00000000-0000-4000-8000-000000001568'


class Maintenance(unittest.TestCase):
    def test_durable_request_is_idempotent_and_replayed_before_fresh_ttl_and_reader_open(self):
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json'
            maintenance.initialize(journal)
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='session',target_id=TARGET)
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='session',target_id=TARGET)
            self.assertEqual(len(json.loads(journal.read_text())['requests']),1)
            calls=[]
            def execute(sql,*,timeout):
                calls.append(sql)
                return batch(0) if 'cutoff_age_seconds' in sql else '{"remaining":false}'
            result=maintenance.restore(journal,execute,lambda:calls.append('OPEN'))
            self.assertEqual(result['state'],'complete')
            self.assertEqual(calls[-1],'OPEN')
            self.assertIn(TARGET,calls[0])
            self.assertIn('365 days',calls[1])
            self.assertEqual(calls[0],calls[-2])
            self.assertNotIn(TARGET,json.dumps(result))

    def test_conflicting_request_symlink_or_missing_authority_never_reaches_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='event',target_id=TARGET)
            with self.assertRaises(ValueError):
                maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='website',target_id=SITE)
            execute=Mock();open_readers=Mock()
            for path in (Path(directory)/'missing',Path(directory)/'link'):
                if path.name=='link':path.symlink_to(journal)
                with self.assertRaises((ValueError,OSError)):
                    maintenance.restore(path,execute,open_readers)
            execute.assert_not_called();open_readers.assert_not_called()

    def test_partial_replay_or_ttl_failure_keeps_readers_closed_and_authority_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='event',target_id=TARGET)
            before=journal.read_bytes();opened=Mock()
            result=maintenance.restore(journal,lambda sql,timeout:'{"remaining":true}',opened)
            self.assertEqual(result['state'],'partial');opened.assert_not_called()
            self.assertEqual(journal.read_bytes(),before)
            result=maintenance.restore(journal,lambda sql,timeout:'{"remaining":false}' if 'cutoff_age_seconds' not in sql else 'invalid',opened)
            self.assertEqual(result['state'],'error');opened.assert_not_called()

    def test_corrupt_or_public_authority_and_contended_owner_refuse_before_sql(self):
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            execute=Mock();opened=Mock()
            with maintenance.locked(journal):
                with self.assertRaises(OSError):maintenance.restore(journal,execute,opened)
            journal.chmod(0o644)
            with self.assertRaises(ValueError):maintenance.restore(journal,execute,opened)
            journal.chmod(0o600);journal.write_text('{"schema":1,"schema":1}')
            with self.assertRaises(ValueError):maintenance.restore(journal,execute,opened)
            execute.assert_not_called();opened.assert_not_called()

    def test_cli_is_off_before_transport_or_journal_creation(self):
        import os
        import sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json'
            with patch.dict(os.environ,{},clear=True),patch.object(sys,'argv',['maintenance.py','initialize','--journal',str(journal)]):
                with self.assertRaisesRegex(ValueError,'maintenance_disabled'):maintenance.main()
            self.assertFalse(journal.exists())

    def test_database_setup_is_off_before_reading_password_or_starting_psql(self):
        import os
        import sys
        import setup_database
        from unittest.mock import patch
        with patch.dict(os.environ,{},clear=True),patch.object(sys,'argv',['setup_database.py','--password-file','/does-not-exist']):
            with self.assertRaisesRegex(ValueError,'umami_setup_disabled'):setup_database.main()
