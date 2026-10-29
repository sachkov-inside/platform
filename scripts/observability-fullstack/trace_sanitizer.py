"""Fixed private OTLP/JSON trace edge. No query, proxy, retry or runtime authority."""
import json
import math
import re

MAX_BODY=1024**2
MAX_DEPTH=32
MAX_NODES=65536
MAX_SPANS=1024
MAX_LINKS=4096
LINKS_PER_SPAN=128
MAX_RESPONSE=16384
DEADLINE_SECONDS=4
FORWARD_HOST='inside-signoz-trace-ingest'
PORT=4318
COLLECTOR_ADDRESS=None
PATH='/v1/traces'
MAX_COUNT=2**53-1


class Refusal(Exception):
    def __init__(self,reason):self.reason=reason;super().__init__(reason)


def need(ok,reason):
    if not ok:raise Refusal(reason)


def object_fields(value,allowed):
    need(type(value) is dict and set(value)<=set(allowed),'payload_shape')


def lexical_budget(text):
    depth=nodes=0;quoted=escaped=atom=False
    for char in text:
        if quoted:
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char=='"':quoted=False
            continue
        if char=='"':quoted=True;nodes+=1;atom=False
        elif char in '[{':depth+=1;nodes+=1;atom=False
        elif char in ']}':depth-=1;atom=False
        elif char in ',: \t\r\n':atom=False
        elif not atom:atom=True;nodes+=1
        need(0<=depth<=MAX_DEPTH and nodes<=MAX_NODES,'payload_budget')
    need(not quoted and depth==0,'payload_shape')


def decode(body,limit=MAX_BODY):
    need(type(body) is bytes and len(body)<=limit,'payload_budget')
    def pairs(rows):
        value={}
        for key,item in rows:
            need(key not in value,'duplicate_key');value[key]=item
        return value
    def number(text):
        value=float(text);need(math.isfinite(value),'nonfinite');return value
    def constant(_):raise Refusal('nonfinite')
    try:
        text=body.decode('utf-8');lexical_budget(text)
        return json.loads(text,object_pairs_hook=pairs,parse_float=number,parse_constant=constant)
    except (UnicodeError,ValueError,RecursionError):raise Refusal('payload_shape') from None


def identity(value,size):
    need(type(value) is str and re.fullmatch('[0-9a-fA-F]{'+str(size)+'}',value) is not None
        and int(value,16)!=0,'identity')


def unsigned(value,maximum=2**32-1):
    need(type(value) is int and 0<=value<=maximum,'numeric_shape')


def sanitize(body):
    value=decode(body);object_fields(value,('resourceSpans',));count=links=0
    resources=value.get('resourceSpans',[]);need(type(resources) is list,'payload_shape')
    for resource in resources:
        object_fields(resource,('resource','scopeSpans','schemaUrl'))
        if 'resource' in resource:object_fields(resource['resource'],('attributes','droppedAttributesCount'))
        scopes=resource.get('scopeSpans',[]);need(type(scopes) is list,'payload_shape')
        for scope in scopes:
            object_fields(scope,('scope','spans','schemaUrl'))
            if 'scope' in scope:object_fields(scope['scope'],('name','version','attributes','droppedAttributesCount'))
            spans=scope.get('spans',[]);need(type(spans) is list,'payload_shape')
            for span in spans:
                count+=1;need(count<=MAX_SPANS,'payload_budget')
                object_fields(span,('traceId','spanId','traceState','parentSpanId','name','kind','startTimeUnixNano',
                    'endTimeUnixNano','attributes','droppedAttributesCount','events','droppedEventsCount',
                    'links','droppedLinksCount','status','flags'))
                identity(span.get('traceId'),32);identity(span.get('spanId'),16)
                if 'flags' in span:unsigned(span['flags'])
                items=span.get('links',[]);need(type(items) is list and len(items)<=LINKS_PER_SPAN,'payload_budget')
                links+=len(items);need(links<=MAX_LINKS,'payload_budget')
                for link in items:
                    # Pinned pdata also accepts snake_case aliases. Reject them, never pass them through.
                    object_fields(link,('traceId','spanId','traceState','attributes','droppedAttributesCount','flags'))
                    identity(link.get('traceId'),32);identity(link.get('spanId'),16)
                    if 'flags' in link:unsigned(link['flags'])
                    if 'droppedAttributesCount' in link:unsigned(link['droppedAttributesCount'])
                    if 'traceState' in link:need(type(link['traceState']) is str,'payload_shape')
                    if 'attributes' in link:need(type(link['attributes']) is list,'payload_shape')
                    link.pop('traceState',None);link.pop('attributes',None)
    try:clean=json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
    except (ValueError,UnicodeError):raise Refusal('payload_shape') from None
    need(len(clean)<=MAX_BODY,'payload_budget')
    return clean,count

