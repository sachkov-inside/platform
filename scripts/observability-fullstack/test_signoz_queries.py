"""SOURCE-MODEL contracts, not native ClickHouse/Prometheus/OTLP execution."""
import copy
from dataclasses import replace
import re
import json
from pathlib import Path
import tempfile
import unittest

import fullstack
from test_cpu_control import assemble, pins, SOURCE
import signoz_queries

START=1800000000000
CUT=START+20000
SOURCE_COLUMNS=('source','available','observed_at_seconds','available_sample_ms','observed_sample_ms','available_series','observed_series','duplicate_samples','flagged_samples','bad_samples','evaluation_ms')


def response(columns,rows,*,phase=4,cut=CUT):
    columns=(*columns,'query_phase','query_cut_ms','query_source_sha')
    rows=[[*row,phase,cut,SOURCE] for row in rows]
    return json.dumps({'status':'success','data':{'type':'scalar','data':{'results':[
        {'queryName':'A','columns':[{'name':name} for name in columns],'data':rows}]}}}).encode()


class RepresentativeQueries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=tempfile.TemporaryDirectory();cls.addClassCleanup(cls.directory.cleanup)
        root=Path(cls.directory.name).resolve()
        output,primary=assemble(root,'queries',control=False)
        cls.layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
            source={'commit':SOURCE,'tree':'b'*40},images=pins(),
            project='inside-observability-representative-'+'1'*12,nonce='2'*32,uid=1001,gid=1001)


    def reader(self,phase=4,cut=CUT,**options):
        return signoz_queries.RepresentativeReads(self.layout,phase,START,cut,**options)

    def test_actual_closed_layout_builds_native_retained_query_and_zero_is_not_absence(self):
        reads=self.reader();request=reads.prepare('retained_probes',{})
        query=request.payload['compositeQuery']['queries'][0]['spec']['query']
        self.assertEqual(request.path,'/api/v5/query_range')
        self.assertIn("metric_name = 'pilot_requests'",query)
        self.assertIn("resource_attrs['service.version'] = '1566156615661566156615661566156615660004'",query)
        self.assertIn('distributed_time_series_v4',query)
        self.assertIn('unix_milli >= 1800000000000',query)
        self.assertIn('max_execution_time=5',query)
        self.assertIn("result_overflow_mode='throw'",query)
        self.assertNotIn('LIMIT 1000',query)
        columns=['raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples','first_ms','last_ms']
        self.assertEqual(reads.observe(request,200,response(columns,[[0,0,0,0,0,0,0,0]])),{'ok':True,'count':0})
        self.assertEqual(reads.observe(request,200,response(columns,[])),{'ok':False,'reason':'schema'})
        self.assertNotIn('1'*12,repr(request));self.assertNotIn('2'*32,repr(request))

    def source_rows(self,available=1,cut=CUT):
        return [['postgresql',available,(cut-1000)/1000,cut-500,cut-500,1,1,0,0,0,cut],
                ['caddy',1,(cut-2000)/1000,cut-500,cut-500,1,1,0,0,0,cut]]

    def test_each_live_poll_has_fresh_trusted_cut_and_new_zero_never_falls_back_to_old_one(self):
        first=self.reader(cut=CUT-2000);second=self.reader(cut=CUT)
        first_request=first.prepare('source_status',{});second_request=second.prepare('source_status',{})
        query=second_request.payload['compositeQuery']['queries'][0]['spec']['query']
        self.assertIn('argMax(value, unix_milli)',query)
        self.assertIn("resource_attrs['service.name'] = 'platform-owner-cache'",query)
        self.assertIn("resource_attrs['service.instance.id'] = 'production-host'",query)
        self.assertNotIn('unix_milli <=',query)
        self.assertEqual(first_request.payload['end'],CUT-2000)
        self.assertEqual(second_request.payload['end'],CUT)
        old=first.observe(first_request,200,response(SOURCE_COLUMNS,self.source_rows(cut=CUT-2000),cut=CUT-2000))
        current=second.observe(second_request,200,response(SOURCE_COLUMNS,self.source_rows(available=0)))
        self.assertTrue(old['ok']);self.assertFalse(current['ok'])
        self.assertEqual(current['reason'],'unavailable')
        self.assertEqual(current['sources']['postgresql']['available'],0)
        self.assertEqual(current['sources']['postgresql']['observed_age_seconds'],1)
        self.assertEqual(current['sources']['postgresql']['sample_age_seconds'],.5)
        self.assertEqual(current['evaluation_seconds'],CUT/1000)
        with self.assertRaises(ValueError):second.observe(first_request,200,response(SOURCE_COLUMNS,self.source_rows()))

    def test_source_future_latest_stale_flags_duplicates_wrong_source_and_missing_are_unknown(self):
        reader=self.reader();request=reader.prepare('source_status',{})
        for name,index,value in [('future_sample',3,CUT+1),('future_observation',2,CUT/1000+.001),
            ('stale_sample',4,CUT-10001),('stale_observation',2,(CUT-10001)/1000),
            ('two_series',5,2),('duplicate',7,1),('flagged',8,1),('nonfinite',9,1),('wrong_source',0,'private-canary'),
            ('bool_available',1,True),('fractional',1,.5)]:
            with self.subTest(name=name):
                rows=self.source_rows();rows[0][index]=value
                actual=reader.observe(request,200,response(SOURCE_COLUMNS,rows))
                self.assertFalse(actual['ok']);self.assertNotIn('private-canary',json.dumps(actual))
        for rows in [[],self.source_rows()[:1],self.source_rows()*2]:
            with self.subTest(rows=len(rows)):self.assertFalse(reader.observe(request,200,response(SOURCE_COLUMNS,rows))['ok'])

    def test_native_api_lag_uses_sanitized_sdk_release_and_never_prometheus_renamed_aliases(self):
        reads=self.reader();request=reads.prepare('api_lag',{})
        query=request.payload['compositeQuery']['queries'][0]['spec']['query']
        self.assertIn("resource_attrs['service.name'] = 'platform-api'",query)
        self.assertIn("resource_attrs['service.version'] = '_OTHER'",query)
        self.assertNotIn('http_server_request_duration_seconds',query)
        cols=('raw_count','sample_ms','flagged_samples','bad_samples')
        self.assertEqual(reads.observe(request,200,response(cols,[[2,CUT-1250,0,0]])),{'ok':True,'age_seconds':1.25,'sample_time_seconds':(CUT-1250)/1000})
        for row in [[0,0,0,0],[1,CUT+1,0,0],[1,START-1,0,0],[1,CUT,1,0],[1,CUT,0,1]]:
            with self.subTest(row=row):self.assertFalse(reads.observe(request,200,response(cols,[row]))['ok'])
        stale=self.reader(cut=START+70000);stale_request=stale.prepare('api_lag',{})
        self.assertFalse(stale.observe(stale_request,200,response(cols,[[1,START+1,0,0]],cut=START+70000))['ok'])

    def test_three_signal_readiness_is_only_query_visibility_and_empty_store_is_valid(self):
        reads=self.reader()
        for op in ('readiness_metrics','readiness_traces','readiness_logs'):
            with self.subTest(op=op):
                request=reads.prepare(op,{})
                value=reads.observe(request,200,response(('count',),[[1 if op=='readiness_metrics' else 0]]))
                self.assertEqual(value,{'ok':True})
                self.assertNotIn('count',value)
                self.assertFalse(reads.observe(request,400,response(('count',),[[0]]))['ok'])

    def test_sdk_correlated_counts_are_source_scoped_but_are_not_actor_or_mcp_parity_proof(self):
        reads=self.reader()
        for op in ('correlated_traces','correlated_logs'):
            request=reads.prepare(op,{})
            query=request.payload['compositeQuery']['queries'][0]['spec']['query']
            self.assertIn('platform-api',query);self.assertIn(SOURCE,query)
            self.assertIn('trace_id GLOBAL IN',query)
            cols=('raw_count','distinct_ids','first_ms','last_ms','bad_ids')
            self.assertEqual(reads.observe(request,200,response(cols,[[3,3,START,CUT-1,0]])),{'ok':True,'count':3})
            self.assertEqual(reads.observe(request,200,response(cols,[[0,0,0,0,0]])),{'ok':True,'count':0})
            self.assertFalse(reads.observe(request,200,response(cols,[[3,2,START,CUT,0]]))['ok'])

    def web_witness(self):
        return {'ok':True,'positive_count':3,'not_found_count':2,'process_start_seconds':(START-1000)/1000,'observed_at_seconds':(CUT-2000)/1000}

    def web_row(self):
        values={'info':1,'epoch':(START-1000)/1000,'observed':(CUT-1000)/1000,'positive':4,'negative':3,'up':1}
        row={}
        for name,value in values.items():row.update({name:value,name+'_ms':CUT-500,name+'_series':1})
        return row|{'duplicate_samples':0,'flagged_samples':0,'bad_samples':0}

    def test_current_web_cohort_requires_real_source_epoch_and_counter_sample_cut(self):
        reads=self.reader(web=self.web_witness());request=reads.prepare('web_current',{})
        query=request.payload['compositeQuery']['queries'][0]['spec']['query']
        self.assertIn("attrs['source_sha'] = '"+SOURCE+"'",query)
        self.assertIn("resource_attrs['service.instance.id'] = 'web'",query)
        self.assertIn("metric_name = 'inside_web_http_requests_total'",query)
        self.assertIn("temporality = 'Cumulative'",query)
        row=self.web_row()
        self.assertEqual(reads.observe(request,200,response(tuple(row),[list(row.values())])),{'ok':True})
        for key,value in [('epoch',START/1000),('positive_ms',CUT-2001),('observed',CUT/1000+.01),
            ('observed', (CUT-10001)/1000),('negative',1),('info_series',0),('positive_series',2),
            ('duplicate_samples',1),('flagged_samples',1),('up',0)]:
            with self.subTest(key=key,value=value):
                bad=row|{key:value};self.assertFalse(reads.observe(request,200,response(tuple(bad),[list(bad.values())]))['ok'])
        with self.assertRaises(ValueError):self.reader().prepare('web_current',{})
        initial=self.reader();request=initial.prepare('web_initial',{})
        self.assertEqual(initial.observe(request,200,response(tuple(row),[list(row.values())])),{'ok':True})

    def test_retained_indices_reject_duplicates_fractional_flags_and_1000_row_boundary_without_pagination(self):
        reader=self.reader();request=reader.prepare('retained_probes',{})
        cols=('raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples','first_ms','last_ms')
        valid=[400,400,1,400,0,0,START,CUT]
        self.assertEqual(reader.observe(request,200,response(cols,[valid])),{'ok':True,'count':400})
        for index,value in [(0,1000),(0,1001),(0,True),(0,1.5),(1,399),(2,0),(3,401),(4,1),(5,1),(6,START-1),(7,CUT+1),(3,float('inf'))]:
            with self.subTest(index=index,value=value):
                row=valid.copy();row[index]=value
                self.assertFalse(reader.observe(request,200,response(cols,[row]))['ok'])
        for count in (1000,1001):
            self.assertFalse(reader.observe(request,200,response(cols,[[count,count,1,count,0,0,START,CUT]]))['ok'])

    def test_native_json_schema_partial_warning_400_duplicate_keys_and_unbounded_shapes_refuse_without_echo(self):
        reader=self.reader();request=reader.prepare('readiness_metrics',{})
        good=response(('count',),[[1]])
        base=json.loads(good)
        cases=[good.decode().encode('utf-16'),b'',b'private-canary',b'['*17+b'0'+b']'*17,b' '*65537,
            good.replace(b'"status": "success"',b'"status":"success","status":"success"'),
            response(('count',),[[True]]),response(('count',),[[.5]]),response(('count',),[[float('nan')]]),
            response(('count',),[[float('inf')]]),response(('count',),[[2**53]]),response(('count',),[]),
            response(('count',),[[1]]*5),response(('count','count'),[[1,1]])]
        for mutation in ('warning','partial','type','queryName','results','column','extra'):
            value=copy.deepcopy(base);native=value['data'];table=native['data']['results'][0]
            if mutation=='warning':native['warning']={'message':'private-canary'}
            elif mutation=='partial':table['partial']=True
            elif mutation=='type':native['type']='time_series'
            elif mutation=='queryName':table['queryName']='B'
            elif mutation=='results':native['data']['results']*=2
            elif mutation=='column':table['columns'][0]['name']='private-canary'
            else:value['private-canary']='private-canary'
            cases.append(json.dumps(value).encode())
        for body in cases:
            with self.subTest(size=len(body)):
                actual=reader.observe(request,200,body)
                self.assertEqual(actual,{'ok':False,'reason':'schema'})
        for status in (0,True,400,429,500):self.assertFalse(reader.observe(request,status,good)['ok'])

    def test_closed_inputs_phase_pair_mode_source_and_request_identity_do_not_admit_agent_fragments(self):
        for phase in (False,-1,14,1.5,'4; DROP TABLE'):
            with self.subTest(phase=phase),self.assertRaises(ValueError):self.reader(phase=phase)
        for start,cut in [(True,CUT),(START,True),(START,START),(START,CUT+600000),(START,float('inf')),(START,2**53-1)]:
            with self.subTest(start=start,cut=cut),self.assertRaises(ValueError):
                signoz_queries.RepresentativeReads(self.layout,4,start,cut)
        for phase,pair,mode in [(0,0,'off'),(3,0,'on'),(6,1,'off'),(9,1,'on'),(12,None,'outage'),(13,None,'recovery')]:
            # Phase numbering is the existing canonical cohort, independent of execution reversal.
            reader=self.reader(phase=phase);self.assertEqual((reader.binding['pair'],reader.binding['mode']),(pair,mode))
        reader=self.reader();request=reader.prepare('retained_probes',{})
        for operation,parameters in [('raw_sql',{}),('/api/v5/query_range',{}),('retained_probes',{'phase':4}),('source_status',{'cut':CUT}),('retained_probes',None)]:
            with self.subTest(operation=operation,parameters=parameters),self.assertRaises(ValueError):reader.prepare(operation,parameters)
        for changed in (replace(request,_operation='raw_sql'),replace(request,_payload='private-canary'),
            replace(request,_binding='private-canary'),self.reader(phase=5).prepare('retained_probes',{}),
            self.reader().prepare('retained_probes',{})):
            with self.assertRaises(ValueError):reader.observe(changed,200,b'{}')
        snapshot=request.payload;snapshot['compositeQuery']['queries'][0]['spec']['query']='private-canary'
        self.assertNotIn('private-canary',json.dumps(request.payload))
        binding=reader.binding;binding['source']['commit']='f'*40
        self.assertEqual(reader.binding['source']['commit'],SOURCE)
        with self.assertRaises(ValueError):signoz_queries.RepresentativeReads(object(),4,START,CUT)
        with self.assertRaises(ValueError):self.reader(web=self.web_witness()|{'positive_count':True})

    def test_pinned_policy_source_chain_distinguishes_app_release_and_separate_sdk_source_sha(self):
        import signoz_ingestion
        text=signoz_ingestion.edge_config()
        pattern=r'^([0-9a-f]{40}|[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4})$'
        self.assertIn('set(attributes["service.version"], "_OTHER")',text)
        self.assertIsNone(re.fullmatch(pattern,'v1'))
        self.assertIsNotNone(re.fullmatch(pattern,SOURCE))
        api=self.reader().prepare('api_lag',{}).payload
        self.assertIn("resource_attrs['service.version'] = '_OTHER'",api['compositeQuery']['queries'][0]['spec']['query'])
        self.assertNotIn("attrs['source_sha']",api['compositeQuery']['queries'][0]['spec']['query'])

    def test_fresh_controller_clock_is_captured_once_for_each_live_reader_not_planned_phase_end(self):
        calls=[]
        def clock():
            value=(CUT+len(calls)*2000)/1000;calls.append(value);return value
        requests=[]
        for _ in range(2):
            current_cut_ms=int(clock()*1000)
            reader=signoz_queries.RepresentativeReads(self.layout,4,START,current_cut_ms)
            request=reader.prepare('source_status',{})
            actual=reader.observe(request,200,response(SOURCE_COLUMNS,self.source_rows(cut=current_cut_ms),cut=current_cut_ms))
            self.assertTrue(actual['ok']);self.assertEqual(actual['evaluation_seconds'],calls[-1]);requests.append(request)
        self.assertEqual(len(calls),2)
        self.assertEqual([request.payload['end'] for request in requests],[CUT,CUT+2000])

    def test_native_response_query_binding_refuses_other_phase_cut_or_source_even_with_valid_counts(self):
        reader=self.reader();request=reader.prepare('readiness_metrics',{})
        good=response(('count',),[[1]])
        self.assertEqual(reader.observe(request,200,good),{'ok':True})
        for index,value in [(1,5),(2,CUT+1),(3,'f'*40),(1,True)]:
            native=json.loads(good);native['data']['data']['results'][0]['data'][0][index]=value
            self.assertEqual(reader.observe(request,200,json.dumps(native).encode()),{'ok':False,'reason':'schema'})


if __name__=='__main__':unittest.main()
