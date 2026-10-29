"""Owned loopback HTTP scalar and MCP contracts; no external providers."""
import copy
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import http.client
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
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01))
        connection=http.client.HTTPConnection
        class Connection(connection):
            def __init__(self,host,port,**kwargs):
                self.fixture_host=(host,port);self.fixture_timeout=kwargs['timeout'];self.close_calls=0
                super().__init__(host,port,**kwargs) if host=='127.0.0.1' else super().__init__('127.0.0.1',server.server_port,**kwargs)
                connections.append(self)
            def getresponse(self):
                response=super().getresponse()
                if read_error is not None:
                    read=response.read
                    def interrupted_read(*args):
                        read(*args)
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
                if observed is not None:observed.append((error,control.FUNCTIONAL_STAGE))
                raise

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
            ('oversize',200,b'x'*65537,'mcp_wire_size',control.ControlFailure),
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
