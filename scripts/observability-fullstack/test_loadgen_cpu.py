"""A complete HTTP load cannot hide throttled or unknown sender CPU counters."""
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
import fullstack


class SenderPressure(unittest.TestCase):
    def test_phase_rejects_sender_throttling_missing_counters_and_counter_reset(self):
        for state in ('unthrottled','throttled','unavailable','reset'):
            with self.subTest(state=state):
                first=threading.Event();finished=threading.Event()
                baseline={'cpu_periods':10,'cpu_throttled_periods':1,'cpu_throttled_ns':100}
                later={'cpu_periods':20,'cpu_throttled_periods':1,'cpu_throttled_ns':100}
                if state=='throttled':later.update(cpu_throttled_periods=2,cpu_throttled_ns=200)
                if state=='unavailable':later.pop('cpu_throttled_ns')
                if state=='reset':later['cpu_periods']=1
                def capture(states):
                    value=later if finished.is_set() else baseline
                    first.set()
                    return {'at_seconds':2 if finished.is_set() else 1,'services':{'loadgen':dict(value)},'errors':{}}
                def invoke(*args,**kwargs):
                    self.assertTrue(first.wait(1),'sampler must observe the baseline before the load completes')
                    finished.set()
                    return json.dumps({'telegram_acknowledged':0,'completed':True})
                owned={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
                with patch.object(fullstack.technical,'owned',return_value=owned),patch.object(fullstack.technical,'capture',side_effect=capture),patch.object(fullstack,'host',return_value={}),patch.object(fullstack,'invoke',side_effect=invoke),patch.object(fullstack.storage,'observe',return_value={}),patch.object(fullstack.telegram,'processed',return_value={'accepted':0}),patch.object(fullstack,'sample_sources',return_value={'postgresql':'observed','caddy':'observed'}):
                    row=fullstack.phase([], 'owned', {'name':'spike','seconds':10,'requests_per_second':40}, ('loadgen',), True, 0, Path('/owned'))
                expected=[] if state=='unthrottled' else ['fixture_loadgen_cpu_'+('unavailable' if state in ('unavailable','reset') else 'throttled')]
                self.assertEqual(row['errors'],expected)
                self.assertEqual(row['loadgen_cpu_pressure']['state'],'unavailable' if state=='reset' else state)
