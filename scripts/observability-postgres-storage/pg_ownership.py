"""PG-only private completion overlay and fixed Linux bridge attachment admission."""
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import struct
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-tracking-storage'))
import ownership as tracking
import pilot
import record
import source_status
import source_status_scenario

SERVICES=tracking.SERVICES
PG_READY_COMMAND=tracking.PG_READY_COMMAND
verify_pg_absence=tracking.verify_pg_absence
AUTH='postgres-completion-auth.json'
CONFIG='postgres-completion.alloy'
PREFIX='INSIDE_PG_SOURCE_'
KEY=PREFIX+'forceFlushAuthKey'
OLD='''otelcol.exporter.otlphttp "metrics" {
  client {
    endpoint = "http://metrics:8428/opentelemetry"
    timeout = "5s"
  }
  sending_queue {
    queue_size = 64
    num_consumers = 1
  }
  retry_on_failure {
    max_elapsed_time = "30s"
  }
}'''
NEW='''otelcol.exporter.otlphttp "metrics" {
  client {
    endpoint = "http://metrics:8428/opentelemetry"
    timeout = "2s"
  }
  sending_queue {
    enabled = false
  }
  retry_on_failure {
    enabled = false
  }
}'''


def refuse():raise ValueError('ownership') from None


def _close(descriptor):
    primary,tb=sys.exc_info()[1:]
    try:os.close(descriptor)
    except BaseException:
        if primary is None:raise
    finally:
        if primary is not None:BaseException.__traceback__.__set__(primary,tb)


def _check(info,*,private=True):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1
            or private and stat.S_IMODE(info.st_mode)!=0o600):refuse()


def _write(output,name,raw,*,existing=False):
    if name not in (AUTH,CONFIG,'compose.json') or existing!=(name=='compose.json'):refuse()
    cap=128 if name==AUTH else len(overlay()) if name==CONFIG else 65536
    if len(raw)>cap:refuse()
    with record.directory(output) as directory:
        flags=os.O_WRONLY|os.O_NOFOLLOW|os.O_CLOEXEC
        if not existing:flags|=os.O_CREAT|os.O_EXCL
        descriptor=os.open(name,flags,0o600,dir_fd=directory)
        try:
            before=os.fstat(descriptor);_check(before,private=not existing)
            if record.identity(before)!=record.identity(os.stat(name,dir_fd=directory,follow_symlinks=False)):refuse()
            if existing:os.fchmod(descriptor,0o600);os.ftruncate(descriptor,0)
            offset=0
            while offset<len(raw):
                count=os.write(descriptor,raw[offset:])
                if count<=0:refuse()
                offset+=count
            current=os.fstat(descriptor);_check(current)
            if current.st_size!=len(raw) or record.identity(current)!=record.identity(os.stat(name,dir_fd=directory,follow_symlinks=False)):refuse()
        finally:_close(descriptor)


def _config(output):
    with record.directory(output) as directory:
        descriptor=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory)
        try:
            before=os.fstat(descriptor);_check(before)
            cap=len(overlay())
            if before.st_size!=cap:refuse()
            raw=os.read(descriptor,cap+1)
            if len(raw)!=cap or record.identity(before)!=record.identity(os.fstat(descriptor)) or record.identity(before)!=record.identity(os.stat(CONFIG,dir_fd=directory,follow_symlinks=False)):refuse()
            return raw
        finally:_close(descriptor)


def secret(output):
    value=record._read(output,AUTH,128)
    if (type(value) is not dict or set(value)!={'schema','key'} or type(value['schema']) is not int or value['schema']!=1
            or type(value['key']) is not str or re.fullmatch('[0-9a-f]{64}',value['key']) is None):refuse()
    return value['key']


def overlay():
    text=(pilot.CONFIG/'config.alloy').read_text()
    if text.count(OLD)!=1:refuse()
    return text.replace(OLD,NEW).encode()



