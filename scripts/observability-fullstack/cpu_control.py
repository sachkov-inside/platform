"""Closed same-runner CPU-policy control. Never a production capacity acceptance."""
import copy
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

PROFILES=('fixture-capped-v1','app-cpu-unlimited-v1')
ROLES=('api','mcp','material-assets-worker','profile-avatars-worker','video-deletions-worker',
       'billing-worker','notifications-worker','web','postgres','rabbitmq','telegram','logto')
IMAGES=('backend','foundation','web','telegram','logto')
KIND='app-cpu-control-v1'
EVENT_MARKER='<!-- monitoring-cpu-control: app-unlimited-v1 -->'
PAIR='cpu-control-pair.json'
MARKER='cpu-control-request.json'
BASELINE='cpu-control-baseline.json'
OWNER='cpu-control-owner.json'
QUOTAS='cpu-control-quotas.json'
OUTCOME='cpu-control-outcome.json'
NAME='fullstack-cpu-control.json'
FILES=(MARKER,BASELINE,OWNER,QUOTAS,NAME)
MAX_BYTES=1_048_576
ACCEPTANCE={'diagnostic_only':True,'capacity':False,'minimum_candidate_gib':None}
CPU_KEYS={'cpu_quota','cpu_period','cpuset','cpu_count','cpu_percent','cpu_shares','deploy'}
STAGES=('not_run','pilot_admission','prepare_inputs','worker')
CATEGORIES=('os_error','command_failed','timeout','interrupted','system_exit','value_error','runtime_error','other')
ERRNOS=('address_in_use','address_unavailable','permission_denied','connection_refused','timed_out','no_space','not_found','other')


def need(ok):
    if not ok:raise ValueError('closed_cpu_control')


def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def present(path):return Path(path).exists() or Path(path).is_symlink()


def directory(path,*,private=True):
    path=Path(path).absolute();need(path==path.resolve())
    info=path.lstat();need(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&(0o077 if private else 0o022))
    return path


def read(path,*,private=True,limit=MAX_BYTES):
    path=Path(path);directory(path.parent,private=False)
    descriptor=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_nlink==1
             and not info.st_mode&(0o077 if private else 0o022) and info.st_size<=limit)
        raw=stream.read(limit+1)
    need(len(raw)<=limit)
    def unique(pairs):
        value={}
        for key,item in pairs:need(key not in value);value[key]=item
        return value
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False))


def write(path,value,*,once=False):
    path=Path(path);directory(path.parent)
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode();need(len(raw)<=MAX_BYTES)
    flags=os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|(os.O_EXCL if once else 0)
    descriptor=os.open(path,flags,0o600)
    with os.fdopen(descriptor,'wb') as stream:
        info=os.fstat(stream.fileno());need(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_nlink==1 and not info.st_mode&0o077)
        stream.truncate();stream.write(raw)


def selector(value):need(type(value) is str and value in PROFILES);return value


def image_set(value):
    need(type(value) is dict and set(value)==set(IMAGES))
    need(all(type(v) is str and re.fullmatch('sha256:[a-f0-9]{64}',v) for v in value.values()))
    return value


def require_event(event,*,head=None,base=None):
    need(type(event) is dict and event.get('action') in ('opened','reopened','synchronize'))
    pr=event.get('pull_request');need(type(pr) is dict)
    need(type(event.get('number')) is int and 0<event['number']<=2**31-1
         and type(pr.get('number')) is int and pr['number']==event['number'] and pr.get('state')=='open'
         and type(event.get('repository')) is dict and event['repository'].get('full_name')=='sachkov-inside/platform')
    for name,expected in (('head',head),('base',base)):
        row=pr.get(name);need(type(row) is dict and type(row.get('sha')) is str and re.fullmatch('[a-f0-9]{40}',row['sha'])
                            and (expected is None or row['sha']==expected))
    need(pr['base'].get('ref')=='main' and type(pr['base'].get('repo')) is dict and pr['base']['repo'].get('full_name')=='sachkov-inside/platform')
    body=pr.get('body');need(type(body) is str and len(body.encode())<=65536)
    # contains() is only a coarse workflow filter. No body fragment becomes an argument.
    need(body.count(EVENT_MARKER)==1 and body.lower().count('<!-- monitoring-cpu-control:')==1
         and '<!-- monitoring-stability:' not in body.lower())


def admission(full,*,scope='full'):
    full.profile(scope)
    full.hosted.context()
    # The provider event can have unrelated fields; only this bounded closed decision is used.
    event=read(Path(os.environ['GITHUB_EVENT_PATH']),private=False,limit=262144)
    require_event(event,head=os.environ['PILOT_PR_HEAD_SHA'],base=os.environ['PILOT_PR_BASE_SHA'])
    need(full.production.select_ci_scope(event)==scope)
    started=float(os.environ['CPU_CONTROL_JOB_STARTED']);need(math.isfinite(started) and 0<=time.monotonic()-started<3600)
    return started


def workload(full,scope):
    full.profile(scope)
    path=full.PROFILE.with_name('technical-profile.json') if scope=='technical' else full.PROFILE
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scope_fields(full,scope):
    full.profile(scope)
    return {'scope':scope,'worker_deadline_seconds':full.stage_timing.SCHEMA2_TECHNICAL_FULL_DEADLINE_SECONDS} if scope=='technical' else {}


def pair(full,root,source,*,scope='full'):
    fields=scope_fields(full,scope)
    root=directory(root);value=read(root/PAIR)
    need(type(value) is dict and set(value)=={'schema','kind','source','root','nonce','profiles','images','workload_sha256'}|set(fields)|({'services'} if fields else set()))
    need(type(value['schema']) is int and value['schema']==(2 if fields else 1) and value['kind']==KIND and value['source']==source
         and re.fullmatch('[a-f0-9]{40}',source) and value['root']==str(root) and value['profiles']==list(PROFILES)
         and type(value['nonce']) is str and re.fullmatch('[a-f0-9]{32}',value['nonce'])
         and value['workload_sha256']==workload(full,scope))
    if fields:need(all(type(value[k]) is type(v) and value[k]==v for k,v in fields.items()) and value['services']==list(full.services(scope)))
    image_set(value['images'])
    return value


