"""The actual guard retains its body failure while owning a bounded native monitor."""
import json
from pathlib import Path
import signal
import tempfile
import threading
import time
import traceback
import unittest
from unittest.mock import patch

import evidence
import lifecycle
from test_lifecycle import benign_engine


class StorageMonitor(unittest.TestCase):
    def test_body_failure_identity_survives_actual_native_monitor_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=benign_engine(root);notified=threading.Event();calls=0
            initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
            def host(_engine,_run):
                nonlocal calls
                calls+=1
                if calls==1:return initial
                engine.raw(['-c','raise SystemExit(7)'])
                raise AssertionError('unreachable')
            previous=signal.signal(signal.SIGUSR1,lambda *_args:notified.set())
            primary=RuntimeError('owned primary fixture')
            try:
                with patch.object(lifecycle,'host_snapshot',host):
                    caught=None;frames=[]
                    try:
                        with lifecycle.storage_guard(engine,object(),root):
                            self.assertTrue(notified.wait(2),'native monitor did not notify')
                            raise primary
                    except BaseException as error:
                        caught=error;frames=traceback.extract_tb(error.__traceback__)
                self.assertIs(caught,primary)
                self.assertEqual(frames[-1].name,'test_body_failure_identity_survives_actual_native_monitor_failure')
                self.assertNotIn('finish',[frame.name for frame in frames])
                self.assertTrue(json.loads((root/'disk-last.json').read_text())['monitor_failed'])
                self.assertEqual(calls,2)
                self.assertEqual(len(json.loads((root/'disk-last.json').read_text())['failure']),1)
                self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                public=json.loads((root/'public/witness.json').read_text())
                self.assertEqual(public['storage_monitor']['first_failure'],
                    {'stage':'host_snapshot','reason':'command_failed'})
                self.assertTrue(public['storage_monitor']['monitor_reaped'])
                self.assertFalse(engine.child)
                self.assertFalse(any(t.name=='owned-signoz-storage' for t in threading.enumerate()))
            finally:
                signal.signal(signal.SIGUSR1,previous)
                engine.cancel_children()


