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