def bound_pair(full,root,source):
    value=read(Path(root)/PAIR);need(type(value) is dict)
    scope=value.get('scope','full')
    return scope,pair(full,root,source,scope=scope)


def transform(plan,profile):
    selector(profile);need(type(plan) is dict and type(plan.get('services')) is dict)
    for role in ROLES:
        service=plan['services'].get(role);need(type(service) is dict and not CPU_KEYS.intersection(service))
        expected='1' if role in (*ROLES[:7],'postgres') else 1
        need(type(service.get('cpus')) is type(expected) and service['cpus']==expected)
        need(service.get('mem_limit')==('768m' if role in ('rabbitmq','logto') else '512m'))
    result=copy.deepcopy(plan)
    if profile==PROFILES[1]:
        for role in ROLES:del result['services'][role]['cpus']
    return result


def prepare_plan(full,output,source,plan,*,scope='full'):
    value=pair(full,output.parent,source,scope=scope);profile=selector(output.name)
    need(set(plan['services'])==set(full.services(scope)))
    selected=transform(plan,profile)
    output.chmod(0o700);directory(output)
    write(output/BASELINE,plan,once=True)
    marker={'schema':2 if scope=='technical' else 1,**scope_fields(full,scope),'kind':KIND,'source':source,'profile':profile,'output':digest(str(output)),
            'pair':digest(value),'workload_sha256':value['workload_sha256'],'baseline_sha256':digest(plan),
            'plan_sha256':digest(selected),'roles':list(ROLES)}
    write(output/MARKER,marker,once=True)
    return selected


def expected_request(full,output,source):
    output=directory(output);scope,value=bound_pair(full,output.parent,source);profile=selector(output.name)
    baseline=read(output/BASELINE);plan=transform(baseline,profile)
    expected={'schema':2 if scope=='technical' else 1,**scope_fields(full,scope),'kind':KIND,'source':source,'profile':profile,'output':digest(str(output)),
              'pair':digest(value),'workload_sha256':value['workload_sha256'],'baseline_sha256':digest(baseline),
              'plan_sha256':digest(plan),'roles':list(ROLES)}
    need(set(baseline['services'])==set(full.services(scope)))
    prepared=read(output/'fullstack-source.json',private=False)
    need(prepared['source']==source and prepared.get('scope','full')==scope and prepared['images'].get('scope','full')==scope
         and digest(prepared['profile'])==digest(full.profile(scope))
         and {k:prepared['images'][k] for k in IMAGES}==value['images'])
    if scope=='technical':
        full.prepared_scope(output,expected=scope,source=source)
        need(type(prepared['scope_binding'].get('worker_deadline_seconds')) is int
             and prepared['scope_binding']['worker_deadline_seconds']==scope_fields(full,scope)['worker_deadline_seconds'])
    return expected,plan


def request(full,output,source):
    expected,plan=expected_request(full,output,source);actual=read(output/MARKER)
    need(type(actual) is dict and type(actual.get('schema')) is int and actual==expected)
    if expected.get('scope')=='technical':need(type(actual.get('worker_deadline_seconds')) is int)
    return expected,plan


def owner_binding(full,output,owner,marker):
    need(type(owner) is dict and set(owner)=={'project','cwd','supervisor_pid','docker_storage','orbstack','daemon','cleanup'})
    need(owner['cwd']==str(full.ROOT) and type(owner['supervisor_pid']) is int and owner['supervisor_pid']>0
         and type(owner['project']) is str and re.fullmatch(re.escape(full.PREFIX)+'[a-f0-9]{12}',owner['project']))
    technical=marker.get('scope')=='technical'
    return {'schema':2 if technical else 1,**({'scope_binding':read(output/'fullstack-source.json',private=False)['scope_binding']} if technical else {}),
            'source':marker['source'],'request':digest(marker),'owner':digest(owner),
            'project':owner['project'],'nonce':owner['project'][-12:],'output':marker['output'],
            'profile':marker['profile'],'baseline_sha256':marker['baseline_sha256'],'plan_sha256':marker['plan_sha256']}


def bind_worker(full,output,owner,source):
    marker,plan=request(full,output,source)
    need(read(output/'owner.json',private=False)==owner)
    need(owner['supervisor_pid']==os.getppid() and read(output/'compose.json')==plan)
    need(not any(present(output/name) for name in (full.stability.MARKER,full.stability.NAME)))
    binding=owner_binding(full,output,owner,marker)
    write(output/OWNER,binding,once=True)
    write(output/QUOTAS,{'schema':1,'source':source,'request':digest(marker),'owner':digest(binding),'snapshots':[],'last_ids':{}},once=True)
    return marker


def mode_plan(full,initial,enabled):
    expected=copy.deepcopy(initial)
    expected['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED']='true' if enabled else 'false'
    for role in (*full.BACKENDS,'telegram'):expected['services'][role]['environment']['INSIDE_OTEL_ENABLED']='true' if enabled else 'false'
    for role in (*full.BACKENDS,'web','rabbitmq','postgres','telegram','logto','caddy'):
        expected['services'][role]['logging']=full.production.logging('platform-'+role if role in (*full.BACKENDS,'web','rabbitmq') else role) if enabled else {'driver':'none'}
    return expected


def current_plan(full,output,source,enabled):
    marker,initial=request(full,output,source)
    need(read(output/'compose.json')==mode_plan(full,initial,enabled))
    return marker


PROJECTION='{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"memory":{{json .HostConfig.Memory}},"nano_cpus":{{json .HostConfig.NanoCpus}},"cpu_quota":{{json .HostConfig.CpuQuota}},"cpu_period":{{json .HostConfig.CpuPeriod}},"cpuset_cpus":{{json .HostConfig.CpusetCpus}}}'