class WorkerEvidence(unittest.TestCase):
    def test_validated_roles_are_durable_before_functional_failure(self):
        # Only native setup is controlled. The real worker, guard, private files
        # and closed collector form the behavior boundary under test.
        import os
        import sys
        import time
        before=sys.path.copy()
        try:import runtime
        finally:sys.path[:]=before
        for mode in ('functional_failure','monitor_signal','validation_failure','agent_start_failure'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);private=root/'private';private.mkdir(mode=0o700)
                (private/'private').mkdir();(private/'driver').mkdir();(private/'driver/inside.py').write_text('# controlled driver fixture\n')
                engine=benign_engine(private);engine.identity={'daemon_id':'fixture'};validated=[];functional_started=threading.Event();events=[];test=self
                lock=lifecycle.verify_packet();pins={r['repository'].split('/')[-1]:r for r in lock['images']}
                images={}
                for role,name in lifecycle.ROLE_IMAGES.items():
                    pin=pins[name];config=lock['image_config_metadata'][pin['repository']]['amd64']['config_digest']
                    images[role]={'reference':pin['pinned'],'runtime_reference':lifecycle.image_proof.runtime_reference(pin),
                        'config_digest':config,'relation':'config_id','image_descriptor_available':False,
                        'architecture':'amd64','child_manifest':pin['linux_amd64_manifest'],'image_id':config,'selected_image_id':config}
                class Owned:
                    def __init__(self,*_args,**_kwargs):self.containers={role:'c'*64 for role in lifecycle.SERVICES};self.images={}
                    def compose(self,*_args):pass
                    def discover(self):pass
                    def record(self):events.append('registered')
                    def record_profile(self,_source):events.append('profile')  # Numeric inspection is covered by test_profiles.
                    def start(self,*names):
                        if 'agent' in names:
                            test.assertEqual(set(validated),set(lifecycle.SERVICES))
                            test.assertIn('registered',events);test.assertIn('profile',events)
                            test.assertTrue(evidence.images(evidence.read(private/'images.json'))['container_bindings_complete'])
                        events.extend('start:'+name for name in names)
                        if mode=='agent_start_failure' and 'agent' in names:raise primary
                    def wait(self,*_args):pass
                    def exec(self,args,**_kwargs):
                        if args==['disk']:return json.dumps({'fsid':1,'device':2,'block':4096,'blocks':25000000,'available':23000000,'files':0,'free_files':0})
                        return ''
                    def validate(self,role):
                        if mode=='validation_failure' and role=='agent':raise lifecycle.Refusal('image_attachment_identity')
                        validated.append(role);self.images[role]['container_descriptor_available']=False
                primary=RuntimeError('private body fixture')
                def functional(*_args):
                    self.assertEqual(set(validated),set(lifecycle.SERVICES))
                    self.assertEqual(events.count('start:agent'),1)
                    self.assertLess(events.index('start:agent'),events.index('start:histogram-init'))
                    self.assertLess(events.index('start:agent'),events.index('start:keeper'))
                    persisted=evidence.images(evidence.read(private/'images.json'))
                    self.assertTrue(persisted['container_bindings_complete'])
                    functional_started.set()
                    if mode=='monitor_signal':engine.raw(['-c','import time;time.sleep(3)'])
                    raise primary
                plan=lifecycle.make_plan(private,lock['images'],'fixture','a'*32,1001,1001)
                lifecycle.private_json(private/'compose.json',plan)
                records={'source':{'profile_id':lifecycle.BASELINE_PROFILE,'commit':'a'*40,'tree':'b'*40},
                         'owner':{'profile_id':lifecycle.BASELINE_PROFILE,'source_sha':'a'*40,'source_tree':'b'*40,'plan_sha256':lifecycle.digest(private/'compose.json'),
                                  'supervisor_pid':os.getppid(),'deadline':time.monotonic()+10,'daemon':{'daemon_id':'fixture'},'project':'fixture','nonce':'a'*32},
                         'worker':{'pid':os.getpid(),'group':os.getpid(),'start_ticks':'fixture'}}
                for name,value in records.items():lifecycle.private_json(private/(name+'.json'),value)
                initial={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
                def host(*_args):
                    if mode=='monitor_signal' and functional_started.is_set():engine.raw(['-c','raise SystemExit(7)'])
                    return initial
                previous={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGUSR1)}
                try:
                    with patch.object(runtime,'require_native_host'),patch.object(runtime,'verify_source'),\
                         patch.object(runtime,'process_start',return_value='fixture'),patch.object(runtime,'engine',return_value=engine),\
                         patch.object(lifecycle,'Owned',Owned),patch.object(lifecycle,'host_snapshot',side_effect=host),\
                         patch.object(lifecycle,'acquire_image'),patch.object(lifecycle,'checked_image',return_value=images['disk']),\
                         patch.object(lifecycle,'inspect_images',return_value=images),patch.object(lifecycle,'require_declared_volume_coverage'),\
                         patch.object(lifecycle,'histogram_asset'),patch.object(runtime.observer,'observe',return_value={'available':True,'counts':{'applied_migrations':1,'migration_lock_rows':0}}),\
                         patch.object(runtime,'functional_with_client',side_effect=functional):
                        with self.assertRaises(BaseException) as caught:runtime.worker(private)
                    if mode in ('functional_failure','agent_start_failure'):self.assertIs(caught.exception,primary)
                    elif mode=='monitor_signal':self.assertEqual(str(caught.exception),'worker_interrupted_or_storage')
                    else:self.assertEqual(str(caught.exception),'image_attachment_identity')
                    self.assertFalse(evidence.collect(private,root/'public',lambda _value:None))
                    public=json.loads((root/'public/witness.json').read_text())
                    self.assertEqual(public['images']['container_bindings_complete'],mode!='validation_failure')
                    self.assertFalse(public['passed']);self.assertFalse(public['functional']['available'])
                    expected={'functional_failure':'functional_failure','monitor_signal':'worker_interrupted_or_storage','validation_failure':'image_attachment_identity','agent_start_failure':'functional_failure'}
                    self.assertEqual(public['failure']['reason'],expected[mode])
                    if mode=='monitor_signal':
                        self.assertEqual(public['storage_monitor']['first_failure'],{'stage':'host_snapshot','reason':'command_failed'})
                    else:self.assertFalse(public['storage_monitor']['failed'])
                    self.assertNotIn('private body fixture',json.dumps(public))
                    self.assertFalse(engine.child)
                    self.assertEqual(events.count('start:agent'),0 if mode=='validation_failure' else 1)
                    if mode in ('validation_failure','agent_start_failure'):
                        self.assertNotIn('start:histogram-init',events);self.assertNotIn('start:keeper',events)
                finally:
                    for s,handler in previous.items():signal.signal(s,handler)
                    engine.cancel_children()


