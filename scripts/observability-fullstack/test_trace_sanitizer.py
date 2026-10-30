"""Private trace edge contracts; owned wire doubles are not native Alloy/Sig proof."""
import copy
import ctypes
from contextlib import contextmanager,ExitStack
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
from unittest.mock import Mock, patch
import unittest
import trace_sanitizer as sanitizer

with patch.object(sys,'path',[str(Path(__file__).resolve().parents[1]/'heavy-check'),*sys.path]):
    from processes import adopt_orphans, process_row


def payload(count=1,links=1):
    return {'resourceSpans':[{'resource':{'attributes':[{'key':'service.name','value':{'stringValue':'platform-api'}}]},
        'scopeSpans':[{'scope':{'name':'inside-collector'},'spans':[{
            'traceId':f'{i+1:032x}','spanId':f'{i+1:016x}','parentSpanId':'b'*16,
            'startTimeUnixNano':'1790000000000000000','endTimeUnixNano':'1790000000001000000',
            'name':'worker.attempt','flags':1,'links':[{'traceId':'c'*32,'spanId':f'{j+1:016x}',
                'flags':257,'traceState':'private=SECRET_SENTINEL','attributes':[{'key':'user.email',
                'value':{'kvlistValue':{'values':[{'key':'deep','value':{'stringValue':'SECRET_SENTINEL'}}]}}}]} for j in range(links)]
        } for i in range(count)]}]}]}


def reap_process(process):
    """Register immediately after this test's process acquisition, before any next one."""
    try:
        if process.poll() is None:
            try:group=os.getpgid(process.pid)
            except ProcessLookupError:group=None
            if group is not None:
                if group!=process.pid:raise RuntimeError('owned process group changed')
                os.killpg(process.pid,signal.SIGKILL)
        process.wait(timeout=2)
    finally:
        if process.stdout:process.stdout.close()
        if process.stderr:process.stderr.close()


