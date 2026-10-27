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
            result=maintenance.restore(journal,lambda sql,timeout:batch(0) if 'cutoff_age_seconds' in sql else '{"remaining":true}',opened)
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

    def test_large_absent_prefix_advances_durably_and_does_not_starve_late_delete_or_ttl(self):
        import uuid
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            targets=[str(uuid.UUID(int=index+100)) for index in range(96)]
            for index,target in enumerate(targets):
                maintenance.append(journal,request_id=str(uuid.UUID(int=index+1000)),website_id=SITE,kind='event',target_id=target)
            authority=journal.read_bytes();now=[0];deleted=[];ttl=[]
            def execute(sql,*,timeout):
                now[0]+=1
                if 'cutoff_age_seconds' in sql:
                    ttl.append(True);return batch(0)
                target=next(value for value in targets if value in sql)
                deleted.append(target)
                return '{"remaining":false}'
            outcomes=[]
            for _ in range(12):
                outcome=maintenance.run(journal,execute,clock=lambda:now[0])
                outcomes.append(outcome['state'])
                if outcome['state']=='complete':break
            self.assertEqual(outcomes[-1],'complete')
            self.assertIn('partial',outcomes)
            self.assertIn(targets[-1],deleted)
            self.assertEqual(len(ttl),len(outcomes))
            self.assertEqual(journal.read_bytes(),authority)
            # Neither replay phase restarts at the already absent first prefix.
            self.assertEqual(deleted.count(targets[0]),2)

    def test_restore_generation_starts_full_replay_and_same_generation_resumes(self):
        import uuid
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            targets=[str(uuid.UUID(int=index+100)) for index in range(40)]
            for index,target in enumerate(targets):
                maintenance.append(journal,request_id=str(uuid.UUID(int=index+1000)),website_id=SITE,kind='event',target_id=target)
            now=[0];seen=[];opened=[]
            def execute(sql,*,timeout):
                now[0]+=1
                if 'cutoff_age_seconds' in sql:return batch(0)
                seen.append(next(value for value in targets if value in sql))
                return '{"remaining":false}'
            generation=str(uuid.UUID(int=9000))
            self.assertEqual(maintenance.restore(journal,execute,lambda:opened.append(True),restore_id=generation,clock=lambda:now[0])['state'],'partial')
            count=len(seen)
            maintenance.restore(journal,execute,lambda:opened.append(True),restore_id=generation,clock=lambda:now[0])
            self.assertNotEqual(seen[count],targets[0])
            # An independently restored database MUST use a fresh operation ID.
            count=len(seen)
            other=str(uuid.UUID(int=9001))
            maintenance.restore(journal,execute,lambda:opened.append(True),restore_id=other,clock=lambda:now[0])
            self.assertEqual(seen[count],targets[0])
            self.assertEqual(opened,[])

    def test_checkpoint_write_failure_retries_the_acknowledged_target_and_keeps_readers_closed(self):
        import uuid
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='event',target_id=TARGET)
            real_replace=maintenance.os.replace;writes=[0];deletions=[];opened=[]
            def fail_checkpoint(source,destination):
                writes[0]+=1
                if writes[0]==2:raise OSError('controlled checkpoint failure')
                return real_replace(source,destination)
            def execute(sql,*,timeout):
                if 'cutoff_age_seconds' in sql:return batch(0)
                deletions.append(TARGET);return '{"remaining":false}'
            restore_id=str(uuid.UUID(int=9010))
            with patch.object(maintenance.os,'replace',side_effect=fail_checkpoint):
                failed=maintenance.restore(journal,execute,lambda:opened.append(True),restore_id=restore_id)
            self.assertEqual(failed['state'],'error');self.assertEqual(opened,[])
            completed=maintenance.restore(journal,execute,lambda:opened.append(True),restore_id=restore_id)
            self.assertEqual(completed['state'],'complete');self.assertEqual(opened,[True])
            self.assertEqual(len(deletions),3)

    def test_progress_rejects_rewritten_authority_prefix_before_sql_and_new_appends_are_not_skipped(self):
        import uuid
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
            for index in range(2):
                maintenance.append(journal,request_id=str(uuid.UUID(int=index+1000)),website_id=SITE,kind='event',target_id=str(uuid.UUID(int=index+100)))
            now=[0]
            def execute(sql,*,timeout):
                if 'cutoff_age_seconds' in sql:return batch(0)
                now[0]+=30;return '{"remaining":false}'
            self.assertEqual(maintenance.run(journal,execute,clock=lambda:now[0])['state'],'partial')
            maintenance.append(journal,request_id=REQUEST,website_id=SITE,kind='event',target_id=TARGET)
            seen=[]
            def remaining(sql,*,timeout):
                if 'cutoff_age_seconds' in sql:return batch(0)
                seen.append(sql);return '{"remaining":false}'
            self.assertEqual(maintenance.run(journal,remaining)['state'],'complete')
            self.assertTrue(any(TARGET in sql for sql in seen))
            authority=json.loads(journal.read_text());authority['requests'][0]['target_id']=str(uuid.UUID(int=9999))
            journal.write_text(json.dumps(authority))
            blocked=Mock()
            with self.assertRaisesRegex(ValueError,'progress_authority_changed'):maintenance.run(journal,blocked)
            blocked.assert_not_called()

    def test_cli_retries_only_partial_progress_and_reports_errors_as_failure(self):
        import contextlib
        import io
        import os
        import sys
        from unittest.mock import patch
        for state,status in (('complete',0),('partial',3),('error',1)):
            with self.subTest(state=state),patch.dict(os.environ,{'INSIDE_UMAMI_MAINTENANCE_ENABLED':'true'},clear=True), \
                    patch.object(sys,'argv',['maintenance.py','run','--journal','/unused']), \
                    patch.object(maintenance,'run',return_value={'schema':1,'state':state}),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(maintenance.main(),status)
