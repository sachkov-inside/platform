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
    def test_held_waits_for_next_scraped_frame_without_spending_snapshot_cap(self):
        # Seven-second visibility fits the unchanged eight-second held witness.
        # Exercise the actual cap, paired canonical decoder and held predicate.
        from types import SimpleNamespace
        import caddy_query
        now=[100.0];events=[];reads=[];visible_at=[107]
        clock=SimpleNamespace(time=lambda:now[0],monotonic=lambda:now[0],
            sleep=lambda seconds:now.__setitem__(0,now[0]+seconds))
        held_wire=wire();baseline=held_wire.replace(b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 1',b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 0')
        class Targets:
            def native_raw(self):return held_wire if events else baseline
        class Held:
            started_at=100.0;finished_at=None
            def __init__(self,token):pass
            def __enter__(self):events.append('held');return self
            def __exit__(self,*args):pass
            def assert_holding(self):
                if now[0]>=108:raise TimeoutError('unchanged eight-second hold expired')
            def finish(self):
                self.assert_holding();now[0]+=.001;self.finished_at=now[0]
        class Response:
            status=200
            def __init__(self,raw):
                from email.message import Message
                self.raw=raw;self.headers=Message()
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,_):return self.raw
        def opened(request,timeout):
            from urllib.parse import parse_qs,urlparse
            params=parse_qs(urlparse(request.full_url).query)
            point=int(params['time'][0]);current=point>=visible_at[0]
            values,stamps=acquisition(point=point,stamp=visible_at[0] if current else 99)
            if not current:values['data']['result'][3]['value'][1]='0'
            raw=stamps if 'source_metric' in params['query'][0] else values
            now[0]+=.001;reads.append(point)
            return Response(json.dumps(raw).encode())
        original=caddy_query.read_snapshot
        def canonical(*args,**kwargs):return original(*args,wall_clock=clock.time,**kwargs)
        def read(*,evaluated_at,previous=None):
            report,current=canonical('owned_token',evaluated_at=evaluated_at,previous=previous)
            report['transport']['mcp']='passed';return report,current
        @contextmanager
        def ready(*args,**kwargs):yield read
        experiment=scenario.Scenario(Targets(),'owned_token',Path('/native'),lambda *_:None)
        experiment.deadline=700
        with patch.object(scenario,'time',clock),patch.object(scenario.mcp_snapshot,'session',ready), \
                patch.object(scenario.request_hold,'Held',Held), \
                patch.object(scenario.caddy_query,'read_snapshot',side_effect=canonical), \
                patch('urllib.request.OpenerDirector.open',side_effect=opened):
            experiment.held()
            self.assertLess(now[0],108)
            self.assertLess(experiment.acquisitions,40)
            self.assertGreaterEqual(now[0],107)
            self.assertEqual(len(reads),2*(experiment.acquisitions+1))
            # Pacing must not turn an out-of-window sample into acceptance.
            now[0]=100;visible_at[0]=109;events.clear();reads.clear()
            experiment.acquisitions=0
            with self.assertRaises(TimeoutError):experiment.held()
            self.assertLess(experiment.acquisitions,40)

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
