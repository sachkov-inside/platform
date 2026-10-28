#!/usr/bin/env python3
"""Native owned lifecycle. Import performs no native acquisition or execution."""
from contextlib import contextmanager
from enum import StrEnum
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import selectors
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import image_proof
from types import MappingProxyType

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONFIG = ROOT / "infra/observability/signoz"
POLICY = ROOT / 'scripts/observability-pilot'
# Imports contain no Docker/runtime execution; runtime.source binds their tracked bytes.
sys.path.insert(0, str(POLICY))
import daemon
import orbstack
import storage_policy

OWNER = 'monitoring-1566-signoz-functional'
GIB = 1024**3
CPU_LIMIT = 2
MEM_LIMIT = 4096 * 1024**2
OUTPUT_LIMIT = 1024**2
ROLE_IMAGES = MappingProxyType({'volume-init':'python','disk':'python','histogram-init':'python',
    'keeper':'clickhouse-keeper','postgres':'postgres','clickhouse':'clickhouse-server',
    'migrator':'signoz-otel-collector','collector':'signoz-otel-collector','server':'signoz',
    'mcp':'signoz-mcp-server','agent':'python'})
SERVICES = tuple(ROLE_IMAGES)
EXITED_ROLES = frozenset(('volume-init','histogram-init','migrator'))
VOLUMES = ('ch-data','keeper-data','keeper-default-data','pg-data','histogram','probe','gateway')
# Includes every container, including stopped init jobs and native MCP.
BUDGETS = {'volume-init': (.025, 32), 'disk': (.1, 96),
           'histogram-init': (.05, 64), 'keeper': (.1, 128), 'postgres': (.1, 256),
           'clickhouse': (.6, 1792), 'migrator': (.2, 448), 'collector': (.3, 448),
           'server': (.4, 640), 'mcp': (.075, 128), 'agent': (.05,64)}
NATIVE_OPERATIONS = frozenset((('unknown','unknown'),('image_pull','amd64_digest_reference'),
    ('image_inspect','amd64_digest_reference'),('image_inspect','digest_reference'),
    ('compose_create','initial_helpers'),('compose_create','all_roles')))
STDERR_CATEGORIES = frozenset(('unclassified','unknown_platform_flag'))
ALIASES = {'keeper': 'signoz-telemetrykeeper-clickhousekeeper-0',
           'postgres': 'signoz-metastore-postgres-0',
           'clickhouse': 'signoz-telemetrystore-clickhouse-0-0',
           'server': 'signoz-signoz-0', 'collector': 'signoz-ingester'}

class ImageAdmissionReason(StrEnum):
    """Finite image-admission refusal vocabulary, shared by guards and publication."""
    IMAGE_PROOF_INVALID = 'image_proof_invalid'
    LOCKED_CHILD_REQUIRED = 'locked_child_required'
    IMAGE_PLATFORM = 'image_platform'
    SELECTED_IMAGE_IDENTITY = 'selected_image_identity'
    IMAGE_CONFIGURATION_IDENTITY = 'image_configuration_identity'
    DECLARED_IMAGE_VOLUME_SHAPE = 'declared_image_volume_shape'
    DECLARED_IMAGE_VOLUME_CONTRACT = 'declared_image_volume_contract'
    IMAGE_INDEX_IDENTITY = 'image_index_identity'
    IMAGE_ATTACHMENT_IDENTITY = 'image_attachment_identity'
    SELECTED_IMAGE_DESCRIPTOR = 'selected_image_descriptor'
    SELECTED_IMAGE_MEDIA_TYPE = 'selected_image_media_type'
    SELECTED_IMAGE_CHILD = 'selected_image_child'
    SELECTED_IMAGE_SIZE = 'selected_image_size'
    SELECTED_IMAGE_PLATFORM = 'selected_image_platform'
    SELECTED_IMAGE_VARIANT = 'selected_image_variant'
    DECLARED_IMAGE_VOLUME_COVERAGE = 'declared_image_volume_coverage'