# This file is mounted alone into the existing Python image. Imports stay stdlib-only.
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler,HTTPServer
import os
from pathlib import Path
import secrets
import signal
import socket
import stat
import sys
import time


def collector_response(status,body,submitted):
    if status!=200:
        need(type(status) is int and 400<=status<=599,'collector_status')
        return b'{"code":13,"message":"collector_failure"}',0,False,False
    value=decode(body,MAX_RESPONSE);object_fields(value,('partialSuccess',))
    if 'partialSuccess' not in value:return b'{}',0,False,False
    partial=value['partialSuccess'];object_fields(partial,('rejectedSpans','errorMessage'))
    number=partial.get('rejectedSpans','0')
    if type(number) is str:
        need(re.fullmatch(r'0|[1-9][0-9]{0,15}',number) is not None,'collector_response')
        number=int(number)
    unsigned(number,submitted)
    warning=partial.get('errorMessage','');need(type(warning) is str,'collector_response')
    projected={'rejectedSpans':str(number)}
    if 'errorMessage' in partial:projected['errorMessage']='collector_partial' if warning else ''
    return json.dumps({'partialSuccess':projected},separators=(',',':')).encode(),number,True,bool(warning)


class Receipt:
    """Fixed private tmpfs counters. Their controller/role/source proof belongs to task5."""
    def __init__(self,root,binding):
        object_fields(binding,('commit','tree','nonce','project'))
        need(set(binding)=={'commit','tree','nonce','project'},'receipt_binding')
        need(all(type(binding[k]) is str and re.fullmatch('[a-f0-9]{40}',binding[k]) for k in ('commit','tree')),'receipt_binding')
        need(type(binding['nonce']) is str and re.fullmatch('[a-f0-9]{32}',binding['nonce']) is not None,'receipt_binding')
        need(type(binding['project']) is str and re.fullmatch('inside-observability-representative-[a-f0-9]{12}',binding['project']) is not None,'receipt_binding')
        need(root.is_absolute() and root.is_dir() and not root.is_symlink(),'receipt_root')
        self.path=root/'receipt.json';need(not self.path.exists() and not self.path.is_symlink(),'receipt_exists')
        cgroup=Path('/proc/self/cgroup');birth=Path('/proc/self/stat')
        self.value={'schema':1,'binding':dict(binding),'instance':secrets.token_hex(16),'pid':os.getpid(),
            'process_start_ticks':int(birth.read_text().rsplit(') ',1)[1].split()[19]) if birth.is_file() else None,
            'cgroup_sha256':hashlib.sha256(cgroup.read_bytes()).hexdigest() if cgroup.is_file() else None,
            **dict.fromkeys(('requests','submitted_spans','acknowledged_spans','rejected_spans','partial_responses','partial_warnings','failed_requests','unknown_outcomes'),0)}
        self.last=None;self.identity=None;self.broken=False;self.write()

    def write(self):
        if self.last is not None:
            info=self.path.lstat()
            need(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.getuid()
                and info.st_size==len(self.last) and (info.st_dev,info.st_ino)==self.identity
                and self.path.read_bytes()==self.last,'receipt_replaced')
        body=json.dumps(self.value,sort_keys=True,separators=(',',':')).encode();need(len(body)<=4096,'receipt_budget')
        temporary=self.path.with_name('.receipt-'+secrets.token_hex(8));temporary_identity=None
        try:
            fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            info=os.fstat(fd);temporary_identity=(info.st_dev,info.st_ino)
            with os.fdopen(fd,'wb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
            os.replace(temporary,self.path);self.last=body
            info=self.path.stat();self.identity=(info.st_dev,info.st_ino)
        finally:
            if temporary.exists() and not temporary.is_symlink():
                info=temporary.stat()
                if stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==temporary_identity:temporary.unlink()

    def observe(self,submitted=0,*,known=False,rejected=0,partial=False,warning=False,failed=False,unknown=False):
        changes={'requests':1,'submitted_spans':submitted,'acknowledged_spans':submitted-rejected if known else 0,
            'rejected_spans':rejected if known else 0,'partial_responses':int(partial),'partial_warnings':int(warning),
            'failed_requests':int(failed),'unknown_outcomes':int(unknown)}
        need(not self.broken,'receipt_broken')
        next_value=dict(self.value)
        for key,added in changes.items():
            unsigned(added,MAX_COUNT);unsigned(next_value[key]+added,MAX_COUNT);next_value[key]+=added
        self.value=next_value
        try:self.write()
        except BaseException:
            self.broken=True
            # A stale counter must not remain a valid-looking0600 receipt after failure.
            try:
                info=self.path.lstat()
                if stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==self.identity:os.chmod(self.path,0,follow_symlinks=False)
            except (OSError,NotImplementedError):pass
            raise


def open_collector(timeout):
    # http.client ignores proxy environment and does not follow redirects or retry.
    need(COLLECTOR_ADDRESS is not None,'collector_unresolved')
    return http.client.HTTPConnection(COLLECTOR_ADDRESS,PORT,timeout=timeout)


class DeadlineReader:
    def __init__(self,stream,wire,remaining):
        self.stream=stream;self.wire=wire;self.remaining_time=remaining;self.header_left=8192;self.active=True
    def read1(self,size=-1):
        self.wire.settimeout(self.remaining_time());return self.stream.read1(size)
    def readline(self,size=-1):
        data=bytearray();limit=size if size>=0 else 8193
        while len(data)<limit:
            value=self.read1(1)
            if not value:break
            data.extend(value)
            if self.active:
                self.header_left-=1;need(self.header_left>=0,'header_budget')
            if value==b'\n':break
        return bytes(data)
    def read(self,size=-1):
        need(0<=size<=MAX_BODY+MAX_RESPONSE,'payload_budget');data=bytearray()
        while len(data)<size:
            value=self.read1(min(4096,size-len(data)))
            if not value:break
            data.extend(value)
        return bytes(data)
    def __getattr__(self,key):return getattr(self.stream,key)


class DeadlineResponse(http.client.HTTPResponse):
    def __init__(self,wire,remaining,**options):
        super().__init__(wire,**options);self.fp=DeadlineReader(self.fp,wire,remaining)
    def begin(self):
        super().begin()
        if self.fp:self.fp.active=False


class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def setup(self):
        self.deadline=time.monotonic()+DEADLINE_SECONDS
        self.request.settimeout(DEADLINE_SECONDS)
        super().setup();self.rfile=DeadlineReader(self.rfile,self.connection,self.remaining)
    def remaining(self):
        value=self.deadline-time.monotonic()
        need(value>0,'request_timeout');self.connection.settimeout(value);return value
    def handle(self):
        self.recorded=False
        try:self.handle_one_request()
        except (Refusal,OSError,ValueError) as error:
            code=431 if isinstance(error,Refusal) and error.reason=='header_budget' else 400
            try:self.reply(code,b'{"code":3,"message":"request_refused"}')
            except OSError:pass
        finally:
            if not self.recorded:
                try:self.server.receipt.observe(failed=True)
                except (Refusal,OSError):pass
            self.close_connection=True
    def log_message(self,*_):pass
    def send_error(self,code,*_):self.reply(405 if code==501 else code,b'{"code":3,"message":"request_refused"}')
    def handle_expect_100(self):self.reply(417,b'{"code":3,"message":"request_refused"}');return False
    def parse_request(self):
        if len(self.raw_requestline)>1024:self.send_error(414);return False
        result=super().parse_request();self.rfile.active=False
        return result
    def reply(self,status,body):
        self.remaining();self.send_response_only(status)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
        self.send_header('Connection','close');self.end_headers();self.wfile.write(body)
    def do_POST(self):
        submitted=0;forwarded=False;recorded=False;connection=None;failure_status=None
        try:
            need(self.path==PATH and len(self.headers)<=32,'request_shape')
            need(not self.headers.get_all('Transfer-Encoding') and not self.headers.get_all('Expect'),'request_shape')
            need(not self.headers.get_all('Content-Encoding'),'request_encoding')
            need(self.headers.get_all('Content-Type')==['application/json'],'request_encoding')
            lengths=self.headers.get_all('Content-Length');need(lengths is not None,'length_required');need(len(lengths)==1,'request_length')
            need(re.fullmatch(r'[1-9][0-9]{0,6}',lengths[0]) is not None,'request_length')
            length=int(lengths[0]);need(length<=MAX_BODY,'payload_budget')
            parts=[];remaining=length
            while remaining:
                self.remaining();part=self.rfile.read1(min(65536,remaining));need(bool(part),'request_length')
                parts.append(part);remaining-=len(part)
            clean,submitted=sanitize(b''.join(parts));connection=open_collector(self.remaining())
            connection.response_class=lambda wire,**options:DeadlineResponse(wire,self.remaining,**options)
            forwarded=True;connection.request('POST',PATH,body=clean,headers={'Content-Type':'application/json','Accept-Encoding':'identity','Host':FORWARD_HOST+':'+str(PORT)})
            connection.timeout=self.remaining()
            if connection.sock:connection.sock.settimeout(connection.timeout)
            wire=connection.sock
            response=connection.getresponse();need(response.getheader('Content-Encoding') is None,'collector_encoding')
            body=bytearray()
            while not response.isclosed():
                self.remaining()
                if wire:wire.settimeout(self.remaining())
                part=response.read1(min(4096,MAX_RESPONSE+1-len(body)))
                if not part:break
                body.extend(part);need(len(body)<=MAX_RESPONSE,'collector_budget')
            need(response.getheader('Content-Type')=='application/json','collector_encoding')
            projected,rejected,partial,warning=collector_response(response.status,bytes(body),submitted)
            if response.status!=200:failure_status=response.status
            self.server.receipt.observe(submitted,known=response.status==200,rejected=rejected,partial=partial,warning=warning,
                failed=response.status!=200,unknown=response.status!=200)
            recorded=True;self.recorded=True;self.reply(response.status,projected)
        except (Refusal,OSError,ValueError,http.client.HTTPException) as error:
            if not recorded and not self.server.receipt.broken:
                try:self.server.receipt.observe(submitted,failed=True,unknown=forwarded);self.recorded=True
                except (Refusal,OSError):pass
            # No body, URL, native exception or collector error text is reflected.
            status=failure_status or (502 if forwarded else {'length_required':411,'request_encoding':415,'payload_budget':413,'header_budget':431}.get(error.reason if isinstance(error,Refusal) else '',400))
            try:self.reply(status,b'{"code":13,"message":"collector_failure"}' if forwarded else b'{"code":3,"message":"request_refused"}')
            except (OSError,Refusal):pass
        except (KeyboardInterrupt,SystemExit):
            if not recorded and not self.server.receipt.broken:
                try:self.server.receipt.observe(submitted,failed=True,unknown=forwarded);self.recorded=True
                except (Refusal,OSError):pass
            raise
        finally:
            if connection is not None:connection.close()


class Server(HTTPServer):
    request_queue_size=1
    def __init__(self,address,receipt):self.receipt=receipt;super().__init__(address,Handler)
    def handle_error(self,*_):pass


def run(server):
    previous=signal.getsignal(signal.SIGTERM)
    def stop(*_):raise SystemExit(128+signal.SIGTERM)
    signal.signal(signal.SIGTERM,stop)
    try:server.serve_forever()
    finally:server.server_close();signal.signal(signal.SIGTERM,previous)


def main():
    need(len(sys.argv)==1,'closed_arguments')
    global COLLECTOR_ADDRESS
    # Resolve the ONE fixed private peer before accepting requests, under the common owner
    # startup deadline. No request can spend an unbounded getaddrinfo inside its4s budget.
    addresses={row[4][0] for row in socket.getaddrinfo(FORWARD_HOST,PORT,socket.AF_INET,socket.SOCK_STREAM)}
    need(len(addresses)==1,'collector_identity');COLLECTOR_ADDRESS=next(iter(addresses))
    binding=decode(os.environ.get('INSIDE_TRACE_BINDING','').encode(),4096)
    receipt=Receipt(Path('/state'),binding)
    server=Server(('',PORT),receipt)
    run(server)


if __name__=='__main__':main()
