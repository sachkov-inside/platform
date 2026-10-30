"""Standalone finite representative agent. No native key or raw query authority."""
from contextlib import contextmanager
import errno
import http.client
from http.server import BaseHTTPRequestHandler
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import stat
import struct
import sys
import time
import threading

SOCKET=Path('/gateway/reader.sock')
OPERATIONS=('retained_probes','source_status','api_lag','readiness_metrics','readiness_logs','readiness_traces',
    'correlated_traces','correlated_logs','web_initial','web_current')
ENDPOINTS={'postgres':('signoz-metastore-postgres-0',(5432,)),
    'clickhouse':('signoz-telemetrystore-clickhouse-0-0',(8123,9000)),'keeper':('signoz-telemetrykeeper-clickhousekeeper-0',(9181,)),
    'collector':('signoz-ingester',(4317,4318,13133)),
    'server':('signoz-signoz-0',(8080,)),'mcp':('mcp',(8000,)),'disk':('sig-disk',(8765,))}


def need(ok,reason='representative_agent_refusal'):
    if not ok:raise ValueError(reason)


def unique(pairs):
    value=dict(pairs);need(len(value)==len(pairs));return value


def socket_identity(path=SOCKET):
    info=path.lstat()
    need(stat.S_ISSOCK(info.st_mode) and info.st_uid==os.getuid() and info.st_gid==os.getgid()
        and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,'representative_socket_identity')
    return {'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid,'gid':info.st_gid,
        'mode':stat.S_IMODE(info.st_mode),'links':info.st_nlink}


def peer(stream):
    if hasattr(socket,'SO_PEERCRED'):
        return struct.unpack('3i',stream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize('3i')))
    # Local SOURCE-MODEL tests use the actual Mac Unix peer credentials. Native
    # admission below requires Linux and never substitutes this for a PID proof.
    need(sys.platform=='darwin' and hasattr(socket,'LOCAL_PEERCRED'))
    version,uid,groups,*gids=struct.unpack('IIh2x16I',stream.getsockopt(0,socket.LOCAL_PEERCRED,76))
    need(version==0 and 1<=groups<=16);return None,uid,gids[0]


def _finite(value,depth=0):
    need(depth<=6)
    if type(value) is dict:
        need(len(value)<=16 and all(type(k) is str and len(k)<=64 for k in value))
        for item in value.values():_finite(item,depth+1)
    elif type(value) is str:need(len(value)<=64 and re.fullmatch('[a-z_]+',value) is not None)
    elif type(value) in (int,float):need(math.isfinite(value) and abs(value)<=2**53)
    else:need(type(value) is bool)


def _handler(key,read):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,status,value):
            raw=json.dumps(value,separators=(',',':'),allow_nan=False).encode();need(len(raw)<=8192)
            if status==403:self.server.denials+=1
            self.send_response(status);self.send_header('Content-Length',str(len(raw)))
            self.send_header('Content-Type','application/json');self.send_header('Connection','close');self.end_headers();self.wfile.write(raw)
        def do_GET(self):self.reply(403,{'state':'denied'})
        do_DELETE=do_GET;do_PUT=do_GET;do_PATCH=do_GET
        def do_POST(self):
            _pid,uid,gid=peer(self.connection)
            length=self.headers.get_all('Content-Length',[])
            auth=self.headers.get_all('Authorization',[])
            if (uid!=os.getuid() or gid!=os.getgid() or self.path!='/read' or len(auth)!=1
                or not secrets.compare_digest(auth[0],'Bearer '+key) or self.headers.get('Transfer-Encoding') is not None
                or len(length)!=1 or not re.fullmatch('[0-9]{1,4}',length[0]) or not 0<int(length[0])<=1024):
                self.reply(403,{'state':'denied'});return
            self.connection.settimeout(1)
            try:
                raw=self.rfile.read(int(length[0]));need(len(raw)==int(length[0]))
                value=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False))
                if (type(value) is not dict or set(value)!={'operation','parameters'} or type(value['operation']) is not str
                    or value['operation'] not in OPERATIONS or type(value['parameters']) is not dict or value['parameters']!={}):
                    self.reply(403,{'state':'denied'});return
            except (ValueError,UnicodeError):self.reply(403,{'state':'denied'});return
            try:
                observation=read(value['operation']);need(type(observation) is dict);_finite(observation)
                self.reply(200,{'state':'observed','observation':observation})
            except Exception:self.reply(503,{'state':'unavailable'})
    return Handler