def quota_rows(raw,ids,project,profile):
    selector(profile);need(type(raw) is str and len(raw.encode())<=16384)
    from acquisition import decode_json
    values=[decode_json(line) for line in raw.splitlines()];need(len(values)==len(ids)==len(ROLES) and len(set(ids))==len(ROLES))
    found={};identity={}
    for row in values:
        need(type(row) is dict and set(row)=={'id','project','service','running','memory','nano_cpus','cpu_quota','cpu_period','cpuset_cpus'})
        role=row['service'];need(type(role) is str and role in ROLES and role not in found and row['id'] in ids
             and type(row['id']) is str and re.fullmatch('[a-f0-9]{64}',row['id']) and row['project']==project and row['running'] is True)
        numbers=[row[k] for k in ('memory','nano_cpus','cpu_quota','cpu_period')]
        expected=[(768 if role in ('rabbitmq','logto') else 512)*1024**2,1_000_000_000 if profile==PROFILES[0] else 0,0,0]
        # Compose --cpus encodes NanoCpus; missing quota/period/cpuset is never zero.
        need(all(type(v) is int for v in numbers) and numbers==expected and row['cpuset_cpus']=='')
        found[role]=[ROLES.index(role),*numbers,0];identity[role]=row['id']
    need(set(found)==set(ROLES));return [found[role] for role in ROLES],identity


def ledger(full,output,source):
    marker,_=request(full,output,source);owner=read(output/'owner.json',private=False)
    binding=owner_binding(full,output,owner,marker);recorded=read(output/OWNER)
    need(type(recorded) is dict and type(recorded.get('schema')) is int and recorded==binding)
    if marker.get('scope')=='technical':need(type(recorded['scope_binding'].get('worker_deadline_seconds')) is int)
    value=read(output/QUOTAS)
    need(type(value) is dict and set(value)=={'schema','source','request','owner','snapshots','last_ids'}
         and type(value['schema']) is int and value['schema']==1 and value['source']==source
         and value['request']==digest(marker) and value['owner']==digest(binding))
    snapshots=value['snapshots'];need(type(snapshots) is list and len(snapshots)<=5)
    indices=[]
    for snapshot in snapshots:
        need(type(snapshot) is dict and set(snapshot)=={'ordinal','rows'} and type(snapshot['ordinal']) is int)
        indices.append(snapshot['ordinal']);need(type(snapshot['rows']) is list and len(snapshot['rows'])==12)
        for index,row in enumerate(snapshot['rows']):
            expected=[index,(768 if ROLES[index] in ('rabbitmq','logto') else 512)*1024**2,1_000_000_000 if marker['profile']==PROFILES[0] else 0,0,0,0]
            need(type(row) is list and all(type(n) is int for n in row) and row==expected)
    need(indices==list(range(len(indices))) or bool(indices) and indices[-1]==4 and indices[:-1]==list(range(len(indices)-1)))
    identities=value['last_ids'];need(type(identities) is dict)
    need(not snapshots and identities=={} or set(identities)==set(ROLES) and len(set(identities.values()))==12
         and all(type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for v in identities.values()))
    return value,owner,marker


def capture(full,output,compose,source,ordinal,enabled):
    need(type(ordinal) is int and ordinal in range(5) and type(enabled) is bool)
    current_plan(full,output,source,enabled)
    value,owner,marker=ledger(full,output,source)
    indices=[row['ordinal'] for row in value['snapshots']]
    need(ordinal not in indices and (ordinal==len(indices) or ordinal==4))
    deadline=time.monotonic()+2
    def invoke(compose,args):
        remaining=deadline-time.monotonic();need(remaining>0)
        return full.invoke(compose,args,timeout=remaining)
    ids=invoke(compose,['ps','-q',*ROLES]).split()
    need(len(ids)==12 and len(set(ids))==12 and all(re.fullmatch('[a-f0-9]{64}',v) for v in ids))
    rows,identities=quota_rows(invoke(['docker'],['inspect','--format',PROJECTION,*ids]),ids,owner['project'],marker['profile'])
    if ordinal==4:need(identities==value['last_ids'])
    value['snapshots'].append({'ordinal':ordinal,'rows':rows});value['last_ids']=identities
    write(output/QUOTAS,value)


def reject(output):
    if any(present(Path(output)/name) for name in FILES) or present(Path(output).parent/PAIR):need(False)


def cleanup_passed(result):return type(result) is dict and result.get('down')=='passed' and result.get('residue')=='passed'


def validate_owner_plan(full,output,source):
    # The durable owner binding survives removal of the private request marker.
    marker,initial=expected_request(full,output,source)
    owner=read(output/'owner.json',private=False);binding=owner_binding(full,output,owner,marker)
    if present(output/OWNER):
        recorded=read(output/OWNER);need(type(recorded) is dict and type(recorded.get('schema')) is int and recorded==binding)
        if marker.get('scope')=='technical':need(type(recorded['scope_binding'].get('worker_deadline_seconds')) is int)
    else:request(full,output,source)
    current=read(output/'compose.json')
    need(current in (initial,mode_plan(full,initial,False),mode_plan(full,initial,True)))


