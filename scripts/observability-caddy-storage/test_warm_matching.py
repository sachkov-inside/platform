"""Cold native initialization must finish before the eight-second held-body witness starts."""
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch, ANY
import unittest
import scenario
from test_native_source import wire
from test_observation import acquisition
import json


class WarmMatching(unittest.TestCase):
    def test_held_waits_for_next_scraped_frame_without_spending_snapshot_cap(self):
        # A real scrape occurs at105 while R100..F106 is held; its stored frame
        # appears at109. Export latency must not extend the eight-second socket.
        from types import SimpleNamespace
        import caddy_query
        for fault in (None,'prior_scrape','outside_interval','no_scrape','stale','registry_contract','finish_contract','canonical_contract'):
            with self.subTest(fault=fault):
                now=[100.0];events=[];reads=[];registry=[10];finished=[];progress=[]
                clock=SimpleNamespace(time=lambda:now[0],monotonic=lambda:now[0],
                    sleep=lambda seconds:now.__setitem__(0,now[0]+seconds))
                class Targets:
                    def native_raw(self):
                        registry[0]+=1
                        if fault=='registry_contract' and registry[0]==13:raise ValueError('private-counterexample')
                        extra=(int(now[0]>=100.5)+int(now[0]>=105)) if fault=='prior_scrape' else int(fault!='no_scrape' and now[0]>=105)
                        busy=2 if fault=='prior_scrape' and now[0]<101 else 1
                        raw=wire().replace(b'caddy_http_requests_total{server="srv1",handler="subroute"} 8\n',b'')+f'caddy_http_requests_total{{server="srv1",handler="subroute"}} {registry[0]+extra}\ncaddy_http_requests_in_flight{{server="srv1",handler="subroute"}} {busy}\n'.encode()
                        if not events:raw=raw.replace(b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 1',b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 0')
                        return raw
                class Held:
                    started_at=100.0;finished_at=None
                    def __init__(self,token):pass
                    def __enter__(self):events.append('held');return self
                    def __exit__(self,*args):pass
                    def assert_holding(self):
                        if now[0]>=108:raise TimeoutError('unchanged eight-second hold expired')
                    def finish(self):
                        self.assert_holding()
                        if fault=='finish_contract':raise ValueError('private-response-counterexample')
                        now[0]+=.001;self.finished_at=now[0];finished.append(now[0])
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
                    point=int(params['time'][0]);visible=now[0]>=(116 if fault=='stale' else 109)
                    stamp=109 if fault=='outside_interval' else 105
                    values,stamps=acquisition(point=point,stamp=stamp if visible else 99)
                    if not visible:values['data']['result'][3]['value'][1]='0'
                    raw=stamps if 'source_metric' in params['query'][0] else values
                    now[0]+=.001;reads.append(point)
                    return Response(json.dumps(raw).encode())
                original=caddy_query.read_snapshot
                def canonical(*args,**kwargs):
                    if fault=='canonical_contract':raise ValueError('private-query-counterexample')
                    return original(*args,wall_clock=clock.time,**kwargs)
                def read(*,evaluated_at,previous=None):
                    report,current=canonical('owned_token',evaluated_at=evaluated_at,previous=previous)
                    report['transport']['mcp']='passed';return report,current
                @contextmanager
                def ready(*args,**kwargs):yield read
                experiment=scenario.Scenario(Targets(),'owned_token',Path('/native'),lambda kind,value:progress.append((kind,value)))
                experiment.deadline=700
                with patch.object(scenario,'time',clock),patch.object(scenario.mcp_snapshot,'session',ready), \
                        patch.object(scenario.request_hold,'Held',Held), \
                        patch.object(scenario.caddy_query,'read_snapshot',side_effect=canonical), \
                        patch('urllib.request.OpenerDirector.open',side_effect=opened):
                    if fault in (None,'prior_scrape'):
                        experiment.held()
                        self.assertLess(finished[0],108)
                        self.assertGreaterEqual(now[0],109)
                        self.assertEqual(set(reads),{int(finished[0])})
                        self.assertEqual(len(reads),2*(experiment.acquisitions+1))
                    else:
                        with self.assertRaises((TimeoutError,ValueError)):experiment.held()
                        if fault=='no_scrape':self.assertEqual(reads,[])
                    self.assertLess(experiment.acquisitions,48)
                    expected={'registry_contract':'inflight_registry_scrape','finish_contract':'inflight_release',
                              'canonical_contract':'inflight_stored'}.get(fault)
                    if expected is not None:
                        self.assertEqual([value for kind,value in progress if kind=='inflight_checkpoint'][-1],expected)
                        self.assertNotIn('private-',str(progress))

    def test_ready_native_session_precedes_held_body_and_exact_canonical_acquisition(self):
        events=[];registry=[100]
        values,stamps=acquisition(point=102,stamp=101)
        canonical={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),'evaluated_at':102,'completed_at':103}
        report=scenario.status.evaluate(**canonical)
        held_wire=wire();baseline=held_wire.replace(b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 1',b'caddy_http_requests_in_flight{server="srv0",handler="subroute"} 0')
        class Targets:
            def native_raw(self):
                raw=baseline if not events else held_wire
                registry[0]+=1
                extra=int(registry[0]>102)
                return raw.replace(b'caddy_http_requests_total{server="srv1",handler="subroute"} 8\n',b'')+f'caddy_http_requests_total{{server="srv1",handler="subroute"}} {registry[0]+extra}\ncaddy_http_requests_in_flight{{server="srv1",handler="subroute"}} 1\n'.encode()
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
            self.assertEqual(evaluated_at,102);self.assertIsNone(previous)
            events.append('mcp_same_E');return {**report,'transport':{'canonical':'unrun','mcp':'passed'}},canonical.copy()
        @contextmanager
        def ready(*args,**kwargs):
            events.append('native_ready')
            try:yield read
            finally:events.append('native_closed')
        experiment=scenario.Scenario(Targets(),'a'*32,Path('/native'),lambda *_:None)
        with patch.object(scenario.mcp_snapshot,'session',ready),patch.object(scenario.request_hold,'Held',Held), \
                patch.object(experiment,'snapshot',return_value=(report,canonical)) as acquired, \
                patch.object(scenario.time,'time',return_value=102):
            experiment.held()
        acquired.assert_called_once_with(evaluated_at=102,deadline=ANY)
        self.assertEqual(events,['native_ready','held_started','held_finished','held_closed','mcp_same_E','native_closed'])
        # A valid wall-clock cohort cannot override an expired monotonic deadline.
        from types import SimpleNamespace
        events.clear();registry[0]=100;monotonic=[100]
        clock=SimpleNamespace(time=lambda:102,monotonic=lambda:monotonic[0],sleep=lambda _:None)
        late=scenario.Scenario(Targets(),'a'*32,Path('/native'),lambda *_:None);late.deadline=700
        def delayed(**kwargs):
            self.assertEqual(kwargs,{'evaluated_at':102,'deadline':110})
            monotonic[0]=118
            return report,canonical
        with patch.object(scenario,'time',clock),patch.object(scenario.mcp_snapshot,'session',ready), \
                patch.object(scenario.request_hold,'Held',Held),patch.object(late,'snapshot',side_effect=delayed):
            with self.assertRaises(TimeoutError):late.held()
        self.assertNotIn('mcp_same_E',events)
        monotonic[0]=109
        with patch.object(scenario,'time',clock), \
                patch.object(scenario.caddy_query,'read_snapshot',return_value=({**report,'transport':{'canonical':'passed'}},canonical)) as query:
            late.snapshot(evaluated_at=102,deadline=110)
        self.assertEqual(query.call_args.kwargs['deadline_seconds'],1)


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

        # A published Docker port can close before Caddy has an HTTP listener.
        # No response is admitted into the journal; only the later whole200 is.
        import http.client
        success={'started':100,'completed':100.1,'method':'GET','code':200}
        progress=[]
        startup=scenario.Scenario(None,'owned_token',Path('/unused'),lambda kind,value:progress.append((kind,value)))
        with patch.object(scenario.traffic,'perform',side_effect=[http.client.RemoteDisconnected('private-canary'),success]):
            self.assertEqual(startup.ready(_recovery=True),success)
        self.assertEqual(len(startup.journal._windows),1)
        self.assertIn(('recovery_checkpoint','gateway_recovery_eof'),progress)
        self.assertNotIn('private-canary',str(progress))
        class ForeignEOF(http.client.RemoteDisconnected):pass
        for failure in (ValueError('private-contract'),http.client.IncompleteRead(b'private'),
                        http.client.BadStatusLine('private'),ConnectionResetError('private'),ForeignEOF('private')):
            with self.subTest(failure=type(failure).__name__):
                def broken_marker(*_):raise RuntimeError('private-marker')
                startup=scenario.Scenario(None,'owned_token',Path('/unused'),broken_marker)
                with patch.object(scenario.traffic,'perform',side_effect=failure):
                    with self.assertRaises(type(failure)) as caught:startup.ready(_recovery=True)
                self.assertIs(caught.exception,failure)
                self.assertEqual(startup.journal._windows,[])
        from test_request_hold import peer
        original=scenario.traffic.perform
        for code,body in ((500,None),(200,b'not-json')):
            with peer(status=code,body=body) as (port,_,_):
                startup=scenario.Scenario(None,'owned_token',Path('/unused'),lambda *_:None)
                def response(case,token):
                    return original(case,token,_connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3))
                with patch.object(scenario.traffic,'perform',side_effect=response) as call:
                    with self.assertRaises(ValueError):startup.ready(_recovery=True)
                self.assertEqual(call.call_count,1)
                self.assertEqual(startup.journal._windows,[])

        # Optional diagnostics preserve an active failure, including its identity.
        primary=ValueError('private-primary');interrupt=KeyboardInterrupt('private-secondary')
        def interrupted_contract(kind,value):
            if value=='gateway_recovery_contract':raise interrupt
        startup=scenario.Scenario(None,'owned_token',Path('/unused'),interrupted_contract)
        with patch.object(scenario.traffic,'perform',side_effect=primary):
            with self.assertRaises(BaseException) as caught:startup.ready(_recovery=True)
        self.assertIs(caught.exception,primary)
        def interrupted(*_):raise interrupt
        startup=scenario.Scenario(None,'owned_token',Path('/unused'),interrupted)
        with patch.object(scenario.traffic,'perform') as perform:
            with self.assertRaises(KeyboardInterrupt) as caught:startup.ready(_recovery=True)
        self.assertIs(caught.exception,interrupt);perform.assert_not_called()
        for active in (False,True):
            with self.subTest(outage_primary=active):
                changes=[]
                class Targets:
                    def change(self,*args):changes.append(args)
                def marker(kind,value):
                    if kind=='recovery_checkpoint':raise interrupt
                startup=scenario.Scenario(Targets(),'owned_token',Path('/unused'),marker)
                query={'state':'query_unavailable','observation':None}
                with patch.object(scenario.caddy_query,'query',side_effect=primary if active else None,return_value=query), \
                        patch.object(scenario.mcp_snapshot,'read_snapshot',side_effect=scenario.caddy_mcp.QueryUnavailable):
                    with self.assertRaises(BaseException) as caught:startup.outages()
                self.assertIs(caught.exception,primary if active else interrupt)
                self.assertEqual(changes,[('gateway','stop'),('gateway','start')])

        # A baseline accepted just before the next scrape cannot contain the seed
        # and a clean later frame within the strict10s source-cohort comparison.
        # Drive the actual partition caller, seed, journal and whole MCP oracle.
        from types import SimpleNamespace
        import math
        now=[100.5];events=[];visibility_lag=[0]
        clock=SimpleNamespace(time=lambda:now[0],monotonic=lambda:now[0],
            sleep=lambda seconds:now.__setitem__(0,now[0]+seconds))
        groups=(('GET',200),('GET',401),('GET',403),('GET',502),('POST',200),('POST',413))
        def frame(point,completed,previous=None):
            stamp=.585+5.01*math.floor((point-visibility_lag[0]-.585)/5.01)
            counts={group:1 for group in groups}
            for end,method,code,count in events:
                if end<stamp:counts[method,code]+=count
            values,stamps=acquisition(point=point,stamp=stamp)
            rows=values['data']['result'];labels={'server':'srv0','handler':'subroute'}
            rows[:]=rows[:4]
            rows[1]['value'][1]=str(sum(counts.values()));rows[2]['value'][1]=str(counts['GET',502]);rows[3]['value'][1]='0'
            def add(name,value,**extra):
                rows.append({'metric':{'__name__':name,'job':'platform-caddy','instance':'pilot',**labels,**extra},'value':[point,str(value)]})
            for (method,code),count in counts.items():
                for bound in scenario.status.BUCKETS:add(scenario.status.DURATION+'bucket',count,method=method,code=str(code),le=bound)
                add(scenario.status.DURATION+'sum',count/1000,method=method,code=str(code))
                add(scenario.status.DURATION+'count',count,method=method,code=str(code))
            import copy
            stamps=copy.deepcopy(values)
            for row in stamps['data']['result']:
                row['metric']['source_metric']=row['metric']['__name__'];row['value'][1]=str(stamp)
            current={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),
                     'evaluated_at':point,'completed_at':completed}
            return scenario.status.evaluate(**current,previous=previous),current
        def canonical(*args,previous=None,**kwargs):
            point=math.floor(now[0]);now[0]+=.02
            result,current=frame(point,now[0],previous)
            events.append((now[0],'GET',200,2));result['transport']['canonical']='passed'
            return result,current
        def perform(case,token):
            started=now[0];now[0]+=.3;method,code=scenario.traffic.CASES[case]
            if type(code) is tuple:code=200
            events.append((now[0],method,code,1))
            return {'started':started,'completed':now[0],'method':method,'code':code}
        def mcp(*,evaluated_at,previous=None):
            result,current=frame(evaluated_at,now[0],previous);result['transport']['mcp']='passed'
            return result,current
        @contextmanager
        def native(*args,**kwargs):yield mcp
        experiment=scenario.Scenario(SimpleNamespace(change=lambda *_:None,native_metrics=lambda:{'request_errors_total':1}),
                                     'owned_token',Path('/unused'),lambda kind,value:None)
        experiment.deadline=700
        with patch.object(scenario,'time',clock),patch.object(scenario.caddy_query,'read_snapshot',side_effect=canonical), \
                patch.object(scenario.traffic,'perform',side_effect=perform),patch.object(scenario.mcp_snapshot,'session',native):
            experiment.partition(94)
        self.assertEqual(experiment.last_report['transport'],{'canonical':'passed','mcp':'passed'})
        self.assertLess(experiment.acquisitions,16)
        self.assertLess(now[0]-100.5,60)

        # Publication lag cannot commit an aged predicted baseline and start seed.
        visibility_lag[0]=5;now[0]=100.5;events.clear()
        experiment=scenario.Scenario(SimpleNamespace(change=lambda *_:None,native_metrics=lambda:{'request_errors_total':1}),
                                     'owned_token',Path('/unused'),lambda kind,value:None)
        experiment.deadline=700
        with patch.object(scenario,'time',clock),patch.object(scenario.caddy_query,'read_snapshot',side_effect=canonical), \
                patch.object(scenario.traffic,'perform',side_effect=perform),patch.object(scenario.mcp_snapshot,'session',native):
            with self.assertRaises(TimeoutError):experiment.partition(94)
        self.assertEqual(now[0],160.5)
        self.assertTrue(all(count==2 for _,_,_,count in events))
        self.assertLess(experiment.acquisitions,128)
