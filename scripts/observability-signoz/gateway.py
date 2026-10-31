"""Finite fixture reader. No raw upstream path, SQL, body or credential input."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import socketserver
import stat
import threading

OPERATIONS=frozenset(('retained_metrics','correlated_traces','correlated_logs','mcp_correlated_traces'))
MAX_REQUEST_BYTES=16384


def unique(pairs):
    value=dict(pairs)
    if len(value)!=len(pairs):raise ValueError('duplicate_key')
    return value


def _handler(agent_key,read):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_args):pass
        def reply(self,status,value):
            body=json.dumps(value,separators=(',',':')).encode()
            self.send_response(status);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.send_header('Connection','close');self.end_headers();self.wfile.write(body)
        def bounded_body(self):
            self.connection.settimeout(10)
            raw_length=self.headers.get('Content-Length','0')
            if (self.headers.get('Transfer-Encoding') is not None or not raw_length.isascii()
                    or not raw_length.isdecimal() or len(raw_length)>5 or not 0<=int(raw_length)<=MAX_REQUEST_BYTES):return None
            raw=self.rfile.read(int(raw_length))
            return raw if len(raw)==int(raw_length) else None
        def do_GET(self):
            self.bounded_body();self.reply(403,{'state':'denied'})
        do_DELETE=do_GET
        do_PUT=do_GET
        do_PATCH=do_GET
        def do_POST(self):
            raw=self.bounded_body()
            if (not raw or self.path!='/read'
                    or not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+agent_key)
                    ):
                self.reply(403,{'state':'denied'});return
            try:
                value=json.loads(raw,object_pairs_hook=unique)
                if (type(value) is not dict or set(value)!={'operation','parameters'}
                        or type(value['operation']) is not str or value['operation'] not in OPERATIONS
                        or value['parameters']!={}):
                    self.reply(403,{'state':'denied'});return
                count=read(value['operation'])
                if type(count) is not int or not 0<=count<=1000000:raise ValueError('closed_count_required')
                self.reply(200,{'state':'observed','count':count})
            except Exception:self.reply(503,{'state':'unavailable'})
    return Handler


@contextmanager
def _running(server):
    server.timeout=1
    thread=threading.Thread(target=server.serve_forever,name='signoz-finite-reader',daemon=False);thread.start()
    try:yield server.server_address
    finally:
        server.shutdown();server.server_close();thread.join(timeout=12)
        if thread.is_alive():raise RuntimeError('finite_reader_not_reaped')


@contextmanager
def serve(agent_key,read):
    # Loopback transport is used only by the owning HTTP protocol contracts.
    with _running(HTTPServer(('127.0.0.1',0),_handler(agent_key,read))) as address:yield address


@contextmanager
def serve_unix(agent_key,read,path):
    path=Path(path);parent=path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid()
            or stat.S_IMODE(parent.st_mode)!=0o700 or path.exists() or path.is_symlink()):
        raise ValueError('fresh_owned_socket_directory_required')
    server=socketserver.UnixStreamServer(str(path),_handler(agent_key,read))
    os.chmod(path,0o600);native=path.lstat();identity=(native.st_dev,native.st_ino)
    try:
        with _running(server):yield str(path)
    finally:
        current=path.lstat()
        if not stat.S_ISSOCK(current.st_mode) or (current.st_dev,current.st_ino)!=identity:
            raise ValueError('socket_identity_changed')
        path.unlink()
