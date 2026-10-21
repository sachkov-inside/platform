"""Current request ACK and owned flush are prerequisites of whole stored-vector validation."""
import unittest
from unittest.mock import patch
import privacy
from test_oracle import EXPECTED


class CompletionOrder(unittest.TestCase):
    def test_privacy_returns_only_the_actual_completion_verdict_for_all_fixed_challenges(self):
        calls=[]
        class Ledger:
            def accept(self,value):return {'continuity':'same_epoch','count_complete':True}
        class Source:
            ledger=Ledger()
            def acquire(self):return EXPECTED.copy()
            def before_unsafe_upload(self):calls.append('logging')
        observation={'freshness':'fresh','points':7,'age_seconds':0}
        # This entry does not exist in the old implementation and must not fall back to stored positives.
        with patch('completion.process',side_effect=lambda source,value,kind:calls.append(kind) or observation):
            result=privacy.run(Source())
        self.assertEqual(calls,[part for kind in privacy.KINDS for part in ('logging',kind)])
        self.assertEqual(result,{**observation,'continuity':'same_epoch','count_complete':True})


import copy
from contextlib import contextmanager
from email.message import Message
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import http.client
import json
from pathlib import Path
import signal
import socket
import tempfile
import threading
import time
from types import SimpleNamespace
import completion
import queries
from test_oracle import vectors,raw,NOW


@contextmanager
def endpoint(body,*,status=200,held=None,seen=None,inspect_request=None,headers=(),tolerate_disconnect=False):
    errors=[];threads=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            threads.append(threading.current_thread())
            try:
                length=int(self.headers['Content-Length']);packet=self.rfile.read(length)
                if inspect_request is not None:inspect_request(self,packet)
                if seen is not None:seen.set()
                if held is not None and not held.wait(3):raise AssertionError('held endpoint never released')
                self.send_response(status)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)))
                for key,value in headers:self.send_header(key,value)
                self.end_headers();self.wfile.write(body);self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError) as error:
                if not tolerate_disconnect:errors.append(error)
                self.close_connection=True
            except BaseException as error:errors.append(error);self.close_connection=True
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01});thread.start()
    try:yield server.server_address[1]
    finally:
        if held is not None:held.set()
        server.shutdown();server.server_close();thread.join(2)
        for worker in threads:worker.join(2)
        if thread.is_alive() or any(worker.is_alive() for worker in threads):raise AssertionError('owned HTTP fixture not settled')
        if errors:raise errors[0]


