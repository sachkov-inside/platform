"""Real owned verified-TLS/HTTP download and child-lifetime contracts, no live provider."""
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pilot


class ArchiveDownload(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory=tempfile.TemporaryDirectory();cls.addClassCleanup(cls.directory.cleanup)
        root=Path(cls.directory.name);cls.cert=root/'cert.pem';cls.key=root/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
            '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',str(cls.key),'-out',str(cls.cert)],
            check=True,timeout=5,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

    @contextmanager
    def server(self,body,*,interval=0,status=200):
        stop=threading.Event();received=threading.Event();sent=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def do_GET(self):
                received.set();self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers()
                try:
                    for byte in body:
                        self.wfile.write(bytes([byte]));self.wfile.flush();sent.append(byte)
                        if interval and stop.wait(interval):break
                except (BrokenPipeError,ConnectionResetError,ssl.SSLError):pass
        native=HTTPServer(('127.0.0.1',0),Handler)
        try:
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(self.cert,self.key)
            native.socket=context.wrap_socket(native.socket,server_side=True)
            thread=threading.Thread(target=lambda:native.serve_forever(poll_interval=.01),daemon=False);thread.start()
            try:
                # A temporary trusted test CA, never TLS verification bypass or production env changes.
                with patch.dict(os.environ,{'SSL_CERT_FILE':str(self.cert),'NO_PROXY':'127.0.0.1,localhost'}):
                    yield 'https://127.0.0.1:'+str(native.server_port)+'/archive',received,sent
            finally:
                stop.set();native.shutdown();thread.join(timeout=2);self.assertFalse(thread.is_alive())
        finally:native.server_close()

    def asset(self,url,body):return {'url':url,'size_bytes':len(body),'digest':'sha256:'+hashlib.sha256(body).hexdigest()}

    def test_real_TLS_trickle_cannot_complete_valid_archive_after_original_total_budget(self):
        body=b'fixed-archive-1566'
        with self.server(body) as (url,received,_),patch.object(pilot,'ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS',2):
            self.assertEqual(pilot.downloaded_asset(self.asset(url,body)),body)
            self.assertTrue(received.is_set(),'actual verified TLS request completed')
        with self.server(body,interval=.05) as (url,received,sent),self.children() as records,patch.object(pilot,'ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS',.5):
            started=time.monotonic();error=None;archive=None
            try:archive=pilot.downloaded_asset(self.asset(url,body))
            except subprocess.TimeoutExpired as caught:error=caught
            elapsed=time.monotonic()-started
            self.assertIsNotNone(error,'socket-idle timeout accepted a valid full archive after the TOTAL deadline')
            self.assertIsNone(archive);self.assertTrue(received.is_set());self.assertGreaterEqual(len(sent),2)
            self.assertLess(elapsed,1.5,'timeout must kill/reap promptly, not wait for the slow response')
            self.reaped(records)

    @contextmanager
    def children(self,*,communicate=None):
        original=subprocess.Popen;records=[]
        def acquire(*args,**kwargs):
            child=original(*args,**kwargs);records.append((child,args,kwargs,os.getpgid(child.pid)))
            if communicate is not None:communicate(child)
            return child
        try:
            with patch.object(pilot.subprocess,'Popen',side_effect=acquire):yield records
        finally:
            # Even the regression's RED state must not leave its actual child/pipes behind.
            for child,*_rest in records:
                if child.poll() is None:child.kill()
                original.wait(child,timeout=1)
                for stream in (child.stdin,child.stdout,child.stderr):
                    if stream is not None:stream.close()

    def reaped(self,records):
        self.assertEqual(len(records),1)
        child,args,options,group=records[0]
        self.assertIsNotNone(child.poll());self.assertEqual(group,os.getpgrp())
        self.assertTrue(child.stdin.closed and child.stdout.closed);self.assertIsNone(child.stderr)
        self.assertEqual(args[0][:4],[sys.executable,'-I','-B','-c'])
        self.assertFalse({'start_new_session','preexec_fn','env','shell'}&set(options))
        self.assertEqual(options['stderr'],subprocess.DEVNULL)

    def test_actual_stdlib_child_preserves_exact_parent_size_digest_and_finite_transport_failure(self):
        expected=b'fixed-archive-1566'
        for name,body,digest in [('valid',expected,None),('short',expected[:-1],None),('extra',expected+b'x',None),
            ('digest',expected,'sha256:'+'0'*64)]:
            with self.subTest(name=name),self.server(body) as (url,_received,_sent),self.children() as records:
                asset=self.asset(url,expected)
                if digest is not None:asset['digest']=digest
                if name=='valid':self.assertEqual(pilot.downloaded_asset(asset),expected)
                else:
                    with self.assertRaisesRegex(RuntimeError,'size/digest check'):pilot.downloaded_asset(asset)
                self.reaped(records)
                self.assertNotIn(url,' '.join(records[0][1][0]))
        with self.server(b'private-server-error',status=503) as (url,_,_sent),self.children() as records:
            with self.assertRaisesRegex(RuntimeError,'^pinned archive download failed$') as caught:pilot.downloaded_asset(self.asset(url,expected))
            self.assertNotIn(url,str(caught.exception));self.assertNotIn('private-server-error',str(caught.exception));self.reaped(records)
        with self.server(expected) as (url,_,_sent),self.children() as records,patch.dict(os.environ,{'SSL_CERT_FILE':''}):
            with self.assertRaisesRegex(RuntimeError,'^pinned archive download failed$'):pilot.downloaded_asset(self.asset(url,expected))
            self.reaped(records)

    @contextmanager
    def stalled_handshake(self):
        stop=threading.Event();entered=threading.Event();listener=socket.socket();connections=[]
        try:
            listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(.1)
            def accept():
                while not stop.is_set():
                    try:connection,_=listener.accept()
                    except socket.timeout:continue
                    connections.append(connection);entered.set();stop.wait(2);return
            thread=threading.Thread(target=accept,daemon=False);thread.start()
            try:yield 'https://127.0.0.1:'+str(listener.getsockname()[1])+'/archive',entered
            finally:
                stop.set();thread.join(timeout=2);self.assertFalse(thread.is_alive())
        finally:
            for connection in connections:connection.close()
            listener.close()

    def test_original_parent_total_budget_includes_real_TLS_handshake_and_reaps_child_pipes(self):
        with self.stalled_handshake() as (url,entered),self.children() as records,patch.object(pilot,'ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS',.5):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:pilot.downloaded_asset(self.asset(url,b'x'))
            self.assertTrue(entered.is_set(),'real child reached native TLS handshake')
            self.assertNotIn(url,str(caught.exception));self.reaped(records)

    def test_interrupt_keeps_original_object_traceback_after_kill_reap_and_secondary_cleanup_error(self):
        original=KeyboardInterrupt('private-original-interrupt');secondary=OSError('private-cleanup-error');frames=[]
        with self.stalled_handshake() as (url,entered):
            def interrupt(child):
                wait=child.wait
                def reap_then_fail(*args,**kwargs):wait(*args,**kwargs);raise secondary
                def communicate(payload,**_options):
                    child.stdin.write(payload);child.stdin.flush();child.stdin.close()
                    self.assertTrue(entered.wait(1),'child reached owned TLS endpoint before interruption')
                    try:raise original
                    except BaseException:
                        frames.append(original.__traceback__);raise
                child.communicate=communicate;child.wait=reap_then_fail
            with self.children(communicate=interrupt) as records,self.assertRaises(KeyboardInterrupt) as caught:
                try:pilot.downloaded_asset(self.asset(url,b'x'))
                except KeyboardInterrupt as error:
                    actual=[];frame=error.__traceback__
                    while frame is not None:actual.append(frame);frame=frame.tb_next
                    self.assertIn(frames[0],actual);self.reaped(records);raise
            self.assertIs(caught.exception,original)

    def test_timeout_keeps_actual_first_exception_and_reaps_despite_secondary_cleanup_error(self):
        captured=[];secondary=OSError('private-secondary-reap')
        def observe(child):
            communicate=child.communicate;wait=child.wait
            def timed(*args,**kwargs):
                try:return communicate(*args,**kwargs)
                except subprocess.TimeoutExpired as error:captured.append((error,error.__traceback__));raise
            def reap_then_fail(*args,**kwargs):wait(*args,**kwargs);raise secondary
            child.communicate=timed;child.wait=reap_then_fail
        with self.stalled_handshake() as (url,entered),self.children(communicate=observe) as records,patch.object(pilot,'ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS',.5):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                try:pilot.downloaded_asset(self.asset(url,b'x'))
                except subprocess.TimeoutExpired as error:
                    frames=[];frame=error.__traceback__
                    while frame is not None:frames.append(frame);frame=frame.tb_next
                    self.assertIn(captured[0][1],frames);self.reaped(records);raise
            self.assertIs(caught.exception,captured[0][0]);self.assertTrue(entered.is_set())

    def test_timeout_still_waits_after_actual_kill_raises_secondary_error(self):
        captured=[];waited=[];killed=[];secondary=OSError('private-secondary-kill')
        def observe(child):
            communicate=child.communicate;kill=child.kill;wait=child.wait
            def timed(*args,**kwargs):
                try:return communicate(*args,**kwargs)
                except subprocess.TimeoutExpired as error:captured.append((error,error.__traceback__));raise
            def kill_then_fail():
                kill();child.kill=kill;killed.append(child.pid);raise secondary
            def actual_wait(*args,**kwargs):
                result=wait(*args,**kwargs);waited.append((child.pid,args,kwargs,result));return result
            child.communicate=timed;child.kill=kill_then_fail;child.wait=actual_wait
        with self.stalled_handshake() as (url,entered),self.children(communicate=observe) as records,patch.object(pilot,'ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS',.5):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                try:pilot.downloaded_asset(self.asset(url,b'x'))
                except subprocess.TimeoutExpired as error:
                    frames=[];frame=error.__traceback__
                    while frame is not None:frames.append(frame);frame=frame.tb_next
                    self.assertIs(error,captured[0][0]);self.assertIn(captured[0][1],frames)
                    self.assertTrue(entered.is_set(),'real child reached owned TLS endpoint')
                    self.assertEqual(killed,[records[0][0].pid])
                    self.assertEqual(len(waited),1,'actual bounded wait must run even after kill raises')
                    self.assertEqual(waited[0][1:3],((),{'timeout':1}))
                    self.assertEqual(waited[0][3],-signal.SIGKILL)
                    self.reaped(records);raise
            self.assertIs(caught.exception,captured[0][0])

    def test_invalid_pinned_size_refuses_before_any_child(self):
        for size in (False,0,-1,128*1024**2+1):
            with self.subTest(size=size),patch.object(pilot.subprocess,'Popen',side_effect=AssertionError('must refuse before acquisition')):
                with self.assertRaisesRegex(RuntimeError,'invalid size metadata'):pilot.downloaded_asset({'size_bytes':size})


if __name__=='__main__':unittest.main()
