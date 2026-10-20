"""An owned HTTP request really withholds its final byte until the private F command."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading
import unittest
import request_hold


@contextmanager
def peer(*,status=200):
    prefixed=threading.Event();completed=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            self.connection.settimeout(3)
            if (self.path!='/metrics/api/v1/query' or self.headers.get('Authorization')!='Bearer owned_token'
                    or self.headers.get('Content-Length')!='7' or self.rfile.read(6)!=b'query='):return
            prefixed.set()
            if self.rfile.read(1)!=b'1':return
            completed.set()
            raw=b'{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[100,"1"]}]}}'
            self.send_response(status);self.send_header('Content-Length',str(len(raw)));self.end_headers()
            try:self.wfile.write(raw)
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.02));thread.start()
    try:yield server.server_address[1],prefixed,completed
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


class HeldBody(unittest.TestCase):
    def test_prefix_is_observed_before_release_and_wrong_response_never_becomes_done(self):
        for status in (200,500):
            with self.subTest(status=status),peer(status=status) as (port,prefixed,completed):
                environment={'PATH':os.environ.get('PATH',''),'CADDY_HOLD_TOKEN':'owned_token','CADDY_TEST_HTTP_PORT':str(port)}
                fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'held.py')],environment)
                with request_hold.Held('owned_token',_fixture=fixture) as held:
                    self.assertTrue(prefixed.wait(1))
                    self.assertFalse(completed.is_set())
                    if status==200:
                        held.finish();self.assertTrue(completed.wait(1))
                    else:
                        with self.assertRaises(ValueError):held.finish()