def worker_cleanup(full,output,source,exit_code):
    directory(output);validate_owner_plan(full,output,source)
    owner=read(output/'owner.json',private=False)
    scope,_=bound_pair(full,output.parent,source)
    deadline=scope_fields(full,scope).get('worker_deadline_seconds',full.pilot.PILOT_DEADLINE_SECONDS)
    worker=read(output/'worker.json',private=False)
    need(type(worker) is dict and set(worker)=={'pid','group','supervisor_pid','deadline_seconds'}
         and type(worker['pid']) is int and worker['pid']>0 and type(worker['group']) is int
         and worker['group']==worker['pid'] and type(worker['supervisor_pid']) is int and worker['supervisor_pid']==owner['supervisor_pid']
         and type(worker['deadline_seconds']) is int and worker['deadline_seconds']==deadline)
    outcome=read(output/'worker-outcome.json',private=False);cleanup=read(output/'cleanup.json',private=False)
    need(type(outcome) is dict and set(outcome)=={'exit_code','duration_seconds','monitor_failed','cleanup'}
         and type(outcome['exit_code']) is int and outcome['exit_code']==exit_code
         and type(outcome['duration_seconds']) in (int,float) and math.isfinite(outcome['duration_seconds'])
         and 0<=outcome['duration_seconds']<=3600 and type(outcome['monitor_failed']) is bool
         and outcome['cleanup']==cleanup)
    return cleanup_passed(cleanup)


def settle_profile(full,stage,output,exit_code):
    # The supervisor already spent its single90s cleanup. Never retry it in the pair.
    if not present(output) or not present(output/'owner.json'):
        stage.release(str(output),cleanup_ok=True);return False
    good=False
    try:
        good=worker_cleanup(full,output,stage.receipt['source'],exit_code)
        return good
    finally:stage.release(str(output),cleanup_ok=good)


def recover_profile(full,stage,output):
    # Never let marker presence, selector or PR body grant cleanup authority.
    if not present(output):
        stage.release(str(output),cleanup_ok=True);return True
    directory(output)
    scope,_=bound_pair(full,output.parent,stage.receipt['source'])
    if scope=='technical':full.prepared_scope(output,expected=scope,source=stage.receipt['source'])
    if not present(output/'owner.json'):
        stage.release(str(output),cleanup_ok=True);return True
    validate_owner_plan(full,output,stage.receipt['source'])
    result=full.resource_runtime.ci.recover(output,project_prefix=full.PREFIX,services=full.services(scope))
    good=cleanup_passed(result);stage.release(str(output),cleanup_ok=good);return good


def profile_context(value,profile):
    selector(profile)
    return {'profile':profile,'context':digest([value['source'],digest(value),value['root'],profile]),
            'stage':'not_run','state':'not_run','prepared':False,'category':None,'errno':None,'exit_code':None}


def failure(error):
    category=('interrupted' if isinstance(error,KeyboardInterrupt) else 'system_exit' if isinstance(error,SystemExit)
              else 'timeout' if isinstance(error,(TimeoutError,subprocess.TimeoutExpired))
              else 'command_failed' if isinstance(error,subprocess.CalledProcessError)
              else 'os_error' if isinstance(error,OSError) else 'value_error' if isinstance(error,ValueError)
              else 'runtime_error' if isinstance(error,RuntimeError) else 'other')
    code=None
    if category=='os_error':
        number=OSError.errno.__get__(error,OSError)
        if type(number) is int:
            code=({errno.EADDRINUSE:'address_in_use',errno.EADDRNOTAVAIL:'address_unavailable',
                   errno.EACCES:'permission_denied',errno.EPERM:'permission_denied',
                   errno.ECONNREFUSED:'connection_refused',errno.ETIMEDOUT:'timed_out',
                   errno.ENOSPC:'no_space',errno.ENOENT:'not_found'}).get(number,'other')
    return {'category':category,'errno':code}


def checked_context(entry,value,profile,exit_code):
    expected=profile_context(value,profile)
    need(type(entry) is dict and set(entry)==set(expected) and entry['profile']==profile
         and entry['context']==expected['context'] and type(entry['stage']) is str and entry['stage'] in STAGES
         and type(entry['prepared']) is bool and entry['exit_code']==exit_code
         and (entry['exit_code'] is None or type(entry['exit_code']) is int))
    if entry['state']=='not_run':need(entry==expected)
    else:
        need(entry['stage']!='not_run' and type(exit_code) is int and -255<=exit_code<=255
             and (entry['stage']!='pilot_admission' or not entry['prepared']))
        if entry['state']=='returned':need(exit_code==0 and entry['stage']=='worker' and entry['category'] is None and entry['errno'] is None)
        else:
            need(entry['state']=='failed' and exit_code!=0 and type(entry['category']) is str and entry['category'] in CATEGORIES
                 and (entry['errno'] is None or type(entry['errno']) is str and entry['errno'] in ERRNOS)
                 and (entry['category']=='os_error' or entry['errno'] is None))
    return entry


