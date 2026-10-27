"""Cold native initialization must finish before the eight-second held-body witness starts."""
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
import unittest
import scenario
from test_native_source import wire
from test_observation import acquisition
import json


class WarmMatching(unittest.TestCase):
    def test_ready_native_session_precedes_held_body_and_exact_canonical_acquisition(self):
        events=[]
        values,stamps=acquisition()
        canonical={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),'evaluated_at':100,'completed_at':101}
        report=scenario.status.evaluate(**canonical)
        held_wire=wire();baseline=held_wire.replace(b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 1',b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 0')
        class Targets:
            def native_raw(self):return baseline if not events else held_wire
        class Held:
            started_at=98;finished_at=None
            def __init__(self,token):pass
            def __enter__(self):
                if events!=['native_ready']:raise AssertionError('cold MCP initialization remains inside held freshness window')
                events.append('held_started');return self
            def __exit__(self,*args):events.append('held_closed')
            def assert_holding(self):pass
            def finish(self):self.finished_at=102;events.append('held_finished')
        def read(*,evaluated_at,previous=None):
            self.assertEqual(evaluated_at,100);self.assertIsNone(previous)
            events.append('mcp_same_E');return {**report,'transport':{'canonical':'unrun','mcp':'passed'}},canonical.copy()
        @contextmanager
        def ready(*args,**kwargs):
            events.append('native_ready')
            try:yield read
            finally:events.append('native_closed')
        experiment=scenario.Scenario(Targets(),'a'*32,Path('/native'),lambda *_:None)
        with patch.object(scenario.mcp_snapshot,'session',ready,create=True),patch.object(scenario.request_hold,'Held',Held),patch.object(experiment,'snapshot',return_value=(report,canonical)):
            experiment.held()
        self.assertEqual(events,['native_ready','held_started','mcp_same_E','held_finished','held_closed','native_closed'])

    def test_partition_prepares_native_before_selecting_current_canonical_sample(self):
        events=[]
        values,stamps=acquisition();canonical={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),'evaluated_at':100,'completed_at':101}
        old_values,old_stamps=acquisition(point=95,stamp=94)
        baseline={'values':json.dumps(old_values).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':95,'completed_at':96}
        report=scenario.status.evaluate(**canonical)
        def baseline_read(*args,**kwargs):
            self.assertEqual(events,['native_ready']);events.append('baseline');return report,baseline
        def snapshot(previous):
            self.assertEqual(events,['native_ready','baseline']);self.assertEqual(previous,baseline)
            events.append('canonical');return report,canonical
        def read(*,evaluated_at,previous=None):
            self.assertEqual(evaluated_at,100);self.assertIsNone(previous);events.append('mcp_same_E')
            return {**report,'transport':{'canonical':'unrun','mcp':'passed'}},canonical.copy()
        @contextmanager
        def ready(*args,**kwargs):
            events.append('native_ready')
            try:yield read
            finally:events.append('native_closed')
        class Targets:
            def native_metrics(self):return {'request_errors_total':1}
        experiment=scenario.Scenario(Targets(),'a'*32,Path('/native'),lambda *_:None)
        with patch.object(scenario.mcp_snapshot,'session',ready),patch.object(experiment,'fresh_after',side_effect=baseline_read),patch.object(experiment,'seed',return_value=98),patch.object(experiment,'snapshot',side_effect=snapshot):
            experiment.partition(90)
        self.assertEqual(events,['native_ready','baseline','canonical','mcp_same_E','native_closed'])
