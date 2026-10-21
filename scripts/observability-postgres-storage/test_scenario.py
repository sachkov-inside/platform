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
            def upload(value):
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
            def upload(value):
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
