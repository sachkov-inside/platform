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

    def test_delayed_source_cannot_hide_throttle_or_unknown_baseline_before_first_async_counter(self):
        for missing_baseline in (False,True):
            with self.subTest(missing_baseline=missing_baseline):
                source_entered=threading.Event();release_source=threading.Event();load_started=threading.Event()
                def capture(states):
                    value={'cpu_periods':20,'cpu_throttled_periods':1,'cpu_throttled_ns':100} if load_started.is_set() else {'cpu_periods':10,'cpu_throttled_periods':0,'cpu_throttled_ns':0}
                    if missing_baseline and not load_started.is_set():value.pop('cpu_throttled_ns')
                    return {'at_seconds':2 if load_started.is_set() else 1,'services':{'loadgen':value},'errors':{}}
                def sample_sources(*args,**options):
                    self.assertEqual(set(options),{'observer'});self.assertTrue(callable(options['observer']))
                    source_entered.set()
                    self.assertTrue(release_source.wait(1),'source must finish under its owner')
                    return {'postgresql':'observed','caddy':'observed'}
                def storage(*args):
                    self.assertTrue(source_entered.wait(1),'delayed sampler must be inside its source read')
                    return {}
                def invoke(*args,**kwargs):
                    # No wait for a counter here: this is the production race.
                    load_started.set();release_source.set()
                    return json.dumps({'telegram_acknowledged':0,'completed':True})
                owned={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
                with patch.object(fullstack.technical,'owned',return_value=owned),patch.object(fullstack.technical,'capture',side_effect=capture),patch.object(fullstack,'host',return_value={}),patch.object(fullstack,'invoke',side_effect=invoke),patch.object(fullstack.storage,'observe',side_effect=storage),patch.object(fullstack.telegram,'processed',return_value={'accepted':0}),patch.object(fullstack,'sample_sources',side_effect=sample_sources):
                    row=fullstack.phase([], 'owned', {'name':'spike','seconds':10,'requests_per_second':40}, ('loadgen',), True, 0, Path('/owned'))
                expected='unavailable' if missing_baseline else 'throttled'
                self.assertEqual(row['errors'],['fixture_loadgen_cpu_'+expected])
                self.assertEqual(row['loadgen_cpu_pressure']['state'],expected)
                self.assertEqual(row['source_publication_timing']['state'],'invalid')
