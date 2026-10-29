"""Source-only limited fixture client. No backend key, raw query or TCP gateway."""
import errno
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import sys
import threading
import time

SOCKET=Path('/gateway/reader.sock')
ENDPOINTS={'postgres':(5432,), 'clickhouse':(8123,9000), 'keeper':(9181,),
    'collector':(4317,4318,13133), 'server':(8080,), 'mcp':(8000,), 'disk':(8765,)}
OPERATIONS={'retained_metrics':400,'correlated_traces':1,'correlated_logs':1,'mcp_correlated_traces':1}
IDENTITY_FIELDS=frozenset(('device','inode','uid','gid','mode','links'))
RESULT_FIELDS=frozenset(('schema','nonce','reads','gateway_denials','backend_denials','filesystem_isolated','namespace_inode','socket_inode','socket_device','dns_noname','dns_unavailable','dns_resolved'))


def require(value):
    if not value:raise ValueError('limited_client_refusal')


def unique(pairs):
    value=dict(pairs);require(len(value)==len(pairs));return value


def socket_identity(path=SOCKET):
    native=path.lstat()
    require(stat.S_ISSOCK(native.st_mode) and native.st_uid==os.getuid() and native.st_gid==os.getgid()
        and native.st_nlink==1 and stat.S_IMODE(native.st_mode)==0o600)
    return {'device':native.st_dev,'inode':native.st_ino,'uid':native.st_uid,'gid':native.st_gid,
        'mode':stat.S_IMODE(native.st_mode),'links':native.st_nlink}


def admission(value):
    require(type(value) is dict and set(value)=={'schema','nonce','agent_key','remaining_seconds','socket_identity','targets','network_namespace'})
    require(type(value['schema']) is int and value['schema']==1)
    require(type(value['nonce']) is str and re.fullmatch('[a-f0-9]{32}',value['nonce']))
    require(type(value['agent_key']) is str and re.fullmatch('[a-f0-9]{64}',value['agent_key']))
    require(type(value['remaining_seconds']) is int and 0<value['remaining_seconds']<=600)
    require(type(value['socket_identity']) is dict and set(value['socket_identity'])==IDENTITY_FIELDS)
    require(all(type(v) is int and v>=0 for v in value['socket_identity'].values()))
    require(type(value['network_namespace']) is str and re.fullmatch(r'net:\[[1-9][0-9]*\]',value['network_namespace']))
    require(type(value['targets']) is dict and set(value['targets'])==set(ENDPOINTS))
    for role,ip in value['targets'].items():
        require(type(ip) is str)
        address=ipaddress.IPv4Address(ip)
        require(any(address in ipaddress.ip_network(cidr) for cidr in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')))
    return value


def result(value,expected):
    require(type(value) is dict and set(value)==RESULT_FIELDS and value.get('nonce')==expected['nonce'])
    require(all(type(v) is int and v>=0 for k,v in value.items() if k!='nonce'))
    require(value['schema']==1 and value['reads']==4 and value['gateway_denials']==9
        and value['backend_denials']==sum(len(v) for v in ENDPOINTS.values()) and value['filesystem_isolated']==1)
    require(value['namespace_inode']==int(expected['network_namespace'][5:-1]))
    require(value['socket_inode']==expected['socket_identity']['inode'] and value['socket_device']==expected['socket_identity']['device'])
    require(value['dns_noname']+value['dns_unavailable']+value['dns_resolved']==1)
    return value


def deny_tcp(ip,port,remaining):
    try:
        connection=socket.create_connection((ip,port),timeout=min(1,remaining))
    except OSError as error:
        # A timeout, resolver failure or refused listener is not a kernel network denial.
        require(error.errno==errno.ENETUNREACH)
        return
    connection.close()
    raise ValueError('backend_reachable_even_without_authorization')


def wire(config,deadline,path='/read',method='POST',body=None,key=None):
    require(time.monotonic()<deadline and socket_identity()==config['socket_identity'])
    connection=http.client.HTTPConnection('finite-unix-reader',timeout=min(10,deadline-time.monotonic()))
    def connect():
        stream=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);connection.sock=stream
        stream.settimeout(min(10,deadline-time.monotonic()));stream.connect(str(SOCKET))
        _pid,uid,gid=struct.unpack('3i',stream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize('3i')))
        require(uid==os.getuid() and gid==os.getgid() and socket_identity()==config['socket_identity'])
    connection.connect=connect
    try:
        connection.request(method,path,None if body is None else json.dumps(body),
            {'Authorization':'Bearer '+(config['agent_key'] if key is None else key),'Connection':'close','Content-Type':'application/json'})
        response=connection.getresponse();raw=response.read(4097);require(len(raw)<=4096 and time.monotonic()<deadline)
        return response.status,json.loads(raw,object_pairs_hook=unique)
    finally:connection.close()