INITIAL={'filesystems':{'owned':{'total_bytes':100*1024**3,'free_bytes':90*1024**3}},'allocated_image_bytes':0}
VM={'fsid':1,'device':2,'block':4096,'blocks':25000000,'available':23000000,'files':0,'free_files':0}


class GuardOutcomes(unittest.TestCase):
    def test_normal_monitor_and_monitor_only_failures_have_distinct_closed_stages(self):
        for mode,stage,reason in [('normal',None,None),('host_guard','host_guard','host_capacity_changed'),
                                  ('vm_sample','vm_sample','vm_sample_shape'),('vm_guard','vm_guard','vm_storage_identity')]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine=benign_engine(root);notified=threading.Event();sampled=threading.Event();calls=0;vm_calls=0
                def host(*_args):
                    nonlocal calls
                    calls+=1
                    if calls>1:
                        sampled.set()
                        if mode=='host_guard':return {**INITIAL,'filesystems':{'owned':{'total_bytes':101*1024**3,'free_bytes':90*1024**3}}}
                    return INITIAL
                class Owned:
                    images={'disk':{'child_manifest':'fixture','image_id':'fixture'}};containers={'disk':'fixture'}
                    def exec(self,*_args,**_kwargs):
                        nonlocal vm_calls
                        vm_calls+=1
                        if vm_calls>1 and mode=='vm_sample':return '{}'
                        return json.dumps({**VM,'device':3} if vm_calls>1 and mode=='vm_guard' else VM)
                (root/'driver').mkdir();(root/'driver/inside.py').write_text('# controlled fixture\n');engine.identity={'daemon_id':'fixture'}
                previous=signal.signal(signal.SIGUSR1,lambda *_args:notified.set())
                try:
                    with patch.object(lifecycle,'host_snapshot',side_effect=host):
                        if mode=='normal':
                            with lifecycle.storage_guard(engine,Owned(),root):self.assertTrue(sampled.wait(2))
                        else:
                            with self.assertRaisesRegex(lifecycle.Refusal,'^storage_monitor_failed$'):
                                with lifecycle.storage_guard(engine,Owned(),root) as admit:
                                    if mode.startswith('vm_'):admit()
                                    self.assertTrue(notified.wait(2))
                    row=evidence.storage_monitor(evidence.read(root/'disk-last.json'))
                    self.assertEqual(row['failed'],mode!='normal')
                    self.assertEqual(row['first_failure'],None if stage is None else {'stage':stage,'reason':reason})
                    self.assertTrue(row['monitor_reaped']);self.assertFalse(engine.child)
                finally:signal.signal(signal.SIGUSR1,previous);engine.cancel_children()

    def test_stop_cancels_and_reaps_actual_blocked_monitor_without_false_failure(self):
        for body_fails in (False,True):
            with self.subTest(body_fails=body_fails),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine=benign_engine(root);entered=threading.Event();calls=0
                def host(*_args):
                    nonlocal calls
                    calls+=1
                    if calls>1:
                        entered.set();engine.raw(['-c','import time;time.sleep(30)'],timeout=3)
                    return INITIAL
                primary=RuntimeError('controlled body')
                try:
                    caught=None
                    with patch.object(lifecycle,'host_snapshot',side_effect=host):
                        try:
                            with lifecycle.storage_guard(engine,object(),root):
                                self.assertTrue(entered.wait(2))
                                end=time.monotonic()+2
                                while not engine.child and time.monotonic()<end:time.sleep(.005)
                                self.assertTrue(engine.child)
                                if body_fails:raise primary
                        except BaseException as error:caught=error
                    self.assertIs(caught,primary if body_fails else None)
                    row=evidence.storage_monitor(evidence.read(root/'disk-last.json'))
                    self.assertFalse(row['failed']);self.assertTrue(row['monitor_reaped']);self.assertIsNone(row['first_failure'])
                    self.assertEqual(row['finalization_stage'],'complete');self.assertFalse(engine.child)
                finally:engine.cancel_children()

    def test_unreaped_monitor_is_visible_even_when_body_failure_keeps_identity(self):
        for body_fails in (False,True):
            with self.subTest(body_fails=body_fails),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);engine=benign_engine(root);entered=threading.Event();release=threading.Event();calls=0;owned=[]
                def host(*_args):
                    nonlocal calls
                    calls+=1
                    if calls>1:entered.set();release.wait(3)
                    return INITIAL
                join=threading.Thread.join
                def elapsed_join(thread,timeout=None):
                    if thread.name=='owned-signoz-storage':owned.append(thread);self.assertEqual(timeout,8)
                    else:join(thread,timeout)
                primary=RuntimeError('controlled body')
                try:
                    caught=None
                    with patch.object(lifecycle,'host_snapshot',side_effect=host),patch.object(threading.Thread,'join',elapsed_join):
                        try:
                            with lifecycle.storage_guard(engine,object(),root):
                                self.assertTrue(entered.wait(2))
                                if body_fails:raise primary
                        except BaseException as error:caught=error
                    if body_fails:self.assertIs(caught,primary)
                    else:self.assertEqual(str(caught),'monitor_not_reaped')
                    self.assertFalse(evidence.collect(root,root/'public',lambda _value:None))
                    row=json.loads((root/'public/witness.json').read_text())['storage_monitor']
                    self.assertFalse(row['monitor_reaped']);self.assertEqual(row['finalization_stage'],'monitor_not_reaped')
                    self.assertFalse(row['failed'])
                finally:
                    release.set()
                    for thread in owned:join(thread,2);self.assertFalse(thread.is_alive())
                    engine.cancel_children()

    def test_cancellation_failure_is_secondary_visible_and_never_replaces_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);engine=benign_engine(root);cancel=engine.cancel_children;primary=RuntimeError('controlled body')
            def failed_cancel():cancel();raise RuntimeError('private cancellation fixture')
            caught=None
            with patch.object(lifecycle,'host_snapshot',return_value=INITIAL),patch.object(engine,'cancel_children',failed_cancel):
                try:
                    with lifecycle.storage_guard(engine,object(),root):raise primary
                except BaseException as error:caught=error
            self.assertIs(caught,primary)
            row=evidence.storage_monitor(evidence.read(root/'disk-last.json'))
            self.assertEqual(row['finalization_stage'],'cancel_children');self.assertTrue(row['monitor_reaped'])
            self.assertNotIn('private cancellation fixture',json.dumps(row));self.assertFalse(engine.child)