class Refusal(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def need(ok, reason):
    if not ok:
        raise Refusal(reason)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def native_operation(args):
    """Classify actual logical argv without retaining any value from it."""
    pinned=bool(args and type(args[-1]) is str and re.fullmatch(r'docker\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}',args[-1]))
    if pinned and args[:-1]==['pull','--platform','linux/amd64']:
        return {'operation':'image_pull','argument_category':'amd64_digest_reference'}
    if pinned and args[:-1] in (['image','inspect','--platform','linux/amd64'],['image','inspect']):
        return {'operation':'image_inspect','argument_category':'amd64_digest_reference' if '--platform' in args else 'digest_reference'}
    if len(args)>=6 and args[0:2]==['compose','-p'] and args[3]=='-f':
        tail=args[5:]
        if tail==['create','--no-build','--pull','never','volume-init','disk']:
            return {'operation':'compose_create','argument_category':'initial_helpers'}
        if tail==['--profile','functional','create','--no-build','--pull','never']:
            return {'operation':'compose_create','argument_category':'all_roles'}
    return {'operation':'unknown','argument_category':'unknown'}


def stderr_category(raw):
    # Exact finite signatures only. Never quote a prefix, suffix, path or native message.
    full=(b"unknown flag: --platform\n\nUsage:  docker image inspect [OPTIONS] IMAGE [IMAGE...]\n\n"
          b"Run 'docker image inspect --help' for more information\n")
    return 'unknown_platform_flag' if raw in (b'unknown flag: --platform\n',full) else 'unclassified'


def healthy_states(states):
    if type(states) is not dict or set(states)!=set(SERVICES):return False
    for role,row in states.items():
        if (type(row) is not dict or set(row)!={'exit_code','running','oom_killed','restart_count'}
                or type(row['exit_code']) is not int or row['exit_code']!=0
                or type(row['restart_count']) is not int or row['restart_count']!=0
                or row['oom_killed'] is not False or row['running'] is not (role not in EXITED_ROLES)):
            return False
    return True


def private_json(path,value):
    path=Path(path)
    need(not path.is_symlink(),'private_record_symlink')
    temporary=path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'w') as stream:
            json.dump(value,stream,separators=(',',':'),allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if temporary.exists():temporary.unlink()


def labels(project, nonce):
    return {'inside.monitoring.owner': OWNER, 'inside.monitoring.nonce': nonce,
            'com.docker.compose.project': project}


def canonical_caps(value):
    need(value is None or type(value) is list,'capability_shape')
    need(value is None or all(type(v) is str for v in value),'capability_shape')
    return {v.removeprefix('CAP_') for v in (value or [])}

def expected_limits(service, value):
    cpu, mem = BUDGETS[service]
    host = value['HostConfig']
    need(host['Memory'] == mem * 1024**2 and host['NanoCpus'] == round(cpu*10**9), 'container_budget')
    need(host.get('PidsLimit') == 128 and host.get('ReadonlyRootfs') is True, 'container_sandbox')
    need(host.get('Privileged') is False and not host.get('PortBindings'), 'container_authority')
    need(not host.get('Binds'), 'legacy_bind_mount')
    need(canonical_caps(host.get('CapDrop'))=={'ALL'},'capability_drop')
    need(canonical_caps(host.get('CapAdd'))==({'CHOWN'} if service=='volume-init' else {'DAC_READ_SEARCH'} if service=='server' else set()),'capability_add')
    need(host.get('MemorySwap')==host['Memory'],'swap_limit')
    need(set(host.get('SecurityOpt') or [])=={'no-new-privileges:true'},'security_options')


def make_plan(run, locked_images, project, nonce, uid, gid):
    """All mounts are explicit, finite and task-owned; no global names or host ports."""
    by_repo = {r['repository'].split('/')[-1]: image_proof.runtime_reference(r) for r in locked_images}
    helper_arch='amd64'
    names = {name: project + '_' + name for name in VOLUMES}
    limits = labels(project, nonce)
    def volume(name, target, read_only=False):
        return {'type':'volume','source':name,'target':target,'read_only':read_only,'volume':{'nocopy':True}}
    def bind(path, target):
        return {'type':'bind','source':str(path),'target':target,'read_only':True,'bind':{'create_host_path':False}}
    def base(service, image, command, entrypoint=None):
        cpu, memory = BUDGETS[service]
        value = {'image':image,'platform':'linux/amd64','pull_policy':'never',
                 'cpus':cpu,'mem_limit':str(memory)+'m','memswap_limit':str(memory)+'m',
                 'pids_limit':128,'user':f'{uid}:{gid}','read_only':True,'cap_drop':['ALL'],
                 'security_opt':['no-new-privileges:true'],'restart':'no',
                 'labels':{**limits,'inside.monitoring.service':service},
                 'tmpfs':['/tmp:size=33554432,mode=1777'],
                 'networks':{'backend':{'aliases':[ALIASES[service]]} if service in ALIASES else {}},
                 'logging':{'driver':'none'},'command':command}
        if image==by_repo['python']:value['platform']='linux/'+helper_arch
        if entrypoint is not None:value['entrypoint']=entrypoint
        return value
    services = {}
    services['volume-init']=base('volume-init',by_repo['python'],
        ['python','-c',"import os; [ (os.chmod('/v/'+n,0o700),os.chown('/v/'+n,"+str(uid)+","+str(gid)+")) for n in "+repr(VOLUMES)+"]"], [])
    services['volume-init'].update({'user':'0:0','cap_add':['CHOWN'],
        'volumes':[volume(n,'/v/'+n) for n in names]})
    services['disk']=base('disk',by_repo['python'],['python','-u','/driver/inside.py','serve'],[])
    services['disk'].update({'volumes':[bind(run/'driver','/driver'),bind(run/'private','/private'),volume('probe','/disk'),volume('gateway','/gateway')]})
    services['histogram-init']=base('histogram-init',by_repo['python'],
        ['python','/driver/inside.py','histogram'],[])
    services['histogram-init']['volumes']=[bind(run/'driver','/driver'),bind(run/'private','/private'),volume('histogram','/histogram')]
    services['keeper']=base('keeper',by_repo['clickhouse-keeper'],
        ['--config-file=/config/keeper-0.yaml'],['/usr/bin/clickhouse-keeper'])
    services['keeper']['volumes']=[bind(run/'private','/config'),volume('keeper-data','/var/lib/clickhouse-keeper'),volume('keeper-default-data','/var/lib/clickhouse')]
    services['postgres']=base('postgres',by_repo['postgres'],['postgres'])
    services['postgres'].update({'environment':{'POSTGRES_DB':'signoz','POSTGRES_USER':'signoz',
        'POSTGRES_PASSWORD_FILE':'/config/pg-password','PGDATA':'/var/lib/postgresql/data'},
        'volumes':[bind(run/'private','/config'),volume('pg-data','/var/lib/postgresql/data')],
        'tmpfs':['/tmp:size=33554432,mode=1777','/var/run/postgresql:size=1048576,mode=1777']})
    services['clickhouse']=base('clickhouse',by_repo['clickhouse-server'],
        ['--config-file=/config/config-0-0.yaml'],['/usr/bin/clickhouse-server'])
    services['clickhouse']['volumes']=[bind(run/'private','/config'),volume('ch-data','/var/lib/clickhouse'),volume('histogram','/var/lib/clickhouse/user_scripts',True)]
    env={'SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN':'tcp://signoz-telemetrystore-clickhouse-0-0:9000',
         'SIGNOZ_OTEL_COLLECTOR_TIMEOUT':'5m','LOW_CARDINAL_EXCEPTION_GROUPING':'false'}
    for name, command in [('migrator',['-c','/signoz-otel-collector migrate ready && /signoz-otel-collector migrate bootstrap && /signoz-otel-collector migrate sync up && /signoz-otel-collector migrate async up']),
                          ('collector',['-c','/signoz-otel-collector migrate sync check && exec /signoz-otel-collector --config=/config/ingester.yaml --manager-config=/config/opamp.yaml --copy-path=/tmp/collector-config.yaml'])]:
        services[name]=base(name,by_repo['signoz-otel-collector'],command,['/bin/sh'])
        services[name].update({'environment':env,'volumes':[bind(run/'private','/config')]})
    services['server']=base('server',by_repo['signoz'],['server','--config','/config/signoz.yaml'],['/root/signoz'])
    services['server'].update({'user':'0:0','cap_add':['DAC_READ_SEARCH'],'working_dir':'/tmp'})
    services['server'].update({'environment':{'SIGNOZ_SQLSTORE_PROVIDER':'postgres',
        # Not a secret value. Runtime private config holds the generated DSN instead.
        'SIGNOZ_TELEMETRYSTORE_PROVIDER':'clickhouse',
        'SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN':'tcp://signoz-telemetrystore-clickhouse-0-0:9000',
        'SIGNOZ_ANALYTICS_ENABLED':'false','SIGNOZ_STATSREPORTER_ENABLED':'false'},
        'volumes':[bind(run/'private','/config')]})
    services['mcp']=base('mcp',by_repo['signoz-mcp-server'],[])
    services['mcp'].update({'profiles':['functional'],
        'environment':{'SIGNOZ_URL':'http://signoz-signoz-0:8080','SIGNOZ_INSTANCE_URL_ALLOWLIST':'signoz-signoz-0','TRANSPORT_MODE':'http','MCP_SERVER_PORT':'8000','ANALYTICS_ENABLED':'false','SIGNOZ_DOCS_REFRESH_INTERVAL':'0','SIGNOZ_DOCS_FULL_REFRESH_INTERVAL':'0','MCP_MAX_REQUEST_BYTES':'16384'}})
    services['agent']=base('agent',by_repo['python'],['python','-B','/driver/agent_probe.py','serve'],[])
    services['agent'].pop('networks')
    services['agent'].update({'network_mode':'none','volumes':[bind(run/'agent-driver','/driver'),bind(run/'agent-admission','/admission'),volume('gateway','/gateway',True)]})
    return {'name':project,'services':services,
        'volumes':{n:{'name':real,'labels':limits} for n,real in names.items()},
        'networks':{'backend':{'name':project+'_backend','internal':True,'driver':'bridge','labels':limits}}}


class Engine:
    def __init__(self, run, deadline):
        self.run,self.deadline=run,deadline
        self.invocation=Path(shutil.which('docker') or '')
        self.cli=self.invocation.resolve(strict=True)
        native=self.invocation.lstat()
        self.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(self.cli))
        self.cli_hash=digest(self.cli)
        self.anon=run/'docker-anon';self.anon.mkdir(mode=0o700);private_json(self.anon/'config.json',{})
        self.plugin=None
        self.identity=None
        self.endpoint=None
        self.cleanup=False
        self.lock=threading.RLock()
        self.child=set()
        self.child_threads={}
        self.cancel_requested=set()
    def raw(self,args,timeout=10,*,binary=None,operation=None):
        if threading.current_thread().name=='owned-signoz-storage':
            need(not getattr(self,'monitor_stop',threading.Event()).is_set(),'monitor_stopping')
        remaining=self.deadline-time.monotonic()
        need(remaining>0,'global_deadline')
        timeout=min(timeout,remaining)
        if self.plugin is not None:
            path,expected=self.plugin;native_plugin=path.lstat()
            need((native_plugin.st_dev,native_plugin.st_ino,native_plugin.st_mode,str(path.resolve(strict=True)),digest(path.resolve(strict=True)))==expected,'compose_plugin_changed')
        native=self.invocation.lstat()
        need((native.st_dev,native.st_ino,native.st_mode,str(self.invocation.resolve(strict=True)))==self.invocation_identity,'docker_invocation_changed')
        command=[str(binary or self.invocation),*args]
        if operation is not None:private_json(self.run/'native-operation.json',{**operation,'status':'started'})
        proc=subprocess.Popen(command,executable=str(binary or self.cli),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            # Separate cancellable group, retaining the registered worker session.
            process_group=0,env={k:v for k,v in os.environ.items() if not k.startswith(('DOCKER_','COMPOSE_'))})
        with self.lock:
            self.child.add(proc);self.child_threads[proc]=threading.get_ident()
        selector=selectors.DefaultSelector();data=[bytearray(),bytearray()];deadline=time.monotonic()+timeout
        for i,stream in enumerate((proc.stdout,proc.stderr)):
            os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,i)
        try:
            while selector.get_map():
                need(time.monotonic()<deadline,'command_deadline')
                for key,_ in selector.select(min(.1,max(0,deadline-time.monotonic()))):
                    chunk=os.read(key.fileobj.fileno(),65536)
                    if not chunk:selector.unregister(key.fileobj);continue
                    data[key.data].extend(chunk)
                    need(len(data[0])+len(data[1])<=OUTPUT_LIMIT,'command_output_limit')
            code=proc.wait(timeout=max(.001,deadline-time.monotonic()))
            if code!=0 and '/driver/inside.py' in args:
                try:
                    failure=json.loads(bytes(data[0]).decode())
                    allowed={'inside_failed','stage','category','http_status','transport'}
                    need(type(failure) is dict and set(failure)==allowed and failure['inside_failed']==1,'closed_inside_failure')
                    need(type(failure['http_status']) is int and 0<=failure['http_status']<=599,'closed_inside_status')
                    need(all(type(failure[k]) is str and re.fullmatch('[a-zA-Z0-9_]{1,48}',failure[k]) for k in ('stage','category','transport')),'closed_inside_category')
                    private_json(self.run/'inside-failure.json',failure)
                except BaseException:pass
            if code==-signal.SIGKILL and proc in self.cancel_requested and threading.current_thread().name=='owned-signoz-storage' and getattr(self,'monitor_stop',threading.Event()).is_set():
                raise Refusal('monitor_stopping')
            need(code==0,'command_failed')
            if operation is not None:private_json(self.run/'native-operation.json',{**operation,'status':'succeeded'})
            return bytes(data[0]).decode('utf8')
        except BaseException as error:
            # Genuine exit is captured before owned group termination. Raw bytes stay private.
            try:
                index=getattr(self,'failure_index',0)+1;self.failure_index=index
                row={'native_exit':proc.poll(),'alive_before_reap':proc.poll() is None,
                    'category':type(error).__name__,'reason':error.reason if isinstance(error,Refusal) else 'native_failure'}
                row.update(operation or {'operation':'unknown','argument_category':'unknown'})
                row['stderr_category']=stderr_category(bytes(data[1]))
                if operation is not None:private_json(self.run/'native-operation.json',{**operation,'status':'failed'})
                for label,value in zip(('stdout','stderr'),data):
                    retained=bytes(value[-32768:]);path=self.run/('failure-'+str(index)+'-'+label+'.private')
                    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                    with os.fdopen(descriptor,'wb') as stream:stream.write(retained)
                    row[label+'_bytes']=len(value);row[label+'_retained_bytes']=len(retained)
                    row[label+'_sha256']=hashlib.sha256(retained).hexdigest()
                private_json(self.run/'failure.json',row)
            except BaseException:self.failure_capture_unavailable=True
            raise
        finally:
            selector.close()
            # Reap even if leader exited while a CLI descendant inherited its pipes.
            try:os.killpg(proc.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:proc.wait(timeout=1)
            except subprocess.TimeoutExpired:pass
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            proc.wait(timeout=1)
            for stream in (proc.stdout,proc.stderr):stream.close()
            with self.lock:
                self.child.discard(proc)
                self.child_threads.pop(proc,None)
                self.cancel_requested.discard(proc)
    def cancel_thread_children(self,thread):
        with self.lock:children=[proc for proc in self.child if self.child_threads.get(proc)==thread.ident and proc.poll() is None]
        for proc in children:
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
    def cancel_children(self):
        with self.lock:
            children=[proc for proc in self.child if proc.poll() is None]
            self.cancel_requested.update(children)
        for proc in children:
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:
                with self.lock:self.cancel_requested.discard(proc)
        for proc in children:
            try:proc.wait(timeout=1)
            except subprocess.TimeoutExpired:pass
    def identify(self):
        need(platform.system()=='Linux' and platform.machine() in ('x86_64','amd64'),'native_linux_amd64_required')
        need(digest(self.cli)==self.cli_hash,'docker_cli_changed')
        def command(args,**kwargs):
            if args[0]=='docker':return self.raw(args[1:],kwargs.get('timeout',10))
            need(args[0]=='lsof','identity_command')
            return self.raw(args[1:],kwargs.get('timeout',10),binary=Path(shutil.which('lsof')).resolve(strict=True))
        if platform.system()=='Darwin' and platform.machine()=='arm64':
            return orbstack.identify(command,home=Path.home())
        need(platform.system()=='Linux','unsupported_native_host')
        return daemon.identify(command)
    def freeze(self):
        need(not any(os.environ.get(k) for k in ('DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','COMPOSE_PROJECT_NAME','COMPOSE_FILE')),'external_docker_override')
        self.identity=self.identify();self.endpoint=self.identity['endpoint']
        need(self.raw(['--host',self.endpoint,'info','--format','{{.Architecture}}']).strip() in ('x86_64','amd64'),'native_daemon_amd64_required')
        metadata=json.loads(self.raw(['--host',self.endpoint,'info','--format','{{json .ClientInfo.Plugins}}']))
        rows=[r for r in metadata if r.get('Name')=='compose'];need(len(rows)==1,'compose_plugin_discovery')
        path=Path(rows[0]['Path']);need(path.is_absolute() and path.name=='docker-compose','compose_plugin_path')
        native=path.lstat();target=path.resolve(strict=True);need(target.is_file(),'compose_plugin_target')
        self.plugin=(path,(native.st_dev,native.st_ino,native.st_mode,str(target),digest(target)))
        private_json(self.anon/'config.json',{'cliPluginsExtraDirs':[str(path.parent)]})
        private_json(self.run/'identity.json',{'cli_sha256':'sha256:'+self.cli_hash,
            'compose_sha256':'sha256:'+digest(target),
            'daemon_sha256':'sha256:'+hashlib.sha256(str(self.identity['daemon_id']).encode()).hexdigest(),
            'endpoint_sha256':'sha256:'+hashlib.sha256(self.endpoint.encode()).hexdigest()})
    def call(self,args,timeout=10):
        need(self.identify()==self.identity,'daemon_identity_changed')
        return self.raw(['--config',str(self.anon),'--host',self.endpoint,*args],timeout,operation=native_operation(args))
    def inspect(self,kind,identity):
        raw=self.call([kind,'inspect',identity] if kind in ('network','volume','image') else ['inspect',identity])
        return (image_proof.decode(raw) if kind=='image' else json.loads(raw))[0]


class Owned:
    def __init__(self,engine,run,images,project,nonce):
        self.engine,self.run,self.images,self.project,self.nonce=engine,run,images,project,nonce
        self.containers={};self.volumes={};self.networks={};self.plan=None;self.created={}
    def compose(self,args,timeout=20):
        return self.engine.call(['compose','-p',self.project,'-f',str(self.run/'compose.json'),*args],timeout)
    def owned_labels(self,value):
        require=labels(self.project,self.nonce)
        need(isinstance(value,dict) and all(value.get(k)==v for k,v in require.items()),'owner_label_changed')
    def discover(self):
        # Only our unpredictable nonce + project can authorize inclusion in cleanup.
        found=self.engine.call(['ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+self.project,
            '--filter','label=inside.monitoring.nonce='+self.nonce]).split()
        for cid in found:
            need(re.fullmatch('[a-f0-9]{64}',cid) is not None,'container_id')
            value=self.engine.inspect('container',cid);self.owned_labels(value['Config']['Labels'])
            name=value['Config']['Labels'].get('inside.monitoring.service');need(name in SERVICES,'foreign_service')
            if name in self.containers:need(self.containers[name]==cid,'replaced_container')
            self.containers[name]=cid
            if name in self.created:need(self.created[name]==value['Created'],'container_created_changed')
            self.created[name]=value['Created']
        for name,value in self.plan['volumes'].items():
            real=value['name']
            listing=self.engine.call(['volume','ls','-q','--filter','name=^'+real+'$']).split()
            if not listing:continue
            need(listing==[real],'volume_name_collision')
            native=self.engine.inspect('volume',real);self.owned_labels(native['Labels'])
            need(native['Driver']=='local' and not native.get('Options'),'foreign_volume_driver')
            identity={k:native[k] for k in ('Name','CreatedAt','Mountpoint','Driver')}
            if real in self.volumes:need(self.volumes[real]==identity,'replaced_volume')
            self.volumes[real]=identity
        for spec in self.plan['networks'].values():
            real=spec['name']
            listing=self.engine.call(['network','ls','-q','--no-trunc','--filter','name=^'+real+'$']).split()
            if listing:
                need(len(listing)==1,'network_name_collision')
                native=self.engine.inspect('network',listing[0]);self.owned_labels(native['Labels'])
                need(native['Name']==real and native['Internal'] is True and native['Driver']=='bridge','network_boundary')
                if real in self.networks:need(self.networks[real]==native['Id'],'replaced_network')
                self.networks[real]=native['Id']
    def validate(self,name):
        cid=self.containers[name];v=self.engine.inspect('container',cid)
        self.owned_labels(v['Config']['Labels']);need(v['Id']==cid,'container_identity')
        need(name in self.created and self.created[name]==v['Created'],'container_created_identity')
        need(v['Image']==self.images[name]['image_id'],'container_image_changed')
        proof=self.engine.image_proofs[self.images[name]['reference']]
        need(v['Config'].get('Image')==proof.runtime_reference and self.plan['services'][name]['image']==proof.runtime_reference,ImageAdmissionReason.IMAGE_ATTACHMENT_IDENTITY)
        if 'ImageManifestDescriptor' in v:require_child_descriptor(v['ImageManifestDescriptor'],proof)
        elif self.images[name]['relation']=='child_id':raise Refusal(ImageAdmissionReason.SELECTED_IMAGE_DESCRIPTOR)
        expected_limits(name,v)
        spec=self.plan['services'][name]
        need(v['Config'].get('User')==spec['user'],'container_user')
        need((v['Config'].get('Cmd') or [])==(spec.get('command') or []),'container_command')
        expected_entry=spec['entrypoint'] if 'entrypoint' in spec else self.images[name]['entrypoint']
        need((v['Config'].get('Entrypoint') or [])==(expected_entry or []),'container_entrypoint')
        need(v['HostConfig'].get('LogConfig',{}).get('Type')=='none','container_logging')
        actual_env=dict(e.split('=',1) for e in v['Config'].get('Env',[]) if '=' in e)
        need(all(actual_env.get(k)==val for k,val in spec.get('environment',{}).items()),'container_environment')
        if name=='agent':
            need(spec.get('network_mode')=='none' and v['HostConfig'].get('NetworkMode')=='none','agent_network_none')
            attached=v['NetworkSettings']['Networks']
            need(type(attached) is dict and set(attached) in (set(),{'none'}),'agent_network_attachment')
            need(all(not row.get(k) for row in attached.values() for k in ('IPAddress','GlobalIPv6Address','Gateway','IPv6Gateway')),'agent_network_address')
            need(v['HostConfig'].get('PidMode')=='' and v['HostConfig'].get('UTSMode')=='','agent_namespace_authority')
        else:
            networks={self.plan['networks'][key]['name'] for key in spec['networks']}
            need(v['HostConfig'].get('NetworkMode') in networks,'network_mode')
            need(set(v['NetworkSettings']['Networks'])==networks,'network_attachment')
        need(v['HostConfig'].get('RestartPolicy',{}).get('Name')=='no','restart_policy')
        expected=self.plan['services'][name].get('volumes',[])
        actual=v.get('Mounts',[]);need(len(actual)==len(expected),'mount_set')
        for spec in expected:
            rows=[m for m in actual if m['Destination']==spec['target']];need(len(rows)==1,'mount_target')
            m=rows[0];need(m['Type']==spec['type'] and m['RW']==(not spec.get('read_only',False)),'mount_authority')
            if spec['type']=='bind':need(Path(m['Source']).resolve()==Path(spec['source']).resolve(),'bind_source')
            else:need(m['Name']==self.plan['volumes'][spec['source']]['name'] and m['Name'] in self.volumes,'volume_mount')
        self.images[name]['container_descriptor_available']='ImageManifestDescriptor' in v
        return v
    def record(self):
        private_json(self.run/'resources.json',{'project':self.project,'nonce':self.nonce,
            'containers':self.containers,'created':self.created,'volumes':self.volumes,'networks':self.networks})
    def start(self,*names):
        for name in names:self.validate(name)
        self.engine.call(['start',*(self.containers[n] for n in names)])
    def wait(self,name,timeout=180):
        end=min(self.engine.deadline,time.monotonic()+timeout)
        while time.monotonic()<end:
            value=self.validate(name)
            if not value['State']['Running']:
                need(value['State']['ExitCode']==0 and value['State']['OOMKilled'] is False,'init_failed')
                return
            time.sleep(.25)
        raise Refusal('init_deadline')
    def exec(self,args,timeout=10):
        self.validate('disk')
        return self.engine.call(['exec',self.containers['disk'],'python','/driver/inside.py',*args],timeout)
    def snapshot_states(self):
        states={}
        for name in SERVICES:
            value=self.validate(name)
            states[name]={'exit_code':value['State']['ExitCode'],'running':value['State']['Running'],
                'oom_killed':value['State']['OOMKilled'],'restart_count':value['RestartCount']}
        return states
    def cleanup_exact(self):
        failures=[]
        # Register resources left by an interrupted create only after exact nonce ownership.
        try:self.discover();self.record()
        except BaseException:failures.append('discovery')
        states={}
        for name,cid in list(self.containers.items()):
            try:
                value=self.validate(name)
                states[name]={'exit_code':value['State']['ExitCode'],'running':value['State']['Running'],'oom_killed':value['State']['OOMKilled'],'restart_count':value['RestartCount']}
            except BaseException:failures.append('container')
        private_json(self.run/'states.json',states)
        # The state witness precedes every deletion. Dependency shutdown cannot
        # retroactively turn required live roles into expected exited roles.
        for name,cid in list(self.containers.items()):
            try:
                self.validate(name)
                self.engine.call(['rm','-f',cid],timeout=5)
            except BaseException:failures.append('container')
        for real,nid in self.networks.items():
            try:
                current=self.engine.inspect('network',nid);self.owned_labels(current['Labels'])
                need(current['Id']==nid and current['Name']==real and not current['Containers'],'cleanup_network_identity')
                self.engine.call(['network','rm',nid],timeout=5)
            except BaseException:failures.append('network')
        for real,identity in self.volumes.items():
            try:
                current=self.engine.inspect('volume',real);self.owned_labels(current['Labels'])
                need(all(current[k]==v for k,v in identity.items()),'cleanup_volume_identity')
                self.engine.call(['volume','rm',real],timeout=5)
            except BaseException:failures.append('volume')
        for args in (['ps','-aq'],['volume','ls','-q'],['network','ls','-q']):
            try:need(not self.engine.call([*args,'--filter','label=inside.monitoring.nonce='+self.nonce]).strip(),'owned_residue')
            except BaseException:failures.append('residue')
        private_json(self.run/'cleanup.json',{'passed':not failures,'failed_operations':failures,
            'exact_containers':len(self.containers),'exact_volumes':len(self.volumes),'exact_networks':len(self.networks)})
        return not failures


def verify_packet():
    lock=json.loads((CONFIG/'inputs.lock.json').read_text())
    for name,expected in lock['config_sha256'].items():
        need(digest(CONFIG/name)==expected,'source_configuration_changed')
    need(set(BUDGETS)==set(ROLE_IMAGES),'complete_role_budget_coverage')
    repositories=[row['repository'].split('/')[-1] for row in lock['images']]
    need(len(repositories)==len(set(repositories)) and set(repositories)==set(ROLE_IMAGES.values()),'complete_role_image_coverage')
    need(abs(sum(v[0] for v in BUDGETS.values())-CPU_LIMIT)<1e-9,'aggregate_cpu')
    need(sum(v[1] for v in BUDGETS.values())*1024**2==MEM_LIMIT,'aggregate_memory')
    return lock


def stage(run, name):
    private_json(run/'phase.json',{'phase':name,'monotonic':time.monotonic()})


def canonical_ref(value):
    value=value.removeprefix('docker.io/').removeprefix('library/')
    return value

def proof_for(engine,row):
    if not hasattr(engine,'image_proofs'):
        try:engine.image_proofs=image_proof.load(CONFIG/'oci',verify_packet())
        except image_proof.ProofError:raise Refusal(ImageAdmissionReason.IMAGE_PROOF_INVALID) from None
    proof=engine.image_proofs.get(row['pinned'])
    need(proof is not None and proof.child==row['linux_amd64_manifest'] and proof.runtime_reference==image_proof.runtime_reference(row),ImageAdmissionReason.IMAGE_PROOF_INVALID)
    return proof


def acquire_image(engine,row):
    proof=proof_for(engine,row)
    engine.call(['pull','--platform','linux/amd64',proof.runtime_reference],timeout=180)


def require_child_descriptor(value,proof):
    need(type(value) is dict,ImageAdmissionReason.SELECTED_IMAGE_DESCRIPTOR)
    need(value.get('mediaType')==proof.descriptor['mediaType'],ImageAdmissionReason.SELECTED_IMAGE_MEDIA_TYPE)
    need(value.get('digest')==proof.child,ImageAdmissionReason.SELECTED_IMAGE_CHILD)
    need(type(value.get('size')) is int and value['size']==proof.descriptor['size'],ImageAdmissionReason.SELECTED_IMAGE_SIZE)
    if 'platform' in value:
        platform_value=value['platform']
        need(type(platform_value) is dict and set(platform_value)<= {'os','architecture','variant'} and platform_value.get('os')=='linux' and platform_value.get('architecture')=='amd64',ImageAdmissionReason.SELECTED_IMAGE_PLATFORM)
        need(platform_value.get('variant') is None,ImageAdmissionReason.SELECTED_IMAGE_VARIANT)


def image_identity(value,proof):
    need(type(value) is dict and value.get('Os')=='linux' and value.get('Architecture')=='amd64' and value.get('Variant') in (None,''),ImageAdmissionReason.IMAGE_PLATFORM)
    present='Descriptor' in value
    if present:require_child_descriptor(value['Descriptor'],proof)
    if value.get('Id')==proof.config_digest:relation='config_id'
    elif value.get('Id')==proof.child:
        need(present,ImageAdmissionReason.SELECTED_IMAGE_DESCRIPTOR);relation='child_id'
    else:raise Refusal(ImageAdmissionReason.SELECTED_IMAGE_IDENTITY)
    config=value.get('Config')
    need(type(config) is dict and all((config.get(key) or None)==(proof.config.get(key) or None) for key in ('Entrypoint','Cmd','WorkingDir','User')),ImageAdmissionReason.IMAGE_CONFIGURATION_IDENTITY)
    need(value.get('RootFS')=={'Type':'layers','Layers':list(proof.diff_ids)},ImageAdmissionReason.IMAGE_CONFIGURATION_IDENTITY)
    declared=config.get('Volumes')
    need(declared is None or type(declared) is dict and all(type(k) is str and k.startswith('/') and v=={} for k,v in declared.items()),ImageAdmissionReason.DECLARED_IMAGE_VOLUME_SHAPE)
    need(tuple(sorted(declared or {}))==proof.volume_paths,ImageAdmissionReason.DECLARED_IMAGE_VOLUME_CONTRACT)
    repos=value.get('RepoDigests')
    need(type(repos) is list and all(type(r) is str for r in repos) and any(canonical_ref(r)==canonical_ref(proof.runtime_reference) for r in repos),ImageAdmissionReason.IMAGE_INDEX_IDENTITY)
    return relation


def checked_image(engine, row, arch):
    child=row['linux_'+arch+'_manifest'];need(type(child) is str and re.fullmatch('sha256:[a-f0-9]{64}',child) is not None,ImageAdmissionReason.LOCKED_CHILD_REQUIRED)
    need(arch=='amd64',ImageAdmissionReason.IMAGE_PLATFORM)
    proof=proof_for(engine,row)
    selected=image_proof.decode(engine.call(['image','inspect',proof.runtime_reference]))
    need(type(selected) is list and len(selected)==1,ImageAdmissionReason.IMAGE_PLATFORM)
    selected=selected[0];relation=image_identity(selected,proof)
    attached=engine.inspect('image',proof.runtime_reference)
    attached_relation=image_identity(attached,proof)
    need(attached['Id']==selected['Id'] and attached_relation==relation,ImageAdmissionReason.IMAGE_ATTACHMENT_IDENTITY)
    return {'entrypoint':selected['Config'].get('Entrypoint'),'reference':proof.reference,
        'runtime_reference':proof.runtime_reference,'config_digest':proof.config_digest,
        'image_id':attached['Id'],'selected_image_id':selected['Id'],'architecture':arch,
        'child_manifest':child,'relation':relation,'image_descriptor_available':'Descriptor' in selected,
        'declared_volume_paths':list(proof.volume_paths)}


def inspect_images(engine, lock, *, acquire=False):
    admitted={}
    for row in lock['images']:
        arch='amd64'
        if acquire:
            acquire_image(engine,row)
        admitted[row['repository'].split('/')[-1]]=checked_image(engine,row,arch)
    need(set(admitted)==set(ROLE_IMAGES.values()),'complete_admitted_image_coverage')
    return {service:dict(admitted[repo]) for service,repo in ROLE_IMAGES.items()}


def require_declared_volume_coverage(plan, images):
    for name,binding in images.items():
        service=plan['services'][name]
        for target in binding['declared_volume_paths']:
            mounts=[v for v in service.get('volumes',[]) if v['target']==target]
            need(len(mounts)==1 and mounts[0]['type']=='volume' and mounts[0]['source'] in plan['volumes'],ImageAdmissionReason.DECLARED_IMAGE_VOLUME_COVERAGE)
    return {'validated_roles':len(images),'owned_volume_count':len(plan['volumes']),
        'image_volume_paths':{name:binding['declared_volume_paths'] for name,binding in images.items()}}


def host_snapshot(engine, run):
    if engine.identity.get('backing'):
        value=orbstack.host_snapshot(engine.identity,[run,ROOT])
        for row in value['filesystems'].values():
            row['free_fraction']=row['free_bytes']/row['total_bytes']
        return value
    paths=[Path(engine.identity['storage']),run,ROOT];filesystems={}
    for path in paths:
        value=path.stat();usage=shutil.disk_usage(path)
        filesystems[str(value.st_dev)]={'total_bytes':usage.total,'free_bytes':usage.free,'free_fraction':usage.free/usage.total}
    return {'filesystems':filesystems,'allocated_image_bytes':0}


def check_host(initial, current):
    need(initial['filesystems'].keys()==current['filesystems'].keys(),'host_filesystem_changed')
    for key,value in current['filesystems'].items():
        before=initial['filesystems'][key]
        need(before['total_bytes']==value['total_bytes'],'host_capacity_changed')
        storage_policy.assert_budget(before['free_bytes'],value['free_bytes'])
        need(value['total_bytes']>0 and 0<=value['free_bytes']<=value['total_bytes'],'host_disk_counters')
    need(current['allocated_image_bytes']-initial['allocated_image_bytes']<4*GIB-storage_policy.STOP_MARGIN_BYTES,'backing_growth')


def vm_sample(owned):
    value=json.loads(owned.exec(['disk'],timeout=3))
    need(type(value) is dict and set(value)=={'fsid','device','block','blocks','available','files','free_files'},'vm_sample_shape')
    need(all(type(x) is int for x in value.values()),'vm_counter_type')
    need(0<value['block']<=GIB and 0<value['blocks']*value['block']<=2**64-1 and 0<=value['available']<=value['blocks'],'vm_counter_range')
    need((value['files']==0 and value['free_files']==0) or (value['files']>0 and 0<value['free_files']<=value['files']),'vm_inode_range')
    value['free_fraction']=value['available']/value['blocks']
    value['inode_capacity']='reported' if value['files']>0 else 'native_not_reported'
    value['free_inode_fraction']=value['free_files']/value['files'] if value['files']>0 else None
    return value


def check_vm(initial, current):
    need(all(current[k]==initial[k] for k in ('fsid','device','block')),'vm_storage_identity')
    free=current['available']*current['block'];before=initial['available']*initial['block']
    storage_policy.assert_budget(before,free)
    initial_unavailable=(initial['blocks']-initial['available'])*initial['block']
    current_unavailable=(current['blocks']-current['available'])*current['block']
    if current_unavailable-initial_unavailable>=storage_policy.GROWTH_BYTES-storage_policy.STOP_MARGIN_BYTES:
        raise storage_policy.StorageBudgetExceeded('growth')
    need((current['files']==0 and current['free_files']==0) or (current['files']>0 and 0<current['free_files']<=current['files']),'vm_inodes_exhausted')


@contextmanager
def storage_guard(engine, owned, run):
    initial=host_snapshot(engine,run)
    private_json(run/'disk-host-initial.json',{'sample':initial,'scope':'actual before functional-smoke admission; fractions are diagnostics'})
    for row in initial['filesystems'].values():
        need(storage_policy.admission(total=row['total_bytes'],free=row['free_bytes'])['ready'],'host_disk_admission')
    stop=threading.Event();failed=[];latest={'host':initial};vm_initial=[None];disk_binding=[None]
    def monitor():
        while not stop.wait(.25):
            try:
                current=host_snapshot(engine,run);check_host(initial,current);latest['host']=current
                if vm_initial[0] is not None:
                    current=vm_sample(owned)
                    fields=('fsid','device','block','blocks','available','files','free_files')
                    previous_vm=latest.get('vm',vm_initial[0])
                    snapshot={'initial':{k:vm_initial[0][k] for k in fields},
                        'previous_accepted':{k:previous_vm[k] for k in fields},
                        'rejected_candidate':{k:current[k] for k in fields},
                        'changed_from_initial':[k for k in fields if current[k]!=vm_initial[0][k]],
                        'changed_from_previous':[k for k in fields if current[k]!=previous_vm[k]],
                        'identity_fields':['fsid','device','block'],'parent_disk_input_binding':disk_binding[0]}
                    try:check_vm(vm_initial[0],current)
                    except BaseException:
                        descriptor=os.open(run/'disk-vm-first-rejected.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                        with os.fdopen(descriptor,'w') as stream:
                            json.dump(snapshot,stream,separators=(',',':'),allow_nan=False);stream.write('\n')
                        raise
                    latest['vm']=current
            except BaseException as error:
                if stop.is_set() and isinstance(error,Refusal) and error.reason=='monitor_stopping':
                    return
                failed.append({'category':type(error).__name__,'reason':error.reason if isinstance(error,Refusal) else error.reason if isinstance(error,storage_policy.StorageBudgetExceeded) else 'counter_or_identity_unavailable'})
                if not stop.is_set():
                    os.kill(os.getpid(),signal.SIGUSR1)
                return
    engine.monitor_stop=stop
    thread=threading.Thread(target=monitor,name='owned-signoz-storage',daemon=False)
    thread.start()
    def admit_vm():
        first=vm_sample(owned)
        private_json(run/'disk-vm-initial.json',{'sample':first,'scope':'actual before functional-smoke admission; fractions are diagnostics'})
        need(storage_policy.admission(total=first['blocks']*first['block'],free=first['available']*first['block'])['ready'],'vm_disk_admission')
        check_vm(first,first)
        disk_binding[0]={'controller_sha256':digest(Path(__file__)),'lock_sha256':digest(CONFIG/'inputs.lock.json'),
            'native_helper_input_sha256':digest(run/'driver/inside.py'),
            'initial_vm_input_sha256':digest(run/'disk-vm-initial.json'),
            'storage_policy_sha256':digest(POLICY/'storage_policy.py'),'trusted_orbstack_sha256':digest(POLICY/'orbstack.py'),
            'disk_cid':owned.containers['disk'],'disk_selected_child':owned.images['disk']['child_manifest'],
            'disk_attachment_image':owned.images['disk']['image_id'],'daemon_id':engine.identity['daemon_id']}
        vm_initial[0]=first;latest['vm']=first
        private_json(run/'disk-admission.json',{'host':initial,'vm':first,'scope':'functional control soft stopping guard, not disk quota'})
    try:yield admit_vm
    finally:
        stop.set();engine.cancel_children();thread.join(timeout=8)
        need(not thread.is_alive(),'monitor_not_reaped')
        private_json(run/'disk-last.json',{'initial_host':initial,'initial_vm':vm_initial[0],
            'latest':latest,'monitor_failed':bool(failed),'failure':failed})
        need(not failed,'storage_monitor_failed')


def write_private_files(run,lock):
    private=run/'private';driver=run/'driver'
    for path in (private,driver,run/'agent-driver',run/'agent-admission'):path.mkdir(mode=0o700)
    for name in ('inside.py','control.py','metric_recipe.py','functional_witness.py','gateway.py','agent_probe.py'):
        shutil.copyfile(HERE/name,driver/name);(driver/name).chmod(0o600)
    shutil.copyfile(HERE/'agent_probe.py',run/'agent-driver/agent_probe.py');(run/'agent-driver/agent_probe.py').chmod(0o600)
    for name in ('ingester.yaml','opamp.yaml','keeper-0.yaml','functions.yaml'):
        shutil.copyfile(CONFIG/name,private/name);(private/name).chmod(0o600)
    # JSON is valid YAML. Config file URI is the pinned CLI --config, not an assumed env flag.
    password=secrets.token_hex(32)
    (private/'pg-password').write_text(password);(private/'pg-password').chmod(0o600)
    private_json(private/'signoz.yaml',{'sqlstore':{'provider':'postgres',
        'postgres':{'dsn':'postgres://signoz:'+password+'@signoz-metastore-postgres-0:5432/signoz?sslmode=disable'}},
        'analytics':{'enabled':False},'statsreporter':{'enabled':False}})
    # Official config retains all features; seven positive worker pool sizes fit the unchanged pids128 fixture.
    original=(CONFIG/'config-0-0.yaml').read_text()
    original=original.replace('path: config-0-0.yaml','path: /config/config-0-0.yaml')
    original=original.replace("user_defined_executable_functions_config: '*functions.yaml'","user_defined_executable_functions_config: '/config/functions.yaml'")
    need('background_schedule_pool_size' not in original,'one_absent_pool_configuration')
    original+='\nbackground_schedule_pool_size: 4\nbackground_buffer_flush_schedule_pool_size: 4\nbackground_message_broker_schedule_pool_size: 4\nbackground_distributed_schedule_pool_size: 4\nbackground_move_pool_size: 2\nbackground_fetches_pool_size: 2\nbackground_common_pool_size: 2\n'
    (private/'config-0-0.yaml').write_text(original);(private/'config-0-0.yaml').chmod(0o600)


def histogram_asset(run,lock,*,acquire):
    path=run/'private/histogram.tar.gz'
    if acquire:
        request=urllib.request.Request(lock['histogram']['url'],headers={'User-Agent':'platform-owned-compatibility-control'})
        with urllib.request.urlopen(request,timeout=30) as response:
            payload=response.read(16*1024**2+1)
        need(len(payload)<=16*1024**2,'histogram_archive_size')
        need(hashlib.sha256(payload).hexdigest()==lock['histogram']['archive_sha256'],'histogram_archive_digest')
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as target:target.write(payload)
    need(path.is_file() and not path.is_symlink() and digest(path)==lock['histogram']['archive_sha256'],'histogram_archive_required')