def run_pair(full,root,images,metadata,*,scope='full'):
    fields=scope_fields(full,scope)
    deadline=full.worker_deadline(scope)
    allowance=deadline+full.pilot.CLEANUP_TIMEOUT_SECONDS
    started=admission(full,**({'scope':scope} if fields else {}));source,disk=full.hosted.metadata_source(metadata);need(disk['ready'])
    root=Path(root).absolute();need(root==root.resolve() and not present(root))
    directory(root.parent,private=False)
    pins=read(images);need(pins['source']==source['checkout_sha'] and pins.get('scope','full')==scope)
    need(set(pins)=={'schema','source','owner',*IMAGES}|({'scope'} if fields else set()) and type(pins['schema']) is int and pins['schema']==3)
    selected=image_set({k:pins[k] for k in IMAGES})
    stage=full.preparation.recover_stage(images);need(stage.receipt['source']==source['checkout_sha'])
    capped,uncapped=(root/profile for profile in PROFILES)
    with stage.in_use():
        stage.require_consumer(str(capped));stage.retain(str(uncapped),'second CPU-control profile')
        root.mkdir(mode=0o700)
        import secrets
        value={'schema':2 if fields else 1,**fields,**({'services':list(full.services(scope))} if fields else {}),
               'kind':KIND,'source':source['checkout_sha'],'root':str(root),'nonce':secrets.token_hex(16),
               'profiles':list(PROFILES),'images':selected,'workload_sha256':workload(full,scope)}
        write(root/PAIR,value,once=True)
        result={'schema':4 if fields else 3,**fields,'source':source['checkout_sha'],'pair':digest(value),'exits':[None,None],'cleanup':[False,False],
                'publication_failed':False,'profiles':[profile_context(value,profile) for profile in PROFILES]}
        first_error=None
        def remember(error):
            nonlocal first_error
            if first_error is None:first_error=error
        def publish(*,once=False):
            try:write(root/OUTCOME,result,once=once)
            except BaseException as error:
                result['publication_failed']=True;remember(error)
        publish(once=True)
        for index,output in enumerate((capped,uncapped)):
            if result['publication_failed'] or index and not result['cleanup'][0]:break
            # Full per-profile worker+cleanup allowance must remain inside the same60min job.
            if not 0<=time.monotonic()-started<=3600-allowance:break
            try:
                stage.require_consumer(str(output));full.hosted.metadata_source(metadata)
                need(read(images)==pins)
            except BaseException as error:
                remember(error)
                break
            observed=result['profiles'][index];observed['stage']='pilot_admission'
            def prepare(path):
                observed['stage']='prepare_inputs'
                full.inputs(path,images,**({'scope':scope} if fields else {}))
                need(0<=time.monotonic()-started<=3600-allowance)
                observed['prepared']=True
            try:
                full.pilot.run(output,prepare_inputs=prepare,worker_script=Path(__file__).resolve(),
                    ports=(18427,13000,14318,1514,13301),services=full.services(scope),project_prefix=full.PREFIX,
                    scope='CPU-policy diagnostic only; not capacity acceptance',missing=['production capacity and seven days'],worker_pass_fds=stage.pass_fds(),
                    **({'worker_deadline_seconds':deadline} if fields else {}))
                result['exits'][index]=0
                observed.update(stage='worker',state='returned',exit_code=0)
            except BaseException as error:
                code=error.returncode if isinstance(error,subprocess.CalledProcessError) else 130 if isinstance(error,KeyboardInterrupt) else 1
                result['exits'][index]=code if type(code) is int and -255<=code<=255 else 1
                remember(error)
                observed.update(state='failed',exit_code=result['exits'][index],**failure(error))
                if isinstance(error,subprocess.CalledProcessError) and error.cmd=='observability pilot worker':observed['stage']='worker'
            finally:
                # Publication is never allowed to skip or mask mandatory settlement.
                publish()
                try:result['cleanup'][index]=settle_profile(full,stage,output,result['exits'][index])
                except BaseException as error:remember(error)
                finally:publish()
            if isinstance(first_error,(KeyboardInterrupt,SystemExit)):break
        # Never-started consumers have no acquired project to recover.
        for index,output in enumerate((capped,uncapped)):
            if result['exits'][index] is None:
                try:recover_profile(full,stage,output)
                except BaseException as error:remember(error)
        if result['publication_failed']:publish()  # Persist failure state, never retry a profile/cleanup.
        if first_error is not None:raise first_error
        need(result['exits']==[0,0] and result['cleanup']==[True,True])


def recover_pair(full,root,images,*,scope='full'):
    full.profile(scope)
    root=Path(root).absolute();need(root==root.resolve())
    if present(root):
        value=read(root/PAIR);need(type(value) is dict)
        pair(full,root,value.get('source'),scope=scope)
    if not full.preparation.directory(images).exists():
        need(not present(root));return
    stage=full.preparation.recover_stage(images)
    if present(root):need(stage.receipt['source']==value['source'])
    with stage.in_use():
        for profile in PROFILES:
            output=root/profile;key=full.preparation.consumer_key(str(output))
            if present(stage.path/('retain-'+key+'.json')):recover_profile(full,stage,output)


def verdict(value):
    need(type(value) is dict)
    basic={'state','minimum_candidate_gib'}
    full=basic|{'measured_peak_host_used_bytes','required_bytes_with_25pct_reserve'}
    need(set(value) in (basic,full) and value['state'] in ('passed','failed','incomplete')
         and (value['minimum_candidate_gib'] is None or type(value['minimum_candidate_gib']) is int and value['minimum_candidate_gib'] in (4,8)))
    if set(value)==basic:need(value=={'state':'incomplete','minimum_candidate_gib':None})
    else:need(all(type(value[k]) in (int,float) and math.isfinite(value[k]) and 0<=value[k]<=2**53-1 for k in full-basic))
    return value


LABELS=('web_home','web_material','api_catalog','api_account','telegram_webhook','logto_discovery')
CFS=('cpu_total_ns','cpu_periods','cpu_throttled_periods','cpu_throttled_ns')
PHASE_ERRORS={'process_replaced_or_oom','sampler_failed','fixture_loadgen_cpu_throttled','fixture_loadgen_cpu_unavailable','counter_missing'}


def number(value,*,lower=0,upper=2**53-1,nullable=False):
    need(nullable and value is None or type(value) in (int,float) and math.isfinite(value) and lower<=value<=upper)
    return value


def assessment(value):
    fields={'complete','oom','enospc','unexplained_loss','query_max_seconds','ingestion_lag_seconds',
            'http_p95_overhead_percent','additional_host_cpu_fraction','minimum_host_memory_free_fraction',
            'minimum_host_disk_free_fraction','peak_host_used_bytes'}
    need(type(value) is dict and set(value)==fields)
    for key in ('complete','oom','enospc'):need(type(value[key]) is bool)
    for key in fields-{'complete','oom','enospc'}:
        number(value[key],lower=-100 if key=='http_p95_overhead_percent' else 0,
               upper=1 if key.endswith('_fraction') else 2**53-1,nullable=True)
    if value['unexplained_loss'] is not None:need(type(value['unexplained_loss']) is int)
    if value['peak_host_used_bytes'] is not None:need(type(value['peak_host_used_bytes']) is int)
    return value


