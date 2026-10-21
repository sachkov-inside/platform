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
import subprocess
import sys
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
    errors=[];workers=[];accepted=[];stop=threading.Event();server=None;thread=None
    primary=None;primary_tb=None
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
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
    class Server(ThreadingHTTPServer):
        def get_request(self):
            connection,address=super().get_request();accepted.append(connection)
            connection.settimeout(1)
            return connection,address
        def process_request(self,request,address):
            worker=threading.Thread(target=self.process_request_thread,args=(request,address),daemon=True)
            workers.append(worker)  # Register the real object before any native thread can start.
            worker.start()
    def serve():
        try:
            while not stop.is_set():server.handle_request()
        except BaseException as error:
            if not stop.is_set():errors.append(error)
    def cleanup(action):
        nonlocal primary,primary_tb
        try:action()
        except BaseException as error:
            if primary is None:primary,primary_tb=error,sys.exc_info()[2]
            else:BaseException.__traceback__.__set__(primary,primary_tb)
    try:
        # Retain the object before __init__ can acquire a socket and then fail.
        server=Server.__new__(Server)
        Server.__init__(server,('127.0.0.1',0),Handler,bind_and_activate=False)
        server.server_bind();server.server_activate();server.timeout=.01
        thread=threading.Thread(target=serve)
        thread.start()
        yield server.server_address[1]
    except BaseException as error:primary,primary_tb=error,sys.exc_info()[2]
    finally:
        if held is not None:cleanup(held.set)
        cleanup(stop.set)
        listener=getattr(server,'socket',None)
        if listener is not None and listener.fileno()>=0:cleanup(listener.close)
        if thread is not None and thread.ident is not None:cleanup(lambda:thread.join(2))
        for worker in list(workers):
            if worker.ident is not None:cleanup(lambda worker=worker:worker.join(2))
        for connection in accepted:
            if connection.fileno()>=0:
                cleanup(lambda connection=connection:connection.shutdown(socket.SHUT_RDWR))
                cleanup(connection.close)
        if thread is not None and thread.ident is not None and thread.is_alive() or any(worker.is_alive() for worker in workers):
            cleanup(lambda:(_ for _ in ()).throw(AssertionError('owned HTTP fixture not settled')))
        if errors and primary is None:primary=errors[0];primary_tb=primary.__traceback__
        if primary is not None:
            BaseException.__traceback__.__set__(primary,primary_tb)
            raise primary from None


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
                deadline=time.monotonic()+2
                while not event.wait(.01):
                    if release.is_set():return
                    if time.monotonic()>=deadline:raise AssertionError('no current held request')
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
                try:
                    if hold is not None and expire is None:
                        watcher=threading.Thread(target=watch)
                        watcher.start()
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
                    primary,primary_tb=sys.exc_info()[1:]
                    def finish(action):
                        nonlocal primary,primary_tb
                        try:action()
                        except BaseException as error:
                            if primary is None:primary,primary_tb=error,sys.exc_info()[2]
                            else:BaseException.__traceback__.__set__(primary,primary_tb)
                    finish(release.set)
                    if watcher is not None and watcher.ident is not None:
                        finish(lambda:watcher.join(2))
                        finish(lambda:self.assertFalse(watcher.is_alive()))
                    finish(lambda:self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0)))
                    if watch_errors and primary is None:primary=watch_errors[0];primary_tb=primary.__traceback__
                    if primary is not None:
                        BaseException.__traceback__.__set__(primary,primary_tb)
                        raise primary from None
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
        # Prior SIG_DFL and real pending expiry exist ONLY in this group-owned child.
        code=r'''import json,os,select,signal,sys
sys.path.insert(0,sys.argv[1])
import queries
primary={'runtime':RuntimeError('first'),'interrupt':KeyboardInterrupt(),'exit':SystemExit(47),'same':RuntimeError('same'),'none':None}[sys.argv[2]]
secondary=primary if sys.argv[2]=='same' else OSError('clear refused')
original_signal=signal.signal;original_timer=signal.setitimer
read,write=os.pipe();clears=[];arms=[];installs=[];saved=[];caught=None
original_signal(signal.SIGALRM,signal.SIG_DFL)
def install(kind,handler):
    installs.append(handler)
    if kind==signal.SIGALRM and callable(handler):
        def observed(signum,frame):
            handler(signum,frame)
            os.write(write,b'x')
        return original_signal(kind,observed)
    return original_signal(kind,handler)
def timer(kind,seconds,*args):
    if seconds==0:clears.append(seconds);raise secondary
    arms.append(seconds);return original_timer(kind,seconds,*args)
signal.signal=install;signal.setitimer=timer
try:
    try:
        with queries._completion_deadline(.05):
            if primary is not None:
                try:raise primary
                except BaseException:saved.append(primary.__traceback__);raise
    except BaseException as error:caught=error
    # The old implementation restores SIG_DFL here and the real signal kills ONLY this child.
    ready,_,_=select.select([read],[],[],1)
    assert ready and os.read(read,1)==b'x','real pending expiry not observed'
    assert caught is (secondary if primary is None else primary) and clears==[0] and arms==[.05]
    trace=caught.__traceback__;names=[];frames=[]
    while trace is not None:names.append(trace.tb_frame.f_code.co_name);frames.append(trace);trace=trace.tb_next
    if primary is not None:assert any(item is saved[0] for item in frames) and 'timer' not in names
    assert queries._alarm_broken and signal.getsignal(signal.SIGALRM)!=signal.SIG_DFL
    before=(len(arms),len(clears),len(installs))
    try:
        with queries._completion_deadline(.1):raise AssertionError('poisoned protocol entered')
    except ValueError:pass
    else:raise AssertionError('poisoned protocol admitted')
    assert before==(len(arms),len(clears),len(installs))
    print(json.dumps({'primary':True,'traceback':True,'single_clear':True,'real_expiry':True,'inert_handler':True,'future_refused':True}))
finally:
    # Independent rescue AFTER verdict; never claims that the production clear succeeded.
    signal.signal=original_signal;signal.setitimer=original_timer
    original_timer(signal.ITIMER_REAL,0);original_signal(signal.SIGALRM,signal.SIG_DFL)
    os.close(read);os.close(write)
'''
        expected={'primary':True,'traceback':True,'single_clear':True,'real_expiry':True,'inert_handler':True,'future_refused':True}
        for kind in ('runtime','interrupt','exit','same','none'):
            with self.subTest(kind=kind):
                result=subprocess.run([sys.executable,'-B','-c',code,str(Path(__file__).resolve().parent),kind],
                    capture_output=True,text=True,timeout=3)
                self.assertEqual(result.returncode,0,'owned timer child failed')
                self.assertEqual(json.loads(result.stdout),expected)


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