class MonitorPublication(unittest.TestCase):
    def test_first_record_is_sticky_and_unknown_private_fields_never_escape(self):
        secret='private-key-error-path-CID-payload'
        base={'monitor_failed':True,'failure':[{'stage':'vm_sample','reason':'command_deadline','category':secret,'error':secret}],
              'monitor_reaped':True,'finalization_stage':'complete','initial_vm':secret,'latest':secret}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for index,record in enumerate([base,{**base,'failure':[{'stage':secret,'reason':secret,'category':secret}]},
                                           {**base,'failure':[{}]}, {**base,'failure':[{'stage':[],'reason':{}}]}]):
                lifecycle.private_json(root/'disk-last.json',record)
                self.assertFalse(evidence.collect(root,root/str(index),lambda _value:None))
                public=json.loads((root/str(index)/'witness.json').read_text())
                expected={'stage':'vm_sample','reason':'command_deadline'} if index==0 else {'stage':'unknown','reason':'unknown'}
                self.assertEqual(public['storage_monitor']['first_failure'],expected)
                self.assertNotIn(secret,json.dumps(public))
            for index,bad in enumerate([{}, {**base,'failure':[]},{**base,'failure':[{},{}]},
                                       {**base,'monitor_failed':'yes'},{**base,'monitor_reaped':None},
                                       {**base,'finalization_stage':secret}]):
                lifecycle.private_json(root/'disk-last.json',bad)
                self.assertFalse(evidence.collect(root,root/('bad-'+str(index)),lambda _value:None))
                public=json.loads((root/('bad-'+str(index))/'witness.json').read_text())
                self.assertEqual(public['storage_monitor'],{'available':False});self.assertNotIn(secret,json.dumps(public))
            (root/'disk-last.json').unlink()
            self.assertFalse(evidence.collect(root,root/'missing',lambda _value:None))
            self.assertEqual(json.loads((root/'missing/witness.json').read_text())['storage_monitor'],{'available':False})


if __name__=='__main__':unittest.main()