def cfs_phase(full,output,ordinal,summary,*,scope='full',definition=None):
    raw=read(output/('fullstack-phase-'+str(ordinal)+'.json'),private=False)
    need(type(raw) is dict and type(raw.get('pair')) is int and (raw.get('pair'),raw.get('mode'),raw.get('name'))==(summary['pair'],summary['mode'],summary['name']))
    frames=raw.get('samples');need(type(frames) is list and 2<=len(frames)<=64 and all(type(frame) is dict for frame in frames))
    need(type(raw.get('load')) is dict)
    keys=('completed','scheduled','success','missed','unexpected_failures','unexplained_probe_loss','latency','query_seconds','ingestion_lag_seconds')
    need(all(key in raw['load'] for key in keys) and digest({key:raw['load'][key] for key in keys})==digest({key:summary['load'][key] for key in keys}))
    need(digest([frame.get('host') for frame in frames])==digest(summary['host_samples']) and raw.get('source_cache_samples')==summary['source_cache_samples']
         and raw.get('loadgen_cpu_pressure')==summary['loadgen_cpu_pressure'])
    counters=[];clean=True
    active=set((*full.APPS,*full.CORE) if summary['mode']=='on' else full.APPS)
    if scope=='technical':
        active-= {'umami','umami-ingest','umami-query'}
        need(raw.get('scope_binding')==summary['scope_binding'] and raw.get('storage_samples')==summary['storage_samples'])
        need(full.validate_technical_phase(raw,summary['pair'],summary['mode'],definition)==full.validate_technical_phase(summary,summary['pair'],summary['mode'],definition))
        phase=summary['pair']*6+(3 if summary['mode']=='on' else 0)+('idle','steady','spike').index(summary['name'])
        leaf=full.slot_refusal.validate(raw['load'].get('slot_refusal'),phase,summary['mode']=='on',raw['load'].get('missed'))
        need(raw['load'].get('completed') is not True or leaf['state']!='captured')
    for frame in frames:
        need(type(frame) is dict and type(frame.get('counters')) is dict)
        value=frame['counters'];services=value.get('services');errors=value.get('errors')
        need(type(services) is dict and set(services)==active and type(errors) is dict and set(errors)<=active
             and all(type(error) is str and error in ('engine_read_failed','required_counter_unavailable') for error in errors.values()))
        clean=clean and not errors
        for service in services.values():
            need(type(service) is dict)
            for key in ('cpu_total_ns','memory_charged_bytes'):
                counter=service.get(key);need(counter is None or type(counter) is int and 0<=counter<=2**53-1)
                clean=clean and counter is not None
        number(value.get('at_seconds'),nullable=True);counters.append(value)
    pressure=full.loadgen_cpu_pressure(frames)
    need(digest(pressure)==digest(raw['loadgen_cpu_pressure']))
    need(type(raw.get('errors')) is list and summary['errors']==raw['errors']+(['counter_missing'] if any(value['errors'] for value in counters) else []))
    before,after=counters[0].get('at_seconds'),counters[-1].get('at_seconds')
    duration=after-before if before is not None and after is not None and after>before else None
    number(duration,upper=600,nullable=True);roles=[]
    for index,role in enumerate(ROLES):
        deltas={};reset=False
        for key in CFS:
            values=[]
            for counter in counters:
                service=counter['services'].get(role,{})
                need(type(service) is dict)
                value=service.get(key);need(value is None or type(value) is int and 0<=value<=2**53-1);values.append(value)
            known=all(value is not None for value in values)
            changed=known and any(b<a for a,b in zip(values,values[1:]))
            reset=reset or changed
            deltas[key]=values[-1]-values[0] if known and not changed else None
        available=all(value is not None for value in deltas.values()) and duration is not None
        roles.append({'role':index,'available':available,'counter_reset':reset,**deltas})
    complete=clean and pressure['state']=='unthrottled' and duration is not None and all(row['available'] for row in roles)
    return {'ordinal':ordinal,'pair':summary['pair'],'mode':summary['mode'],'phase':summary['name'],
            'duration_seconds':duration,'roles':roles},complete


