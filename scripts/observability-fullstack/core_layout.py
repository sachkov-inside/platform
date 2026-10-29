"""Two fixed private layout contracts. No acquisition, worker or nested supervisor."""
from dataclasses import dataclass
import copy
import hashlib
import importlib.util
import json
import math
import os
import stat
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
PRIMARY='primary-v1'
SIGNOZ='signoz-mcp512-v1'
CORES=(PRIMARY,SIGNOZ)
PROFILE='representative-signoz-mcp512-v1'
OWNER='monitoring-1566-representative'
VENDOR=('metrics','logs','traces','grafana','vmauth','gateway','horizon')
PRIMARY_VOLUMES=('metrics','logs','traces','grafana')
APP_VOLUMES=('application-database','broker-data','caddy-data','caddy-config')
NETWORKS=('pilot','ingress','storage','telemetry','hostsource','loopback')
BACKENDS=('api','mcp','material-assets-worker','profile-avatars-worker','video-deletions-worker','billing-worker','notifications-worker')
# Includes stopped init/migration jobs and every observer, not only live app roles.
BASE_MEMORY={**dict.fromkeys(BACKENDS,512),'web':512,'postgres':512,'migrations':512,
    'broker-config':512,'rabbitmq':768,'telegram':512,'telegram-migrations':512,
    'logto':768,'logto-migrations':768,'caddy':256,'provider':96,'loadgen':96,'bot-provider':96,
    'metrics':768,'logs':768,'traces':768,'grafana':512,'vmauth':128,'gateway':128,'horizon':128,
    'alloy':512,'host-agent':512,'umami':1024,'umami-ingest':64,'umami-query':64,'volume-reader':64}
BASE_CPU={**dict.fromkeys(BASE_MEMORY,1),**dict.fromkeys(('metrics','logs','traces'),.4),
    'alloy':.25,'host-agent':.25,'grafana':.25,'vmauth':.1,'gateway':.1,'horizon':.1,
    'provider':.25,'bot-provider':.25,'loadgen':2,'caddy':.5,'umami-ingest':.1,'umami-query':.25,'volume-reader':.25}


def need(ok,reason):
    if not ok:raise ValueError(reason)


def selected(core):
    need(type(core) is str and core in CORES,'representative_core')
    return core


def require_runtime(core):
    if selected(core)!=PRIMARY:raise ValueError('representative_signoz_runtime_unavailable')


def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def signoz_lifecycle():
    # A single source-fixed constructor, not a plugin or caller-supplied module path.
    name='_fullstack_signoz_lifecycle'
    if name not in sys.modules:
        directory=ROOT/'scripts/observability-signoz'
        spec=importlib.util.spec_from_file_location(name,directory/'lifecycle.py')
        module=importlib.util.module_from_spec(spec)
        sys.path.insert(0,str(directory))
        try:spec.loader.exec_module(module)
        finally:sys.path.remove(str(directory))
        sys.modules[name]=module
    return sys.modules[name]


def memory(value):
    need(type(value) is str and re.fullmatch(r'[1-9][0-9]*[mg]',value) is not None,'representative_memory')
    return int(value[:-1])*(1024**2 if value[-1]=='m' else 1024**3)


