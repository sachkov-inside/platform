"""Owned loopback HTTP scalar and MCP contracts; no external providers."""
import copy
from contextlib import contextmanager, nullcontext
from http.server import BaseHTTPRequestHandler, HTTPServer
import http.client
import hashlib
import json
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import control
import functional_witness as witness


def scalar(count):
    return {'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':'count'}],'data':[[count]]}]}}


class ClosedProtocol(unittest.TestCase):
    @contextmanager
    def http_fixture(self,replies,*,read_error=None):
        calls=[];connections=[]
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*_args):pass
            def request(self):
                length=int(self.headers.get('Content-Length','0'))
                body=self.rfile.read(length) if length else None
                calls.append((self.command,self.path,body,dict(self.headers)))
                status,payload=replies[len(calls)-1]
                self.send_response(status);self.send_header('Content-Length',str(len(payload)))
                self.end_headers();self.wfile.write(payload)
            do_GET=request
            do_POST=request
        server=HTTPServer(('127.0.0.1',0),Handler)
        # Every subcase owns a server. Bound idle shutdown polling so repeated
        # fixtures leave room for the full suite's unchanged 30-second budget.
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.001))
        connection=http.client.HTTPConnection
        class Connection(connection):
            def __init__(self,host,port,**kwargs):
                self.fixture_host=(host,port);self.fixture_timeout=kwargs['timeout'];self.close_calls=0;self.fixture_reads=[]
                super().__init__(host,port,**kwargs) if host=='127.0.0.1' else super().__init__('127.0.0.1',server.server_port,**kwargs)
                connections.append(self)
            def getresponse(self):
                response=super().getresponse()
                read=response.read
                def measured_read(*args):
                    payload=read(*args);self.fixture_reads.append((args,len(payload)));return payload
                response.read=measured_read
                if read_error is not None:
                    measured=response.read
                    def interrupted_read(*args):
                        measured(*args)
                        try:raise read_error
                        except BaseException:
                            self.fixture_read_traceback=read_error.__traceback__
                            raise
                    response.read=interrupted_read
                return response
            def close(self):
                self.close_calls+=1
                super().close()
        thread.start()
        try:
            with patch.object(witness.http.client,'HTTPConnection',Connection),patch.object(control,'DEADLINE',time.monotonic()+5):
                yield calls,connections
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
            self.assertTrue(all(conn.sock is None and conn.close_calls>=1 for conn in connections))

    def functional_run(self,observed=None):
        admission=json.dumps({'owner':'monitoring-1566-signoz-functional','remaining_seconds':600})
        with patch.object(Path,'read_text',return_value=admission),patch.object(control,'bootstrap',side_effect=lambda:control.FUNCTIONAL_HOOK(None,'fixture-viewer-key')),\
            patch.object(control,'FUNCTIONAL_HOOK',None,create=True),patch.object(control,'FUNCTIONAL_STAGE','bootstrap',create=True):
            try:witness.run()
            except BaseException as error:
                control.preserve_failure(error)
                if observed is not None:observed.append((error,control.FUNCTIONAL_STAGE))
                raise

    @staticmethod
    def trace_log_prefix():
        prefix=[(200,b'ok'),(200,json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()),
            (202,b''),(200,json.dumps({'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query'}]}}).encode())]
        prefix += [(200,b'{}')]*3
        retained={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':name} for name in
            ('raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples')],
            'data':[[400,400,1,400,0,0]]}]}}
        prefix += [(200,json.dumps({'status':'success','data':retained}).encode())]
        return prefix

    def test_fixed_trace_payload_uses_canonical_span_key_and_preserves_every_other_field(self):
        # Pinned da556 Normalize/storage resolve span.trace_id to the same FixedString32.
        for trace_id in ('00000000000000000000000000001566','00000000000000000000000000000000'):
            original={'schemaVersion':'v1','start':1729999940125,'end':1730000000125,'requestType':'scalar',
                'compositeQuery':{'queries':[{'type':'builder_query','spec':{'name':'A','signal':'traces',
                    'aggregations':[{'expression':'count()','alias':'count'}],
                    'filter':{'expression':"service.name = 'platform-fallback-control' AND trace_id = '"+trace_id+"'"},'limit':1}}]}}
            expected=copy.deepcopy(original)
            expected['compositeQuery']['queries'][0]['spec']['filter']['expression']=(
                "service.name = 'platform-fallback-control' AND span.trace_id = '"+trace_id+"'")
            with self.subTest(trace_id=trace_id),patch.object(witness.time,'time',return_value=1730000000.125):
                actual=witness.scalar_query('traces',trace_id)
                self.assertEqual(actual,expected)
                restored=copy.deepcopy(actual)
                restored['compositeQuery']['queries'][0]['spec']['filter']=original['compositeQuery']['queries'][0]['spec']['filter']
                self.assertEqual(restored,original)

    def test_fixed_log_payload_bytes_and_closed_correlation_ids_remain_unchanged(self):
        for trace_id in ('00000000000000000000000000001566','00000000000000000000000000000000'):
            expected={'schemaVersion':'v1','start':1729999940125,'end':1730000000125,'requestType':'scalar',
                'compositeQuery':{'queries':[{'type':'builder_query','spec':{'name':'A','signal':'logs',
                    'aggregations':[{'expression':'count()','alias':'count'}],
                    'filter':{'expression':"service.name = 'platform-fallback-control' AND trace_id = '"+trace_id+"'"},'limit':1}}]}}
            with self.subTest(trace_id=trace_id),patch.object(witness.time,'time',return_value=1730000000.125):
                self.assertEqual(json.dumps(witness.scalar_query('logs',trace_id),separators=(',',':')).encode(),
                    json.dumps(expected,separators=(',',':')).encode())
        for signal in ('traces','logs'):
            for trace_id in ('1'*32,'',None,"x' OR 1=1",'00000000000000000000000000001566 '):
                with self.subTest(signal=signal,trace_id=trace_id),self.assertRaises(control.ControlFailure):
                    witness.scalar_query(signal,trace_id)
        for signal in ('metrics','span.traces','',None):
            with self.subTest(signal=signal),self.assertRaises(control.ControlFailure):
                witness.scalar_query(signal,'00000000000000000000000000001566')

    def test_actual_trace_log_chain_distinguishes_signal_polarity_and_scalar_refusal(self):
        # Source counterexample to ambiguity, not a reproduction of the native fault.
        prefix=self.trace_log_prefix()
        for index,stage in enumerate(('traces_positive_scalar_warning','traces_negative_scalar_warning',
                'logs_positive_scalar_warning','logs_negative_scalar_warning')):
            reads=[scalar(1),scalar(0),scalar(1),scalar(0)][:index]
            reads.append({**scalar(1),'warning':'private-trace-log-sentinel'})
            replies=prefix+[(200,json.dumps({'status':'success','data':value}).encode()) for value in reads]
            with self.subTest(stage=stage),self.http_fixture(replies) as (calls,_):
                with self.assertRaises(control.ControlFailure) as caught:self.functional_run()
                self.assertEqual(control.failure_context(caught.exception),{'inside_failed':1,'stage':stage,
                    'category':'ControlFailure','http_status':200,'transport':'query_v5'})
                self.assertEqual(len(calls),9+index)
                self.assertNotIn('private-trace-log-sentinel',json.dumps(control.failure_context(caught.exception)))

    def test_actual_trace_log_chain_separates_query_scalar_and_count_deadlines(self):
        bad_table=scalar(1)['data']['results'][0]
        scalar_cases=[('scalar_type',None),('scalar_type',{}),('scalar_warning',{**scalar(1),'warning':'private-sentinel'}),
            ('scalar_results',{'type':'scalar','data':{'results':[]}}),
            ('scalar_query',{'type':'scalar','data':{'results':[{**bad_table,'queryName':'private-sentinel'}]}}),
            ('scalar_columns',{'type':'scalar','data':{'results':[{**bad_table,'columns':[]}]}}),
            ('scalar_rows',{'type':'scalar','data':{'results':[{**bad_table,'data':[]}]}}),
            ('scalar_number',scalar(True)),('scalar_number',scalar(None)),('scalar_number',scalar(float('nan'))),
            ('scalar_number',scalar(float('inf'))),('scalar_number_range',scalar(-1)),('scalar_number_range',scalar(.5))]
        cases=[(step,(200,json.dumps({'status':'success','data':value}).encode()),control.ControlFailure) for step,value in scalar_cases]
        cases += [('query_response',(503,b'private-sentinel'),control.ControlFailure),
            ('query_response',(200,b'x'*65537),control.ControlFailure),
            ('query_decode',(200,b'private-sentinel'),json.JSONDecodeError),
            ('query_object',(200,b'[]'),control.ControlFailure),
            ('query_envelope',(200,b'{"status":"error","data":"private-sentinel"}'),control.ControlFailure)]
        for index in range(4):
            signal,polarity=(('traces','positive'),('traces','negative'),('logs','positive'),('logs','negative'))[index]
            before=[(200,json.dumps({'status':'success','data':scalar(count)}).encode()) for count in (1,0,1,0)[:index]]
            for step,reply,category in cases:
                replies=self.trace_log_prefix()+before+[reply]
                with self.subTest(signal=signal,polarity=polarity,step=step),self.http_fixture(replies) as (calls,connections):
                    with self.assertRaises(category) as caught:self.functional_run()
                    context=control.failure_context(caught.exception)
                    self.assertEqual(context,{'inside_failed':1,'stage':signal+'_'+polarity+'_'+step,
                        'category':category.__name__,'http_status':reply[0],'transport':'query_v5'})
                    self.assertEqual(len(calls),len(replies));self.assertEqual(connections[-1].fixture_timeout,10)
                    self.assertEqual(connections[-1].fixture_reads[0][0],(65537,))
                    self.assertNotIn('private-sentinel',json.dumps(context))
            for count in (0,1,2,987654321):
                if (polarity=='positive' and count==1) or (polarity=='negative' and count==0):continue
                clock=[time.monotonic()]
                fake=SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _seconds:clock.__setitem__(0,clock[0]+61),time=time.time,time_ns=time.time_ns)
                reply=(200,json.dumps({'status':'success','data':scalar(count)}).encode())
                with self.subTest(signal=signal,polarity=polarity,count=count),self.http_fixture(self.trace_log_prefix()+before+[reply]) as (calls,_),patch.object(witness,'time',fake):
                    with self.assertRaises(control.ControlFailure) as caught:self.functional_run()
                    suffix=('wait_' if polarity=='positive' else 'count_')+('zero' if count==0 else 'one' if count==1 else 'many')
                    self.assertEqual(control.failure_context(caught.exception)['stage'],signal+'_'+polarity+'_'+suffix)
                    self.assertEqual(len(calls),9+index)
                    self.assertNotIn('987654321',json.dumps(control.failure_context(caught.exception)))

    def test_trace_log_malformed_nested_scalar_keeps_original_exception_category(self):
        for value,category,stage in (({'type':'scalar','data':None},AttributeError,'scalar_results'),
                ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[1]}]}},TypeError,'scalar_rows')):
            reply=(200,json.dumps({'status':'success','data':value}).encode())
            with self.subTest(stage=stage),self.http_fixture(self.trace_log_prefix()+[reply]) as (calls,_):
                with self.assertRaises(category) as caught:self.functional_run()
                self.assertEqual(control.failure_context(caught.exception),{'inside_failed':1,'stage':'traces_positive_'+stage,
                    'category':'unavailable','http_status':200,'transport':'query_v5'})
                self.assertEqual(len(calls),9)

    def test_trace_log_success_keeps_four_exact_reads_before_native_MCP(self):
        reads=[(200,json.dumps({'status':'success','data':scalar(count)}).encode()) for count in (1,0,1,0)]
        with self.http_fixture(self.trace_log_prefix()+reads+[(503,b'private-next-stage')]) as (calls,connections):
            errors=[]
            with self.assertRaises(control.ControlFailure):self.functional_run(errors)
            self.assertEqual(errors[0][1],'mcp_read')
            self.assertEqual(control.failure_context(errors[0][0])['stage'],'mcp_wire_status')
            for call,(signal,trace_id) in zip(calls[8:12],(('traces',witness.TRACE_ID),('traces','0'*32),('logs',witness.TRACE_ID),('logs','0'*32))):
                method,path,raw,headers=call;payload=json.loads(raw)
                self.assertEqual((method,path),('POST','/api/v5/query_range'))
                self.assertEqual(payload,{'schemaVersion':'v1','start':payload['end']-60000,'end':payload['end'],
                    'requestType':'scalar','compositeQuery':{'queries':[{'type':'builder_query','spec':{'name':'A','signal':signal,
                    'aggregations':[{'expression':'count()','alias':'count'}],
                    'filter':{'expression':"service.name = 'platform-fallback-control' AND "+('span.trace_id' if signal=='traces' else 'trace_id')+" = '"+trace_id+"'"},'limit':1}}]}})
                self.assertEqual(headers['SIGNOZ-API-KEY'],'fixture-viewer-key')
            self.assertEqual(len(calls),13)
            self.assertTrue(all(connection.fixture_timeout==10 for connection in connections))

    def test_trace_log_transport_retains_original_error_and_closes_before_context_exits(self):
        original=OSError('private-query-sentinel')
        # System boundary fault after the actual query response has been read.
        for secondary in (OSError('private-secondary-query'),original):
            with self.subTest(secondary_type=type(secondary).__name__),self.http_fixture([(200,b'{}')],read_error=original) as (calls,connections):
                close=witness.http.client.HTTPConnection.close
                def fail_close(connection):close(connection);raise secondary
                frames=[]
                with patch.object(witness.http.client.HTTPConnection,'close',fail_close),self.assertRaises(OSError) as caught:
                    try:
                        with control.trace_log_read(control.TRACE_LOG_READS[('logs','negative')]):
                            witness.query(witness.scalar_query('logs','0'*32),'fixture-key')
                    except OSError as error:
                        frame=BaseException.__traceback__.__get__(error)
                        while frame is not None:frames.append(frame);frame=frame.tb_next
                        raise
                self.assertIs(caught.exception,original)
                self.assertEqual(control.failure_context(original),{'inside_failed':1,'stage':'logs_negative_query_read',
                    'category':'OSError','http_status':200,'transport':'query_v5'})
                self.assertIn(connections[0].fixture_read_traceback,frames)
                self.assertNotIn('fail_close',[frame.tb_frame.f_code.co_name for frame in frames])
                self.assertEqual(len(calls),1)
        # Ordinary callers after the operation cannot inherit a stale context.
        with patch.object(control,'FUNCTIONAL_STAGE','finite_gateway',create=True):
            with self.assertRaises(control.ControlFailure) as later:control.scalar(None)
            self.assertEqual(control.failure_context(later.exception)['stage'],'finite_gateway')

        cleanup=OSError('private-close-query')
        reply=json.dumps({'status':'success','data':scalar(1)}).encode()
        with self.http_fixture([(200,reply)]) as (calls,_):
            close=witness.http.client.HTTPConnection.close
            def fail_successful_close(connection):close(connection);raise cleanup
            with patch.object(witness.http.client.HTTPConnection,'close',fail_successful_close),self.assertRaises(OSError) as caught:
                with control.trace_log_read(control.TRACE_LOG_READS[('traces','positive')]):
                    witness.query(witness.scalar_query('traces',witness.TRACE_ID),'fixture-key')
            self.assertIs(caught.exception,cleanup)
            self.assertEqual(control.failure_context(cleanup)['stage'],'traces_positive_query_close')
            self.assertEqual(len(calls),1)

    def test_trace_log_query_native_boundaries_do_not_retry_or_inspect_errors(self):
        for step,method in (('query_admission','__init__'),('query_request','request'),('query_headers','getresponse')):
            original=TimeoutError('private-query-sentinel')
            with self.subTest(step=step),self.http_fixture([(200,b'')]) as (calls,connections):
                # Header refusal occurs after an accepted send. Stub that system
                # send so a peer cannot race the deliberately refused receive.
                sent=patch.object(witness.http.client.HTTPConnection,'request',return_value=None) if method=='getresponse' else nullcontext()
                with sent,patch.object(witness.http.client.HTTPConnection,method,side_effect=original) as boundary:
                    with self.assertRaises(TimeoutError) as caught:
                        with control.trace_log_read(control.TRACE_LOG_READS[('traces','positive')]):
                            witness.query(witness.scalar_query('traces',witness.TRACE_ID),'fixture-key')
                    self.assertIs(caught.exception,original)
                    self.assertEqual(control.failure_context(original),{'inside_failed':1,'stage':'traces_positive_'+step,
                        'category':'TimeoutError','http_status':0,'transport':'query_v5'})
                    self.assertEqual(boundary.call_count,1)
                    self.assertLessEqual(len(calls),1 if method=='getresponse' else 0)

    def test_complete_pinned_public_catalogue_reaches_only_the_intentional_OTLP_sentinel(self):
        # Public source model, not a captured native response. Golden copied byte-for-byte:
        # SigNoz/signoz-mcp-server d6a95cbb043ca7e0039cc4cbdfe9c68e5b988e9d (v0.15.0),
        # https://github.com/SigNoz/signoz-mcp-server/blob/d6a95cbb043ca7e0039cc4cbdfe9c68e5b988e9d/internal/mcp-server/testdata/wire-catalog/tools-list.json
        # Git blob93fb8cd862242bb9f776b3690a08d95c69b90a7d.
        raw=(Path(__file__).parent.parent/'fixtures/observability-signoz-mcp-v0.15.0-tools-list.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),'03474d78203eb9f2c94f06ff74522b7ffe859659595d350bcf2f64486c1cb2b9')
        golden=json.loads(raw);inventory=golden['response'];inventory['id']=2
        self.assertEqual(len(inventory['result']['tools']),43)
        self.assertNotIn('nextCursor',inventory['result'])
        body=json.dumps(inventory,separators=(',',':'),ensure_ascii=False).encode()
        self.assertEqual(len(body),214194)
        initialized=json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()
        go_body=body.decode().replace('&',r'\u0026').replace('<',r'\u003c').replace('>',r'\u003e').encode()+b'\n'
        self.assertEqual(len(go_body),214765)
        for payload in (body,go_body):
            replies=[(200,b'ok'),(200,initialized),(202,b''),(200,payload),(503,b'')]
            with self.subTest(bytes=len(payload)),self.http_fixture(replies) as (calls,connections):
                errors=[]
                with self.assertRaises(control.ControlFailure):self.functional_run(errors)
                self.assertEqual(errors[0][1],'ingest',control.failure_context(errors[0][0]))
                self.assertEqual([(m,p) for m,p,_,_ in calls],[('GET','/readyz'),('POST','/mcp'),('POST','/mcp'),('POST','/mcp'),('POST','/v1/traces')])
                self.assertEqual([json.loads(c[2])['method'] for c in calls[1:4]],['initialize','notifications/initialized','tools/list'])
                self.assertEqual([c.fixture_host for c in connections],[('mcp',8000)]*4+[('signoz-ingester',4318)])

    def test_inventory_receive_budget_is_exact_and_reads_only_one_byte_beyond_the_cap(self):
        initialize=json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()
        inventory=json.dumps({'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query'}]}}).encode()
        prefix=[(200,b'ok'),(200,initialize),(202,b'')]
        for size in (65536,65537,262144,262145,524288):
            replies=prefix+[(200,inventory+b' '*(size-len(inventory)))]+([(503,b'')] if size<=262144 else [])
            with self.subTest(size=size),self.http_fixture(replies) as (calls,connections):
                errors=[]
                with self.assertRaises(control.ControlFailure) as caught:self.functional_run(errors)
                self.assertIs(errors[0][0],caught.exception)
                self.assertEqual(connections[3].fixture_reads,[((262145,),min(size,262145))])
                if size<=262144:
                    self.assertEqual(errors[0][1],'ingest');self.assertEqual(len(calls),5)
                else:
                    self.assertEqual(control.failure_context(caught.exception),{'inside_failed':1,'stage':'mcp_inventory_size','category':'ControlFailure','http_status':200,'transport':'mcp_http'})
                    self.assertEqual(len(calls),4)

    def test_every_ordinary_wire_operation_keeps_the_original_exact_64KiB_budget(self):
        rpc=json.dumps({'jsonrpc':'2.0','id':2,'result':{}}).encode()
        operations=[('readyz',lambda:witness.wire('mcp',8000,'/readyz',decode_json=False)),
            ('initialize',lambda:witness.mcp_call('initialize',{},'fixture-key',2)),
            ('notification',lambda:witness.wire('mcp',8000,'/mcp','POST',{'method':'notifications/initialized'})),
            ('tools_call',lambda:witness.mcp_call('tools/call',{},'fixture-key',2)),
            ('ordinary_tools_list',lambda:witness.mcp_call('tools/list',{},'fixture-key',2)),
            ('OTLP',lambda:witness.wire('signoz-ingester',4318,'/v1/traces','POST',{})),
            ('query',lambda:control.request('POST','/api/v5/query_range',{}))]
        query=json.dumps({'status':'success','data':{}}).encode()
        for name,operation in operations:
            for size in (65536,65537,262145):
                payload=query if name=='query' else rpc
                with self.subTest(operation=name,size=size),self.http_fixture([(200,payload+b' '*(size-len(payload)))]) as (calls,connections),                    patch.object(control,'FUNCTIONAL_STAGE','mcp_inventory',create=True):
                    if size==65536:operation()
                    else:
                        with self.assertRaises(control.ControlFailure) as caught:operation()
                        if name not in ('query','OTLP'):self.assertEqual(control.failure_context(caught.exception)['stage'],'mcp_wire_size')
                    self.assertEqual(connections[0].fixture_reads,[((65537,),min(size,65537))]);self.assertEqual(len(calls),1)

    def test_inventory_capability_cannot_be_selected_by_payload_stage_or_forged_or_reused_authority(self):
        body=json.dumps({'jsonrpc':'2.0','id':2,'result':{}}).encode();body+=b' '*(65537-len(body))
        class Forged:
            def __eq__(self,_other):return True
        for operation in (None,'tools/list','mcp_inventory',262144,True,{},[],object(),Forged()):
            with self.subTest(selector=type(operation).__name__),self.http_fixture([(200,body)]) as (calls,connections),                patch.object(control,'FUNCTIONAL_STAGE','mcp_inventory',create=True):
                with self.assertRaises(control.ControlFailure) as caught:
                    witness.wire('mcp',8000,'/mcp','POST',dict(witness._MCP_INVENTORY_REQUEST),_receive_operation=operation)
                self.assertEqual(control.failure_context(caught.exception)['stage'],'mcp_wire_size')
                self.assertEqual(connections[0].fixture_reads,[((65537,),65537)]);self.assertEqual(len(calls),1)
        for host,port,path,method,request in (
            ('mcp',8000,'/mcp','POST',dict(witness._MCP_INVENTORY_REQUEST)),
            ('mcp',8000,'/readyz','POST',witness._MCP_INVENTORY_REQUEST),
            ('mcp',8000,'/mcp','GET',witness._MCP_INVENTORY_REQUEST),
            ('signoz-ingester',4318,'/mcp','POST',witness._MCP_INVENTORY_REQUEST)):
            with self.subTest(endpoint=(host,path,method)),self.http_fixture([(200,body)]) as (calls,connections):
                with self.assertRaises(control.ControlFailure):
                    witness.wire(host,port,path,method,request,_receive_operation=witness._MCP_INVENTORY_RECEIVE)
                self.assertEqual(connections[0].fixture_reads,[((65537,),65537)]);self.assertEqual(len(calls),1)

    def test_actual_run_waits_for_plaintext_readyz_then_JSON_RPC_and_empty_notification(self):
        # Pinned MCP v0.15.0 d6a95cbb server.go readyHandler writes text for
        # both503 and200; streamableHTTPOptions chooses JSONResponse:true.
        initialize={'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}
        inventory={'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query'}]}}
        with self.http_fixture([(503,b'docs index not ready\n'),(200,b'ok'),
            (200,json.dumps(initialize).encode()),(202,b''),(200,json.dumps(inventory).encode()),(503,b'')]) as (calls,connections):
            with self.assertRaises(control.ControlFailure):self.functional_run()
            self.assertEqual([(method,path) for method,path,_,_ in calls],[('GET','/readyz'),('GET','/readyz'),
                ('POST','/mcp'),('POST','/mcp'),('POST','/mcp'),('POST','/v1/traces')])
            self.assertEqual([json.loads(calls[i][2])['method'] for i in (2,3,4)],
                ['initialize','notifications/initialized','tools/list'])
            self.assertEqual(json.loads(calls[2][2])['params']['protocolVersion'],'2025-11-25')
            self.assertTrue(all(conn.fixture_host==('mcp',8000) for conn in connections[:5]))
            self.assertEqual(connections[5].fixture_host,('signoz-ingester',4318))
            for _,_,_,headers in calls[2:5]:
                self.assertEqual(headers['SIGNOZ-API-KEY'],'fixture-viewer-key')
                self.assertEqual(headers['MCP-Protocol-Version'],'2025-11-25')
                self.assertEqual(headers['Accept'],'application/json, text/event-stream')
            self.assertTrue(all(headers['Connection']=='close' for _,_,_,headers in calls))

    def test_actual_run_still_refuses_invalid_status_oversize_and_nonJSON_RPC_or_OTLP(self):
        initialize=json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()
        inventory=json.dumps({'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query'}]}}).encode()
        prefix=[(200,b'ok'),(200,initialize),(202,b''),(200,inventory)]
        cases=[('ready_status',[(403,b'ok')],control.ControlFailure,'mcp_ready'),
            ('ready_size',[(200,b'x'*65537)],control.ControlFailure,'mcp_ready'),
            ('initialize_JSON',prefix[:1]+[(200,b'not-json')],json.JSONDecodeError,'mcp_initialize'),
            ('inventory_JSON',prefix[:3]+[(200,b'not-json')],json.JSONDecodeError,'mcp_inventory'),
            ('OTLP_JSON',prefix+[(200,b'not-json')],json.JSONDecodeError,'ingest')]
        for label,replies,category,stage in cases:
            with self.subTest(boundary=label),self.http_fixture(replies) as (calls,_):
                errors=[]
                with self.assertRaises(category) as caught:self.functional_run(errors)
                self.assertIs(errors[0][0],caught.exception);self.assertEqual(errors[0][1],stage)
                self.assertEqual(len(calls),len(replies))

    def test_actual_RPC_wire_keeps_ten_second_and_shared_deadline_guards(self):
        with self.http_fixture([(200,b'{}')]) as (calls,connections):
            with patch.object(witness,'time',SimpleNamespace(monotonic=iter((0,10.001)).__next__)),\
                patch.object(control,'DEADLINE',time.monotonic()+600),self.assertRaises(control.ControlFailure):
                witness.mcp_call('initialize',{},'fixture-viewer-key',1)
            self.assertEqual(len(calls),1);self.assertEqual(connections[0].fixture_timeout,10)
        with self.http_fixture([]) as (calls,connections):
            with patch.object(control,'DEADLINE',time.monotonic()-1),self.assertRaises(control.ControlFailure):
                witness.mcp_call('initialize',{},'fixture-viewer-key',1)
            self.assertEqual((calls,connections),([],[]))

    def test_actual_RPC_wire_preserves_interrupt_object_traceback_and_closes_connection(self):
        error=KeyboardInterrupt('private-fixture-sentinel')
        with self.http_fixture([(200,b'{}')],read_error=error) as (calls,connections):
            frames=[]
            with self.assertRaises(KeyboardInterrupt) as caught:
                try:witness.mcp_call('initialize',{},'fixture-viewer-key',1)
                except KeyboardInterrupt as interrupted:
                    frame=interrupted.__traceback__
                    while frame is not None:frames.append(frame);frame=frame.tb_next
                    raise
            self.assertIs(caught.exception,error)
            self.assertIn(connections[0].fixture_read_traceback,frames)
            self.assertIn('wire',[frame.tb_frame.f_code.co_name for frame in frames])
            self.assertEqual(len(calls),1);self.assertGreaterEqual(connections[0].close_calls,1)
            self.assertIsNone(connections[0].sock)

    def test_explicit_zero_is_valid_but_missing_bool_nonfinite_and_warnings_fail(self):
        self.assertEqual(control.scalar(scalar(0)),0)
        for value in (None,{},scalar(None),scalar(True),scalar(float('nan')),scalar(-1),scalar(.5),dict(scalar(1),warning=['partial'])):
            with self.subTest(value=repr(value)),self.assertRaises(control.ControlFailure):control.scalar(value)

    def test_400_actual_points_cannot_be_replaced_with_a_maximum_or_duplicate_indices(self):
        names=['raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples']
        value={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':n} for n in names],'data':[[400,400,1,400,0,0]]}]}}
        self.assertEqual(witness.retained_count(value),400)
        for row in ([400,1,400,400,0,0],[400,400,1,400,0,1],[None,400,1,400,0,0]):
            changed=copy.deepcopy(value);changed['data']['results'][0]['data']=[row]
            with self.assertRaises(control.ControlFailure):witness.retained_count(changed)
        empty=copy.deepcopy(value);empty['data']['results'][0]['data']=[[0,0,None,None,0,0]]
        self.assertEqual(witness.retained_count(empty),0)
        missing=copy.deepcopy(value);missing['data']['results'][0]['data']=[]
        with self.assertRaises(control.ControlFailure):witness.retained_count(missing)

    def test_native_MCP_result_must_match_RPC_id_and_actual_scalar_not_a_text_claim(self):
        payload=witness.scalar_query('traces',witness.TRACE_ID)
        result={'jsonrpc':'2.0','id':3,'result':{'structuredContent':{'status':'success','data':scalar(1)}}}
        with patch.object(witness,'wire',return_value=(200,result)):
            self.assertEqual(witness.mcp_count(payload,'fixture-key'),1)
        for changed in (dict(result,id=4),dict(result,result={'isError':True,'content':[{'text':'success'}]}),
                        dict(result,result={'structuredContent':{'status':'success','data':{}}})):
            with patch.object(witness,'wire',return_value=(200,changed)),self.assertRaises(control.ControlFailure):
                witness.mcp_count(payload,'fixture-key')

    def test_agent_cannot_supply_filter_or_foreign_correlation_identity(self):
        with self.assertRaises(control.ControlFailure):witness.scalar_query('traces',"x' OR 1=1")
        corpus=witness.corpus()
        spans=corpus['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        logs=corpus['logs']['resourceLogs'][0]['scopeLogs'][0]['logRecords']
        self.assertEqual((spans[0]['traceId'],spans[0]['spanId']),(logs[0]['traceId'],logs[0]['spanId']))
        points=corpus['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['gauge']['dataPoints']
        self.assertEqual(len(points),400)
        self.assertEqual({p['asInt'] for p in points},{str(i) for i in range(1,401)})

    def test_real_inventory_status_body_decode_and_RPC_predicates_report_only_first_closed_refusal(self):
        initialized={'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}
        inventory={'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query'}]}}
        prefix=[(200,b'ok'),(200,json.dumps(initialized).encode()),(202,b'')]
        cases=[('status',403,b'private-MCP-canary','mcp_wire_status',control.ControlFailure),
            ('oversize',200,b'x'*262145,'mcp_inventory_size',control.ControlFailure),
            ('decode',200,b'private-MCP-canary','mcp_wire_decode',json.JSONDecodeError)]
        mutations=[('object',[],'mcp_rpc_object'),('version',dict(inventory,jsonrpc='private-MCP-canary'),'mcp_rpc_version'),
            ('id',dict(inventory,id=99),'mcp_rpc_id'),('error',dict(inventory,error={'message':'private-MCP-canary'}),'mcp_rpc_error'),
            ('result',dict(inventory,result=[]),'mcp_rpc_result'),('isError',dict(inventory,result={'isError':True}),'mcp_rpc_is_error'),
            ('cursor',dict(inventory,result={'tools':inventory['result']['tools'],'nextCursor':'private-MCP-canary'}),'mcp_inventory_cursor'),
            ('tools',dict(inventory,result={'tools':{}}),'mcp_inventory_tools'),
            ('empty',dict(inventory,result={'tools':[]}),'mcp_inventory_count'),
            ('large',dict(inventory,result={'tools':[{}]*129}),'mcp_inventory_count'),
            ('missing',dict(inventory,result={'tools':[{'name':'private-MCP-canary'}]}),'mcp_inventory_query_tool')]
        cases.extend((name,200,json.dumps(value).encode(),stage,control.ControlFailure) for name,value,stage in mutations)
        for name,status,body,stage,category in cases:
            with self.subTest(name=name),self.http_fixture(prefix+[(status,body)]) as (calls,connections),\
                patch.object(control,'STEP','query_v5',create=True),patch.object(control,'LAST_HTTP_STATUS',200,create=True):
                errors=[]
                with self.assertRaises(category) as caught:self.functional_run(errors)
                self.assertIs(errors[0][0],caught.exception)
                self.assertEqual(control.failure_context(caught.exception),{'inside_failed':1,'stage':stage,'category':category.__name__,'http_status':status,'transport':'mcp_http'})
                self.assertEqual(len(calls),4);self.assertNotIn('private-MCP-canary',json.dumps(control.failure_context(caught.exception)))

    def test_native_like_inventory_at_original_bounds_still_reaches_ingest_without_extra_requests(self):
        initialized={'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}
        for count,cursor in ((1,None),(128,'')):
            tools=[{'name':'other_fixed_tool'}]*(count-1)+[{'name':'signoz_execute_builder_query'}]
            inventory={'jsonrpc':'2.0','id':2,'result':{'tools':tools,'nextCursor':cursor}}
            replies=[(200,b'ok'),(200,json.dumps(initialized).encode()),(202,b''),(200,json.dumps(inventory).encode()),(503,b'')]
            with self.subTest(count=count),self.http_fixture(replies) as (calls,_):
                errors=[]
                with self.assertRaises(control.ControlFailure):self.functional_run(errors)
                self.assertEqual(errors[0][1],'ingest');self.assertEqual(len(calls),5)
                self.assertEqual([json.loads(c[2])['method'] for c in calls[1:4]],['initialize','notifications/initialized','tools/list'])

    def test_actual_MCP_wire_deadline_admission_read_and_close_keep_first_error_and_unknown_status(self):
        with self.http_fixture([]) as (calls,connections),patch.object(control,'DEADLINE',time.monotonic()-1),\
            patch.object(control,'STEP','query_v5',create=True),patch.object(control,'LAST_HTTP_STATUS',200,create=True):
            with self.assertRaises(control.ControlFailure) as caught:witness.mcp_call('tools/list',{},'fixture-key',2)
            self.assertEqual(control.failure_context(caught.exception),{'inside_failed':1,'stage':'mcp_wire_admission','category':'ControlFailure','http_status':0,'transport':'mcp_http'})
            self.assertEqual((calls,connections),([],[]))
        with self.http_fixture([(200,b'{}')]) as (calls,_),patch.object(witness,'time',SimpleNamespace(monotonic=iter((0,10.001)).__next__)):
            with self.assertRaises(control.ControlFailure) as caught:witness.mcp_call('tools/list',{},'fixture-key',2)
            self.assertEqual(control.failure_context(caught.exception)['stage'],'mcp_wire_deadline');self.assertEqual(len(calls),1)
        error=OSError('private-MCP-canary');cleanup=OSError('private-secondary-canary')
        with self.http_fixture([(200,b'{}')],read_error=error) as (calls,connections):
            close=witness.http.client.HTTPConnection.close
            def fail_close(connection):close(connection);raise cleanup
            frames=[]
            with patch.object(witness.http.client.HTTPConnection,'close',fail_close),self.assertRaises(OSError) as caught:
                try:witness.mcp_call('tools/list',{},'fixture-key',2)
                except OSError as original:
                    frame=original.__traceback__
                    while frame is not None:frames.append(frame);frame=frame.tb_next
                    raise
            self.assertIs(caught.exception,error)
            self.assertIn(connections[0].fixture_read_traceback,frames)
            self.assertEqual(control.failure_context(error),{'inside_failed':1,'stage':'mcp_wire_read','category':'OSError','http_status':200,'transport':'mcp_http'})
            self.assertEqual(len(calls),1)
        reply=json.dumps({'jsonrpc':'2.0','id':2,'result':{}}).encode()
        with self.http_fixture([(200,reply)]) as (calls,_):
            close=witness.http.client.HTTPConnection.close
            def fail_close_first(connection):close(connection);raise cleanup
            with patch.object(witness.http.client.HTTPConnection,'close',fail_close_first),self.assertRaises(OSError) as caught:
                witness.mcp_call('tools/list',{},'fixture-key',2)
            self.assertIs(caught.exception,cleanup);self.assertEqual(control.failure_context(cleanup)['stage'],'mcp_wire_close')

    def test_actual_bootstrap_MCP_failure_survives_revoke204_or_secondary500_with_original_traceback(self):
        from test_auth import AuthWire
        for revoke_status in (204,500):
            before=[];errors=[]
            def hook(_proxy,key):
                control.FUNCTIONAL_STAGE='mcp_inventory'
                try:witness.mcp_call('tools/list',{},key,2)
                except BaseException as error:
                    before.append((error,error.__traceback__));raise
            with self.subTest(revoke_status=revoke_status),self.http_fixture([(403,b'private-MCP-canary')]) as (calls,_):
                failure=AuthWire().exercise(False,project_failure=True,revoke_status=revoke_status,failure_hook=hook,observed_errors=errors)
                self.assertIs(errors[0],before[0][0])
                frames=[];frame=errors[0].__traceback__
                while frame is not None:frames.append(frame);frame=frame.tb_next
                self.assertIn(before[0][1],frames)
                self.assertEqual(failure,{'inside_failed':1,'stage':'mcp_wire_status','category':'ControlFailure','http_status':403,'transport':'mcp_http'})
                self.assertEqual(len(calls),1);self.assertNotIn('private-MCP-canary',json.dumps(failure))

    def test_MCP_diagnostic_is_per_exception_and_copied_private_tags_cannot_poison_later_errors(self):
        bad=json.dumps({'jsonrpc':'2.0','id':2,'error':{'message':'private-MCP-canary'}}).encode()
        good=json.dumps({'jsonrpc':'2.0','id':2,'result':{}}).encode()
        with self.http_fixture([(200,bad),(200,good)]) as (calls,_):
            with self.assertRaises(control.ControlFailure) as caught:witness.mcp_call('tools/list',{},'fixture-key',2)
            self.assertEqual(control.failure_context(caught.exception)['stage'],'mcp_rpc_error')
            self.assertEqual(witness.mcp_call('tools/list',{},'fixture-key',2),{});self.assertEqual(len(calls),2)
        for tag in (None,[],{},'private-MCP-canary',caught.exception._signoz_mcp_validation,
            (object(),0,'mcp_rpc_error','mcp_http',200)):
            error=RuntimeError('private-MCP-canary');error._signoz_mcp_validation=tag
            with patch.object(control,'FUNCTIONAL_STAGE','mcp_inventory',create=True),patch.object(control,'STEP','mcp_http',create=True),patch.object(control,'LAST_HTTP_STATUS',0,create=True):
                control.preserve_failure(error)
                self.assertEqual(control.failure_context(error),{'inside_failed':1,'stage':'mcp_inventory','category':'RuntimeError','http_status':0,'transport':'mcp_http'})
        for stage in ('private-MCP-canary',[],{},'x'*1000):
            error=RuntimeError('private-MCP-canary')
            error._signoz_mcp_validation=(control._MCP_READ_AUTHORITY,id(error),stage,'mcp_http',200)
            with patch.object(control,'FUNCTIONAL_STAGE','mcp_inventory',create=True):
                self.assertEqual(control.failure_context(error)['stage'],'mcp_inventory')
            self.assertNotIn('private-MCP-canary',json.dumps(control.failure_context(error)))
        # Predicate evaluation exceptions retain their actual class; no invented schema fix.
        reply=json.dumps({'jsonrpc':'2.0','id':2,'result':{'tools':[None]}}).encode()
        init=json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()
        with self.http_fixture([(200,b'ok'),(200,init),(202,b''),(200,reply)]) as (calls,_):
            with self.assertRaises(AttributeError) as caught:self.functional_run()
            self.assertEqual(control.failure_context(caught.exception)['stage'],'mcp_inventory_query_tool')
            self.assertEqual(control.failure_context(caught.exception)['category'],'unavailable')


if __name__ == '__main__':unittest.main()
