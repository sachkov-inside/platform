"""Clock association diagnostics do not change sender counters or acceptance."""
import json
import shutil
import subprocess
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import fullstack


class CounterClock(unittest.TestCase):
    def phase(self, capture, *, monotonic=None, epoch=None):
        sampled=threading.Event()
        def read(states):
            value=capture(states)
            if threading.current_thread() is not threading.main_thread():sampled.set()
            return value
        def load(*args,**options):
            self.assertTrue(sampled.wait(1),'the actual sampler capture must finish')
            return json.dumps({'telegram_acknowledged':0,'completed':True})
        def processed(read,predicate,**options):
            value=read();self.assertTrue(predicate(value));return value
        def host():return {'unchanged':1,'fixture_read_at_seconds':time.monotonic()}
        owned={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
        with patch.object(fullstack.technical,'owned',return_value=owned),patch.object(fullstack.technical,'capture',side_effect=read),patch.object(fullstack,'host',side_effect=host),patch.object(fullstack,'invoke',side_effect=load),patch.object(fullstack.storage,'observe',return_value={}),patch.object(fullstack.telegram,'processed',return_value={'accepted':0}),patch.object(fullstack.pilot,'await_fact',side_effect=processed):
            from contextlib import ExitStack
            with ExitStack() as clocks:
                if monotonic is not None:clocks.enter_context(patch.object(fullstack.time,'monotonic',side_effect=monotonic))
                if epoch is not None:clocks.enter_context(patch.object(fullstack.time,'time',side_effect=epoch))
                return fullstack.phase([], 'owned', {'name':'spike','seconds':10,'requests_per_second':40}, ('loadgen',), False, 0, Path('/owned'))

    def test_every_baseline_sampler_and_final_frame_retains_its_clock_bridge(self):
        original=[]
        def capture(states):
            value={'at_seconds':time.monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
            original.append(value)
            return value
        value=self.phase(capture)
        self.assertGreaterEqual(len(value['samples']),3)
        for row,counters in zip(value['samples'],original):
            self.assertIs(row['counters'],counters)
            self.assertEqual(row['host']['unchanged'],1)
            before,epoch,after=row['counter_clock_anchor']
            self.assertTrue(all(type(number) in (int,float) for number in (before,epoch,after)))
            self.assertLessEqual(before,counters['at_seconds']*1000)
            self.assertLessEqual(counters['at_seconds']*1000,after)
            self.assertLessEqual(before,row['host']['fixture_read_at_seconds']*1000)
            self.assertLessEqual(row['host']['fixture_read_at_seconds']*1000,after)
            self.assertGreater(epoch,0)
        self.assertEqual(value['errors'],[])
        self.assertTrue(value['load']['completed'])

    def test_clock_read_failure_does_not_replace_the_original_capture_error(self):
        failure=ValueError('original counter failure')
        def capture(states):raise failure
        def epoch():raise RuntimeError('private-sentinel')
        with self.assertRaises(ValueError) as caught:self.phase(capture,epoch=epoch)
        self.assertIs(caught.exception,failure)

    def test_bad_clock_numbers_or_unbracketed_counter_are_unknown_without_changing_load(self):
        def capture(states):
            return {'at_seconds':time.monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
        for invalid in (float('nan'),float('inf'),-1,True,2**53,'private-sentinel',RuntimeError('private-sentinel')):
            with self.subTest(clock=type(invalid).__name__):
                def epoch():
                    if isinstance(invalid,Exception):raise invalid
                    return invalid
                value=self.phase(capture,epoch=epoch)
                self.assertTrue(all(row['counter_clock_anchor'] is None for row in value['samples']))
                self.assertEqual(value['errors'],[])
                self.assertTrue(value['load']['completed'])
        for invalid in (None,float('nan'),float('inf'),-1,True,2**53,'private-sentinel'):
            with self.subTest(counter=type(invalid).__name__):
                def unbracketed(states):
                    return {**capture(states),'at_seconds':invalid}
                value=self.phase(unbracketed)
                self.assertTrue(all(row['counter_clock_anchor'] is None for row in value['samples']))
                self.assertTrue(all(row['counters']['at_seconds'] is invalid for row in value['samples']))
                self.assertEqual(value['errors'],[])
        readings=iter([3,1])
        def reversed_clock():return next(readings,3)
        value=self.phase(lambda states:{**capture(states),'at_seconds':2},monotonic=reversed_clock)
        self.assertIsNone(value['samples'][0]['counter_clock_anchor'])
        self.assertTrue(value['load']['completed'])

    def test_wall_clock_change_and_wide_precision_remain_visible_instead_of_becoming_a_gate(self):
        tick=[100.0];main=[0]
        def monotonic():
            tick[0]+=100
            return tick[0]
        def epoch():
            if threading.current_thread() is not threading.main_thread():return 99
            main[0]+=1
            return 100 if main[0]==1 else 101
        def capture(states):
            return {'at_seconds':time.monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
        value=self.phase(capture,monotonic=monotonic,epoch=epoch)
        anchors=[row['counter_clock_anchor'] for row in value['samples']]
        self.assertEqual(anchors[0][1],100000)
        self.assertEqual(anchors[1][1],99000)
        self.assertEqual(anchors[-1][1],101000)
        self.assertTrue(all(after-before>=200000 for before,_,after in anchors))
        self.assertLess(anchors[0][0],anchors[1][0])
        self.assertEqual(value['errors'],[])
        self.assertTrue(value['load']['completed'])

    def test_real_node_epoch_bracket_is_enclosed_by_actual_python_counter_capture(self):
        # One-shot stdlib clock adapter, no sockets, Docker or Node descendants.
        # subprocess.run owns timeout kill+wait; the phase owns the sampler thread.
        node=shutil.which('node');self.assertIsNotNone(node)
        observations=[]
        def capture(states):
            at=time.monotonic()
            child=subprocess.run([node,'-e','console.log(JSON.stringify([performance.now(),Date.now(),performance.now()]))'],capture_output=True,text=True,check=True,timeout=3)
            observations.append(json.loads(child.stdout))
            return {'at_seconds':at,'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
        value=self.phase(capture)
        self.assertEqual(len(value['samples']),len(observations))
        for row,node_clock in zip(value['samples'],observations):
            before,epoch,after=row['counter_clock_anchor']
            self.assertLessEqual(node_clock[0],node_clock[2])
            # Date.now quantizes epoch to whole milliseconds; the host bracket
            # encloses process startup, its clock reads and observed completion.
            self.assertGreaterEqual(node_clock[1],epoch-1)
            self.assertLessEqual(node_clock[1],epoch+(after-before)+1)
        self.assertEqual(value['errors'],[])