def _owner(output,name):
    if name not in ('auth.json',AUTH,CONFIG):refuse()
    with record.directory(output) as directory:
        descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory)
        try:
            info=os.fstat(descriptor);_check(info)
            if record.identity(info)!=record.identity(os.stat(name,dir_fd=directory,follow_symlinks=False)):refuse()
            return info.st_uid,info.st_gid
        finally:_close(descriptor)


def _reader(output):
    identity=_owner(output,'auth.json')
    if _owner(output,AUTH)!=identity or _owner(output,CONFIG)!=identity:refuse()
    return str(identity[0])+':'+str(identity[1])


def plan(output):
    result=tracking.plan(output);key=secret(output)
    if _config(output)!=overlay():refuse()
    reader=_reader(output)
    if result['services']['vmauth']['user']!=reader:refuse()
    result['services']['alloy']['user']=reader
    result['services']['alloy']['volumes']=[str(output/CONFIG)+':/etc/alloy/config.alloy:ro']
    metrics=result['services']['metrics']
    if 'environment' in metrics or any('envflag' in arg or 'forceFlushAuthKey' in arg for arg in metrics['command']):refuse()
    metrics['command']+=['-envflag.enable=true','-envflag.prefix='+PREFIX]
    metrics['environment']={KEY:key};metrics['logging']={'driver':'none'}
    return result


def prepare(output):
    tracking.prepare(output)
    _write(output,AUTH,(json.dumps({'schema':1,'key':secrets.token_hex(32)},separators=(',',':'))+'\n').encode())
    _write(output,CONFIG,overlay())
    _write(output,'compose.json',(json.dumps(plan(output),indent=2)+'\n').encode(),existing=True)