@contextmanager
def server(key,read,path=SOCKET):
    """Private synchronous server. Callback runs in the resident's scope thread."""
    need(type(key) is str and re.fullmatch('[a-f0-9]{64}',key) is not None)
    info=path.parent.lstat();need(path.parent==path.parent.resolve() and stat.S_ISDIR(info.st_mode)
        and info.st_uid==os.getuid() and stat.S_IMODE(info.st_mode)==0o700
        and not path.exists() and not path.is_symlink(),'representative_socket_parent')
    instance=socketserver.UnixStreamServer(str(path),_handler(key,read));instance.timeout=.05
    os.chmod(path,0o600);identity=socket_identity(path);first=None;instance.denials=0
    try:yield instance
    except BaseException as error:first=error;raise
    finally:
        instance.server_close()
        try:need(socket_identity(path)==identity);path.unlink()
        except BaseException:
            if first is None:raise


def wire(config,deadline,*,path=SOCKET,body=None,key=None):
    need(time.monotonic()<deadline and socket_identity(path)==config['socket_identity'])
    connection=http.client.HTTPConnection('representative-unix',timeout=min(10,deadline-time.monotonic()))
    def connect():
        stream=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);connection.sock=stream
        stream.settimeout(min(10,deadline-time.monotonic()));stream.connect(str(path))
        _pid,uid,gid=peer(stream);need(uid==os.getuid() and gid==os.getgid() and socket_identity(path)==config['socket_identity'])
    connection.connect=connect
    first=None;response=None
    try:
        send_failure=None
        try:
            connection.request('POST','/read',json.dumps(body,separators=(',',':')),{'Authorization':'Bearer '+(config['agent_key'] if key is None else key),'Content-Type':'application/json','Connection':'close'})
        except BrokenPipeError:
            # An authenticated peer may reject headers and close before our body
            # send. Read that SAME response once; a reset is never a denial.
            send_failure=sys.exc_info()
        try:
            remaining=deadline-time.monotonic();need(remaining>0)
            if connection.sock is not None:connection.sock.settimeout(min(10,remaining))
            response=connection.getresponse();raw=response.read(8193)
            need(len(raw)<=8192 and time.monotonic()<deadline and socket_identity(path)==config['socket_identity'])
            value=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False))
            if send_failure is not None:
                need(response.status==403 and value=={'state':'denied'},'representative_early_denial_unproved')
        except BaseException:
            if send_failure is not None:raise send_failure[1].with_traceback(send_failure[2])
            raise
        return response.status,value
    except BaseException as error:first=error;raise
    finally:
        cleanup=None
        for close in ((response.close,) if response is not None else ())+(connection.close,):
            try:close()
            except BaseException:
                if cleanup is None:cleanup=sys.exc_info()
        if first is None and cleanup is not None:raise cleanup[1].with_traceback(cleanup[2])


def deny_tcp(address,port,remaining):
    try:connection=socket.create_connection((address,port),timeout=min(1,remaining))
    except OSError as error:
        need(error.errno==errno.ENETUNREACH,'representative_kernel_denial_required')
        return {'kernel_denied':True}
    connection.close();raise ValueError('representative_backend_reachable')


def read_private(path):
    need(path.is_absolute() and path.parent==path.parent.resolve())
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno());need(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid()
            and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and 0<info.st_size<=8192)
        raw=stream.read(8193);current=path.lstat()
        need(len(raw)==info.st_size and (current.st_dev,current.st_ino,current.st_uid,current.st_nlink,current.st_mode)==
            (info.st_dev,info.st_ino,info.st_uid,info.st_nlink,info.st_mode))
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False))


