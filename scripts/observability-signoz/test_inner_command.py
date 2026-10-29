"""Owned benign processes expose the first monitor command, never private argv."""
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

import evidence
import lifecycle
from test_lifecycle import benign_engine
from test_oci_admission import fixture, Native, container_fixture


class FirstInnerCommand(unittest.TestCase):
    def test_actual_disk_helper_finishes_real_filesystem_calls_and_preserves_seven_stdout_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=root/'owned-cli';inside=Path(lifecycle.__file__).with_name('inside.py')
            # This owned CLI adapter maps only the fixture's fixed mount to an
            # actual temporary filesystem. All stat calls and helper bytes are real.
            helper.write_text('#!'+sys.executable+'\n'+'''import os,runpy,sys
from pathlib import Path
root=Path(__file__).parent;native_stat=os.stat;native_statvfs=os.statvfs
def mounted_stat(path,*args,**kwargs):return native_stat(root if path=='/disk' else path,*args,**kwargs)
def mounted_statvfs(path):return native_statvfs(root if path=='/disk' else path)
os.stat=mounted_stat;os.statvfs=mounted_statvfs
sys.argv=['inside.py','disk']
runpy.run_path('''+repr(str(inside))+''',run_name='__main__')
# Inject a native CLI failure only after successful helper dispatch so Engine.raw
# retains both the actual seven-field stdout and the helper's stderr milestones.
raise SystemExit(7)
''');helper.chmod(0o700)
            engine=benign_engine(root);engine.invocation=helper;engine.cli=helper.resolve()
            native=helper.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli))
            engine.anon=root;engine.endpoint='private-endpoint'
            try:
                with self.assertRaises(lifecycle.Refusal) as caught:
                    engine.raw(['--config',str(root),'--host',engine.endpoint,'exec','private-CID','python','/driver/inside.py','disk'],timeout=3)
                self.assertEqual(caught.exception.reason,'command_failed')
                context=lifecycle.first_raw_command(caught.exception)
                self.assertEqual(context['native_exit'],7);self.assertFalse(context['alive_before_reap'])
                self.assertEqual(context['disk_helper_stage'],'syscalls_complete')
                result=json.loads((root/'failure-1-stdout.private').read_text())
                self.assertEqual(set(result),{'fsid','device','block','blocks','available','files','free_files'})
                self.assertTrue(all(type(value) is int for value in result.values()))
                self.assertEqual(result['device'],root.stat().st_dev)
                self.assertEqual(result['block'],os.statvfs(root).f_frsize)
                self.assertFalse(engine.child)
            finally:engine.cancel_children()

    def test_owned_disk_timeout_keeps_helper_stage_on_original_exception_after_reap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=root/'owned-cli'
            helper.write_text('#!'+sys.executable+'\n'+'''import sys,time
from pathlib import Path
sys.stderr.write('signoz-disk-stage-v1:entered\\n');sys.stderr.flush()
sys.stderr.write('signoz-disk-stage-v1:imports_complete\\n');sys.stderr.flush()
(Path(__file__).parent/'blocked').touch()
time.sleep(30)
''');helper.chmod(0o700)
            engine=benign_engine(root);engine.invocation=helper;engine.cli=helper.resolve()
            native=helper.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli))
            engine.anon=root;engine.endpoint='private-endpoint';engine.deadline=time.monotonic()+60
            real_clock=time.monotonic
            def clock():return real_clock()+(20 if (root/'blocked').exists() else 0)
            try:
                with patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=clock)):
                    with self.assertRaises(lifecycle.Refusal) as caught:
                        engine.raw(['--config',str(root),'--host',engine.endpoint,'exec','private-CID','python','/driver/inside.py','disk'],timeout=3)
                original=caught.exception
                self.assertEqual(original.reason,'command_deadline')
                self.assertFalse(engine.child)
                context=lifecycle.first_raw_command(original)
                self.assertEqual(context['disk_helper_stage'],'imports_complete')
                self.assertEqual(context['command_class'],'disk_exec')
                self.assertIsNone(context['native_exit']);self.assertTrue(context['alive_before_reap'])
                self.assertEqual(context['timeout_seconds'],3)
                with self.assertRaises(lifecycle.Refusal):engine.raw(['private-argv'],timeout=.2)
                self.assertEqual(lifecycle.first_raw_command(original),context)
                public=evidence.inner_command(context)
                self.assertTrue(public['available']);self.assertEqual(public['disk_helper_stage'],'imports_complete')
                self.assertNotIn('private-',json.dumps(public))
            finally:engine.cancel_children()

    def test_owned_raw_accepts_only_complete_ordered_disk_markers(self):
        entered=b'signoz-disk-stage-v1:entered\n'
        imported=b'signoz-disk-stage-v1:imports_complete\n'
        finished=b'signoz-disk-stage-v1:syscalls_complete\n'
        cases=((b'','unknown'),(entered,'entered'),(entered+imported,'imports_complete'),
               (entered+imported+finished,'syscalls_complete'),(entered[:-1],'unknown'),
               (imported+entered,'unknown'),(entered+entered,'unknown'),
               (entered+b'private-email-key-URL\n','unknown'),(entered+b'x'*129,'unknown'))
        for payload,expected in cases:
            with self.subTest(expected=expected,payload_size=len(payload)),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);helper=root/'owned-cli'
                helper.write_text('#!'+sys.executable+'\nimport sys\nsys.stderr.buffer.write('+repr(payload)+');sys.stderr.flush()\nraise SystemExit(7)\n');helper.chmod(0o700)
                engine=benign_engine(root);engine.invocation=helper;engine.cli=helper.resolve()
                native=helper.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli))
                engine.anon=root;engine.endpoint='private-endpoint'
                try:
                    with self.assertRaises(lifecycle.Refusal) as caught:
                        engine.raw(['--config',str(root),'--host',engine.endpoint,'exec','private-CID','python','/driver/inside.py','disk'],timeout=3)
                    self.assertEqual(caught.exception.reason,'command_failed')
                    public=evidence.inner_command(lifecycle.first_raw_command(caught.exception))
                    self.assertEqual(public['disk_helper_stage'],expected)
                    self.assertEqual(public['native_exit'],7);self.assertFalse(engine.child)
                    self.assertNotIn('private-',json.dumps(public));self.assertNotIn('signoz-disk-stage',json.dumps(public))
                    with self.assertRaises(lifecycle.Refusal) as unrelated:
                        engine.raw(['private-unrelated-command'],timeout=3)
                    other=evidence.inner_command(lifecycle.first_raw_command(unrelated.exception))
                    self.assertTrue(other['available']);self.assertNotIn('disk_helper_stage',other)
                finally:engine.cancel_children()

    def test_incomplete_stderr_pipe_after_owned_reap_cannot_establish_disk_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=root/'owned-cli'
            helper.write_text('#!'+sys.executable+'\n'+'''import sys,time
from pathlib import Path
sys.stderr.write('signoz-disk-stage-v1:entered\\n');sys.stderr.flush()
(Path(__file__).parent/'blocked').touch()
time.sleep(30)
''');helper.chmod(0o700)
            engine=benign_engine(root);engine.invocation=helper;engine.cli=helper.resolve()
            native=helper.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli))
            engine.anon=root;engine.endpoint='private-endpoint';engine.deadline=time.monotonic()+60
            native_popen=lifecycle.subprocess.Popen;held=[];real_clock=time.monotonic
            def clock():return real_clock()+(20 if (root/'blocked').exists() else 0)
            def incomplete_pipe(*args,**kwargs):
                read,write=os.pipe();held.append(write)
                try:
                    kwargs['stderr']=write;proc=native_popen(*args,**kwargs)
                    proc.stderr=os.fdopen(read,'rb');return proc
                except BaseException:os.close(read);raise
            try:
                with patch.object(lifecycle.subprocess,'Popen',incomplete_pipe),patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=clock)):
                    with self.assertRaises(lifecycle.Refusal) as caught:
                        engine.raw(['--config',str(root),'--host',engine.endpoint,'exec','private-CID','python','/driver/inside.py','disk'],timeout=3)
                self.assertEqual(caught.exception.reason,'command_deadline')
                context=evidence.inner_command(lifecycle.first_raw_command(caught.exception))
                self.assertEqual(context['disk_helper_stage'],'unknown')
                self.assertTrue(context['alive_before_reap']);self.assertIsNone(context['native_exit'])
                self.assertFalse(engine.child)
            finally:
                for descriptor in held:os.close(descriptor)
                engine.cancel_children()

    def test_real_preflight_and_final_exec_keep_distinct_first_command_after_later_failure(self):
        for mode,command,timeout in [('preflight','daemon_info',10),('disk','disk_exec',3)]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);lock,row,image=fixture();native=Native(image)
                own,container=container_fixture(native,row,image,root)
                (root/'container.json').write_text(json.dumps(container));(root/'mode').write_text('valid')
                (root/'driver').mkdir();(root/'driver/inside.py').write_text('# controlled helper input\n')
                helper=root/'helper'
                helper.write_text('#!'+sys.executable+'\n'+'''import json,sys,time
from pathlib import Path
r=Path(__file__).parent;args=sys.argv[1:];mode=(r/'mode').read_text()
if args[:1]==['--context']:
 if mode=='preflight':(r/'blocked').touch();time.sleep(30)
 print('identity');raise SystemExit
if args[:1]!=['--config']:raise SystemExit(7)
args=args[4:]
if args[0]=='inspect':print(json.dumps([json.loads((r/'container.json').read_text())]));raise SystemExit
if mode=='disk':
 sys.stderr.write('signoz-disk-stage-v1:entered\\nsignoz-disk-stage-v1:imports_complete\\n');sys.stderr.flush()
 (r/'blocked').touch();time.sleep(30)
print(json.dumps(dict(fsid=1,device=2,block=4096,blocks=25000000,available=23000000,files=0,free_files=0)))
''');helper.chmod(0o700)
                engine=benign_engine(root);engine.deadline=time.monotonic()+60
                engine.invocation=helper;engine.cli=helper.resolve();st=helper.lstat()
                engine.invocation_identity=(st.st_dev,st.st_ino,st.st_mode,str(engine.cli));engine.cli_hash=lifecycle.digest(helper)
                engine.identity={'daemon_id':'fixture'};engine.endpoint='fixture';engine.anon=root;engine.image_proofs=native.image_proofs
                def identify():
                    engine.raw(['--context','private-context','info','--format','{{json .}}'],timeout=10)
                    return engine.identity
                engine.identify=identify;own.engine=engine
                initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
                notified=threading.Event();previous=signal.signal(signal.SIGUSR1,lambda *_args:notified.set())
                real_clock=time.monotonic
                def clock():
                    return real_clock()+(20 if threading.current_thread().name=='owned-signoz-storage' and (root/'blocked').exists() else 0)
                primary=RuntimeError('private body failure')
                try:
                    with patch.object(lifecycle,'host_snapshot',return_value=initial),patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=clock)):
                        with self.assertRaises(RuntimeError) as caught:
                            with lifecycle.storage_guard(engine,own,root) as admit:
                                admit();(root/'mode').write_text(mode)
                                self.assertTrue(notified.wait(4),'monitor did not retain its failure')
                                # This later raw failure overwrites failure.json, not the
                                # context attached to the original monitor exception.
                                with self.assertRaises(lifecycle.Refusal):engine.raw(['private-key-DSN-URL'])
                                self.assertEqual(json.loads((root/'failure.json').read_text())['reason'],'command_failed')
                                raise primary
                    self.assertIs(caught.exception,primary)
                    self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                    public=json.loads((root/'public/witness.json').read_text());monitor=public['storage_monitor']
                    self.assertEqual(monitor['first_failure'],{'stage':'vm_sample','reason':'command_deadline'})
                    inner=monitor.get('first_inner_command',{'available':False})
                    self.assertTrue(inner['available'],'first raw command is lost at publication')
                    self.assertEqual(inner['command_class'],command);self.assertEqual(inner['timeout_seconds'],timeout)
                    self.assertGreaterEqual(inner['elapsed_seconds'],20)
                    self.assertIsNone(inner['native_exit']);self.assertTrue(inner['alive_before_reap'])
                    if mode=='disk':self.assertEqual(inner['disk_helper_stage'],'imports_complete')
                    else:self.assertNotIn('disk_helper_stage',inner)
                    self.assertTrue(monitor['monitor_reaped']);self.assertFalse(engine.child)
                    self.assertNotIn('private-',json.dumps(public));self.assertFalse(public['passed'])
                finally:
                    signal.signal(signal.SIGUSR1,previous);engine.cancel_children()

    def test_unknown_private_argv_and_nonraw_exception_have_distinct_availability(self):
        for mode in ('raw','raw_exit_between_polls','nonraw'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine=benign_engine(root);notified=threading.Event();calls=0
                initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
                private='private-key-email-URL'
                def host(*_args):
                    nonlocal calls
                    calls+=1
                    if calls==1:return initial
                    if mode=='raw':engine.raw(['-c','raise SystemExit(7) # '+private],timeout=.2)
                    if mode=='raw_exit_between_polls':
                        popen=lifecycle.subprocess.Popen
                        def native_process(*args,**kwargs):
                            proc=popen(*args,**kwargs);poll=proc.poll;observed=False
                            def exits_after_snapshot():
                                nonlocal observed
                                code=poll()
                                if not observed:
                                    observed=True;self.assertIsNone(code)
                                    # Actual owned child exits after the first observation.
                                    os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=1)
                                return code
                            proc.poll=exits_after_snapshot;return proc
                        with patch.object(lifecycle.subprocess,'Popen',native_process):
                            engine.raw(['-c','import time;time.sleep(30) # '+private],timeout=.2)
                    error=RuntimeError(private)
                    error._signoz_raw_failure=(object(),{'command_class':'daemon_info'})
                    raise error
                previous=signal.signal(signal.SIGUSR1,lambda *_args:notified.set())
                try:
                    with patch.object(lifecycle,'host_snapshot',side_effect=host):
                        with self.assertRaises(lifecycle.Refusal) as caught:
                            with lifecycle.storage_guard(engine,object(),root):
                                self.assertTrue(notified.wait(3))
                    self.assertEqual(str(caught.exception),'storage_monitor_failed')
                    self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                    public=json.loads((root/'public/witness.json').read_text())
                    inner=public['storage_monitor']['first_inner_command']
                    if mode.startswith('raw'):
                        self.assertTrue(inner['available']);self.assertEqual(inner['command_class'],'unknown')
                        self.assertEqual(inner['native_exit'],7 if mode=='raw' else None)
                        self.assertEqual(inner['alive_before_reap'],mode!='raw')
                        self.assertEqual(inner['timeout_seconds'],.2)
                    else:self.assertEqual(inner,{'available':False})
                    self.assertNotIn(private,json.dumps(public));self.assertFalse(public['passed']);self.assertFalse(engine.child)
                finally:signal.signal(signal.SIGUSR1,previous);engine.cancel_children()


    def test_actual_raw_uses_global_capped_timeout_in_public_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=benign_engine(root);engine.deadline=1000.5
            notified=threading.Event();calls=0
            initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
            def host(*_args):
                nonlocal calls
                calls+=1
                if calls==1:return initial
                engine.raw(['-c','from pathlib import Path;import time;Path('+repr(str(root/'blocked'))+').touch();time.sleep(30)'],timeout=10)
            def clock():return 1002. if (root/'blocked').exists() else 1000.
            previous=signal.signal(signal.SIGUSR1,lambda *_args:notified.set())
            try:
                with patch.object(lifecycle,'host_snapshot',side_effect=host),patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=clock)):
                    with self.assertRaises(lifecycle.Refusal):
                        with lifecycle.storage_guard(engine,object(),root):self.assertTrue(notified.wait(3))
                self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                inner=json.loads((root/'public/witness.json').read_text())['storage_monitor']['first_inner_command']
                self.assertEqual(inner['timeout_seconds'],.5);self.assertEqual(inner['elapsed_seconds'],2.)
                self.assertFalse(engine.child)
            finally:signal.signal(signal.SIGUSR1,previous);engine.cancel_children()

    def test_owned_early_cancel_reaps_process_without_publishing_monitor_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=benign_engine(root);entered=threading.Event();unexpected=threading.Event();calls=0
            initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
            real_selector=lifecycle.selectors.DefaultSelector
            class Selector:
                def __init__(self):self.inner=real_selector()
                def register(self,*args):return self.inner.register(*args)
                def unregister(self,*args):return self.inner.unregister(*args)
                def get_map(self):return self.inner.get_map()
                def close(self):self.inner.close()
                def select(self,*args):entered.set();return self.inner.select(*args)
            def host(*_args):
                nonlocal calls
                calls+=1
                if calls>1:engine.raw(['-c','import time;time.sleep(30)'],timeout=3)
                return initial
            previous=signal.signal(signal.SIGUSR1,lambda *_args:unexpected.set())
            try:
                with patch.object(lifecycle,'host_snapshot',side_effect=host),patch.object(lifecycle.selectors,'DefaultSelector',Selector):
                    with lifecycle.storage_guard(engine,object(),root):self.assertTrue(entered.wait(3))
                self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                monitor=json.loads((root/'public/witness.json').read_text())['storage_monitor']
                self.assertFalse(monitor['failed']);self.assertIsNone(monitor['first_failure'])
                self.assertEqual(monitor['first_inner_command'],{'available':False})
                self.assertTrue(monitor['monitor_reaped']);self.assertFalse(engine.child);self.assertFalse(unexpected.is_set())
            finally:signal.signal(signal.SIGUSR1,previous);engine.cancel_children()


if __name__=='__main__':unittest.main()