class ActualTransport(unittest.TestCase):
    def exercise(self,*,ingest=b'{}',flush=b'',foreign=False,hold=None,status=200,headers=(),flush_status=200,expire=None):
        events=[];owners=[];reads=[];actual=http.client.HTTPConnection
        ingest_seen=threading.Event();flush_seen=threading.Event();release=threading.Event();watch_errors=[]
        def packet(request,body):
            events.append('ingest')
            self.assertEqual(request.path,'/v1/metrics');self.assertLessEqual(len(body),4096)
            self.assertEqual(len(json.loads(body)['resourceMetrics']),2)
        def flush_packet(request,body):
            events.append('flush');self.assertEqual(request.path,'/internal/force_flush')
            self.assertEqual(body,b'authKey='+b'a'*64)
        def watch():
            try:
                event=ingest_seen if hold=='ingest' else flush_seen
                if not event.wait(2):raise AssertionError('no current held request')
                self.assertEqual(events,['ingest'] if hold=='ingest' else ['ingest','flush'])
                self.assertEqual(reads,[])
            except BaseException as error:watch_errors.append(error)
            finally:release.set()
        watcher=None
        rows,stamps=vectors()
        class Response:
            status=200
            def __init__(self,body):self.body=body.encode();self.headers=Message()
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,cap):return self.body
        class Opener:
            def open(self,request,timeout):
                reads.append(request);events.append('read')
                current=copy.deepcopy(stamps if len(reads)==2 else rows)
                if foreign and len(reads)==3:
                    bad=copy.deepcopy(rows[0]);bad['metric']['service.name']='foreign-service';current.append(bad)
                return Response(raw(current))
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();path=output/'postgres-completion-auth.json'
            path.write_text(json.dumps({'schema':1,'key':'a'*64}));path.chmod(0o600)
            class Targets:
                def __init__(self):self.output=output
                def metrics_private(self,deadline):owners.append(deadline)
                def flush_target(self,deadline):owners.append(deadline);return ('127.0.0.1','127.0.0.1',1)
            source=SimpleNamespace(end=time.monotonic()+150,token='A'*32,targets=Targets(),verify_storage=owners.append)
            with endpoint(ingest,status=status,held=release if hold=='ingest' else None,seen=ingest_seen,inspect_request=packet,headers=headers,tolerate_disconnect=expire is not None) as ingest_port, \
                    endpoint(flush,status=flush_status,held=release if hold=='flush' else None,seen=flush_seen,inspect_request=flush_packet,tolerate_disconnect=expire is not None) as flush_port:
                def connection(host,port,timeout):
                    self.assertEqual(host,'127.0.0.1');self.assertIn(port,(14318,8428))
                    client=actual(host,ingest_port if port==14318 else flush_port,timeout=timeout)
                    if expire is not None and ((hold=='ingest' and port==14318) or (hold=='flush' and port==8428)):
                        response=client.getresponse
                        def held_response():
                            # Prove this actual request reached the held owned endpoint before timing out its read.
                            observed=ingest_seen if port==14318 else flush_seen
                            if not observed.wait(1):raise AssertionError('current held request not observed')
                            client.sock.settimeout(expire)
                            return response()
                        client.getresponse=held_response
                    return client
                if hold is not None and expire is None:watcher=threading.Thread(target=watch);watcher.start()
                try:
                    with patch.object(completion.http.client,'HTTPConnection',side_effect=connection), \
                            patch.object(queries.urllib.request,'build_opener',return_value=Opener()), \
                            patch.object(queries.time,'time',return_value=1790000000),patch.object(queries.time,'time_ns',return_value=NOW*1000):
                        result=completion.process(source,EXPECTED,'foreign')
                    self.assertEqual(result['freshness'],'fresh')
                except BaseException:
                    if expire is not None:
                        self.assertEqual(events,['ingest'] if hold=='ingest' else ['ingest','flush']);self.assertEqual(reads,[])
                    if ingest!=b'{}' or status!=200 or headers:
                        self.assertEqual(events,['ingest']);self.assertEqual(reads,[])
                    elif flush or flush_status!=200:
                        self.assertEqual(events,['ingest','flush']);self.assertEqual(reads,[])
                    raise
                finally:
                    release.set()
                    if watcher is not None:
                        watcher.join(2);self.assertFalse(watcher.is_alive())
                    self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))
                    if watch_errors:raise watch_errors[0]
        return events,owners,reads

    def test_real_held_current_ingest_and_flush_ack_block_later_steps(self):
        for hold in ('ingest','flush'):
            with self.subTest(held=hold):
                events,owners,reads=self.exercise(hold=hold)
                self.assertEqual(events,['ingest','flush','read','read','read'])
                self.assertEqual(len(reads),3);self.assertEqual(len(set(owners)),1)

    def test_actual_partial_invalid_and_oversized_ingest_never_reach_flush_or_queries(self):
        for body in (b'{"partialSuccess":{}}',b'{"a":1,"a":2}',b'\xef\xbb\xbf{}',b'{} trailing',b'null',b'',b' '*1025):
            with self.subTest(body_length=len(body)),self.assertRaises(ValueError):self.exercise(ingest=body)
        with self.assertRaises(ValueError):self.exercise(status=302)
        with self.assertRaises(ValueError):self.exercise(headers=(('Content-Encoding','gzip'),))

    def test_actual_held_socket_timeout_cannot_advance_and_resources_are_settled(self):
        for hold in ('ingest','flush'):
            with self.subTest(held=hold),self.assertRaises((TimeoutError,socket.timeout)):self.exercise(hold=hold,expire=.05)

    def test_nonempty_flush_and_late_foreign_global_vector_cannot_pass(self):
        with self.assertRaises(ValueError):self.exercise(flush=b'x')
        with self.assertRaises(ValueError):self.exercise(flush_status=403)
        with self.assertRaises(ValueError):self.exercise(foreign=True)