def measurement(full,output,proof,*,pending=False,scope='full'):
    need(type(proof) is dict and type(proof.get('schema')) is int and proof['schema']==1
         and digest(proof.get('profile'))==digest(full.profile(scope)) and proof.get('state') in ('running','measured','failed'))
    phases=proof.get('phases');need(type(phases) is list and len(phases)<=12)
    profile=full.profile(scope)
    expected=[(pair,mode,definition) for pair,modes in enumerate(profile['pairs']) for mode in modes for definition in profile['phases']]
    if scope=='technical':
        prepared=read(output/'fullstack-source.json',private=False)
        need(proof.get('scope')==scope and proof.get('scope_binding')==prepared['scope_binding'] and proof.get('full_spec_acceptance')=='deferred')
        for ordinal,(row,(pair,mode,definition)) in enumerate(zip(phases,expected)):
            need(type(row) is dict and row.get('scope_binding')==prepared['scope_binding'])
            full.validate_technical_phase(row,pair,mode,definition)
            if len(phases)<12:cfs_phase(full,output,ordinal,row,scope=scope,definition=definition)
    else:need(proof.get('scope','full')=='full' and 'scope_binding' not in proof)
    if len(phases)<12:return {'available':False}
    totals=dict.fromkeys(('scheduled','success','missed','unexpected_failures','unexplained_probe_loss'),0)
    quality=True;http=True;source=True;counter_complete=True;phase_errors=0;cfs=[];inodes=[]
    for ordinal,(row,(pair,mode,definition)) in enumerate(zip(phases,expected)):
        need(type(row) is dict and type(row.get('pair')) is int and (row['pair'],row.get('mode'),row.get('name'))==(pair,mode,definition['name']))
        load=row.get('load');need(type(load) is dict and type(load.get('completed')) is bool)
        offered=definition['seconds']*definition['requests_per_second']
        for key in totals:
            value=load.get(key)
            if key=='unexplained_probe_loss' and value is None:
                totals[key]=None;quality=False
            else:
                need(type(value) is int and 0<=value<=3200)
                if totals[key] is not None:totals[key]+=value
        quality=quality and load['completed'] and load['scheduled']==load['success']==offered and load['missed']==load['unexpected_failures']==load['unexplained_probe_loss']==0
        errors=row.get('errors');need(type(errors) is list and all(type(error) is str and error in PHASE_ERRORS for error in errors))
        phase_errors+=len(errors);quality=quality and not errors
        pressure=row.get('loadgen_cpu_pressure');need(type(pressure) is dict and pressure.get('state') in ('unthrottled','throttled','unavailable'))
        quality=quality and pressure['state']=='unthrottled'
        latencies=load.get('latency');need(type(latencies) is list and len(latencies)<=300)
        counts=dict.fromkeys(LABELS,0)
        for sample in latencies:
            need(type(sample) is dict and set(sample)=={'label','elapsed_ms'} and type(sample['label']) is str and sample['label'] in LABELS)
            number(sample['elapsed_ms'],upper=600_000);counts[sample['label']]+=1
        http=http and all(count==offered//8 for count in counts.values())
        queries=load.get('query_seconds');need(type(queries) is list and len(queries)<=400)
        for value in queries:number(value,upper=600)
        number(load.get('ingestion_lag_seconds'),upper=600,nullable=True)
        sources=row.get('source_cache_samples');need(type(sources) is list and len(sources)<=64)
        for sample in sources:
            need(type(sample) is dict and set(sample)=={'postgresql','caddy'} and all(type(v) is str and v in ('observed','unavailable') for v in sample.values()))
        source=source and (mode=='off' or load['completed'] and bool(queries) and len(sources)>={'idle':2,'steady':8,'spike':2}[definition['name']] and all(sample=={'postgresql':'observed','caddy':'observed'} for sample in sources))
        quality=quality and (mode=='off' or definition['name']=='idle' or load['ingestion_lag_seconds'] is not None)
        storage=row.get('storage_samples');need(type(storage) is list and len(storage)<=2);quality=quality and len(storage)==2
        hosts=row.get('host_samples');need(type(hosts) is list and 2<=len(hosts)<=64)
        for host in hosts:
            need(type(host) is dict)
            for key in ('total_inodes','free_inodes','cpu_total','cpu_busy','used_bytes','device_io_reads','device_io_writes','device_io_read_bytes','device_io_written_bytes'):
                value=host.get(key);need(value is None or type(value) is int and 0<=value<=2**53-1)
                quality=quality and value is not None
            for key in ('memory_free_fraction','disk_free_fraction'):number(host.get(key),upper=1,nullable=True)
            quality=quality and all(host.get(key) is not None for key in ('memory_free_fraction','disk_free_fraction'))
            total,free=host.get('total_inodes'),host.get('free_inodes')
            if total is not None and free is not None:
                need(free<=total);inodes.append(free/total if total>0 else None)
            else:inodes.append(None)
        for key in ('cpu_total','cpu_busy','device_io_reads','device_io_writes','device_io_read_bytes','device_io_written_bytes'):
            values=[host.get(key) for host in hosts]
            quality=quality and all(v is not None for v in values) and all(b>=a for a,b in zip(values,values[1:]))
        quality=quality and hosts[-1]['cpu_total']>hosts[0]['cpu_total']
        projected,known=cfs_phase(full,output,ordinal,row,**({'scope':scope,'definition':definition} if scope=='technical' else {}));cfs.append(projected)
        counter_complete=counter_complete and known and projected['duration_seconds']>=definition['seconds']
    # The owning worker commits the whole-workload flag only after outage recovery.
    need(type(proof.get('source_cache_workload')) is bool and (proof['source_cache_workload'] is False if pending else proof['source_cache_workload']==source))
    inputs=assessment(full.assessment_inputs(proof))
    quality=bool(not pending and quality and http and source and counter_complete and totals['scheduled']==totals['success']==3200
                 and not inputs['oom'] and not inputs['enospc'] and inputs['unexplained_loss']==0
                 and all(value is not None for value in inputs.values())
                 and proof.get('controlled_outage')=={'attempted':1,'acknowledged':0,'explained_loss':1,'post_restart_acknowledged':1,'post_restart_stored':1,'outage_stored':0})
    closure=None
    if scope=='technical':
        # A failed resource gate can still accompany a fully measured workload.
        try:closure=full.technical_closure(proof)
        except ValueError:quality=False
    pairs=[]
    for pair in (0,1):
        for label in LABELS:
            before=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='off' for sample in row['load']['latency'] if sample['label']==label]
            after=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='on' for sample in row['load']['latency'] if sample['label']==label]
            pairs.append({'pair':pair,'label':label,**full.p95_pair(before,after)})
    gates={key:{'observed':inputs[key],'passed':None if pending or inputs[key] is None else inputs[key]>=limit if lower else inputs[key]<=limit}
           for key,(limit,lower) in full.acceptance.LIMITS.items()}
    # Original complete includes inode reserve. With all other quality facts known,
    # its exact value exposes that original condition without a second gate formula.
    gates['host_inode_reserve']={'minimum_free_fraction':min(inodes) if inodes and all(v is not None for v in inodes) else None,
                                 'passed':inputs['complete'] if quality else None}
    return {'available':True,**({'technical_workload':closure} if scope=='technical' else {}),
            'assessment_inputs':inputs,'p95_pairs':pairs,'cfs_phases':cfs,'resource_gates':gates,
            'quality':{'complete':quality,**totals,'http_complete':bool(http),'source_complete':bool(source),
                       'counter_complete':bool(counter_complete),'phase_errors':phase_errors}}