def baseline(plan,images,source):
    need(type(plan) is dict and set(plan)=={'services','networks','volumes'},'representative_plan')
    need(type(plan['services']) is dict and set(plan['services'])==set(BASE_MEMORY),'representative_primary_roles')
    need(plan['volumes']=={role:{} for role in (*PRIMARY_VOLUMES,*APP_VOLUMES)},'representative_primary_volumes')
    networks=plan['networks']
    need(type(networks) is dict and set(networks)==set(NETWORKS),'representative_primary_networks')
    need(networks['pilot']==networks['storage']==networks['hostsource']=={'internal':True}
        and networks['ingress']=={'driver':'bridge','internal':False} and networks['loopback']=={}
        and type(networks['telemetry']) is dict and set(networks['telemetry'])=={'internal','name'}
        and networks['telemetry']['internal'] is True
        and re.fullmatch(r'inside-observability-full-[a-f0-9]{12}-telemetry',networks['telemetry']['name']) is not None,'representative_primary_networks')
    need(type(images) is dict and set(images)=={'schema','source','owner','backend','foundation','web','telegram','logto'}
         and type(images['schema']) is int and images['schema']==3 and images['source']==source['commit']
         and type(images['owner']) is str and re.fullmatch(r'inside-platform-production-smoke-cache-[a-z0-9][a-z0-9-]{0,80}',images['owner']) is not None,'representative_images')
    need(all(type(images[k]) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',images[k]) is not None for k in ('backend','foundation','web','telegram','logto')),'representative_images')
    app_images={**dict.fromkeys((*BACKENDS,'migrations','broker-config','provider','loadgen','bot-provider'),images['backend']),
        'postgres':images['foundation'],'web':images['web'],'telegram':images['telegram'],'telegram-migrations':images['telegram'],
        'logto':images['logto'],'logto-migrations':images['logto']}
    pins=json.loads((ROOT/'infra/observability/pilot/inputs.lock.json').read_text())['images']
    analytics=json.loads((ROOT/'infra/observability/umami/inputs.lock.json').read_text())['images']
    expected={**app_images,**{r:pins[r] for r in (*VENDOR,'alloy') if r!='horizon'},'horizon':pins['metrics'],
        'host-agent':pins['alloy'],'caddy':pins['gateway'],'rabbitmq':'ghcr.io/sachkov-inside/rabbitmq:4.2.4-alpine@sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47','umami':analytics['umami'],
        'umami-ingest':pins['gateway'],'umami-query':analytics['python'],'volume-reader':analytics['python']}
    for role,service in plan['services'].items():
        need(type(service) is dict and service.get('image')==expected[role] and service.get('pull_policy')=='never','representative_image_pin')
        need(memory(service.get('mem_limit'))==BASE_MEMORY[role]*1024**2,'representative_primary_budget')
        need(type(service.get('cpus')) in (str,int,float) and not isinstance(service.get('cpus'),bool)
            and math.isfinite(float(service['cpus'])) and float(service['cpus'])==BASE_CPU[role],'representative_primary_cpu')
        need(not any(k in service for k in ('deploy','extends','scale','memswap_limit','mem_reservation','cpu_quota','cpu_period','cpuset','cgroup_parent','labels')),'representative_hidden_override')


@dataclass(frozen=True,repr=False)
class Layout:
    """Private immutable snapshot; reads return copies, validation grants no runtime authority."""
    _plan:str
    _manifest:str
    _files:str='{}'

    @property
    def plan(self):return json.loads(self._plan)

    @property
    def manifest(self):return json.loads(self._manifest)

    @property
    def files(self):return json.loads(self._files)

    def prepare_inputs(self):
        """Materialize only fresh private files; no lease, Docker or runtime acquisition."""
        import signoz_ingestion
        manifest=self.manifest;files=self.files
        need(manifest['core']==SIGNOZ and set(files)=={'edge.alloy','host.alloy'},'representative_generated_files')
        need(manifest['generator_inputs']==signoz_ingestion.input_hashes(),'representative_generated_source')
        need(manifest['generated_files']=={name:hashlib.sha256(text.encode()).hexdigest() for name,text in files.items()},'representative_generated_files')
        run=Path(manifest['root']);need(run.is_dir() and run==run.resolve(),'representative_root')
        info=run.stat();need({'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid}==manifest['root_identity'],'representative_root')
        directory=run/'representative-ingestion';directory.mkdir(mode=0o700)
        own=directory.stat();created={}
        try:
            for name,text in files.items():
                target=directory/name
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                info=os.fstat(fd);created[name]=(info.st_dev,info.st_ino)
                with os.fdopen(fd,'wb') as stream:stream.write(text.encode());stream.flush();os.fsync(stream.fileno())
            return directory
        except BaseException:
            for name,identity in created.items():
                target=directory/name
                if target.exists() and not target.is_symlink():
                    info=target.stat()
                    if stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==identity:target.unlink()
            if not directory.is_symlink() and directory.is_dir() and not any(directory.iterdir()):
                info=directory.stat()
                if (info.st_dev,info.st_ino)==(own.st_dev,own.st_ino):directory.rmdir()
            raise

    def validate(self,candidate,manifest=None):
        if manifest is not None:need(encoded(manifest)==self._manifest,'representative_manifest_mismatch')
        need(encoded(candidate)==self._plan,'representative_layout_mismatch')


def construct(primary,core,*,run,source,images,project,nonce,uid,gid):
    selected(core)
    need(type(source) is dict and set(source)=={'commit','tree'}
        and all(type(v) is str and re.fullmatch(r'[a-f0-9]{40}',v) is not None for v in source.values()),'representative_source')
    need(isinstance(run,Path) and run.is_absolute() and run==run.resolve() and run.is_dir(),'representative_root')
    root_info=run.stat()
    need(root_info.st_uid==os.getuid() and not root_info.st_mode&0o022,'representative_root')
    need(type(project) is str and re.fullmatch(r'inside-observability-representative-[a-f0-9]{12}',project) is not None,'representative_project')
    need(type(nonce) is str and re.fullmatch(r'[a-f0-9]{32}',nonce) is not None,'representative_nonce')
    need(all(type(v) is int and 0<=v<2**31 for v in (uid,gid)),'representative_uid')
    baseline(primary,images,source)
    plan=copy.deepcopy(primary)
    sig_roles=();sig_volumes=();sig_memory=0;files={};generator_inputs={}
    if core==SIGNOZ:
        need(plan['services']['alloy'].get('networks')=={'storage':{},'telemetry':{'aliases':['inside-telemetry']},'loopback':{}}
            and plan['services']['host-agent'].get('networks')==['hostsource'],'representative_retained_edge_networks')
        lifecycle=signoz_lifecycle()
        canonical=lifecycle.make_plan(run/'signoz',lifecycle.verify_packet()['images'],project,nonce,uid,gid,profile_id=lifecycle.MCP512_PROFILE)
        lifecycle.plan_profile(canonical,lifecycle.MCP512_PROFILE)
        sig_roles=tuple('sig-'+r for r in lifecycle.SERVICES)
        sig_volumes=tuple('sig-'+v for v in lifecycle.VOLUMES)
        for role in VENDOR:del plan['services'][role]
        for volume in PRIMARY_VOLUMES:del plan['volumes'][volume]
        # The edge still joins storage until the separately reviewed ingestion task.
        for role,service in canonical['services'].items():
            value=copy.deepcopy(service);name='sig-'+role
            if 'networks' in value:
                value['networks']={'sig-backend':value['networks']['backend']}
                if role=='mcp':value['networks']['sig-backend']={'aliases':['mcp']}
                if role=='collector':
                    value['networks'].update({network:{'aliases':['inside-signoz-collector']} for network in ('storage','hostsource')})
            for mount in value.get('volumes',[]):
                if mount['type']=='volume':mount['source']='sig-'+mount['source']
            plan['services'][name]=value
        for volume,value in canonical['volumes'].items():
            plan['volumes']['sig-'+volume]={**copy.deepcopy(value),'name':project+'_sig-'+volume}
        plan['networks']['sig-backend']={**copy.deepcopy(canonical['networks']['backend']),'name':project+'_sig-backend'}
        # Same read-only observer, now accounts for ALL candidate and app storage.
        reader=plan['services']['volume-reader']
        reader['volumes']=[reader['volumes'][0],*(name+':/volumes/'+name+':ro' for name in (*APP_VOLUMES,*sig_volumes))]
        sig_memory=lifecycle.resource_profile(lifecycle.MCP512_PROFILE)['aggregate_memory_bytes']
        import signoz_ingestion
        files=signoz_ingestion.attach(plan,run,project,nonce,source)
        generator_inputs=signoz_ingestion.input_hashes()
        labels={'inside.monitoring.owner':OWNER,'inside.monitoring.nonce':nonce,
            'inside.monitoring.source':source['commit'],'inside.monitoring.tree':source['tree'],
            'inside.monitoring.profile':PROFILE,'com.docker.compose.project':project}
        for role,service in plan['services'].items():service['labels']={**labels,'inside.monitoring.service':role}
        for kind in ('volumes','networks'):
            for name,value in plan[kind].items():
                value['labels']=dict(labels)
                # Never reuse the primary monitor's independently generated network name.
                value['name']=project+'_'+name
        plan['name']=project
        plan['x-inside-resource-profile']=PROFILE
    costs={role:{'memory_bytes':memory(service['mem_limit']),'nano_cpus':round(float(service['cpus'])*10**9)} for role,service in plan['services'].items()}
    manifest={'schema':1,'owner':OWNER,'plan_sha256':hashlib.sha256(encoded(plan).encode()).hexdigest(),'core':core,'profile':PROFILE if core==SIGNOZ else PRIMARY,'source':dict(source),
        'root':str(run),'root_identity':{'device':root_info.st_dev,'inode':root_info.st_ino,'uid':root_info.st_uid},'project':project,'nonce':nonce,'uid':uid,'gid':gid,
        'supervisor':{'count':1,'deadline_seconds':600,'cleanup_seconds':90},
        'primary_sha256':hashlib.sha256(encoded(primary).encode()).hexdigest(),
        'roles':costs,'volumes':sorted(plan['volumes']),'networks':sorted(plan['networks']),
        'sig_roles':list(sig_roles),'sig_volumes':list(sig_volumes),'sig_memory_bytes':sig_memory,
        'one_shot_roles':['migrations','broker-config','telegram-migrations','logto-migrations','volume-reader',
            *(['sig-volume-init','sig-histogram-init','sig-migrator'] if core==SIGNOZ else [])],
        'memory_bytes':sum(row['memory_bytes'] for row in costs.values()),'nano_cpus':sum(row['nano_cpus'] for row in costs.values()),
        'runtime_available':core==PRIMARY,
        'generated_files':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in files.items()},
        'generator_inputs':generator_inputs}
    return Layout(encoded(plan),encoded(manifest),encoded(files))