@contextmanager
def parser_worker(code):
    # The existing external owner survives launcher death and forks the measured
    # worker from its clean Python interpreter (Linux ru_maxrss survives exec).
    owner=(Path(__file__).resolve().parents[1]/'owned-process.mjs').as_uri()
    launcher="""import {spawnOwned,stopOwned} from OWNER;
const child=spawnOwned(process.argv[1],['-B','-c',process.argv[2]],{stdio:'inherit',ownerExitGraceMilliseconds:0});
const timer=setTimeout(()=>{void stopOwned(child,0)},8000);
child.once('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=127});
child.once('exit',(code,signal)=>{clearTimeout(timer);process.exitCode=code??1});
""".replace('OWNER',json.dumps(owner))
    deadline=time.monotonic()+10
    child=subprocess.Popen(['node','--input-type=module','-e',launcher,sys.executable,code],
        cwd=Path(__file__).resolve().parent,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:yield child,deadline
    finally:
        try:
            # Kill only our unreaped direct child. The independent owner receives
            # control-pipe EOF and cleans descendants even when this launcher died.
            if child.poll() is None:child.kill()
            child.communicate(timeout=max(.001,deadline-time.monotonic()))
        finally:
            child.stdout.close();child.stderr.close()


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


@contextmanager
def fixture_adoption():
    """Keep this fixture, rather than an outer command owner, as Linux wait owner."""
    if sys.platform != 'linux':
        yield
        return
    library = ctypes.CDLL(None, use_errno=True)
    library.prctl.argtypes = [ctypes.c_int, *([ctypes.c_ulong] * 4)]
    library.prctl.restype = ctypes.c_int
    previous = ctypes.c_int()
    # PR_GET_CHILD_SUBREAPER / PR_SET_CHILD_SUBREAPER from linux/prctl.h.
    if library.prctl(37, ctypes.addressof(previous), 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_GET_CHILD_SUBREAPER')
    try:
        adopt_orphans()
        yield
    finally:
        failure = sys.exc_info()[1]
        try:
            if library.prctl(36, previous.value, 0, 0, 0) != 0:
                raise OSError(ctypes.get_errno(), 'restore PR_SET_CHILD_SUBREAPER')
        except BaseException as error:
            if failure is None:
                raise
            failure.add_note(f'fixture adoption restoration failed: {error!r}')


def reap_fixture_zombies(identities):
    """Wait only for observed births now adopted as this fixture's zombie children."""
    if sys.platform == 'linux':
        for pid, birth in identities.items():
            row = process_row(pid)
            if row is not None and row[3] == birth and row[0] == os.getpid() and row[2] == 'Z':
                os.waitpid(pid, os.WNOHANG)


def finish_fixture(identities, *operations):
    """Attempt every fallback cleanup without replacing an in-flight test failure."""
    failure = sys.exc_info()[1]
    errors = []
    deadline = time.monotonic() + 5
    for pid, birth in identities.items():
        try:
            row = process_row(pid)
            if row is not None and row[3] == birth and row[2] != 'Z':
                os.kill(pid, signal.SIGKILL)
        except BaseException as error:
            errors.append(error)
    for operation in operations:
        try:
            operation()
        except BaseException as error:
            errors.append(error)
    try:
        while True:
            reap_fixture_zombies(identities)
            remaining = {pid: row for pid, birth in identities.items()
                         if (row := process_row(pid)) is not None and row[3] == birth}
            if not remaining:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f'fixture cleanup retained observed births: {remaining}')
            time.sleep(.01)
    except BaseException as error:
        errors.append(error)
    if errors:
        if failure is None:
            for error in errors[1:]:
                errors[0].add_note(f'additional fixture cleanup failure: {error!r}')
            raise errors[0]
        for error in errors:
            failure.add_note(f'fixture cleanup failed: {error!r}')


class Sanitizer(unittest.TestCase):
    def test_fixture_adoption_reaps_only_registered_child_births_and_restores_state(self):
        # The kernel boundary is modeled on macOS; this is not Linux physical proof.
        for previous in (0, 1):
            with self.subTest(previous=previous):
                enabled = previous
                parent = os.getpid()
                rows = {101: (999, 101, 'Z', 501), 102: (999, 102, 'Z', 502),
                        103: (parent, 103, 'Z', 999), 104: (parent, 104, 'S', 504),
                        106: (parent, 106, 'Z', 506)}
                identities = {101: 501, 102: 502, 103: 503, 104: 504, 105: 505}
                def prctl(option, value, *_):
                    nonlocal enabled
                    if option == 37:
                        ctypes.c_int.from_address(value).value = enabled
                    elif option == 36:
                        enabled = value
                    else:
                        raise AssertionError(option)
                    return 0
                def adopt():
                    nonlocal enabled
                    enabled = 1
                def wait(pid, options):
                    self.assertEqual((pid, options), (101, os.WNOHANG))
                    self.assertEqual(rows[pid], (parent, 101, 'Z', 501))
                    del rows[pid]
                    return pid, 0
                library = Mock(); library.prctl.side_effect = prctl
                with patch.object(sys, 'platform', 'linux'), patch.object(ctypes, 'CDLL', return_value=library), \
                        patch(__name__ + '.adopt_orphans', side_effect=adopt), \
                        patch(__name__ + '.process_row', side_effect=rows.get), patch.object(os, 'waitpid', side_effect=wait) as waited:
                    with fixture_adoption():
                        # Node owner exits; the nearest enabled subreaper gets this child.
                        rows[101] = (parent if enabled else 999, 101, 'Z', 501)
                        reap_fixture_zombies(identities)
                        self.assertNotIn(101, rows, 'registered orphan zombie needs its fixture to wait')
                        self.assertEqual(set(rows), {102, 103, 104, 106})
                        self.assertEqual(waited.call_count, 1)
                    self.assertEqual(enabled, previous)


    def test_fixture_adoption_keeps_kernel_failures_visible_and_preserves_first_error(self):
        parent = os.getpid()
        for error in (ChildProcessError('not our child'), PermissionError('wait denied')):
            with self.subTest(error=type(error).__name__), patch.object(sys, 'platform', 'linux'), \
                    patch(__name__ + '.process_row', return_value=(parent, 101, 'Z', 501)), \
                    patch.object(os, 'waitpid', side_effect=error):
                with self.assertRaises(type(error)) as caught:
                    reap_fixture_zombies({101: 501})
                self.assertIs(caught.exception, error)
        for initial_failure in (False, True):
            with self.subTest(initial_failure=initial_failure):
                enabled = 0
                def prctl(option, value, *_):
                    nonlocal enabled
                    if option == 37:
                        ctypes.c_int.from_address(value).value = enabled
                    elif value == 0:
                        raise PermissionError('restore denied')
                    return 0
                def adopt():
                    nonlocal enabled
                    enabled = 1
                library = Mock(); library.prctl.side_effect = prctl
                marker = RuntimeError('fixture first failure')
                traceback = None
                with patch.object(sys, 'platform', 'linux'), patch.object(ctypes, 'CDLL', return_value=library), \
                        patch(__name__ + '.adopt_orphans', side_effect=adopt):
                    try:
                        with fixture_adoption():
                            if initial_failure:
                                try:
                                    raise marker
                                finally:
                                    traceback = sys.exc_info()[2]
                    except BaseException as error:
                        if initial_failure:
                            self.assertIs(error, marker)
                            self.assertIs(error.__traceback__, traceback)
                            self.assertIn('restore denied', error.__notes__[0])
                        else:
                            self.assertIsInstance(error, PermissionError)
                    else:
                        self.fail('restoration failure must remain visible')
        marker = RuntimeError('original fixture interruption')
        cleanup_marker = PermissionError('cleanup denied')
        attempted = []
        def broken_cleanup():
            attempted.append('broken')
            raise cleanup_marker
        with patch.object(sys, 'platform', 'darwin'), \
                patch(__name__ + '.process_row', side_effect=[(parent, 101, 'S', 501), None]), \
                patch.object(os, 'kill', side_effect=PermissionError('signal denied')):
            try:
                try:
                    raise marker
                finally:
                    traceback = sys.exc_info()[2]
                    finish_fixture({101: 501}, broken_cleanup, lambda: attempted.append('last'))
            except RuntimeError as error:
                self.assertIs(error, marker)
                self.assertIs(error.__traceback__, traceback)
                self.assertEqual(attempted, ['broken', 'last'])
                self.assertEqual(len(error.__notes__), 2)
            else:
                self.fail('cleanup replaced the original failure')

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
        with tempfile.TemporaryDirectory() as directory,ExitStack() as cleanup:
            child=subprocess.Popen([sys.executable,'-B','-c',code,directory],cwd=Path(__file__).resolve().parent,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True)
            cleanup.callback(reap_process,child)
            unrelated=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'],start_new_session=True)
            cleanup.callback(reap_process,unrelated)
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
        def measure(worker):
            with parser_worker(worker) as (child,deadline):
                stdout,stderr=child.communicate(timeout=deadline-time.monotonic())
                return subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)
        result=measure(code)
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        measured=json.loads(result.stdout);self.assertEqual(len(measured['input_bytes']),3)
        self.assertGreater(max(measured['input_bytes']),1000000)
        # A real resident allocation before tracing must still fail the unchanged
        # RSS bound even when the traced parser allocation fits its separate bound.
        oversized=measure("resident=bytearray(96*1024**2)\nfor page in range(0,len(resident),4096):resident[page]=1\n"+code)
        self.assertNotEqual(oversized.returncode,0)
        rejected=json.loads(oversized.stdout)
        self.assertEqual(rejected['input_bytes'],measured['input_bytes'])
        self.assertLess(rejected['peak_traced_bytes'],32*1024**2)
        self.assertGreaterEqual(rejected['max_rss_bytes'],64*1024**2)

        # Exercise the same real owner at the leader-death seam. A worker keeps
        # both inherited pipes open and ignores TERM, so launcher-only cleanup fails.
        with patch.object(sys,'path',[str(Path(__file__).resolve().parents[1]/'heavy-check'),*sys.path]):
            from processes import process_row
        for outcome in ('success','failure','timeout','launcher-kill','launcher-term','interruption'):
            with self.subTest(outcome=outcome),ExitStack() as cleanup:
                unrelated=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'],start_new_session=True)
                cleanup.callback(reap_process,unrelated)
                identities={}
                controlled="""import json,os,signal,sys
signal.signal(signal.SIGTERM,signal.SIG_IGN)
print(json.dumps({'pid':os.getpid(),'owner':os.getppid(),'group':os.getpgrp()}),flush=True)
"""
                controlled+=("raise SystemExit(0)" if outcome=='success' else
                    "raise SystemExit(19)" if outcome=='failure' else "signal.pause()")
                marker=RuntimeError('controlled_parser_interruption')
                try:
                    try:
                        with parser_worker(controlled) as (child,deadline):
                            with selectors.DefaultSelector() as ready:
                                ready.register(child.stdout,selectors.EVENT_READ)
                                self.assertTrue(ready.select(min(3,deadline-time.monotonic())))
                                row=json.loads(child.stdout.readline());worker_pid=row['pid']
                                for pid in (worker_pid,row['owner']):
                                    identity=process_row(pid)
                                    if identity is not None:identities[pid]=identity[3]
                            if outcome=='launcher-kill':child.kill()
                            elif outcome=='launcher-term':child.terminate()
                            elif outcome=='interruption':raise marker
                            child.communicate(timeout=deadline-time.monotonic())
                            if outcome=='success':self.assertEqual(child.returncode,0)
                            elif outcome=='failure':self.assertEqual(child.returncode,19)
                            else:self.assertNotEqual(child.returncode,0)
                    except RuntimeError as error:
                        if outcome!='interruption':raise
                        self.assertIs(error,marker)
                    self.assertLess(time.monotonic(),deadline)
                    self.assertTrue(child.stdout.closed);self.assertTrue(child.stderr.closed)
                    for pid,birth in identities.items():
                        current=process_row(pid)
                        self.assertTrue(current is None or current[2]=='Z' or current[3]!=birth,
                            f'owned parser process {pid} survived {outcome}: {current}')
                    self.assertIsNone(unrelated.poll())
                finally:
                    # A failing regression may leave its worker. Bind fallback
                    # cleanup to observed births, never a stale leader PID.
                    for pid,birth in identities.items():
                        current=process_row(pid)
                        if current is not None and current[2]!='Z' and current[3]==birth:
                            os.kill(pid,signal.SIGKILL)

    def test_late_parser_owner_loss_reaps_every_born_identity_before_original_deadline(self):
        with patch.object(sys,'path',[str(Path(__file__).resolve().parents[1]/'heavy-check'),*sys.path]):
            from processes import process_row
        controlled="""import json,os,signal
signal.signal(signal.SIGTERM,signal.SIG_IGN)
print(json.dumps({'pid':os.getpid(),'owner':os.getppid()}),flush=True)
signal.pause()
"""
        for at_seconds in (4.9,5.1,6,7.8):
            for outcome in ('interruption','launcher-kill','launcher-term'):
                with self.subTest(at_seconds=at_seconds,outcome=outcome),ExitStack() as cleanup,fixture_adoption():
                    unrelated=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'],start_new_session=True)
                    cleanup.callback(reap_process,unrelated)
                    identities={};marker=RuntimeError('controlled_late_parser_interruption')
                    try:
                        try:
                            with parser_worker(controlled) as (child,deadline):
                                for pid in (child.pid,):
                                    identity=process_row(pid);self.assertIsNotNone(identity)
                                    identities[pid]=identity[3]
                                with selectors.DefaultSelector() as ready:
                                    ready.register(child.stdout,selectors.EVENT_READ)
                                    self.assertTrue(ready.select(min(3,deadline-time.monotonic())))
                                    row=json.loads(child.stdout.readline())
                                for pid in row.values():
                                    identity=process_row(pid);self.assertIsNotNone(identity)
                                    identities[pid]=identity[3]
                                # A real delay selects the late failure boundary, never proves cleanup.
                                time.sleep(max(0,deadline-10+at_seconds-time.monotonic()))
                                if outcome=='interruption':raise marker
                                if outcome=='launcher-kill':child.kill()
                                else:child.terminate()
                                child.communicate(timeout=deadline-time.monotonic())
                        except RuntimeError as error:
                            if outcome!='interruption':raise
                            self.assertIs(error,marker)
                        self.assertLess(time.monotonic(),deadline)
                        self.assertIsNotNone(child.returncode)
                        self.assertTrue(child.stdout.closed);self.assertTrue(child.stderr.closed)
                        # Pipe EOF alone is not a supervisor-exit receipt. Observe every birth.
                        while True:
                            reap_fixture_zombies(identities)
                            live={pid:current for pid,birth in identities.items()
                                if (current:=process_row(pid)) is not None and current[3]==birth}
                            if not live:break
                            self.assertLess(time.monotonic(),deadline,f'owned identities survived: {live}')
                            time.sleep(.01)
                        self.assertIsNone(unrelated.poll())
                    finally:
                        finish_fixture(identities)

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

    def test_second_process_acquisition_failure_reaps_real_first_listener_and_pipes_preserving_error(self):
        original=subprocess.Popen;started=[];port=None;failure=OSError('controlled_second_acquisition')
        def acquire(*args,**options):
            nonlocal port
            if started:raise failure
            process=original(*args,**options);started.append(process)
            with selectors.DefaultSelector() as ready:
                ready.register(process.stdout,selectors.EVENT_READ)
                self.assertTrue(ready.select(3),'first real helper bound its listener before second acquisition')
                port=json.loads(process.stdout.readline())['port']
            return process
        try:
            with patch.object(subprocess,'Popen',side_effect=acquire):
                with self.assertRaises(OSError) as caught:
                    self.test_real_owned_helper_process_interrupt_reaps_socket_and_preserves_unrelated_process()
            self.assertIs(caught.exception,failure);self.assertEqual(len(started),1)
            process=started[0]
            self.assertIsNotNone(process.poll(),'first helper must be reaped when second acquisition fails')
            self.assertTrue(process.stdout.closed);self.assertTrue(process.stderr.closed)
            with socket.socket() as probe:
                probe.settimeout(1);self.assertNotEqual(probe.connect_ex(('127.0.0.1',port)),0)
        finally:
            # The regression itself owns its RED-state leak and never leaves that child behind.
            for process in started:
                if process.poll() is None:
                    self.assertEqual(os.getpgid(process.pid),process.pid);os.killpg(process.pid,signal.SIGKILL)
                process.wait(timeout=2)
                if process.stdout:process.stdout.close()
                if process.stderr:process.stderr.close()


if __name__=='__main__':unittest.main()