def collect(full,root,metadata,destination,*,scope='full'):
    fields=scope_fields(full,scope)
    source,disk=full.hosted.metadata_source(metadata);sha=source['checkout_sha']
    root=directory(root);value=pair(full,root,sha,scope=scope);outcome=read(root/OUTCOME)
    need(type(outcome) is dict and type(outcome.get('schema')) is int and outcome['schema'] in ((4,) if fields else (2,3))
         and set(outcome)=={'schema','source','pair','exits','cleanup','publication_failed'}|set(fields)|({'profiles'} if outcome['schema'] in (3,4) else set())
         and outcome['source']==sha
         and type(outcome['publication_failed']) is bool and outcome['pair']==digest(value)
         and type(outcome['exits']) is list and len(outcome['exits'])==2 and all(v is None or type(v) is int and -255<=v<=255 for v in outcome['exits'])
         and type(outcome['cleanup']) is list and len(outcome['cleanup'])==2 and all(type(v) is bool for v in outcome['cleanup']))
    need(all(type(outcome[k]) is type(v) and outcome[k]==v for k,v in fields.items()))
    contexts=None
    if outcome['schema'] in (3,4):
        need(type(outcome['profiles']) is list and len(outcome['profiles'])==2)
        contexts=[checked_context(entry,value,profile,exit_code) for entry,profile,exit_code in zip(outcome['profiles'],PROFILES,outcome['exits'])]
    rows=[];verdicts={}
    for index,profile in enumerate(PROFILES):
        output=root/profile
        row={'profile':profile,'run_exit':outcome['exits'][index],'cleanup':outcome['cleanup'][index],'state':'not_run',
             'plan_sha256':None,'baseline_sha256':None,'snapshots':[],'measurement':{'available':False},'original_oracle':{'state':'incomplete','minimum_candidate_gib':None}}
        context=contexts[index] if contexts is not None else None
        if context is not None and context['state']=='failed':
            row['failure']={key:context[key] for key in ('stage','category','errno','exit_code')}
        if present(output):
            marker,_=request(full,output,sha);row.update(plan_sha256=marker['plan_sha256'],baseline_sha256=marker['baseline_sha256'],state='incomplete')
            timing=None
            if fields and present(output/full.stage_timing.NAME):
                timing=full.stage_timing.read(output,sha,**full.timing_options(output,sha))
            if row['run_exit'] is not None:
                observed=worker_cleanup(full,output,sha,row['run_exit']);need(not row['cleanup'] or observed)
            if present(output/QUOTAS):
                quotas,owner,_=ledger(full,output,sha);row['snapshots']=quotas['snapshots']
                actual_cleanup=read(output/'cleanup.json',private=False) if present(output/'cleanup.json') else {}
                need(not row['cleanup'] or cleanup_passed(actual_cleanup))
                proof=read(output/'fullstack-proof.json',private=False)
                original=proof.get('measured_linux_acceptance',{'state':'incomplete','minimum_candidate_gib':None})
                pending=type(original) is dict and original=={'state':'incomplete'}
                if pending:
                    need(proof.get('state')=='failed' and row['run_exit'] is not None and row['run_exit']!=0
                         and proof.get('source_cache_workload') is False and 'controlled_outage' in proof and proof['controlled_outage'] is None)
                    original={'state':'incomplete','minimum_candidate_gib':None}
                else:original=verdict(original)
                measured=measurement(full,output,proof,pending=pending,**({'scope':scope} if fields else {}));row['measurement']=measured
                if measured['available'] and not pending:need(full.acceptance.assess(measured['assessment_inputs'])==original)
                else:need(original['state']=='incomplete')
                row['original_oracle']=original;verdicts[profile+'-verdict.json']=original
                worker=read(output/'worker-outcome.json',private=False) if present(output/'worker-outcome.json') else {}
                need(row['run_exit'] is None or worker.get('exit_code')==row['run_exit'])
                runtime_complete=(row['run_exit']==0 and original['state']=='passed' and proof.get('state')=='measured'
                                  or row['run_exit']==1 and original['state']=='failed' and proof.get('state')=='failed')
                if runtime_complete and (not fields or timing is not None) and row['cleanup'] and measured['available'] and measured['quality']['complete'] and [s['ordinal'] for s in quotas['snapshots']]==list(range(5)):
                    row['state']='measurement_complete'
        else:
            if context is not None and context['state']=='failed':
                need(context['stage'] in ('pilot_admission','prepare_inputs') and not context['prepared'] and not row['cleanup'])
                row['state']='admission_failed'
            else:need(row['run_exit'] is None and not row['cleanup'])
        rows.append(row)
    # Baselines use fresh output paths; their hashes need not equal one another.
    result={'schema':outcome['schema'],**fields,**({'full_spec_acceptance':'deferred'} if fields else {}),
            'kind':KIND,'source':sha,'workload_sha256':value['workload_sha256'],'images':value['images'],
            **ACCEPTANCE,'state':'measurement_complete' if not outcome['publication_failed'] and all(row['state']=='measurement_complete' for row in rows) else 'incomplete','profiles':rows,
            'measurement_complete':not outcome['publication_failed'] and all(row['state']=='measurement_complete' for row in rows),
            'publication_failed':outcome['publication_failed'],
            'fixed_order':list(PROFILES),'host_and_order_confounded':True}
    # All private reads/validation precede creation; publish canonical snapshots only.
    destination=Path(destination);need(destination.absolute()==destination.resolve() and not present(destination))
    directory(destination.parent,private=False);destination.mkdir(mode=0o700)
    created=destination.lstat()
    descriptor=os.open(destination,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        pinned=os.fstat(descriptor);need((created.st_dev,created.st_ino)==(pinned.st_dev,pinned.st_ino))
        for name,snapshot in {NAME:result,**verdicts,'source.json':source,'admission.json':disk}.items():
            current=destination.lstat();need((current.st_dev,current.st_ino)==(pinned.st_dev,pinned.st_ino))
            raw=(json.dumps(snapshot,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode();need(len(raw)<=MAX_BYTES)
            fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor)
            with os.fdopen(fd,'wb') as stream:stream.write(raw)
    finally:os.close(descriptor)
    return result


if __name__=='__main__':
    import fullstack
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=('worker',));parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    fullstack.worker(args.output,cpu=True)
