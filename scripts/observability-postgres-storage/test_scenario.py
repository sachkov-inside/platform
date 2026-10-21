"""Owning phase/decreasing-deadline controls; no PG/container/storage execution."""
import subprocess
import time
import unittest
from unittest.mock import patch
import scenario


class Driver(unittest.TestCase):
    def test_restart_readiness_uses_only_frozen_postgres_and_same_remaining_deadline(self):
        driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
        calls=[];deadlines=[];cid='a'*64
        def read(args):
            calls.append(args)
            if len(calls)==1:raise subprocess.CalledProcessError(1,args)
            return ''
        with patch.object(driver,'verify_pg',side_effect=deadlines.append),patch.object(driver,'read',side_effect=read), \
             patch.object(scenario.time,'sleep'):
            driver.await_postgres(cid)
        self.assertEqual(calls,[['docker','exec',cid,'pg_isready','-U','tracking','-d','tracking']]*2)
        self.assertEqual(len(set(deadlines)),1)
        self.assertLessEqual(deadlines[0],time.monotonic()+10)

    def test_only_parent_verified_failed_acquisition_emits_current_zero_without_advancing_ledger(self):
        import capture
        for status in ('verified','unproved','cleanup','upload_failure'):
            driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
            primary=ValueError('cleanup') if status=='cleanup' else capture.ClosedClientFailure()
            if isinstance(primary,capture.ClosedClientFailure):primary.verified=status in ('verified','upload_failure')
            secondary=RuntimeError('controlled emission failure');uploads=[]
            def upload(value,*,deadline=None):
                uploads.append(value)
                if status=='upload_failure':raise secondary
            with self.subTest(status=status),patch.object(scenario.capture,'acquire',side_effect=primary), \
                 patch.object(scenario.time,'time_ns',return_value=1790000000000000000),patch.object(driver,'upload',side_effect=upload):
                try:driver.acquire()
                except ValueError as caught:self.assertIs(caught,primary)
                else:self.fail('failed acquisition returned a sample')
            self.assertIsNone(driver.ledger.last)
            if status in ('verified','upload_failure'):
                self.assertEqual(len(uploads),1)
                metrics=uploads[0]['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
                self.assertEqual(len(metrics),1);self.assertEqual(metrics[0]['name'],'inside.postgresql.server.available')
                self.assertEqual(metrics[0]['gauge']['dataPoints'],[{'attributes':[],'timeUnixNano':'1790000000000000000','asInt':'0'}])
            else:self.assertEqual(uploads,[])

    def test_stopped_owned_zero_requires_client_settlement_frozen_identity_and_exact_terminal_state(self):
        from types import SimpleNamespace
        for fault in (None,'cleanup','live_actor','before_owner','stop_error','wrong_stop','after_owner','state_error','running','oversize','expired','upload_error'):
            driver=scenario.Scenario(None,['compose'],'fixed',None);driver.end=time.monotonic()+150
            cid='a'*64;target={'id':cid,'image':'pinned-private'};calls=[];uploads=[];primary=RuntimeError('controlled first')
            def close(deadline):
                calls.append('close')
                if fault=='cleanup':raise primary
            actor=SimpleNamespace(close=close,process=SimpleNamespace(poll=lambda:None if fault=='live_actor' else 0))
            driver.actors=actor
            def inspect(role,identity):
                calls.append('inspect');self.assertEqual((role,identity),('postgres',cid))
                if fault=='after_owner':return {'id':'b'*64}
                return target
            driver.targets=SimpleNamespace(targets={'postgres':target},inspect=inspect)
            def verify(deadline):
                calls.append('verify')
                if fault=='before_owner':raise primary
            def read(args):
                calls.append(args)
                if args[:2]==['docker','stop']:
                    if fault=='stop_error':raise primary
                    return 'b'*64 if fault=='wrong_stop' else cid+'\n'
                self.assertEqual(args,['docker','inspect','--format',scenario.STOPPED,cid])
                if fault=='state_error':raise primary
                if fault=='expired':driver.end=time.monotonic()-1
                return 'running' if fault=='running' else 'x'*17 if fault=='oversize' else 'stopped\n'
            def upload(value,*,deadline=None):
                uploads.append(value)
                if fault=='upload_error':raise primary
            with self.subTest(fault=fault),patch.object(driver,'verify_pg',side_effect=verify),patch.object(driver,'read',side_effect=read), \
                 patch.object(driver,'upload',side_effect=upload),patch.object(scenario.pilot,'assert_docker_identity'), \
                 patch.object(scenario.time,'time_ns',return_value=1790000000000000000):
                if fault is None:self.assertEqual(driver.stop_postgres(),cid)
                else:
                    try:driver.stop_postgres()
                    except Exception as error:
                        if fault in ('cleanup','before_owner','stop_error','state_error','upload_error'):self.assertIs(error,primary)
                    else:self.fail('invalid stop proof admitted')
            self.assertEqual(len(uploads),1 if fault in (None,'upload_error') else 0)
            if uploads:
                metrics=uploads[0]['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
                self.assertEqual([(m['name'],m['gauge']['dataPoints'][0]) for m in metrics],
                    [('inside.postgresql.server.available',{'attributes':[],'timeUnixNano':'1790000000000000000','asInt':'0'})])
            if fault is None:
                self.assertEqual(calls[:3],['close','verify',['docker','stop','--time','2',cid]])
                self.assertEqual(calls[3],'inspect');self.assertEqual(len(calls),5)
            self.assertIsNone(driver.ledger.last)

    def test_real_stop_upload_composition_has_one_alarm_and_the_original_decreasing_deadline(self):
        import json
        import signal
        from pathlib import Path
        import postgres_source
        import source_status_scenario
        for fault in (None,'poisoned_state','poisoned_owner','expired','http_failure','expired_response'):
            clock=[100.0];requests=[];identity_deadlines=[];stopped=[False];primary=RuntimeError('controlled HTTP first')
            driver=scenario.Scenario(None,['docker','compose','-p','inside-observability-pilot-'+'a'*12,'-f','/task/compose.json'],'fixed',None)
            driver.end=250;driver.clock_deadline=110
            roles=('postgres','alloy','metrics','gateway');ids={role:f'{index+1:064x}' for index,role in enumerate(roles)}
            plan={'services':{role:{'image':'fixture/'+role+'@sha256:'+'a'*64,'networks':['pilot','ingress']} for role in roles},'volumes':{}}
            targets=postgres_source.ownership.TrackingTargets.__new__(postgres_source.ownership.TrackingTargets)
            targets.output=Path('/task');targets.compose=driver.compose;targets.project=driver.compose[3];targets.plan=plan;targets.read=driver.read
            targets._ownership_observer=None;targets._ownership_callback_error=None;targets.targets={};driver.targets=targets
            def daemon(args,**kwargs):
                self.assertLessEqual(kwargs['timeout'],10)
                if args[:6]==driver.compose:return ids[args[-1]]
                if args[:2]==['docker','stop']:
                    self.assertEqual(args,['docker','stop','--time','2',ids['postgres']]);stopped[0]=True;clock[0]=102;return ids['postgres']+'\n'
                self.assertEqual(args[:3],['docker','inspect','--format'])
                role=next(role for role in roles if ids[role]==args[-1])
                if args[3]==scenario.STOPPED:
                    self.assertTrue(stopped[0])
                    if fault=='expired':clock[0]=111
                    return 'unknown' if fault=='poisoned_state' else 'stopped\n'
                self.assertEqual(args[3],source_status_scenario.INSPECT)
                image=plan['services'][role]['image']
                if fault=='poisoned_owner' and stopped[0] and role=='postgres':image='foreign'
                return json.dumps({'id':ids[role],'image':image,'project':targets.project,'service':role,
                    'config_files':driver.compose[5],'mounts':[],'networks':{targets.project+'_'+name:{'NetworkID':key*64} for name,key in (('pilot','b'),('ingress','c'))}})
            def identity(**kwargs):identity_deadlines.append(kwargs['deadline'])
            class Response:
                status=200
                def __enter__(self):return self
                def __exit__(self,*_):return False
                def read(self,cap):
                    if fault=='expired_response':clock[0]=111
                    return b'{}'
            class Opener:
                def open(inner,request,timeout):
                    self.assertTrue(stopped[0]);self.assertLess(clock[0],110)
                    self.assertEqual(driver.clock_deadline,110);self.assertEqual(timeout,8)
                    self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0],0)
                    self.assertEqual(request.full_url,'http://127.0.0.1:14318/v1/metrics')
                    requests.append(request)
                    if fault=='http_failure':raise primary
                    return Response()
            with self.subTest(fault=fault),patch.object(scenario.time,'monotonic',side_effect=lambda:clock[0]), \
                 patch.object(scenario.pilot,'command',side_effect=daemon),patch.object(scenario.pilot,'assert_docker_identity',side_effect=identity), \
                 patch.object(scenario.urllib.request,'build_opener',return_value=Opener()):
                for role in roles:targets.targets[role]=targets.inspect(role,ids[role])
                if fault is None:self.assertEqual(driver.stop_postgres(),ids['postgres'])
                else:
                    try:driver.stop_postgres()
                    except Exception as error:
                        if fault=='http_failure':self.assertIs(error,primary)
                    else:self.fail('invalid composed stop returned success')
            self.assertEqual(requests!=[],fault in (None,'http_failure','expired_response'))
            self.assertTrue(all(deadline==110 for deadline in identity_deadlines))
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))
