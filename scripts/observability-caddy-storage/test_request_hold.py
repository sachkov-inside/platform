"""An owned HTTP request really withholds its final byte until the private F command."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
import socket
import struct
from pathlib import Path
import sys
import threading
import unittest
import request_hold


@contextmanager
def peer(*,status=200,body=None):
    prefixed=threading.Event();completed=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def respond(self):
            raw=body if body is not None else b'{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[100,"1"]}]}}'
            self.send_response(status);self.send_header('Content-Length',str(len(raw)));self.end_headers()
            try:self.wfile.write(raw)
            except (BrokenPipeError,ConnectionResetError):pass
        def do_GET(self):
            if self.path=='/metrics/api/v1/query?query=1' and self.headers.get('Authorization')=='Bearer owned_token':self.respond()
        def do_POST(self):
            self.connection.settimeout(3)
            if (self.path!='/metrics/api/v1/query' or self.headers.get('Authorization')!='Bearer owned_token'
                    or self.headers.get('Content-Length')!='7' or self.rfile.read(6)!=b'query='):return
            prefixed.set()
            if self.rfile.read(1)!=b'1':return
            completed.set()
            self.respond()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.02));thread.start()
    try:yield server.server_address[1],prefixed,completed
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


@contextmanager
def transport_peer(fault):
    server=socket.socket();server.bind(('127.0.0.1',0));server.listen();server.settimeout(.05)
    stop=threading.Event();requests=[];errors=[]
    body=b'{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[100,"1"]}]}}'
    def serve():
        try:
            while not stop.is_set():
                try:client,_=server.accept()
                except socket.timeout:continue
                except OSError:
                    if stop.is_set():break
                    raise
                with client:
                    client.settimeout(2);raw=b''
                    while b'\r\n\r\n' not in raw:
                        value=client.recv(4096)
                        if not value:break
                        raw+=value
                    requests.append(len(raw))
                    if len(requests)==1 and fault:
                        if fault=='prefix':client.sendall(b'HTTP/1.1 200 OK\r\n')
                        if fault=='interim':client.sendall(b'HTTP/1.1 100 Continue\r\n\r\n')
                        if fault=='protocol':client.sendall(b'NOT HTTP\r\n')
                        if fault=='stall':stop.wait(2)
                        if fault=='body':client.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body[:8])
                        if fault!='eof':client.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack('ii',1,0))
                    else:client.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n\r\n'+body)
        except BaseException as error:errors.append(type(error).__name__)
    worker=threading.Thread(target=serve);worker.start()
    try:yield server.getsockname()[1],requests
    finally:stop.set();server.close();worker.join(timeout=3);assert not worker.is_alive() and not errors,errors


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