def run():
    need(sys.platform=='linux','representative_native_linux_required')
    config=read_private(Path('/admission/representative.json'))
    need(set(config)=={'schema','nonce','agent_key','socket_identity','deadline_mono_ns','network_namespace','targets'}
        and type(config['schema']) is int and config['schema']==1 and re.fullmatch('[a-f0-9]{32}',config['nonce']) is not None)
    need(type(config['agent_key']) is str and re.fullmatch('[a-f0-9]{64}',config['agent_key']) is not None)
    now=time.monotonic_ns()
    need(type(config['deadline_mono_ns']) is int and now<config['deadline_mono_ns']<=now+600*10**9)
    identity=config['socket_identity']
    need(type(identity) is dict and set(identity)=={'device','inode','uid','gid','mode','links'}
        and all(type(v) is int and v>=0 for v in identity.values()) and identity['inode']>0
        and identity['uid']==os.getuid() and identity['gid']==os.getgid() and identity['mode']==0o600 and identity['links']==1)
    deadline=config['deadline_mono_ns']/10**9
    need(os.readlink('/proc/self/ns/net')==config['network_namespace'] and [name for _,name in socket.if_nameindex()]==['lo'])
    need(sorted(os.listdir('/gateway'))==['reader.sock'] and sorted(os.listdir('/driver'))==['agent_probe.py','representative_agent.py']
        and sorted(os.listdir('/admission'))==['representative.json'])
    need(all(not os.path.lexists(path) for path in ('/private','/disk','/var/run/docker.sock','/driver/control.py')))
    need(type(config['targets']) is dict and set(config['targets'])==set(ENDPOINTS))
    facts={'schema':1,'reads':0,'gateway_denials':0,'direct_ip_denials':0,'alias_kernel_denials':0,'alias_dns_unknown':0}
    for operation in OPERATIONS:
        status,value=wire(config,deadline,body={'operation':operation,'parameters':{}})
        need(status==200 and type(value) is dict and set(value)=={'state','observation'} and value['state']=='observed')
        _finite(value['observation']);facts['reads']+=1
    for body in ({'operation':'raw_sql','parameters':{}},{'operation':'api_lag','parameters':{'sql':'SELECT 1'}},
                 {'operation':'api_lag','parameters':{},'path':'/api/v1/roles'}):
        status,value=wire(config,deadline,body=body);need(status==403 and value=={'state':'denied'});facts['gateway_denials']+=1
    status,_=wire(config,deadline,body={'operation':'api_lag','parameters':{}},key='wrong');need(status==403);facts['gateway_denials']+=1
    resolved={}
    def resolve_aliases():
        for role,(alias,_ports) in ENDPOINTS.items():
            try:resolved[role]={entry[4][0] for entry in socket.getaddrinfo(alias,None,socket.AF_INET,socket.SOCK_STREAM)}
            except OSError:resolved[role]=None
    dns=threading.Thread(target=resolve_aliases,name='representative-dns-diagnostic',daemon=True);dns.start()
    for role,(_alias,ports) in ENDPOINTS.items():
        address=config['targets'][role];need(type(address) is str and ipaddress.IPv4Address(address).is_private)
        for port in ports:
            need(time.monotonic()<deadline);deny_tcp(address,port,deadline-time.monotonic());facts['direct_ip_denials']+=1
    dns.join(timeout=min(1,max(0,deadline-time.monotonic())))
    for role,(_alias,ports) in ENDPOINTS.items():
        addresses=resolved.get(role)
        if not addresses:facts['alias_dns_unknown']+=len(ports);continue
        need(addresses=={config['targets'][role]},'representative_alias_identity')
        for port in ports:
            need(time.monotonic()<deadline);deny_tcp(config['targets'][role],port,deadline-time.monotonic());facts['alias_kernel_denials']+=1
    return facts


if __name__=='__main__':
    try:
        if sys.argv[1:]==['socket-identity']:
            need(sys.platform=='linux');print(json.dumps(socket_identity(),separators=(',',':')))
        else:need(not sys.argv[1:]);print(json.dumps(run(),separators=(',',':')))
    except BaseException:
        print('{"representative_agent_failed":true}');sys.exit(1)