def read_private(path):
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:
        native=os.fstat(stream.fileno())
        require(stat.S_ISREG(native.st_mode) and native.st_uid==os.getuid() and native.st_nlink==1
            and stat.S_IMODE(native.st_mode)==0o600 and native.st_size<=8192)
        raw=stream.read(8193);require(len(raw)<=8192)
    return json.loads(raw,object_pairs_hook=unique)


def run():
    require(sys.platform=='linux')
    config=admission(read_private('/admission/fixture.json'));deadline=time.monotonic()+config['remaining_seconds']
    require(os.readlink('/proc/self/ns/net')==config['network_namespace'])
    require([name for _index,name in socket.if_nameindex()]==['lo'])
    require(sorted(os.listdir('/gateway'))==['reader.sock'])
    require(sorted(os.listdir('/admission'))==['fixture.json'] and sorted(os.listdir('/driver'))==['agent_probe.py'])
    require(all(not os.path.lexists(path) for path in ('/private','/disk','/var/run/docker.sock','/driver/control.py')))
    facts={'schema':1,'nonce':config['nonce'],'reads':0,'gateway_denials':0,'backend_denials':0,
        'filesystem_isolated':1,'namespace_inode':int(config['network_namespace'][5:-1]),
        'socket_inode':config['socket_identity']['inode'],'socket_device':config['socket_identity']['device'],
        'dns_noname':0,'dns_unavailable':1,'dns_resolved':0}
    dns=[]
    def observe_dns():
        try:socket.getaddrinfo('signoz-signoz-0',8080);dns.append('resolved')
        except socket.gaierror as error:dns.append('noname' if error.errno==socket.EAI_NONAME else 'unavailable')
        except OSError:dns.append('unavailable')
    diagnostic=threading.Thread(target=observe_dns,daemon=True);diagnostic.start()
    for operation,count in OPERATIONS.items():
        status,value=wire(config,deadline,body={'operation':operation,'parameters':{}})
        require(status==200 and value=={'state':'observed','count':count});facts['reads']+=1
    negatives=[('POST','/v1/metrics',{}),('POST','/v1/logs',{}),('POST','/v1/traces',{}),
        ('DELETE','/api/v1/service_accounts/x',None),('POST','/api/v5/query_range',{}),
        ('POST','/private',{}),('POST','/read',{'operation':'raw_sql','parameters':{}}),
        ('POST','/read',{'operation':'retained_metrics','parameters':{'query':'SELECT 1'}})]
    for method,path,body in negatives:
        status,value=wire(config,deadline,path,method,body);require(status==403 and value=={'state':'denied'});facts['gateway_denials']+=1
    status,_=wire(config,deadline,body={'operation':'retained_metrics','parameters':{}},key='wrong')
    require(status==403);facts['gateway_denials']+=1
    for role,ports in ENDPOINTS.items():
        for port in ports:
            require(time.monotonic()<deadline);deny_tcp(config['targets'][role],port,deadline-time.monotonic());facts['backend_denials']+=1
    diagnostic.join(timeout=min(1,max(0,deadline-time.monotonic())))
    if dns:
        facts['dns_unavailable']=0;facts['dns_'+dns[0]]=1
    print(json.dumps(result(facts,config),separators=(',',':')))


if __name__=='__main__':
    try:
        if sys.argv[1:] == ['serve']:
            while True:time.sleep(60)
        elif sys.argv[1:] == ['socket-identity']:
            try:identity=socket_identity()
            except FileNotFoundError:print('{"available":false}')
            else:print(json.dumps({'available':True,'identity':identity},separators=(',',':')))
        else:require(not sys.argv[1:]);run()
    except BaseException:
        print('{"agent_failed":1}');sys.exit(1)
