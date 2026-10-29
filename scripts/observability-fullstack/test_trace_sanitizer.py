"""Private trace edge contracts; owned wire doubles are not native Alloy/Sig proof."""
import copy
from contextlib import contextmanager
import socket
import time
import os
import signal
import subprocess
import sys
import selectors
import json
import http.client
import tempfile
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler,HTTPServer
from unittest.mock import patch
import unittest
import trace_sanitizer as sanitizer


def payload(count=1,links=1):
    return {'resourceSpans':[{'resource':{'attributes':[{'key':'service.name','value':{'stringValue':'platform-api'}}]},
        'scopeSpans':[{'scope':{'name':'inside-collector'},'spans':[{
            'traceId':f'{i+1:032x}','spanId':f'{i+1:016x}','parentSpanId':'b'*16,
            'startTimeUnixNano':'1790000000000000000','endTimeUnixNano':'1790000000001000000',
            'name':'worker.attempt','flags':1,'links':[{'traceId':'c'*32,'spanId':f'{j+1:016x}',
                'flags':257,'traceState':'private=SECRET_SENTINEL','attributes':[{'key':'user.email',
                'value':{'kvlistValue':{'values':[{'key':'deep','value':{'stringValue':'SECRET_SENTINEL'}}]}}}]} for j in range(links)]
        } for i in range(count)]}]}]}


