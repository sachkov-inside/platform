"""SOURCE-MODEL birth barrier using tiny actual owned children, no native trial."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import representative_witness as witness


class Worker(unittest.TestCase):
    def test_registration_is_durable_before_child_crosses_barrier(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            child=subprocess.Popen([sys.executable,'-I','-B','-c',
                "import sys,json,pathlib,os; assert sys.stdin.buffer.read(1)==b'1'; r=json.loads(pathlib.Path(sys.argv[1]).read_text()); assert r['pid']==os.getpid(); pathlib.Path(sys.argv[2]).write_text('registered')",
                str(root/'worker.json'),str(root/'passed')],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            try:
                self.assertFalse((root/'passed').exists())
                with patch.object(witness._native_runtime(),'process_start',return_value='123456'):
                    record=witness._register(child,root)
                self.assertEqual(set(record),{'pid','group','start_ticks'})
                self.assertEqual(record,{'pid':child.pid,'group':child.pid,'start_ticks':'123456'})
                self.assertEqual(child.wait(timeout=3),0)
                self.assertEqual((root/'passed').read_text(),'registered')
                self.assertEqual((root/'worker.json').stat().st_mode&0o777,0o600)
            finally:
                if child.poll() is None:os.killpg(child.pid,9)
                child.wait(timeout=3)
                if child.stdin:child.stdin.close()
    def test_receipt_collision_does_not_release_or_kill_unrelated_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            (root/'worker.json').write_text('foreign');(root/'worker.json').chmod(0o600)
            child=subprocess.Popen([sys.executable,'-I','-B','-c','import sys; sys.stdin.buffer.read(1)'],stdin=subprocess.PIPE,start_new_session=True)
            try:
                with patch.object(witness._native_runtime(),'process_start',return_value='123456'),self.assertRaises(FileExistsError):witness._register(child,root)
                self.assertIsNone(child.poll());self.assertEqual((root/'worker.json').read_text(),'foreign')
            finally:
                child.stdin.close();child.wait(timeout=3)


class Helper(unittest.TestCase):
    def test_actual_receipt_envelope_keeps_unknown_and_rejects_stale_or_partial_counts(self):
        import copy
        binding={'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'d'*12}
        row={'schema':1,'binding':binding,'instance':'e'*32,'pid':1,'process_start_ticks':123,'cgroup_sha256':'f'*64,
            'requests':2,'submitted_spans':3,'acknowledged_spans':3,'rejected_spans':0,'partial_responses':0,
            'partial_warnings':0,'failed_requests':0,'unknown_outcomes':0}
        value={'receipt':row,'identity':[1,2,os.getuid(),1],'process_start_ticks':123,'cgroup_sha256':'f'*64,
            'source_sha256':'1'*64,'read_start_ns':time.monotonic_ns()-1000,'read_end_ns':time.monotonic_ns()}
        self.assertEqual(witness.helper_receipt(value,binding=binding,source_sha256='1'*64),row)
        for field,changed in [('unknown_outcomes',1),('rejected_spans',1),('requests',True),('acknowledged_spans',4),('instance','changed')]:
            bad=copy.deepcopy(value);bad['receipt'][field]=changed
            with self.subTest(field=field),self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64,previous=row)
        bad=copy.deepcopy(value);del bad['receipt']['unknown_outcomes']
        with self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64)
        bad=copy.deepcopy(value);bad['receipt']['submitted_spans']=2;bad['receipt']['acknowledged_spans']=2
        with self.assertRaises(ValueError):witness.helper_receipt(bad,binding=binding,source_sha256='1'*64,previous=row)


class IsolatedEntrypoint(unittest.TestCase):
    def test_literal_worker_bootstraps_before_private_refusal(self):
        result=subprocess.run([sys.executable,'-I','-B',str(Path(witness.__file__).resolve()),'--worker','/tmp/representative-never-acquired'],capture_output=True,timeout=5)
        self.assertEqual(result.returncode,1)
        self.assertEqual(result.stdout,b'');self.assertEqual(result.stderr,b'')


class WorkerCause(unittest.TestCase):
    def coordinate(self,root,*,status=1,cleanup_error=None,cause=True):
        from types import SimpleNamespace
        source={'commit':'a'*40,'tree':'b'*40}
        bindings={'source':source,'nonce':'c'*32,'project':'inside-observability-representative-'+'d'*12}
        record={'pid':43210,'group':43210,'start_ticks':'123'}
        secret='PRIVATE_SENTINEL_NEVER_TRANSPORT_THIS'
        process=SimpleNamespace(wait=lambda **kwargs:status)
        owner=SimpleNamespace(cleanup_exact=lambda:True)
        if cleanup_error:
            def cleanup():raise cleanup_error
            owner.cleanup_exact=cleanup
        def wait(*args):
            if cause:
                admission=witness.scopes._read(root/'representative-trial.json',private=True)[0]
                witness._record_failure(root,admission,record,'corpus',ValueError(secret),runtime)
            return status
        runtime=SimpleNamespace(require_native_host=lambda:None,source=lambda profile:source,
            lifecycle=SimpleNamespace(MCP512_PROFILE='fixed',first_raw_command=lambda error:None),
            supervisor=SimpleNamespace(wait=wait,stop=lambda process:None),stop_worker=lambda record:None,
            process_start=lambda pid:'123',engine=lambda *args:SimpleNamespace())
        (root/'representative-owner').mkdir();(root/'representative-owner/resources.json').write_text('model')
        with patch.object(witness,'_native_runtime',return_value=runtime),patch.object(witness.owners,'_canonical'),\
                patch.object(witness.subprocess,'Popen',return_value=process),patch.object(witness,'_register',return_value=record),\
                patch.object(witness.owners,'_worker',return_value=record),patch.object(witness.owners.CompositeOwner,'recover',return_value=owner):
            with self.assertRaises(Exception) as caught:witness.coordinate(root,bindings,{})
        error=caught.exception
        if status!=0:
            self.assertIsInstance(error,witness.WorkerFailure)
            self.assertEqual(error.worker_status,status)
            self.assertEqual(error.cause['availability'],'available' if cause else 'unavailable')
            if cause:self.assertEqual(error.cause['stage'],'corpus');self.assertEqual(error.cause['category'],'validation')
            self.assertEqual(str(error),'representative_worker_failed')
        else:self.assertIs(error,cleanup_error)
        self.assertEqual(error.cleanup_outcomes,{'stop':'passed','recovery':'failed' if cleanup_error else 'passed','reap':'passed'})
        retained=(root/'representative-outcome.json').read_text()
        self.assertNotIn(secret,retained);self.assertNotIn('ValueError',retained)
        self.assertNotIn('cleanup-secret',retained)
    def test_semantic_worker_cause_precedes_successful_and_failed_cleanup(self):
        for failure in (None,RuntimeError('cleanup-secret')):
            with self.subTest(cleanup_failed=failure is not None),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();root.chmod(0o700)
                self.coordinate(root,cleanup_error=failure)
    def test_cleanup_error_is_primary_only_when_worker_succeeded(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            self.coordinate(root,status=0,cause=False,cleanup_error=RuntimeError('cleanup-secret'))

    def test_early_signal_and_deadline_without_record_are_explicitly_unavailable(self):
        for status in (1,-9,124):
            with self.subTest(status=status),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();root.chmod(0o700)
                self.coordinate(root,status=status,cause=False)


class CauseBinding(unittest.TestCase):
    def test_stale_forged_birth_source_and_secret_fields_are_unavailable(self):
        import copy
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            admission={'bindings':{'source':{'commit':'a'*40,'tree':'b'*40},'nonce':'c'*32,'project':'fixed'}}
            raw=witness.scopes._encoded(admission);identity=witness.scopes._write(root/'representative-trial.json',raw)
            record={'pid':43210,'group':43210,'start_ticks':'123'}
            runtime=SimpleNamespace(process_start=lambda pid:'123',lifecycle=SimpleNamespace(first_raw_command=lambda error:None))
            witness._record_failure(root,raw,record,'corpus',ValueError('secret-value'),runtime)
            path=root/'representative-failure.json';good=json.loads(path.read_bytes())
            with patch.object(witness.owners,'_worker',return_value=record):
                self.assertEqual(witness._worker_cause(root,raw,identity,record,runtime)['availability'],'available')
                for field,value in (('admission_sha256','d'*64),('nonce','d'*32),('project','stale'),
                        ('source',{'commit':'d'*40,'tree':'b'*40}),('worker',dict(record,start_ticks='124')),
                        ('stage','secret-stage'),('category','ValueError'),('reason','secret-reason'),
                        ('first_command',{'command_class':'secret-argv'}),('secret','arbitrary')):
                    changed=copy.deepcopy(good);changed[field]=value
                    path.write_bytes(witness.scopes._encoded(changed))
                    with self.subTest(field=field):self.assertEqual(witness._worker_cause(root,raw,identity,record,runtime),{'availability':'unavailable'})
                path.write_bytes(witness.scopes._encoded(good))
                runtime.process_start=lambda pid:'124'
                self.assertEqual(witness._worker_cause(root,raw,identity,record,runtime),{'availability':'unavailable'})
                runtime.process_start=lambda pid:'123'
                path.unlink();path.symlink_to(root/'representative-trial.json')
                self.assertEqual(witness._worker_cause(root,raw,identity,record,runtime),{'availability':'unavailable'})

    def test_real_worker_process_transports_only_closed_first_command_context(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();root.chmod(0o700)
            raw=witness.scopes._encoded({'bindings':{'source':{'commit':'a'*40,'tree':'b'*40},'nonce':'c'*32,'project':'fixed'}})
            identity=witness.scopes._write(root/'representative-trial.json',raw)
            code=r'''import importlib.util,sys,os,types
from pathlib import Path
p=Path(WITNESS);spec=importlib.util.spec_from_file_location('private_witness',p)
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
root=Path(sys.argv[1]);record={'pid':os.getpid(),'group':os.getpgrp(),'start_ticks':'123'}
w.scopes._write(root/'worker.json',w.scopes._encoded(record))
raw=w.scopes._read(root/'representative-trial.json',private=True)[0]
context={'command_class':'disk_exec','timeout_seconds':1,'elapsed_seconds':.5,'native_exit':1,'alive_before_reap':False,'disk_helper_stage':'imports_complete'}
runtime=types.SimpleNamespace(lifecycle=types.SimpleNamespace(first_raw_command=lambda error:context))
try:raise ValueError('SECRET_ARGV_KEY_TELEMETRY_LOCALS')
except BaseException as error:w._record_failure(root,raw,record,'corpus',error,runtime)
sys.exit(1)
'''.replace('WITNESS',repr(str(Path(witness.__file__).resolve())))
            child=subprocess.Popen([sys.executable,'-I','-B','-c',code,str(root)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            out,err=child.communicate(timeout=5)
            self.assertEqual(child.returncode,1);self.assertEqual(out,b'');self.assertEqual(err,b'')
            record=witness.owners._worker(root)
            runtime=SimpleNamespace(process_start=lambda pid:'123')
            cause=witness._worker_cause(root,raw,identity,record,runtime)
            self.assertEqual(cause['availability'],'available');self.assertEqual(cause['category'],'command')
            self.assertEqual(cause['first_command']['disk_helper_stage'],'imports_complete')
            retained=(root/'representative-failure.json').read_text()
            self.assertNotIn('SECRET',retained);self.assertNotIn('ValueError',retained)
            self.assertEqual((root/'representative-failure.json').stat().st_mode&0o777,0o600)

    def test_worker_keeps_semantic_exception_identity_and_traceback_when_record_write_fails(self):
        import io
        from types import SimpleNamespace
        for write_fails in (False,True):
            with self.subTest(write_fails=write_fails),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();root.chmod(0o700)
                record={'pid':os.getpid(),'group':os.getpid(),'start_ticks':'123'}
                admission={'schema':1,'bindings':{'source':{'commit':'a'*40,'tree':'b'*40},'nonce':'c'*32,'project':'fixed'},
                    'images':{},'source':{},'deadline_mono_ns':int((time.monotonic()+50)*10**9)}
                witness.scopes._write(root/'representative-trial.json',witness.scopes._encoded(admission))
                runtime=SimpleNamespace(require_native_host=lambda:None,process_start=lambda pid:'123',verify_source=lambda *args:None,
                    engine=lambda *args:SimpleNamespace(),lifecycle=SimpleNamespace(MCP512_PROFILE='fixed',first_raw_command=lambda error:None))
                owner=SimpleNamespace(create=lambda:None,prepare_native_session=lambda observed:None,helper_receipt=lambda:{})
                original=ValueError('PRIVATE_SEMANTIC_SENTINEL')
                def semantic_failure(*args):raise original
                write=witness.scopes._write
                def capture(path,raw):
                    if write_fails and path.name=='representative-failure.json':raise RuntimeError('PRIVATE_DIAGNOSTIC_SENTINEL')
                    return write(path,raw)
                with patch.object(witness,'_native_runtime',return_value=runtime),patch.object(witness.sys,'stdin',SimpleNamespace(buffer=io.BytesIO(b'1'))),\
                    patch.object(witness.owners,'_worker',return_value=record),patch.object(witness.os,'getpgrp',return_value=os.getpid()),\
                    patch.object(witness.owners.CompositeOwner,'prepare',return_value=owner),patch.object(witness,'_startup'),\
                    patch.object(witness,'_emit_sdk',return_value=({},{})),patch.object(witness,'helper_receipt',return_value={}),\
                    patch.object(witness,'_parallel_corpus',side_effect=semantic_failure),patch.object(witness.scopes,'_write',side_effect=capture):
                    try:witness._worker(root)
                    except BaseException as error:
                        self.assertIs(error,original)
                        import traceback
                        self.assertIn('semantic_failure',[frame.name for frame in traceback.extract_tb(error.__traceback__)])
                    else:self.fail('semantic worker failure was lost')
                if not write_fails:
                    cause=json.loads((root/'representative-failure.json').read_bytes())
                    self.assertEqual(cause['stage'],'corpus');self.assertEqual(cause['category'],'validation')
                    self.assertNotIn('PRIVATE',(root/'representative-failure.json').read_text())


class IsolatedSourceClosure(unittest.TestCase):
    def test_committed_fixed_bootstrap_imports_without_directory_authority_and_refuses_tampering(self):
        import shutil
        closure=('core_layout','representative_scope','representative_owner','representative_reader',
            'representative_agent','representative_stored','signoz_queries','signoz_ingestion','fullstack','extra',
            'telegram','storage','stage_timing','source_guard','contact_job','stability','cpu_control',
            'slot_refusal','startup_refusal','health_timing','acceptance')
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();scripts=root/'scripts/observability-fullstack';scripts.mkdir(parents=True)
            for name in (*closure,'representative_witness'):
                shutil.copyfile(Path(witness.__file__).with_name(name+'.py'),scripts/(name+'.py'))
            def git(*args):return subprocess.run(['git',*args],cwd=root,check=True,capture_output=True,text=True).stdout.strip()
            git('init','-q');git('add','scripts')
            git('-c','user.name=Source Model','-c','user.email=model@invalid','-c','commit.gpgsign=false','commit','-qm','Fixture source')
            source={'commit':git('rev-parse','HEAD'),'tree':git('rev-parse','HEAD^{tree}')}
            prepared=root/'prepared';prepared.mkdir(mode=0o700)
            witness.scopes._write(prepared/'representative-trial.json',witness.scopes._encoded({'source':source}))
            (scripts/'unauthorized_sibling.py').write_text("raise RuntimeError('ambient_import_must_not_run')")
            code=r'''import importlib.util,sys
from pathlib import Path
p=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('isolated_witness',p)
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
w._controller_modules(Path(sys.argv[2]))
import representative_agent
assert Path(representative_agent.__file__).parent==p.parent
assert str(p.parent) not in sys.path
try:import unauthorized_sibling
except ModuleNotFoundError:pass
else:raise AssertionError('ambient module imported')
print('fixed_source_loaded')
'''
            argv=[sys.executable,'-I','-B','-c',code,str(scripts/'representative_witness.py'),str(prepared)]
            result=subprocess.run(argv,capture_output=True,text=True,timeout=8)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'fixed_source_loaded')
            # Tampering any fixed sibling is refused before owner/agent imports.
            (scripts/'representative_agent.py').write_text("raise RuntimeError('tampered_agent_ran')")
            result=subprocess.run(argv,capture_output=True,text=True,timeout=8)
            self.assertNotEqual(result.returncode,0);self.assertNotIn('tampered_agent_ran',result.stderr)
            self.assertIn('representative_bootstrap_source',result.stderr)
