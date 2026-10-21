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