class Settlement(unittest.TestCase):
    def test_each_acquired_http_resource_closes_once_and_preserves_pending_primary_traceback(self):
        variants=((RuntimeError('private first'),OSError('private close')), (KeyboardInterrupt(),SystemExit(7)),
                  (SystemExit(9),KeyboardInterrupt()))
        same=RuntimeError('same primary');variants+=((same,same),)
        for primary,secondary in variants:
            for fault in ('request','body','owner'):
                with self.subTest(primary=type(primary).__name__,fault=fault):
                    closed=[];owner_calls=[];saved=[]
                    class Response:
                        status=200
                        def getheaders(self):return [('Content-Type','application/json'),('Content-Length','2')]
                        def read(self,cap):
                            if fault=='body':fail()
                            return b'{}'
                        def close(self):closed.append('response');raise secondary
                    class Connection:
                        def request(self,*args,**kwargs):
                            if fault=='request':fail()
                        def getresponse(self):return Response()
                        def close(self):closed.append('connection');raise secondary
                    def fail():
                        try:raise primary
                        except BaseException:saved.append(primary.__traceback__);raise
                    def owner(deadline):
                        owner_calls.append(deadline)
                        if fault=='owner' and len(owner_calls)==2:fail()
                    source=SimpleNamespace(verify_storage=owner,targets=SimpleNamespace(metrics_private=lambda deadline:None))
                    caught=None
                    with patch.object(completion.http.client,'HTTPConnection',return_value=Connection()):
                        try:completion._ingest(source,b'{}',time.monotonic()+1)
                        except BaseException as error:caught=error
                    self.assertIs(caught,primary)
                    self.assertEqual(closed,['connection'] if fault=='request' else ['response','connection'])
                    trace=caught.__traceback__;frames=[];names=[]
                    while trace is not None:frames.append(trace);names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                    self.assertTrue(any(item is saved[0] for item in frames));self.assertNotIn('close',names)
                    self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))

    def test_close_failure_after_success_is_visible_and_all_remaining_closes_are_attempted(self):
        closed=[];primary=OSError('controlled close')
        class Response:
            status=200
            def getheaders(self):return [('Content-Type','application/json')]
            def read(self,cap):return b'{}'
            def close(self):closed.append('response');raise primary
        class Connection:
            def request(self,*args,**kwargs):pass
            def getresponse(self):return Response()
            def close(self):closed.append('connection');raise primary
        source=SimpleNamespace(verify_storage=lambda deadline:None,targets=SimpleNamespace(metrics_private=lambda deadline:None))
        with patch.object(completion.http.client,'HTTPConnection',return_value=Connection()):
            try:completion._ingest(source,b'{}',time.monotonic()+1)
            except OSError as error:self.assertIs(error,primary)
            else:self.fail('failed settlement returned success')
        self.assertEqual(closed,['response','connection'])

    def test_expired_or_active_alarm_refuses_before_any_transport_and_restores_timer_handler(self):
        source=SimpleNamespace(verify_storage=lambda deadline:None)
        prior=signal.getsignal(signal.SIGALRM)
        with patch.object(completion.http.client,'HTTPConnection') as transport:
            with self.assertRaises(TimeoutError):completion._ingest(source,b'{}',time.monotonic()-1)
            with queries.source_status_query._deadline(2):
                with self.assertRaises(ValueError):completion._ingest(source,b'{}',time.monotonic()+1)
                self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0],0)
            transport.assert_not_called()
        self.assertEqual(signal.getsignal(signal.SIGALRM),prior);self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))

    def test_timer_restoration_fault_keeps_original_interrupt_or_same_primary(self):
        original=signal.setitimer
        for primary in (KeyboardInterrupt(),SystemExit(11),RuntimeError('same timer primary')):
            with self.subTest(kind=type(primary).__name__):
                calls=[];saved=[];caught=None
                def timer(kind,seconds,*args):
                    calls.append(seconds)
                    if seconds==0:raise primary
                    return original(kind,seconds,*args)
                try:
                    with patch.object(signal,'setitimer',side_effect=timer):
                        try:
                            with queries._completion_deadline(1):
                                try:raise primary
                                except BaseException:saved.append(primary.__traceback__);raise
                        except BaseException as error:caught=error
                    self.assertIs(caught,primary);self.assertEqual(calls,[1,0])
                    names=[];trace=caught.__traceback__
                    while trace is not None:names.append(trace.tb_frame.f_code.co_name);trace=trace.tb_next
                    self.assertNotIn('timer',names)
                finally:
                    # Independent safety only after evaluating restoration failure, never an admission proof.
                    original(signal.ITIMER_REAL,0)


class ActualPacket(unittest.TestCase):
    def test_actual_fixed_challenges_fit_cap_and_oversize_refuses_before_ingest(self):
        value={'sample_us':9007199254740991,'postmaster_us':9007199254740990,'stats_reset_us':9007199254740989,
               'connected_backends':1000000,'waiting_locks':1000000,'deadlocks':9007199254740991}
        for kind in privacy.KINDS:
            packet=json.dumps(privacy.challenge(value,kind),separators=(',',':')).encode()
            self.assertLessEqual(len(packet),3440)
        source=SimpleNamespace(end=time.monotonic()+150)
        with patch.object(privacy,'challenge',return_value={'controlled':'x'*4096}),patch.object(completion,'_ingest') as ingest:
            with self.assertRaisesRegex(ValueError,'^malformed$'):completion.process(source,value,'foreign')
        ingest.assert_not_called()

    def test_flush_connection_failure_closes_once_without_retry_and_missing_auth_never_connects(self):
        for primary in (RuntimeError('controlled connect'),KeyboardInterrupt(),SystemExit(13)):
            with self.subTest(kind=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                output=Path(directory).resolve();path=output/'postgres-completion-auth.json'
                path.write_text(json.dumps({'schema':1,'key':'a'*64}));path.chmod(0o600)
                closed=[];calls=[]
                class Connection:
                    def connect(self):calls.append('connect');raise primary
                    def close(self):closed.append('close');raise primary
                source=SimpleNamespace(verify_storage=lambda deadline:None,
                    targets=SimpleNamespace(output=output,flush_target=lambda deadline:('127.0.0.1','127.0.0.1',1)))
                with patch.object(completion.http.client,'HTTPConnection',return_value=Connection()) as factory:
                    try:completion._flush(source,time.monotonic()+1)
                    except BaseException as error:self.assertIs(error,primary)
                    else:self.fail('connect failure admitted')
                    self.assertEqual(factory.call_count,1)
                self.assertEqual((calls,closed),(['connect'],['close']))
                path.unlink()
                with patch.object(completion.http.client,'HTTPConnection') as factory:
                    with self.assertRaises((ValueError,OSError)):completion._flush(source,time.monotonic()+1)
                    factory.assert_not_called()
