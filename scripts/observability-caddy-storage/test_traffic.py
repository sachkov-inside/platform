"""Actual finite HTTP request/response path; this fixture is not native Caddy evidence."""
import http.client
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import socket
from unittest.mock import Mock
from urllib.parse import parse_qs
import unittest
import traffic
from test_request_hold import peer


@contextmanager
def privacy_peer():
    """Real HTTP boundary with the guard's closed form-key contract, no stored/native claim."""
    observed=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            self.connection.settimeout(3)
            form=parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode('ascii'),strict_parsing=True)
            observed.append((self.path,form,dict(self.headers)))
            code=200 if set(form)=={'query'} else 400
            raw=b'{"status":"success","data":{"resultType":"scalar","result":[100,"1"]}}'
            self.send_response(code);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.02));thread.start()
    try:yield server.server_address[1],observed
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


class FixedTraffic(unittest.TestCase):
    def test_controlled_recovery_retains_each_actual_502_for_partition_accounting(self):
        with peer(status=502) as (port,_,_):
            result=traffic.perform('recovery','owned_token',_connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3))
            self.assertEqual((result['method'],result['code']),('GET',502))

        # Only an actual refused connect and the response's first empty read are
        # retryable. Request-side failures and foreign error subclasses stay fatal.
        with socket.socket() as blocked:
            blocked.bind(('127.0.0.1',0));address=blocked.getsockname();blocked.close()
            with self.assertRaises(traffic.ReadinessUnavailable) as caught:
                traffic.perform('recovery','owned_token',_connection=http.client.HTTPConnection(*address,timeout=1))
            self.assertEqual(caught.exception.phase,'refused')
        class ForeignRefused(ConnectionRefusedError):pass
        class ForeignReset(ConnectionResetError):pass
        for error in (ConnectionResetError('private'),BrokenPipeError('private'),ConnectionAbortedError('private'),
                      OSError('private'),TimeoutError('private'),KeyboardInterrupt(),ForeignRefused('private')):
            with self.subTest(request_error=type(error).__name__):
                connection=Mock(spec=http.client.HTTPConnection);connection.response_class=http.client.HTTPResponse
                connection.request.side_effect=error
                with self.assertRaises(type(error)) as caught:traffic.perform('recovery','owned_token',_connection=connection)
                self.assertIs(caught.exception,error);connection.getresponse.assert_not_called();connection.close.assert_called_once()
        for received,error in ((False,ForeignReset('private')),(True,ConnectionResetError('private'))):
            with self.subTest(prefix_seen=received):
                sock=Mock();wire=Mock();sock.makefile.return_value=wire;wire.peek.side_effect=error
                response=traffic._ReadinessResponse(sock);response._received=received
                try:
                    with self.assertRaises(type(error)) as caught:response._read_status()
                    self.assertIs(caught.exception,error)
                finally:response.close()

    def test_fixed_post_records_only_a_validated_successful_whole_response(self):
        for status in (200,500):
            with self.subTest(status=status),peer(status=status) as (port,_,completed):
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
                if status==200:
                    result=traffic.perform('http_post','owned_token',_connection=connection)
                    self.assertEqual((result['method'],result['code']),('POST',200))
                    self.assertTrue(completed.is_set())
                else:
                    with self.assertRaises(ValueError):traffic.perform('http_post','owned_token',_connection=connection)

        # The privacy corpus must reach native storage through the same closed query guard.
        # A private unknown form key is refused before a successful whole query can be observed.
        with privacy_peer() as (port,observed):
            result=traffic.perform('privacy','owned_token',_connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3))
            self.assertEqual((result['method'],result['code']),('POST',200))
            self.assertEqual(len(observed),1)
            path,form,headers=observed[0]
            self.assertEqual(path,'/metrics/api/v1/query')
            self.assertEqual(form,{'query':['1 #'+traffic.SENTINEL]})
            for name,value in (('Host',traffic.SENTINEL+'.invalid'),('Cookie','private='+traffic.SENTINEL),
                               ('X-Private',traffic.SENTINEL),('tracestate','private='+traffic.SENTINEL),
                               ('baggage','private='+traffic.SENTINEL),('traceparent','00-'+'0a'*16+'-'+'0b'*8+'-01')):
                self.assertEqual(headers[name],value)
