"""SOURCE-MODEL: real Unix socket requests and finite callback observations."""
import errno
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import representative_agent as agent


class Protocol(unittest.TestCase):
    def test_fresh_request_drives_callback_and_closed_negatives_do_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary).resolve();directory.chmod(0o700);path=directory/'reader.sock';seen=[]
            def read(operation):seen.append(operation);return {'ok':True,'count':len(seen)}
            with agent.server('a'*64,read,path) as server:
                stop=threading.Event()
                def run():
                    while not stop.is_set():server.handle_request()
                thread=threading.Thread(target=run);thread.start()
                config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                try:
                    for count in (1,2):
                        status,value=agent.wire(config,time.monotonic()+2,path=path,body={'operation':'retained_probes','parameters':{}})
                        self.assertEqual((status,value),(200,{'state':'observed','observation':{'ok':True,'count':count}}))
                    for body in ({'operation':'raw_sql','parameters':{}},{'operation':'retained_probes','parameters':[]},
                            {'operation':'retained_probes','parameters':{'sql':'SELECT 1'}},
                            {'operation':'retained_probes','parameters':{},'window':1}):
                        self.assertEqual(agent.wire(config,time.monotonic()+2,path=path,body=body)[0],403)
                    self.assertEqual(agent.wire(config,time.monotonic()+2,path=path,body={'operation':'retained_probes','parameters':{}},key='wrong')[0],403)
                    self.assertEqual(seen,['retained_probes','retained_probes'])
                finally:stop.set();thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
    def test_socket_replacement_and_foreign_peer_refuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary).resolve()/'reader.sock';Path(temporary).resolve().chmod(0o700)
            with agent.server('a'*64,lambda _: {'ok':True},path):
                config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                wrong=dict(config);wrong['socket_identity']=dict(config['socket_identity'],inode=0)
                with self.assertRaises(ValueError):agent.wire(wrong,time.monotonic()+2,path=path,body={})
                with patch.object(agent,'peer',return_value=(1,os.getuid()+1,os.getgid())),self.assertRaises(ValueError):
                    agent.wire(config,time.monotonic()+2,path=path,body={})
    def test_only_kernel_network_unreachable_counts_as_denial(self):
        for error in (errno.ECONNREFUSED,errno.ETIMEDOUT,errno.EHOSTUNREACH):
            with patch.object(socket,'create_connection',side_effect=OSError(error,'model')),self.assertRaises(ValueError):agent.deny_tcp('10.0.0.2',8080,1)
        with patch.object(socket,'create_connection',side_effect=OSError(errno.ENETUNREACH,'model')):
            self.assertEqual(agent.deny_tcp('10.0.0.2',8080,1),{'kernel_denied':True})


class EarlyDenial(unittest.TestCase):
    def test_actual_early_denial_is_read_after_body_send_failure_without_retry(self):
        import http.client
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary).resolve();directory.chmod(0o700);path=directory/'reader.sock'
            seen=[];closed=threading.Event();stop=threading.Event();send_errors=[]
            with agent.server('a'*64,lambda operation:seen.append(operation) or {'ok':True},path) as server:
                shutdown=server.shutdown_request;send=http.client.HTTPConnection.send
                def shutdown_request(request):
                    try:return shutdown(request)
                    finally:closed.set()
                server.shutdown_request=shutdown_request
                body={'operation':'retained_probes','parameters':{}}
                raw=agent.json.dumps(body,separators=(',',':')).encode()
                def interleaved_send(connection,data):
                    if data==raw:self.assertTrue(closed.wait(2),'early denial close budget')
                    try:return send(connection,data)
                    except BrokenPipeError as error:send_errors.append(error);raise
                def run():
                    while not stop.is_set():server.handle_request()
                thread=threading.Thread(target=run);thread.start()
                config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                try:
                    with patch.object(http.client.HTTPConnection,'send',interleaved_send):
                        value=agent.wire(config,time.monotonic()+3,path=path,body=body,key='wrong')
                    self.assertEqual(value,(403,{'state':'denied'}))
                    self.assertEqual(len(send_errors),1);self.assertEqual(server.denials,1);self.assertEqual(seen,[])
                    self.assertEqual(agent.wire(config,time.monotonic()+2,path=path,body=body),(200,{'state':'observed','observation':{'ok':True}}))
                    self.assertEqual(seen,['retained_probes']);self.assertEqual(server.denials,1)
                finally:stop.set();thread.join(timeout=3)
                self.assertFalse(thread.is_alive())

    def test_unproved_early_responses_keep_original_send_error_and_close_socket(self):
        import http.client
        import traceback
        cases=((403,b''),(200,b'{"state":"denied"}'),(403,b'{"state":"observed"}'),
            (403,b'{"state":"denied","state":"denied"}'),(403,b'x'*8193),(403,b'x'*8194))
        for status,payload in cases:
            with self.subTest(status=status,size=len(payload)),tempfile.TemporaryDirectory() as temporary:
                directory=Path(temporary).resolve();directory.chmod(0o700);path=directory/'reader.sock'
                seen=[];closed=threading.Event();errors=[];sockets=[];requests=[];responses=[]
                with agent.server('a'*64,lambda operation:seen.append(operation) or {'ok':True},path) as server:
                    class UnprovedReply(server.RequestHandlerClass):
                        def reply(self,status,value):
                            self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,32768)
                            self.connection.sendall(b'HTTP/1.0 '+str(status_code).encode()+b' Response\r\nContent-Length: '+str(len(payload)).encode()+b'\r\n\r\n'+payload)
                    status_code=status;server.RequestHandlerClass=UnprovedReply
                    shutdown=server.shutdown_request;send=http.client.HTTPConnection.send
                    def shutdown_request(request):
                        try:requests.append(1);return shutdown(request)
                        finally:closed.set()
                    server.shutdown_request=shutdown_request
                    body={'operation':'retained_probes','parameters':{}}
                    raw=agent.json.dumps(body,separators=(',',':')).encode()
                    def interleaved_send(connection,data):
                        if data==raw:
                            self.assertTrue(closed.wait(2),'early response close budget');sockets.append(connection.sock)
                        try:return send(connection,data)
                        except BrokenPipeError as error:errors.append(error);raise
                    getresponse=http.client.HTTPConnection.getresponse
                    def capture_response(connection):
                        response=getresponse(connection);responses.append(response);return response
                    thread=threading.Thread(target=server.handle_request);thread.start()
                    config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                    try:
                        with patch.object(http.client.HTTPConnection,'send',interleaved_send),patch.object(http.client.HTTPConnection,'getresponse',capture_response):
                            try:agent.wire(config,time.monotonic()+3,path=path,body=body,key='wrong')
                            except BrokenPipeError as error:
                                self.assertIs(error,errors[0])
                                self.assertIn('interleaved_send',[frame.name for frame in traceback.extract_tb(error.__traceback__)])
                            else:self.fail('unproved response replaced the first send failure')
                        self.assertEqual(len(errors),1);self.assertEqual(requests,[1]);self.assertEqual(seen,[])
                        self.assertEqual([stream.fileno() for stream in sockets],[-1])
                        self.assertTrue(all(response.isclosed() for response in responses))
                    finally:thread.join(timeout=3)
                    self.assertFalse(thread.is_alive())