@contextmanager
def wire_edge(body=b'{}',status=200,headers=None,pause=None):
    requests=[]
    class Collector(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(self.rfile.read(int(self.headers['Content-Length'])))
            if pause is not None:pause[0].set();pause[1].wait(2)
            self.send_response(status)
            for key,value in (headers or {'Content-Type':'application/json','Content-Length':str(len(body))}).items():self.send_header(key,value)
            self.end_headers()
            try:self.wfile.write(body)
            except (BrokenPipeError,ConnectionResetError):pass
        def log_message(self,*_):pass
    collector=HTTPServer(('127.0.0.1',0),Collector);thread=threading.Thread(target=lambda:collector.serve_forever(poll_interval=.01));thread.start()
    try:
        with tempfile.TemporaryDirectory() as directory:
            receipt=sanitizer.Receipt(Path(directory),{'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'1'*12})
            server=sanitizer.Server(('127.0.0.1',0),receipt);worker=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01));worker.start()
            try:
                with patch.object(sanitizer,'open_collector',side_effect=lambda timeout:http.client.HTTPConnection('127.0.0.1',collector.server_port,timeout=timeout)):
                    yield server,receipt,requests
            finally:server.shutdown();server.server_close();worker.join(5);assert not worker.is_alive()
    finally:
        if pause is not None:pause[1].set()
        collector.shutdown();collector.server_close();thread.join(5);assert not thread.is_alive()


class Sanitizer(unittest.TestCase):
    def test_real_payload_removes_only_link_metadata_preserving_all_identity_flags_and_structure(self):
        original=payload(2,3);expected=copy.deepcopy(original)
        for span in expected['resourceSpans'][0]['scopeSpans'][0]['spans']:
            for link in span['links']:del link['attributes'];del link['traceState']
        body=json.dumps(original).encode()
        cleaned,count=sanitizer.sanitize(body)
        self.assertEqual(count,2);self.assertEqual(json.loads(cleaned),expected)
        self.assertNotIn(b'SECRET_SENTINEL',cleaned);self.assertIn('SECRET_SENTINEL',json.dumps(original))

    def test_actual_private_http_forwards_one_sanitized_request_and_records_partial_without_echo(self):
        requests=[]
        class Collector(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append((self.path,self.headers, self.rfile.read(int(self.headers['Content-Length']))))
                body=b'{"partialSuccess":{"rejectedSpans":"1","errorMessage":"SECRET_SENTINEL"}}'
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def log_message(self,*_):pass
        collector=HTTPServer(('127.0.0.1',0),Collector);thread=threading.Thread(target=collector.serve_forever);thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                receipt=sanitizer.Receipt(Path(directory),{'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'1'*12})
                server=sanitizer.Server(('127.0.0.1',0),receipt);worker=threading.Thread(target=server.serve_forever);worker.start()
                try:
                    with patch.object(sanitizer,'open_collector',side_effect=lambda timeout:http.client.HTTPConnection('127.0.0.1',collector.server_port,timeout=timeout)):
                        client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                        try:
                            client.request('POST','/v1/traces',json.dumps(payload(2)),{'Content-Type':'application/json'})
                            response=client.getresponse();body=response.read();self.assertEqual(response.status,200)
                        finally:client.close()
                    self.assertEqual(json.loads(body),{'partialSuccess':{'rejectedSpans':'1','errorMessage':'collector_partial'}})
                    self.assertNotIn(b'SECRET_SENTINEL',body);self.assertEqual(len(requests),1)
                    self.assertEqual(requests[0][0],'/v1/traces');self.assertNotIn(b'SECRET_SENTINEL',requests[0][2])
                    state=json.loads((Path(directory)/'receipt.json').read_bytes())
                    self.assertEqual(state['submitted_spans'],2);self.assertEqual(state['rejected_spans'],1)
                    self.assertEqual(state['partial_responses'],1);self.assertEqual(state['requests'],1)
                    self.assertNotIn('SECRET_SENTINEL',json.dumps(state))
                finally:server.shutdown();server.server_close();worker.join(2);self.assertFalse(worker.is_alive())
        finally:collector.shutdown();collector.server_close();thread.join(2);self.assertFalse(thread.is_alive())

    def test_private_http_rejects_ambiguous_framing_without_forward_or_echo(self):
        cases=[(b'Content-Type: application/json\r\n',411),
            (b'Content-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n',400),
            (b'Content-Type: application/json\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n',400),
            (b'Content-Type: application/json\r\nContent-Length: 2\r\nContent-Encoding: gzip\r\n',415),
            (b'Content-Type: application/x-protobuf\r\nContent-Length: 2\r\n',415),
            (b'Content-Type: application/json\r\nContent-Length: 1048577\r\n',413)]
        with wire_edge() as (server,receipt,requests):
            for headers,expected in cases:
                with self.subTest(expected=expected,headers=headers),socket.create_connection(server.server_address,timeout=2) as client:
                    client.sendall(b'POST /v1/traces HTTP/1.1\r\nHost: private\r\n'+headers+b'\r\n{}')
                    response=http.client.HTTPResponse(client);response.begin();body=response.read()
                    self.assertEqual(response.status,expected);self.assertNotIn(b'SECRET_SENTINEL',body)
            self.assertEqual(requests,[])
            self.assertEqual(receipt.value['failed_requests'],len(cases))

    def test_canonical_512_1024_batches_and_128_links_preserve_valid_bounds(self):
        for count in (512,1024):
            body=json.dumps(payload(count,1)).encode()
            cleaned,observed=sanitizer.sanitize(body)
            self.assertEqual(observed,count);self.assertEqual(len(json.loads(cleaned)['resourceSpans'][0]['scopeSpans'][0]['spans']),count)
        value=payload(1,128);value['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['links'][0]['traceId']='C'*32
        cleaned,count=sanitizer.sanitize(json.dumps(value).encode())
        links=json.loads(cleaned)['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['links']
        self.assertEqual(count,1);self.assertEqual(len(links),128);self.assertEqual(links[0]['traceId'],'C'*32)
        self.assertEqual(links[0]['flags'],257)

    def test_private_alias_identity_numeric_depth_count_and_encoding_fail_closed(self):
        for field,value in [('trace_state','SECRET_SENTINEL'),('trace_id','c'*32),('arbitrary','SECRET_SENTINEL'),
            ('traceId','0'*32),('spanId','base64-SECRET_SENTINEL'),('flags',True),('flags',-1),('flags',2**32),
            ('droppedAttributesCount',True),('attributes',{}),('traceState',{})]:
            original=payload();original['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['links'][0][field]=value
            with self.subTest(field=field),self.assertRaises(sanitizer.Refusal) as caught:sanitizer.sanitize(json.dumps(original).encode())
            self.assertNotIn('SECRET_SENTINEL',str(caught.exception))
        for body in (b'{"resourceSpans":[],"resourceSpans":[]}',b'{"resourceSpans":NaN}',b'{"resourceSpans":1e999}',
            b'['*33+b']'*33,b'x'*(sanitizer.MAX_BODY+1),b'\xff',b'{"secret":"SECRET_SENTINEL"}'):
            with self.subTest(body_length=len(body)),self.assertRaises(sanitizer.Refusal):sanitizer.sanitize(body)
        for value in (payload(1025,0),payload(1,129)):
            with self.assertRaises(sanitizer.Refusal):sanitizer.sanitize(json.dumps(value).encode())

    def test_real_collector_bad_success_failure_and_private_partial_warning_never_become_full_ack(self):
        cases=[(200,b'{"partialSuccess":{"rejectedSpans":"2"}}',502),
            (200,b'{"partialSuccess":{"rejectedSpans":true}}',502),
            (200,b'{"partialSuccess":{"rejectedSpans":"0","errorMessage":"SECRET_SENTINEL"}}',200),
            (200,b'{"partial_success":{"rejected_spans":"0"}}',502),(200,b'not-json-SECRET_SENTINEL',502),
            (503,b'{"message":"SECRET_SENTINEL"}',503),(302,b'{}',502)]
        for status,body,expected in cases:
            with self.subTest(status=status,body=body),wire_edge(body,status) as (server,receipt,requests):
                client=http.client.HTTPConnection(*server.server_address,timeout=2)
                try:
                    client.request('POST','/v1/traces',json.dumps(payload()),{'Content-Type':'application/json'})
                    response=client.getresponse();result=response.read();self.assertEqual(response.status,expected)
                finally:client.close()
                self.assertNotIn(b'SECRET_SENTINEL',result);self.assertEqual(len(requests),1)
                if expected!=200:self.assertEqual(receipt.value['unknown_outcomes'],1)
                else:
                    self.assertEqual(receipt.value['partial_warnings'],1);self.assertEqual(receipt.value['rejected_spans'],0)
                    self.assertNotEqual(result,b'{}')

    def test_receipt_replacement_and_overflow_refuse_without_touching_foreign_target(self):
        binding={'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'1'*12}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);receipt=sanitizer.Receipt(root,binding);instance=receipt.value['instance']
            receipt.observe(3,known=True,rejected=1,partial=True,warning=True)
            self.assertEqual(receipt.value['instance'],instance);self.assertEqual(receipt.value['acknowledged_spans'],2)
            target=root/'foreign';target.write_text('KEEP');mode=target.stat().st_mode
            receipt.path.unlink();receipt.path.symlink_to(target)
            with self.assertRaises(sanitizer.Refusal):receipt.observe()
            self.assertEqual(target.read_text(),'KEEP');self.assertEqual(target.stat().st_mode,mode)
        with tempfile.TemporaryDirectory() as directory:
            receipt=sanitizer.Receipt(Path(directory),binding);receipt.value['requests']=sanitizer.MAX_COUNT
            with self.assertRaises(sanitizer.Refusal):receipt.observe()

    def test_actual_socket_deadlines_close_slow_headers_and_unknown_collector_outcome(self):
        with patch.object(sanitizer,'DEADLINE_SECONDS',.15),wire_edge() as (server,receipt,requests):
            with socket.create_connection(server.server_address,timeout=1) as client:
                client.sendall(b'POST /v1/traces HTTP/1.1\r\nHost: private\r\n')
                self.assertEqual(client.recv(1),b'')
            self.assertEqual(requests,[])
        entered=threading.Event();release=threading.Event()
        with patch.object(sanitizer,'DEADLINE_SECONDS',.15),wire_edge(pause=(entered,release)) as (server,receipt,requests):
            client=http.client.HTTPConnection(*server.server_address,timeout=1)
            try:
                client.request('POST','/v1/traces',json.dumps(payload()),{'Content-Type':'application/json'})
                self.assertTrue(entered.wait(1),'actual collector received request')
                try:
                    response=client.getresponse();self.assertEqual(response.status,502);response.read()
                except http.client.RemoteDisconnected:pass
            finally:client.close();release.set()
            self.assertEqual(len(requests),1);self.assertEqual(receipt.value['unknown_outcomes'],1)

    def test_original_collector_failure_survives_private_counter_io_failure(self):
        with wire_edge(b'{"message":"SECRET_SENTINEL"}',503) as (server,receipt,requests):
            with patch.object(sanitizer.os,'fsync',side_effect=OSError('SECRET_SENTINEL')):
                client=http.client.HTTPConnection(*server.server_address,timeout=2)
                try:
                    client.request('POST','/v1/traces',json.dumps(payload()),{'Content-Type':'application/json'})
                    response=client.getresponse();body=response.read();self.assertEqual(response.status,503)
                finally:client.close()
            self.assertEqual(len(requests),1);self.assertTrue(receipt.broken);self.assertNotIn(b'SECRET_SENTINEL',body)
            self.assertEqual(receipt.path.stat().st_mode&0o777,0)

    def test_real_owned_helper_process_interrupt_reaps_socket_and_preserves_unrelated_process(self):
        code="""import json,sys;from pathlib import Path;import trace_sanitizer as s
r=s.Receipt(Path(sys.argv[1]),{'commit':'a'*40,'tree':'b'*40,'nonce':'c'*32,'project':'inside-observability-representative-'+'1'*12})
class Ready(s.Server):
 def get_request(self):
  print(json.dumps({'accepted':True}),flush=True)
  return super().get_request()
server=Ready(('127.0.0.1',0),r)
print(json.dumps({'port':server.server_port}),flush=True)
s.run(server)
"""
        with tempfile.TemporaryDirectory() as directory:
            child=subprocess.Popen([sys.executable,'-B','-c',code,directory],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True)
            unrelated=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'],start_new_session=True)
            try:
                with selectors.DefaultSelector() as ready:
                    ready.register(child.stdout,selectors.EVENT_READ);self.assertTrue(ready.select(3),'owned helper published listener')
                    port=json.loads(child.stdout.readline())['port']
                with socket.create_connection(('127.0.0.1',port),timeout=2) as client:
                    client.sendall(b'POST /v1/traces HTTP/1.1\r\nHost: private\r\n')
                    with selectors.DefaultSelector() as accepted:
                        accepted.register(child.stdout,selectors.EVENT_READ);self.assertTrue(accepted.select(2),'signal handler installed before actual accept')
                        self.assertEqual(json.loads(child.stdout.readline()),{'accepted':True})
                    self.assertEqual(os.getpgid(child.pid),child.pid);os.killpg(child.pid,signal.SIGTERM)
                    child.wait(timeout=2);self.assertEqual(child.returncode,128+signal.SIGTERM)
                    try:self.assertEqual(client.recv(1),b'')
                    except ConnectionResetError:pass  # Kernel may reset unread request bytes on process exit.
                self.assertIsNone(unrelated.poll())
                with socket.socket() as probe:
                    self.assertNotEqual(probe.connect_ex(('127.0.0.1',port)),0)
            finally:
                for process in (child,unrelated):
                    if process.poll() is None:os.killpg(process.pid,signal.SIGKILL)
                    process.wait(timeout=2)
                if child.stdout:child.stdout.close()
                if child.stderr:child.stderr.close()

    def test_actual_parser_bounded_batches_and_near_byte_limit_stay_inside_tentative_memory_budget(self):
        code="""import json,resource,sys,tracemalloc;import trace_sanitizer as s
base={'traceId':'a'*32,'spanId':'b'*16,'links':[{'traceId':'c'*32,'spanId':'d'*16,'attributes':[]}]}
def run(spans):
 body=json.dumps({'resourceSpans':[{'scopeSpans':[{'spans':spans}]}]}).encode()
 cleaned,count=s.sanitize(body)
 assert count==len(spans) and len(cleaned)<=len(body)
 return len(body)
tracemalloc.start()
sizes=[run([base for _ in range(1024)])]
base['links'][0]['attributes']=[{'key':'private','value':{'stringValue':'x'*1000000}}]
sizes.append(run([base]))
base['links'][0]['attributes']=[{'key':'k'+str(i),'value':{'stringValue':''}} for i in range(7000)]
sizes.append(run([base]))
_,peak=tracemalloc.get_traced_memory()
rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)
print(json.dumps({'peak_traced_bytes':peak,'max_rss_bytes':rss,'input_bytes':sizes}))
assert peak<32*1024**2 and rss<64*1024**2
"""
        result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        measured=json.loads(result.stdout);self.assertEqual(len(measured['input_bytes']),3)
        self.assertGreater(max(measured['input_bytes']),1000000)

    def test_no_read_admin_arbitrary_path_or_cli_destination_can_reach_collector(self):
        with wire_edge() as (server,receipt,requests):
            for method,path in (('GET','/v1/traces'),('GET','/receipt.json'),('POST','http://foreign/v1/traces'),
                ('POST','/v1/traces?destination=foreign'),('POST','/v1/metrics')):
                client=http.client.HTTPConnection(*server.server_address,timeout=2)
                try:
                    client.request(method,path,b'{}',{'Content-Type':'application/json'})
                    response=client.getresponse();self.assertIn(response.status,(400,405));response.read()
                finally:client.close()
            self.assertEqual(requests,[])
        with patch.object(sys,'argv',['trace_sanitizer.py','--endpoint','http://foreign']),patch.object(sanitizer.socket,'getaddrinfo',side_effect=AssertionError('must refuse before DNS')):
            with self.assertRaisesRegex(sanitizer.Refusal,'closed_arguments'):sanitizer.main()


if __name__=='__main__':unittest.main()
