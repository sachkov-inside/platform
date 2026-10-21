"""New PG evidence owns only closed source records; no shared phase writer."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import record


class Records(unittest.TestCase):
    def value(self):return record.report('a'*40)

    def test_owned_atomic_record_roundtrip_and_present_invalid_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();value=self.value();record.write(root,value)
            self.assertEqual(record.read(root,'a'*40),value)
            (root/record.NAME).write_text('{"schema":1,"schema":1}')
            with self.assertRaises(ValueError):record.read(root,'a'*40)
            (root/record.NAME).unlink();(root/record.NAME).symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):record.read(root,'a'*40)

    def test_foreign_recreated_temporary_is_never_removed_on_writer_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();actual_replace=os.replace
            def replace(*args,**kwargs):
                (root/record.TEMPORARY).unlink();(root/record.TEMPORARY).write_text('foreign-owned-test-file')
                raise OSError('controlled refusal')
            with patch.object(record.os,'replace',side_effect=replace),self.assertRaises(ValueError):record.write(root,self.value())
            self.assertEqual((root/record.TEMPORARY).read_text(),'foreign-owned-test-file')

    def test_complete_receipt_is_required_before_public_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();p=root/'source.json'
            value={'checkout_sha':'a'*40,'checkout_tree':'b'*40,'provider_execution_sha':'a'*40,
                'repository':None,'run_id':None,'run_attempt':None,'event':None,'provider_pr_head_sha':None,
                'provider_pr_base_sha':None,'inputs':{},'scope':record.SCOPE}
            p.write_text(json.dumps(value));p.chmod(0o600)
            self.assertEqual(record.receipt(root),'a'*40)
            value['provider_execution_sha']=None;p.write_text(json.dumps(value))
            with self.assertRaises(ValueError):record.receipt(root)

    def test_passed_artifact_cannot_project_unhealthy_or_incomplete_phase_verdicts(self):
        import copy
        value=self.value();value.update(state='passed',phase='complete')
        value['cases']=[{'phase':phase,'freshness':'fresh','continuity':continuity,'count_complete':complete,'points':7,'age_seconds':0}
            for phase,continuity,complete in (('baseline','same_epoch',True),('connections','same_epoch',True),
                ('locks','same_epoch',True),('deadlocks','same_epoch',True),('reset','statistics_reset',False),
                ('restart','server_restart',False),('stale','same_epoch',True),('privacy','same_epoch',True))]
        self.assertEqual(record.validate(value,'a'*40),value)
        for index in range(8):
            for key,replacement in (('freshness','malformed'),('points',0),('age_seconds',None),('continuity','unknown')):
                bad=copy.deepcopy(value);bad['cases'][index][key]=replacement
                with self.subTest(index=index,key=key),self.assertRaises(ValueError):record.validate(bad,'a'*40)
        bad=copy.deepcopy(value);bad['cases'][4]['count_complete']=True
        with self.assertRaises(ValueError):record.validate(bad,'a'*40)

    def test_directory_close_fault_attempts_every_acquired_fd_and_preserves_active_primary(self):
        for fault in (OSError('controlled cleanup'),KeyboardInterrupt()):
            with self.subTest(kind=type(fault).__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();acquired=[];closed=[];original_open=os.open;original_close=os.close
                primary=RuntimeError('controlled first');saved=[]
                def opened(*args,**kwargs):
                    fd=original_open(*args,**kwargs);acquired.append(fd);return fd
                def closing(fd):
                    closed.append(fd);original_close(fd)
                    if len(closed)==1:raise fault
                def body():
                    try:raise primary
                    except RuntimeError:saved.append(primary.__traceback__);raise
                with patch.object(record.os,'open',side_effect=opened),patch.object(record.os,'close',side_effect=closing):
                    try:
                        with record.directory(root):body()
                    except RuntimeError as error:caught=error
                    else:self.fail('primary missing')
                self.assertIs(caught,primary)
                self.assertEqual(closed,list(reversed(acquired)))
                # The initial body traceback remains reachable without the cleanup callback entering it.
                trace=primary.__traceback__;names=[];frames=[]
                while trace is not None:frames.append(trace);names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                self.assertTrue(any(trace is saved[0] for trace in frames))
                self.assertNotIn('closing',names)

    def test_directory_cleanup_fault_without_primary_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            real=os.close;calls=[]
            def close(fd):
                calls.append(fd);real(fd)
                if len(calls)==1:raise OSError('controlled cleanup')
            with patch.object(record.os,'close',side_effect=close),self.assertRaises(ValueError):
                with record.directory(Path(directory).resolve()):pass
            self.assertGreater(len(calls),1)

    def test_fifteen_baseline_top_level_stages_roundtrip_without_broadening_cases(self):
        stages=('baseline_actor_start','baseline_setup',
            'baseline_first_acquire','baseline_first_upload','baseline_first_stored_read','baseline_first_stored_oracle','baseline_first_stored_pending','baseline_first_ledger',
            'baseline_second_acquire','baseline_second_upload','baseline_second_stored_read','baseline_second_stored_oracle','baseline_second_stored_pending','baseline_second_ledger',
            'baseline_waiting_locks')
        original=('acquisition','baseline','connections','locks','deadlocks','reset','restart','stale','privacy','cleanup','complete')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            for state in ('failed','incomplete'):
                for stage in stages:
                    value=self.value();value.update(state=state,phase=stage,reason='query_refused' if state=='failed' else 'none')
                    record.write(root,value)
                    self.assertEqual(record.read(root,'a'*40),value)
                    self.assertEqual(set(value),{'schema','scope','source','state','phase','reason','cases','duration_seconds'})
                    bad={**value,'cases':[{'phase':stage,'freshness':'fresh','continuity':'same_epoch','count_complete':True,'points':7,'age_seconds':0}]}
                    with self.assertRaises(ValueError):record.validate(bad,'a'*40)
                    with self.assertRaises(ValueError):record.validate({**value,'state':'passed'},'a'*40)
            for phase in original:
                value=self.value();value['cases']=[{'phase':phase,'freshness':'fresh','continuity':'same_epoch','count_complete':True,'points':7,'age_seconds':0}]
                self.assertEqual(record.validate(value,'a'*40),value)
            value=self.value();value.update(state='passed',phase='complete')
            value['cases']=[{'phase':phase,'freshness':'fresh','continuity':continuity,'count_complete':complete,'points':7,'age_seconds':0}
                for phase,continuity,complete in (('baseline','same_epoch',True),('connections','same_epoch',True),
                    ('locks','same_epoch',True),('deadlocks','same_epoch',True),('reset','statistics_reset',False),
                    ('restart','server_restart',False),('stale','same_epoch',True),('privacy','same_epoch',True))]
            record.write(root,value);self.assertEqual(record.read(root,'a'*40),value)

    def test_baseline_stage_receipt_contamination_refuses_before_public_creation(self):
        import postgres_source
        from test_public import AdmissionComposition
        controls=('unknown','type','BOM','duplicate','nonfinite','source','cap','extra','case','receipt')
        for control in ('valid',*controls):
            with self.subTest(control=control),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);metadata=root/'metadata';public=root/'public'
                value=self.value();value.update(state='failed',phase='baseline_first_acquire',reason='query_refused')
                with AdmissionComposition().external_reads(root):
                    self.assertEqual(postgres_source.admission(metadata),0);record.write(output,value)
                    raw=json.dumps(value).encode()
                    if control=='unknown':raw=json.dumps({**value,'phase':'baseline_third_acquire'}).encode()
                    elif control=='type':raw=json.dumps({**value,'phase':[]}).encode()
                    elif control=='BOM':raw=b'\xef\xbb\xbf'+raw
                    elif control=='duplicate':raw=raw[:-1]+b',"phase":"baseline_first_acquire"}'
                    elif control=='nonfinite':raw=json.dumps({**value,'duration_seconds':float('nan')}).encode()
                    elif control=='source':raw=json.dumps({**value,'source':'b'*40}).encode()
                    elif control=='cap':raw=b' '*4097
                    elif control=='extra':raw=json.dumps({**value,'private_stage':'not-allowed'}).encode()
                    elif control=='case':raw=json.dumps({**value,'cases':[{'phase':'baseline_actor_start','freshness':'fresh','continuity':'same_epoch','count_complete':True,'points':7,'age_seconds':0}]}).encode()
                    elif control=='receipt':
                        source=metadata/'source.json';receipt=json.loads(source.read_text());receipt['provider_execution_sha']=None;source.write_text(json.dumps(receipt))
                    (output/record.NAME).write_bytes(raw)
                    if control=='valid':
                        postgres_source.collect(output,metadata,public);self.assertEqual(record.read(public,'a'*40),value)
                    else:
                        with self.assertRaises(ValueError):postgres_source.collect(output,metadata,public)
                        self.assertFalse(public.exists())
