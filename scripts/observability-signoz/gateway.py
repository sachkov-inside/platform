"""Finite fixture reader. No raw upstream path, SQL, body or credential input."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import secrets
import threading

OPERATIONS=frozenset(('retained_metrics','correlated_traces','correlated_logs','mcp_correlated_traces'))
MAX_REQUEST_BYTES=16384


def unique(pairs):
    value=dict(pairs)
    if len(value)!=len(pairs):raise ValueError('duplicate_key')
    return value


@contextmanager
def serve(agent_key,read):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_args):pass
        def reply(self,status,value):
            body=json.dumps(value,separators=(',',':')).encode()
            self.send_response(status);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.send_header('Connection','close');self.end_headers();self.wfile.write(body)
        def do_GET(self):self.reply(403,{'state':'denied'})
        do_DELETE=do_GET
        do_PUT=do_GET
        do_PATCH=do_GET
        def do_POST(self):
            self.connection.settimeout(10)
            raw_length=self.headers.get('Content-Length','')
            if (self.path!='/read' or self.headers.get('Transfer-Encoding') is not None
                    or not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+agent_key)
                    or not raw_length.isascii() or not raw_length.isdecimal() or len(raw_length)>5
                    or not 0<int(raw_length)<=MAX_REQUEST_BYTES):
                self.reply(403,{'state':'denied'});return
            try:
                value=json.loads(self.rfile.read(int(raw_length)),object_pairs_hook=unique)
                if (type(value) is not dict or set(value)!={'operation','parameters'}
                        or type(value['operation']) is not str or value['operation'] not in OPERATIONS
                        or value['parameters']!={}):
                    self.reply(403,{'state':'denied'});return
                count=read(value['operation'])
                if type(count) is not int or not 0<=count<=1000000:raise ValueError('closed_count_required')
                self.reply(200,{'state':'observed','count':count})
            except Exception:self.reply(503,{'state':'unavailable'})
    server=HTTPServer(('127.0.0.1',0),Handler);server.timeout=1
    thread=threading.Thread(target=server.serve_forever,name='signoz-finite-reader',daemon=False);thread.start()
    try:yield server.server_address
    finally:
        server.shutdown();server.server_close();thread.join(timeout=12)
        if thread.is_alive():raise RuntimeError('finite_reader_not_reaped')
