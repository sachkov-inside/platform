"""Owned benign processes expose the first monitor command, never private argv."""
import json
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
if mode=='disk':(r/'blocked').touch();time.sleep(30)
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
                    self.assertTrue(monitor['monitor_reaped']);self.assertFalse(engine.child)
                    self.assertNotIn('private-',json.dumps(public));self.assertFalse(public['passed'])
                finally:
                    signal.signal(signal.SIGUSR1,previous);engine.cancel_children()

    def test_unknown_private_argv_and_nonraw_exception_have_distinct_availability(self):
        for mode in ('raw','nonraw'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine=benign_engine(root);notified=threading.Event();calls=0
                initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
                private='private-key-email-URL'
                def host(*_args):
                    nonlocal calls
                    calls+=1
                    if calls==1:return initial
                    if mode=='raw':engine.raw(['-c','raise SystemExit(7) # '+private],timeout=.2)
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
                    if mode=='raw':
                        self.assertTrue(inner['available']);self.assertEqual(inner['command_class'],'unknown')
                        self.assertEqual(inner['native_exit'],7);self.assertFalse(inner['alive_before_reap'])
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