class Targets(source_status_scenario.OwnedTargets):
    """Same Core7 registry plus same PG identity; only the PG plan differs."""
    def __init__(self,output,compose,expected,read):
        if expected!=plan(output):refuse()
        core={**expected,'services':{key:value for key,value in expected['services'].items() if key!='postgres'},
              'volumes':{key:value for key,value in expected['volumes'].items() if key!='postgres'}}
        super().__init__(output,compose,core,read)
        self.plan=expected
        cid=read(compose+['ps','-q','postgres']).strip()
        if re.fullmatch('[0-9a-f]{64}',cid) is None or cid in {target['id'] for target in self.targets.values()}:refuse()
        target=self.inspect('postgres',cid)
        if target['networks']!=self.targets['gateway']['networks']:refuse()
        self.targets['postgres']=target
        pilot.write_json(output/'tracking-pg-owned.json',{'project':self.project,'container':cid,
            'volume':self.project+'_postgres','networks':sorted(target['networks'].values())})

    postgres=tracking.TrackingTargets.postgres

    def alloy_private(self,deadline):
        if time.monotonic()>=deadline:raise TimeoutError()
        pilot.assert_docker_identity(deadline=deadline)
        target=self.targets['alloy'];cid=self.read(self.compose+['ps','-q','alloy']).strip()
        if cid!=target['id'] or self.inspect('alloy',cid)!=target:refuse()
        template='{"user":{{json .Config.User}},"command":{{json .Config.Cmd}},"caps":{{json .HostConfig.CapDrop}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"running":{{json .State.Running}}}'
        raw=self.read(['docker','inspect','--format',template,cid]).encode()
        if len(raw)>8192:refuse()
        value=source_status.decode_json(raw);expected=plan(self.output)['services']['alloy']
        if (type(value) is not dict or set(value)!={'user','command','caps','readonly','running'}
                or value['user']!=expected['user'] or value['command']!=expected['command']
                or value['caps']!=['ALL'] or value['readonly'] is not True or value['running'] is not True):refuse()
        pilot.assert_docker_identity(deadline=deadline)
        if time.monotonic()>=deadline:raise TimeoutError()

    def metrics_private(self,deadline):
        self.alloy_private(deadline)
        if time.monotonic()>=deadline:raise TimeoutError()
        pilot.assert_docker_identity(deadline=deadline)
        target=self.targets['metrics'];cid=self.read(self.compose+['ps','-q','metrics']).strip()
        if cid!=target['id'] or self.inspect('metrics',cid)!=target:refuse()
        template='{"logging":{{json .HostConfig.LogConfig.Type}},"environment":{{json .Config.Env}},"command":{{json .Config.Cmd}},"running":{{json .State.Running}}}'
        raw=self.read(['docker','inspect','--format',template,cid]).encode()
        if len(raw)>8192:refuse()
        value=source_status.decode_json(raw)
        if type(value) is not dict or set(value)!={'logging','environment','command','running'} or value['running'] is not True or value['logging']!='none':refuse()
        env=value['environment']
        if type(env) is not list or len(env)>64 or any(type(item) is not str for item in env):refuse()
        selected=[item for item in env if item.startswith(PREFIX)]
        if selected!=[KEY+'='+secret(self.output)] or value['command']!=plan(self.output)['services']['metrics']['command']:refuse()
        pilot.assert_docker_identity(deadline=deadline)
        if time.monotonic()>=deadline:raise TimeoutError()

    def flush_target(self,deadline):
        identity=pilot.FROZEN_DOCKER_IDENTITY
        if (sys.platform!='linux' or type(identity) is not dict or identity.get('platform')!='linux'
                or identity.get('endpoint')!=pilot.FROZEN_DOCKER_ENDPOINT or not str(identity.get('endpoint','')).startswith('unix:///')):refuse()
        self.metrics_private(deadline)
        target=self.targets['metrics'];name=self.project+'_pilot';network=target['networks'].get(name)
        if type(network) is not str or re.fullmatch('[0-9a-f]{64}',network) is None:refuse()
        # Fixed projection only. No secret appears in argv, URL or retained evidence.
        template='{{json (index .NetworkSettings.Networks '+json.dumps(name)+')}}'
        raw=self.read(['docker','inspect','--format',template,target['id']]).encode()
        if len(raw)>8192:refuse()
        attachment=source_status.decode_json(raw)
        if type(attachment) is not dict or attachment.get('NetworkID')!=network:refuse()
        raw=self.read(['docker','network','inspect','--format','{{json .}}',network]).encode()
        if len(raw)>8192:refuse()
        config=source_status.decode_json(raw)
        if (type(config) is not dict or config.get('Id')!=network or config.get('Name')!=name or config.get('Driver')!='bridge'
                or config.get('Internal') is not True or type(config.get('Labels')) is not dict
                or config['Labels'].get('com.docker.compose.project')!=self.project
                or config['Labels'].get('com.docker.compose.network')!='pilot'
                or type(config.get('Options')) is not dict or 'com.docker.network.bridge.name' in config['Options']):refuse()
        ipam=config.get('IPAM')
        if type(ipam) is not dict or type(ipam.get('Config')) is not list or len(ipam['Config'])!=1:refuse()
        entry=ipam['Config'][0]
        if type(entry) is not dict:refuse()
        try:
            subnet=ipaddress.IPv4Network(entry['Subnet'],strict=True);gateway=ipaddress.IPv4Address(entry['Gateway']);address=ipaddress.IPv4Address(attachment['IPAddress'])
            prefix=attachment['IPPrefixLen']
            if (type(prefix) is not int or prefix!=subnet.prefixlen or gateway not in subnet or address not in subnet
                    or attachment.get('Gateway')!=str(gateway) or address in (subnet.network_address,subnet.broadcast_address,gateway)
                    or not address.is_private or any((address.is_loopback,address.is_link_local,address.is_multicast,address.is_unspecified,address.is_reserved))):refuse()
        except (ValueError,KeyError,TypeError):refuse()
        bridge='br-'+network[:12];index=socket.if_nametoindex(bridge)
        probe=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        try:
            observed=fcntl.ioctl(probe.fileno(),0x8915,struct.pack('256s',bridge.encode()))
            if socket.inet_ntoa(observed[20:24])!=str(gateway) or socket.if_nametoindex(bridge)!=index:refuse()
        finally:
            primary,tb=sys.exc_info()[1:]
            try:probe.close()
            except BaseException:
                if primary is None:raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,tb)
        pilot.assert_docker_identity(deadline=deadline)
        if time.monotonic()>=deadline:raise TimeoutError()
        return (str(address),str(gateway),index)