class FixtureLifetime(unittest.TestCase):
    def test_acquisition_faults_settle_real_listener_and_started_thread_before_rescue(self):
        for fault in ('constructor','bind','activate','start_before','start_after'):
            with self.subTest(fault=fault):
                servers=[];threads=[];primary=KeyboardInterrupt();caught=None
                initialize=ThreadingHTTPServer.__init__;bind=ThreadingHTTPServer.server_bind
                activate=ThreadingHTTPServer.server_activate;start=threading.Thread.start
                def init(server,*args,**kwargs):
                    initialize(server,*args,**kwargs);servers.append(server)
                    if fault=='constructor':raise primary
                def bound(server):
                    bind(server)
                    if fault=='bind':raise primary
                def activated(server):
                    activate(server)
                    if fault=='activate':raise primary
                def started(thread):
                    threads.append(thread)
                    if fault=='start_before':raise primary
                    start(thread)
                    if fault=='start_after':raise primary
                try:
                    with patch.object(ThreadingHTTPServer,'__init__',init),patch.object(ThreadingHTTPServer,'server_bind',bound), \
                            patch.object(ThreadingHTTPServer,'server_activate',activated),patch.object(threading.Thread,'start',started):
                        try:
                            with endpoint(b'{}'):self.fail('failed fixture acquisition yielded')
                        except BaseException as error:caught=error
                    # Evaluate production fixture ownership BEFORE independent safety rescue.
                    self.assertIs(caught,primary)
                    self.assertTrue(all(server.socket.fileno()==-1 for server in servers))
                    self.assertTrue(all(not thread.is_alive() for thread in threads))
                finally:
                    for server in servers:
                        if server.socket.fileno()>=0:server.socket.close()
                    for thread in threads:
                        if thread.ident is not None and thread.is_alive():thread.join(3)

    def test_cleanup_fault_attempts_all_eligible_joins_and_preserves_pending_primary(self):
        for fault in ('listener_close','join'):
            for kind in ('runtime','interrupt','exit','same'):
                with self.subTest(fault=fault,kind=kind):
                    servers=[];threads=[];joined=[];closed=[];saved=[]
                    primary={'runtime':RuntimeError('first'),'interrupt':KeyboardInterrupt(),'exit':SystemExit(41),'same':RuntimeError('same')}[kind]
                    secondary=primary if kind=='same' else OSError('cleanup')
                    init=ThreadingHTTPServer.__init__;start=threading.Thread.start;join=threading.Thread.join;close=socket.socket.close
                    def initialized(server,*args,**kwargs):init(server,*args,**kwargs);servers.append(server)
                    def started(thread):threads.append(thread);return start(thread)
                    def joining(thread,*args,**kwargs):
                        joined.append(thread);result=join(thread,*args,**kwargs)
                        if fault=='join' and len(joined)==1:raise secondary
                        return result
                    def closing(value):
                        listener=any(server.socket is value for server in servers);result=close(value)
                        if listener:
                            closed.append(value)
                            if fault=='listener_close':raise secondary
                        return result
                    caught=None
                    try:
                        with patch.object(ThreadingHTTPServer,'__init__',initialized),patch.object(threading.Thread,'start',started), \
                                patch.object(threading.Thread,'join',joining),patch.object(socket.socket,'close',closing):
                            try:
                                with endpoint(b'{}') as port:
                                    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=1)
                                    try:
                                        connection.request('POST','/',body=b'{}');response=connection.getresponse()
                                        try:self.assertEqual(response.read(),b'{}')
                                        finally:response.close()
                                    finally:connection.close()
                                    try:raise primary
                                    except BaseException:saved.append(primary.__traceback__);raise
                            except BaseException as error:caught=error
                        self.assertIs(caught,primary)
                        self.assertEqual(len(closed),1);self.assertGreaterEqual(len(joined),2)
                        self.assertEqual(len(joined),len(set(joined)))
                        self.assertTrue(all(not thread.is_alive() for thread in threads))
                        self.assertTrue(all(server.socket.fileno()==-1 for server in servers))
                        names=[];frames=[];trace=caught.__traceback__
                        while trace is not None:names.append(trace.tb_frame.f_code.co_name);frames.append(trace);trace=trace.tb_next
                        self.assertTrue(any(item is saved[0] for item in frames));self.assertNotIn('joining',names);self.assertNotIn('closing',names)
                    finally:
                        for server in servers:
                            if server.socket.fileno()>=0:close(server.socket)
                        for thread in threads:
                            if thread.ident is not None and thread.is_alive():join(thread,3)

    def test_watcher_start_failure_after_native_start_settles_every_owned_resource(self):
        servers=[];threads=[];primary=SystemExit(43);caught=None
        init=ThreadingHTTPServer.__init__;start=threading.Thread.start
        def initialized(server,*args,**kwargs):init(server,*args,**kwargs);servers.append(server)
        def started(thread):
            threads.append(thread);start(thread)
            if getattr(thread,'_target',None).__name__=='watch':raise primary
        try:
            with patch.object(ThreadingHTTPServer,'__init__',initialized),patch.object(threading.Thread,'start',started):
                try:ActualTransport().exercise(hold='ingest')
                except BaseException as error:caught=error
            self.assertIs(caught,primary)
            self.assertTrue(all(server.socket.fileno()==-1 for server in servers))
            self.assertTrue(all(not thread.is_alive() for thread in threads))
        finally:
            for server in servers:
                if server.socket.fileno()>=0:server.socket.close()
            for thread in threads:
                if thread.ident is not None and thread.is_alive():thread.join(3)
