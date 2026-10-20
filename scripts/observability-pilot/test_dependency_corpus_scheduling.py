"""Dependency scheduling through real builders/oracles and owned deterministic I/O boundaries."""
import copy
import datetime
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import dependency_privacy
import pilot
from test_dependency_privacy import communications_rows, metric_rows, telegram_http_rows, trace_rows

PAIRS=(('dependency','json'),('dependency','protobuf'),('communications','json'),
       ('communications','protobuf'),('telegram-http','json'),('telegram-http','protobuf'))
STAMPS=tuple(1790000000000000000+i*1_000_000_000 for i in range(6))


class CorpusBoundary:
    """One test-owned virtual clock for upload visibility, reads, and existing polling."""
    def __init__(self, *, delay=0, read_cost=0):
        self.delay=delay;self.read_cost=read_cost;self.clock=0.;self.events=[];self.sent=[]
        self.reads=[];self.ready={};self.proof=None;self.readiness=[];self.guards=0
        self.post_failure=None;self.guard_failure=None;self.logging_failure=None
        self.trace_fault=None;self.metric_fault=None;self.cancellation=None

    def tick(self,seconds):self.clock+=seconds

    def logging(self,*args):
        self.events.append(('logging',))
        if self.logging_failure is not None:raise self.logging_failure

    def identity(self):
        self.guards+=1
        if self.guard_failure==self.guards:raise RuntimeError('controlled identity refusal')

    def request(self,path, *, token=None,body=None,method='GET',port=18427):
        if method=='POST':
            index=len(self.sent)
            assert self.events[0]==('logging',) and self.guards==index+1,'controlled ingress guard order'
            assert token is None and method=='POST' and port==14318,'controlled ingress scope'
            pair=PAIRS[0 if index<4 else 1 if index<8 else 2+(index-8)//2]
            self.events.append(('post',index));self.sent.append((path,copy.deepcopy(body),port))
            if self.cancellation is not None and index==5:raise self.cancellation
            if self.post_failure is not None and self.post_failure[0]==index:
                if self.post_failure[1]=='transport':raise OSError('controlled transport refusal')
                return 503,''
            self.ready[pair]=self.clock+self.delay
            return 200,''
        assert token=='controlled-token' and port==18427 and body is None,'controlled metric read scope'
        self.events.append(('metric',path));rows=metric_rows()
        if self.metric_fault=='private':rows[-1]['metric']['url.full']='controlled-private'
        elif self.metric_fault=='extra':
            row=copy.deepcopy(rows[0]);row['metric']['__name__']='inside.dependency.extra';rows.append(row)
        elif self.metric_fault=='label':rows[-1]['metric']['unknown']='controlled-private'
        elif self.metric_fault=='partial':rows=rows[:-1]
        elif self.metric_fault=='last':rows[-1]['value'][1]='NaN'
        return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':rows}})

    def trace(self,compose,name):
        pair=next(pair for pair in PAIRS if '-'.join(pair)==name);index=PAIRS.index(pair)
        self.events.append(('read',name));self.reads.append(name);self.tick(self.read_cost)
        if self.trace_fault==(index,'decode'):return '{'
        if self.trace_fault==(index,'refused'):raise RuntimeError('controlled stored read refusal')
        if self.clock<self.ready[pair] or self.trace_fault==(index,'incomplete'):return ''
        factory=trace_rows if pair[0]=='dependency' else communications_rows if pair[0]=='communications' else telegram_http_rows
        rows=factory(pair[1])
        if pair[0]=='telegram-http':
            stamp=STAMPS[index];seconds,nanos=divmod(stamp,1_000_000_000)
            value=datetime.datetime.fromtimestamp(seconds,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
            for row in rows:
                row.update(start_time_unix_nano=str(stamp),end_time_unix_nano=str(stamp+1_000_000),
                           _time=value+('.'+str(nanos).rjust(9,'0') if nanos else '')+'Z')
        if self.trace_fault is not None and self.trace_fault[0]==index:
            fault=self.trace_fault[1]
            if fault=='private':rows[-1]['span_attr:authorization']='controlled-private'
            elif fault=='identity':rows[-1]['span_id']='f'*16
            elif fault=='extra':rows.append(copy.deepcopy(rows[-1]))
            elif fault=='duplicate':rows[-1]=copy.deepcopy(rows[0])
            elif fault=='timestamp':rows[-1]['start_time_unix_nano']='1'
        return '\n'.join(json.dumps(row) for row in rows)

    def run(self):
        with tempfile.TemporaryDirectory() as directory,ExitStack() as stack:
            root=Path(directory)
            for target,value in (('verify_trace_store_logging',self.logging),('assert_docker_identity',self.identity),
                                 ('request',self.request),('fixture_trace_rows',self.trace)):
                stack.enter_context(patch.object(pilot,target,side_effect=value))
            stack.enter_context(patch.object(pilot.time,'time_ns',side_effect=iter(STAMPS)))
            stack.enter_context(patch.object(pilot.time,'monotonic',side_effect=lambda:self.clock))
            stack.enter_context(patch.object(pilot.time,'sleep',side_effect=self.tick))
            try:pilot.dependency_catalog_corpus('controlled-token',root,('owned-compose',))
            finally:
                path=root/'dependency-collector.json'
                if path.exists():self.proof=json.loads(path.read_text())
                path=root/'readiness.json'
                if path.exists():self.readiness=json.loads(path.read_text())


class DependencyScheduling(unittest.TestCase):
    def test_all_fixed_uploads_precede_full_reads_with_original_wire_and_per_pair_stamps(self):
        boundary=CorpusBoundary();boundary.run()
        operations=[event[0] for event in boundary.events]
        self.assertEqual(operations,['logging']+['post']*16+['read']*6+['metric'])
        self.assertEqual(boundary.guards,16)
        self.assertEqual(boundary.reads,['-'.join(pair) for pair in PAIRS])
        expected=[]
        builders={'communications':dependency_privacy.communications_payloads,'telegram-http':dependency_privacy.telegram_http_payloads}
        for (partition,transport),stamp in zip(PAIRS,STAMPS):
            batches=dependency_privacy.payload_batches(transport,stamp) if partition=='dependency' else (builders[partition](transport,stamp),)
            for batch in batches:
                for signal,body in batch.items():expected.append(('/v1/'+signal,body,14318))
        self.assertTrue(boundary.sent==expected,'all sixteen original unsafe wire bodies must remain byte/JSON equal')
        self.assertEqual(boundary.proof['outcome'],'passed')
        self.assertEqual([(c['partition'],c['transport']) for c in boundary.proof['cases']],list(PAIRS))
        self.assertEqual(boundary.proof['metrics'],{'stored_series':440,'metric_labelsets':86,'pool_series':10,'privacy':'passed'})
        self.assertEqual(boundary.events[-1],('metric','/metrics/api/v1/query?query=%7B__name__%3D~%22.%2B%22%7D'))
        self.assertEqual([row['probe'] for row in boundary.readiness],
            [partition+'_full_storage_'+transport for partition,transport in PAIRS]+['dependency_metric_catalog'])

    def test_each_original_stamp_and_oracle_flags_are_used_after_ingress(self):
        original=dependency_privacy.stored_traces;observed=[]
        def oracle(raw,transport,**kwargs):
            observed.append((transport,kwargs.copy()))
            return original(raw,transport,**kwargs)
        with patch.object(dependency_privacy,'stored_traces',side_effect=oracle):
            boundary=CorpusBoundary();boundary.run()
        self.assertEqual(observed,[(transport,{'communications':partition=='communications',
            'telegram_http':partition=='telegram-http','now_ns':stamp})
            for (partition,transport),stamp in zip(PAIRS,STAMPS)])
        self.assertEqual(boundary.proof['cases'],[
            {'transport':transport,'stored_spans':35 if partition=='dependency' else 2 if partition=='communications' else 8,
             'registered_completions':32 if partition=='dependency' else 2 if partition=='communications' else 8,
             'causality':'passed','fallback':'passed' if partition=='dependency' else 'not_applicable',
             'privacy':'passed','partition':partition} for partition,transport in PAIRS])

    def test_latency_model_shares_visibility_wait_but_keeps_every_read_cost(self):
        for delay,cost,expected in ((0,0,0),(4,0,4),(4,.5,6.75)):
            with self.subTest(delay=delay,read_cost=cost):
                boundary=CorpusBoundary(delay=delay,read_cost=cost);boundary.run()
                self.assertEqual(boundary.clock,expected)
                self.assertEqual(boundary.proof['outcome'],'passed')
                self.assertEqual(len(boundary.sent),16)
                self.assertEqual(set(boundary.reads),{'-'.join(pair) for pair in PAIRS})
                self.assertTrue(all(row['outcome']=='passed' for row in boundary.readiness))

    def refused(self,boundary,stage,prefix):
        with self.assertRaises(RuntimeError) as caught:boundary.run()
        self.assertEqual(caught.exception.args,('dependency collector proof failed; raw diagnostics withheld',))
        self.assertEqual(boundary.proof['outcome'],'failed')
        self.assertEqual(boundary.proof['stage'],stage)
        self.assertEqual([(c['partition'],c['transport']) for c in boundary.proof['cases']],list(PAIRS[:prefix]))
        self.assertNotIn('controlled-private',json.dumps(boundary.proof))
        self.assertNotIn('controlled-token',json.dumps(boundary.proof))

    def test_each_post_failure_refuses_before_any_reads_with_honest_empty_cases(self):
        stages=[partition+'_'+transport+'_'+signal for partition,transport in PAIRS
                for batch in range(2 if partition=='dependency' else 1) for signal in ('traces','metrics')]
        for index in range(16):
            for fault in ('status','transport'):
                with self.subTest(position=index,fault=fault):
                    boundary=CorpusBoundary();boundary.post_failure=(index,fault)
                    self.refused(boundary,'ingest_'+stages[index],0)
                    self.assertEqual(len(boundary.sent),index+1)
                    self.assertEqual(boundary.reads,[])
                    self.assertFalse(any(event[0]=='metric' for event in boundary.events))

    def test_logging_and_every_original_identity_guard_stop_unsafe_ingress(self):
        boundary=CorpusBoundary();boundary.logging_failure=RuntimeError('controlled logging refusal')
        self.refused(boundary,'logging',0);self.assertEqual(boundary.sent,[])
        stages=[partition+'_'+transport+'_'+signal for partition,transport in PAIRS
                for batch in range(2 if partition=='dependency' else 1) for signal in ('traces','metrics')]
        for guard in range(1,17):
            with self.subTest(guard=guard):
                boundary=CorpusBoundary();boundary.guard_failure=guard
                self.refused(boundary,'ingest_'+stages[guard-1],0)
                self.assertEqual(len(boundary.sent),guard-1);self.assertEqual(boundary.reads,[])

    def test_every_full_trace_oracle_refuses_late_poison_and_keeps_only_successful_read_prefix(self):
        for index,pair in enumerate(PAIRS):
            for fault in ('decode','refused','private','identity','extra','duplicate'):
                with self.subTest(pair=index,fault=fault):
                    boundary=CorpusBoundary();boundary.trace_fault=(index,fault)
                    self.refused(boundary,'storage_'+'_'.join(pair),index)
                    self.assertEqual(len(boundary.sent),16)
                    self.assertEqual(boundary.reads,['-'.join(p) for p in PAIRS[:index+1]])
                    self.assertFalse(any(event[0]=='metric' for event in boundary.events))
        for index in (4,5):
            boundary=CorpusBoundary();boundary.trace_fault=(index,'timestamp')
            self.refused(boundary,'storage_'+'_'.join(PAIRS[index]),index)

    def test_every_incomplete_partition_uses_the_original_poll_deadline_and_refuses(self):
        for index,pair in enumerate(PAIRS):
            with self.subTest(pair=index):
                boundary=CorpusBoundary();boundary.trace_fault=(index,'incomplete')
                self.refused(boundary,'storage_'+'_'.join(pair),index)
                self.assertEqual(len(boundary.sent),16)
                self.assertEqual(boundary.clock,60)
                self.assertEqual(boundary.readiness[-1]['outcome'],'timed_out')
                self.assertEqual(boundary.readiness[-1]['attempts'],240)
                self.assertEqual(set(boundary.reads),{'-'.join(p) for p in PAIRS[:index+1]})
                self.assertFalse(any(event[0]=='metric' for event in boundary.events))

    def test_final_whole_metric_vector_stays_after_six_reads_and_rejects_poison_or_pending(self):
        for fault in ('private','extra','label','partial','last'):
            with self.subTest(fault=fault):
                boundary=CorpusBoundary();boundary.metric_fault=fault
                self.refused(boundary,'metrics',6)
                self.assertEqual(len(boundary.sent),16)
                self.assertEqual(boundary.reads,['-'.join(p) for p in PAIRS])
                self.assertEqual(boundary.clock,60 if fault=='partial' else 0)

    def test_cancellation_remains_same_primary_and_never_fabricates_terminal_proof(self):
        for kind in (KeyboardInterrupt,SystemExit):
            error=kind('controlled cancellation');boundary=CorpusBoundary();boundary.cancellation=error
            with self.assertRaises(kind) as caught:boundary.run()
            self.assertIs(caught.exception,error)
            self.assertIsNone(boundary.proof)
            self.assertEqual(len(boundary.sent),6);self.assertEqual(boundary.reads,[])
