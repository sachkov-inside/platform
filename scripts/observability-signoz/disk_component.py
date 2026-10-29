"""Independent two-role disk diagnostic; never functional or capacity acceptance."""
import argparse
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
import threading
import time
import uuid

import evidence
import lifecycle
import runtime
import supervisor

SCOPE='independent two-role disk component diagnostic; no monitoring, capacity or production acceptance'
PROFILE=lifecycle.MCP512_PROFILE
CASES=('minimal_exec','python_imports','actual_vm_sample')
IMPORTS='import json,os,sys,time;print("disk-component-imports-v1")'
SETUP_SECONDS=180
MEASURE_SECONDS=60
CLEANUP_SECONDS=90
ROLES=('volume-init','disk')


def require(value):
    if not value:raise ValueError('closed_component_contract')


def require_opt_in():
    """Case-sensitive authoritative gate; workflow contains() is only a coarse filter."""
    try:
        require(os.environ.get('GITHUB_EVENT_NAME')=='pull_request')
        name=os.environ.get('GITHUB_EVENT_PATH');require(type(name) is str and bool(name))
        path=Path(name);require(path.is_absolute() and path.resolve()==path)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb') as stream:
            native=os.fstat(stream.fileno())
            require(stat.S_ISREG(native.st_mode) and native.st_uid==os.getuid() and native.st_nlink==1
                    and native.st_mode&0o022==0 and 0<native.st_size<=1048576)
            raw=stream.read(1048577);require(len(raw)<=1048576)
        def constant(_value):raise ValueError('nonfinite_event')
        event=json.loads(raw,object_pairs_hook=evidence.observer.unique,parse_constant=constant)
        require(type(event) is dict and event.get('action') in ('opened','synchronize','reopened'))
        pr=event.get('pull_request');require(type(pr) is dict)
        body=pr.get('body');require(type(body) is str and len(body)<=65536)
        require('<!-- signoz-disk-component: run -->' in body)
    except (OSError,ValueError,TypeError,RecursionError):
        raise ValueError('exact_component_opt_in_required') from None


class ComponentEngine(lifecycle.Engine):
    """Observe only the selected final raw command, after all original preflight."""
    def raw(self,args,timeout=10,*,binary=None,operation=None):
        # This component owns one serial main thread and no background sampler.
        # Lock every raw call so the private final-call window cannot leak to another call.
        require(threading.current_thread() is threading.main_thread() and threading.active_count()==1)
        with self.lock:
            final=(getattr(self,'component_argv',None) is not None and binary is None
                   and args==['--config',str(self.anon),'--host',self.endpoint,*self.component_argv])
            original=self.deadline
            if final:
                lifecycle.need(original-time.monotonic()>=3,'component_full_budget_unavailable')
                require(timeout==3);self.component_entered=True
                # Only this final raw3s call uses its own full local window. The
                # external measurement supervisor still owns the hard60s deadline.
                # A shortened/interrupted phase can never produce a complete contrast.
                self.deadline=math.inf
            try:return super().raw(args,timeout,binary=binary,operation=operation)
            finally:self.deadline=original


def run_case(own,case):
    require(case in CASES)
    engine=own.engine;engine.component_entered=False;engine.component_argv=None
    started=time.monotonic()
    row={'case':case,'status':'not_run','entered_final_exec':False,'declared_final_timeout_seconds':3,
         'outer_elapsed_seconds':0,'reason':'unavailable','first_inner_command':{'available':False}}
    try:
        own.validate('disk')
        if case=='actual_vm_sample':argv=['exec',own.containers['disk'],'python','/driver/inside.py','disk']
        elif case=='minimal_exec':argv=['exec',own.containers['disk'],'/bin/true']
        else:argv=['exec',own.containers['disk'],'python','-c',IMPORTS]
        engine.component_argv=argv
        if case=='actual_vm_sample':lifecycle.vm_sample(own)
        else:
            raw=engine.call(argv,timeout=3)
            require(raw==('' if case=='minimal_exec' else 'disk-component-imports-v1\n'))
        row.update(status='succeeded',reason='completed')
    except Exception as error:
        entered=engine.component_entered
        reason=error.reason if isinstance(error,lifecycle.Refusal) else 'invalid_result'
        if reason not in ('command_failed','command_deadline','global_deadline','component_full_budget_unavailable','invalid_result'):reason='preflight_or_identity_failure'
        row.update(status='failed' if entered else 'not_run',reason=reason,
            first_inner_command=evidence.inner_command(lifecycle.first_raw_command(error)))
        inner=row['first_inner_command']
        if entered and inner['available'] and inner['native_exit'] in (126,127):
            row.update(status='not_run',reason='executable_unavailable')
        if entered and inner['available'] and inner['timeout_seconds']!=3:
            row.update(status='not_run',reason='component_full_budget_unavailable')
    finally:
        row['entered_final_exec']=engine.component_entered
        row['outer_elapsed_seconds']=time.monotonic()-started
        engine.component_argv=None
    return row


def request(output):
    require(output.is_absolute() and output.resolve()==output and output.is_dir() and not output.is_symlink())
    source=evidence.read(output/'source.json');runtime.verify_source(source,PROFILE)
    value=evidence.read(output/'component-request.json')
    require(type(value) is dict and set(value)=={'schema','profile_id','source_sha','source_tree','project','nonce','cwd','output'})
    require(type(value['schema']) is int and value['schema']==1 and value['profile_id']==source['profile_id']==PROFILE)
    require(value['source_sha']==source['commit'] and value['source_tree']==source['tree'])
    require(value['cwd']==str(runtime.ROOT) and value['output']==str(output))
    require(type(value['project']) is str and re.fullmatch('signoz1566-[a-f0-9]{12}',value['project']) is not None)
    require(type(value['nonce']) is str and re.fullmatch('[a-f0-9]{32}',value['nonce']) is not None)
    return source,value


def owner_matches(output,value):
    owner=evidence.read(output/'owner.json')
    require(all(owner.get(k)==value[k] for k in ('project','nonce','profile_id','source_sha','source_tree','cwd')))
    return owner


def recovery_preflight(output,source,value):
    """Pure receipt validation must precede every cleaner/worker signal or engine."""
    owner=owner_matches(output,value)
    require(owner['source_sha']==source['commit'] and owner['source_tree']==source['tree'] and owner['profile_id']==source['profile_id']==PROFILE)
    plan=evidence.read(output/'compose.json');lifecycle.plan_profile(plan,PROFILE)
    require(lifecycle.digest(output/'compose.json')==owner['plan_sha256'])
    expected=lifecycle.make_plan(output,lifecycle.verify_packet(PROFILE)['images'],value['project'],value['nonce'],os.getuid(),os.getgid(),profile_id=PROFILE)
    require(plan==expected)
    prior_path=output/'resources.json'
    if not prior_path.exists() and not prior_path.is_symlink():return
    prior=evidence.read(prior_path)
    require(type(prior) is dict and set(prior)=={'project','nonce','profile_id','containers','created','volumes','networks'})
    require(all(prior[k]==value[k] for k in ('project','nonce','profile_id')))
    require(all(type(prior[k]) is dict for k in ('containers','created','volumes','networks')))
    require(set(prior['containers'])<=set(ROLES) and set(prior['created'])==set(prior['containers']))
    require(all(type(cid) is str and re.fullmatch('[a-f0-9]{64}',cid) for cid in prior['containers'].values()))
    require(len(set(prior['containers'].values()))==len(prior['containers']))
    require(all(type(created) is str and 0<len(created)<=200 for created in prior['created'].values()))
    require(set(prior['volumes'])<={v['name'] for v in plan['volumes'].values()})
    for name,identity in prior['volumes'].items():
        require(type(identity) is dict and set(identity)=={'Name','CreatedAt','Mountpoint','Driver'}
                and identity['Name']==name and identity['Driver']=='local')
        require(all(type(v) is str and 0<len(v)<=4096 for v in identity.values()))
    require(set(prior['networks'])<={v['name'] for v in plan['networks'].values()})
    require(all(type(nid) is str and re.fullmatch('[a-f0-9]{64}',nid) for nid in prior['networks'].values()))


def recover(output,deadline=None):
    if not output.exists():return {'passed':False,'state':'component_output_unavailable'}
    source,value=request(output)
    if (output/'owner.json').exists() or (output/'owner.json').is_symlink():
        recovery_preflight(output,source,value)
        if (output/'component-cleaner.json').exists():runtime.stop_worker(evidence.read(output/'component-cleaner.json'))
        return runtime.recover(output,deadline,profile_id=PROFILE)
    # Registration precedes even the initial engine freeze and owner receipt.
    # Source + closed request validation must therefore precede this signal too.
    for name in ('worker.json','component-cleaner.json'):
        if (output/name).exists():runtime.stop_worker(evidence.read(output/name))
    return {'passed':True,'state':'no_registered_project'}

def launch_phase(output,phase,started,deadline,cancelled):
    require(phase in ('setup','measure','cleanup'))
    limit={'setup':SETUP_SECONDS,'measure':MEASURE_SECONDS,'cleanup':CLEANUP_SECONDS}[phase]
    registration=output/('component-cleaner.json' if phase=='cleanup' else 'worker.json')
    lifecycle.private_json(output/'component-phase.json',{'phase':phase,'deadline':deadline})
    process=None;code=1;stopped=False
    try:
        if time.monotonic()>=deadline:return {'available':True,'phase':phase,'status':'not_run','exit':124,'elapsed_seconds':time.monotonic()-started,'limit_seconds':limit,'stopped':True}
        process=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'worker','--output',str(output),'--phase',phase],
            start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        lifecycle.private_json(registration,{'pid':process.pid,'group':process.pid,'start_ticks':runtime.process_start(process.pid)})
        code=supervisor.wait(process,deadline,cancelled)
    finally:
        if process is not None:
            try:
                runtime.stop_worker(evidence.read(registration));process.wait(timeout=1);stopped=True
            except Exception:
                supervisor.stop(process)
    return {'available':True,'phase':phase,'status':'executed','exit':code,'elapsed_seconds':time.monotonic()-started,'limit_seconds':limit,'stopped':stopped}


def phase_complete(value):
    return (value.get('available') is True and value.get('status')=='executed' and value.get('exit')==0 and value.get('stopped') is True
            and value.get('elapsed_seconds',math.inf)<=value.get('limit_seconds',0))


def run(output):
    require_opt_in()
    runtime.require_native_host();started=time.monotonic();source=runtime.source(PROFILE)
    require(not output.exists() and output.is_absolute() and output.resolve()==output)
    output.mkdir(mode=0o700);lifecycle.private_json(output/'source.json',source)
    lifecycle.private_json(output/'component-request.json',{'schema':1,'profile_id':PROFILE,
        'source_sha':source['commit'],'source_tree':source['tree'],'project':'signoz1566-'+uuid.uuid4().hex[:12],
        'nonce':uuid.uuid4().hex,'cwd':str(runtime.ROOT),'output':str(output)})
    phases={k:{'available':False} for k in ('setup','measure','cleanup')};cancelled=[False]
    def cancel(*_args):cancelled[0]=True
    previous={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT)}
    for s in previous:signal.signal(s,cancel)
    try:
        phases['setup']=launch_phase(output,'setup',started,started+SETUP_SECONDS,lambda:cancelled[0])
        if phase_complete(phases['setup']) and not cancelled[0]:
            measurement=time.monotonic()
            phases['measure']=launch_phase(output,'measure',measurement,measurement+MEASURE_SECONDS,lambda:cancelled[0])
    finally:
        for s in previous:signal.signal(s,signal.SIG_IGN)
        cleanup_started=time.monotonic()
        try:phases['cleanup']=launch_phase(output,'cleanup',cleanup_started,cleanup_started+CLEANUP_SECONDS,lambda:False)
        finally:
            for s,value in previous.items():signal.signal(s,value)
        complete=not cancelled[0] and all(phase_complete(v) for v in phases.values())
        lifecycle.private_json(output/'component-outcome.json',{'schema':1,'profile_id':PROFILE,'complete':complete,'phases':phases})
    return 0 if complete else 1


def component_engine(output,deadline):
    directory=output/('engine-'+str(os.getpid())+'-'+uuid.uuid4().hex[:8]);directory.mkdir(mode=0o700)
    current=ComponentEngine(directory,deadline);current.freeze();return current


def registered_phase(output,phase):
    require(phase in ('setup','measure','cleanup'))
    source,value=request(output)
    phase_record=evidence.read(output/'component-phase.json')
    require(type(phase_record) is dict and set(phase_record)=={'phase','deadline'} and phase_record['phase']==phase)
    deadline=phase_record['deadline'];require(type(deadline) in (int,float) and math.isfinite(deadline))
    require(0<deadline-time.monotonic()<= {'setup':180,'measure':60,'cleanup':90}[phase])
    registration=output/('component-cleaner.json' if phase=='cleanup' else 'worker.json')
    expected={'pid':os.getpid(),'group':os.getpid(),'start_ticks':runtime.process_start(os.getpid())}
    registration_deadline=min(deadline,time.monotonic()+5)
    while time.monotonic()<registration_deadline:
        if registration.exists() and evidence.read(registration)==expected:break
        time.sleep(.01)
    else:raise ValueError('registered_component_worker_required')
    if (output/'owner.json').exists() or (output/'owner.json').is_symlink():
        owner=owner_matches(output,value);require(owner['supervisor_pid']==os.getppid())
    return source,value,deadline


def live_inventory(own,source,value):
    own.discover();own.record()
    require(set(own.containers)==set(ROLES) and len(own.volumes)==7 and len(own.networks)==1)
    for role in ROLES:own.validate(role)
    return {'schema':1,'profile_id':PROFILE,'source_sha':source['commit'],'source_tree':source['tree'],
        'project':value['project'],'nonce':value['nonce'],'plan_sha256':lifecycle.digest(own.run/'compose.json'),
        'resources':evidence.read(own.run/'resources.json'),'limits':own.observed_limits,'images':own.images}


def prepare(output,source,value,current):
    lock=lifecycle.verify_packet(PROFILE);lifecycle.write_private_files(output,lock)
    own=lifecycle.Owned(current,output,{},value['project'],value['nonce'],profile_id=PROFILE)
    own.plan=lifecycle.make_plan(output,lock['images'],value['project'],value['nonce'],os.getuid(),os.getgid(),profile_id=PROFILE)
    lifecycle.private_json(output/'compose.json',own.plan)
    lifecycle.private_json(output/'owner.json',{**{k:value[k] for k in ('project','nonce','profile_id','source_sha','source_tree','cwd')},
        'daemon':current.identity,'supervisor_pid':os.getppid(),'deadline':current.deadline,'plan_sha256':lifecycle.digest(output/'compose.json')})
    initial=lifecycle.host_snapshot(current,output)
    for row in initial['filesystems'].values():require(lifecycle.storage_policy.admission(total=row['total_bytes'],free=row['free_bytes'])['ready'])
    lifecycle.private_json(output/'component-host-initial.json',initial)
    row=next(r for r in lock['images'] if r['repository'].endswith('/python'))
    lifecycle.acquire_image(current,row);helper=lifecycle.checked_image(current,row,'amd64')
    own.images={role:dict(helper) for role in ROLES};lifecycle.require_declared_volume_coverage(own.plan,own.images)
    own.compose(['create','--no-build','--pull','never','volume-init','disk']);own.discover();own.record()
    own.start('volume-init');own.wait('volume-init',20);own.start('disk')
    before=live_inventory(own,source,value);lifecycle.private_json(output/'component-inventory-before.json',before)


def existing(output,source,value,current):
    owner=owner_matches(output,value);require(current.identity==owner['daemon'])
    plan=evidence.read(output/'compose.json');require(lifecycle.digest(output/'compose.json')==owner['plan_sha256'])
    lifecycle.plan_profile(plan,PROFILE)
    lock=lifecycle.verify_packet(PROFILE);row=next(r for r in lock['images'] if r['repository'].endswith('/python'))
    helper=lifecycle.checked_image(current,row,'amd64')
    own=lifecycle.Owned(current,output,{role:dict(helper) for role in ROLES},value['project'],value['nonce'],profile_id=PROFILE);own.plan=plan
    prior=evidence.read(output/'component-inventory-before.json')
    registry=evidence.read(output/'resources.json');require(registry==prior['resources'])
    require(all(registry[k]==value[k] for k in ('project','nonce','profile_id')))
    for key in ('containers','created','volumes','networks'):setattr(own,key,dict(registry[key]))
    now=live_inventory(own,source,value);require(now==prior)
    return own


def measure(output,source,value,current):
    own=existing(output,source,value,current)
    initial=evidence.read(output/'component-host-initial.json');rows=[]
    try:
        for case in CASES:
            lifecycle.check_host(initial,lifecycle.host_snapshot(current,output))
            row=run_case(own,case);rows.append(row)
            lifecycle.private_json(output/'component-cases.json',{'schema':1,'cases':rows})
            require(live_inventory(own,source,value)==evidence.read(output/'component-inventory-before.json'))
        lifecycle.check_host(initial,lifecycle.host_snapshot(current,output))
        lifecycle.private_json(output/'component-inventory-after.json',live_inventory(own,source,value))
        require(all(r['entered_final_exec'] and r['status']!='not_run' for r in rows))
    finally:
        lifecycle.private_json(output/'component-cases.json',{'schema':1,'cases':rows})


def worker(output,phase):
    if phase!='cleanup':require_opt_in()
    runtime.require_native_host();source,value,deadline=registered_phase(output,phase)
    def interrupted(*_args):raise lifecycle.Refusal('component_interrupted')
    for signum in (signal.SIGTERM,signal.SIGINT):signal.signal(signum,interrupted)
    if phase=='cleanup':
        # The cleaner has its own registration. Original recovery must stop only
        # the already-stopped setup/measurement worker, never its own session.
        if (output/'owner.json').exists() or (output/'owner.json').is_symlink():recovery_preflight(output,source,value)
        result=runtime.recover(output,deadline,profile_id=PROFILE)
        lifecycle.private_json(output/'component-cleanup.json',{'schema':1,'passed':result['passed']})
        return 0 if result['passed'] else 1
    current=component_engine(output,deadline)
    try:
        if phase=='setup':prepare(output,source,value,current)
        else:measure(output,source,value,current)
    finally:current.cancel_children()
    return 0

def finite_read(path):
    value=evidence.read(path)
    def walk(item,depth=0):
        require(depth<=24)
        if type(item) is float:require(math.isfinite(item))
        elif type(item) is dict:
            for child in item.values():walk(child,depth+1)
        elif type(item) is list:
            for child in item:walk(child,depth+1)
    walk(value);return value


def verified_inventory(row,source,value,plan):
    require(type(row) is dict and set(row)=={'schema','profile_id','source_sha','source_tree','project','nonce','plan_sha256','resources','limits','images'})
    require(type(row['schema']) is int and row['schema']==1)
    require(all(row[k]==value[k] for k in ('profile_id','source_sha','source_tree','project','nonce')))
    require(row['plan_sha256']==lifecycle.digest(Path(value['output'])/'compose.json'))
    resources=row['resources'];require(type(resources) is dict and set(resources)=={'project','nonce','profile_id','containers','created','volumes','networks'})
    require(all(resources[k]==value[k] for k in ('profile_id','project','nonce')))
    require(set(resources['containers'])==set(resources['created'])==set(ROLES))
    require(all(type(cid) is str and re.fullmatch('[a-f0-9]{64}',cid) for cid in resources['containers'].values()))
    require(len(set(resources['containers'].values()))==2)
    require(all(type(created) is str and 0<len(created)<=200 for created in resources['created'].values()))
    require(set(resources['volumes'])=={v['name'] for v in plan['volumes'].values()})
    for name,identity in resources['volumes'].items():
        require(type(identity) is dict and set(identity)=={'Name','CreatedAt','Mountpoint','Driver'} and identity['Name']==name and identity['Driver']=='local')
        require(all(type(x) is str and 0<len(x)<=4096 for x in identity.values()))
    require(set(resources['networks'])=={v['name'] for v in plan['networks'].values()})
    require(all(type(nid) is str and re.fullmatch('[a-f0-9]{64}',nid) for nid in resources['networks'].values()))
    require(set(row['limits'])==set(row['images'])==set(ROLES))
    for role,memory,cpu in (('volume-init',33554432,25000000),('disk',100663296,100000000)):
        require(row['limits'][role]=={'memory_bytes':memory,'memory_swap_bytes':memory,'nano_cpus':cpu,'pids_limit':128})
        require(all(type(v) is int for v in row['limits'][role].values()))
    lock=lifecycle.verify_packet(PROFILE);pin=next(r for r in lock['images'] if r['repository'].endswith('/python'))
    proof=lifecycle.image_proof.load(lifecycle.CONFIG/'oci',lock)[pin['pinned']]
    images={}
    for role,image in row['images'].items():
        require(type(image) is dict and set(image)=={'entrypoint','reference','runtime_reference','config_digest','image_id','selected_image_id','architecture','child_manifest','relation','image_descriptor_available','container_descriptor_available','declared_volume_paths'})
        require(image['reference']==proof.reference and image['runtime_reference']==proof.runtime_reference and image['config_digest']==proof.config_digest and image['child_manifest']==proof.child and image['architecture']=='amd64')
        require(image['entrypoint']==proof.config.get('Entrypoint') and image['declared_volume_paths']==list(proof.volume_paths))
        require(type(image['image_descriptor_available']) is bool and type(image['container_descriptor_available']) is bool)
        require(image['relation'] in ('config_id','child_id'))
        expected=proof.config_digest if image['relation']=='config_id' else proof.child
        require(image['image_id']==image['selected_image_id']==expected)
        if image['relation']=='child_id':require(image['image_descriptor_available'] and image['container_descriptor_available'])
        images[role]={k:image[k] for k in ('reference','runtime_reference','config_digest','image_id','selected_image_id','architecture','child_manifest','relation','image_descriptor_available','container_descriptor_available')}
    return {'available':True,'roles':row['limits'],'images':images,'containers':2,'volumes':7,'networks':1}


def case_rows(record):
    require(type(record) is dict and set(record)=={'schema','cases'} and type(record['schema']) is int and record['schema']==1)
    rows=record['cases'];require(type(rows) is list and len(rows)<=3)
    for index,row in enumerate(rows):
        require(type(row) is dict and set(row)=={'case','status','entered_final_exec','declared_final_timeout_seconds','outer_elapsed_seconds','reason','first_inner_command'})
        require(row['case']==CASES[index] and row['status'] in ('succeeded','failed','not_run'))
        require(type(row['entered_final_exec']) is bool and type(row['declared_final_timeout_seconds']) is int and row['declared_final_timeout_seconds']==3)
        evidence.number(row['outer_elapsed_seconds'],3600)
        require(row['reason'] in ('completed','command_failed','command_deadline','global_deadline','component_full_budget_unavailable','invalid_result','preflight_or_identity_failure','executable_unavailable'))
        inner=row['first_inner_command'];require(type(inner) is dict and type(inner.get('available')) is bool)
        if inner['available']:
            require(set(inner)=={'available','command_class','timeout_seconds','elapsed_seconds','native_exit','alive_before_reap'})
            projected=evidence.inner_command({k:v for k,v in inner.items() if k!='available'});require(projected==inner)
            require(inner['elapsed_seconds']<=row['outer_elapsed_seconds'])
        else:require(inner=={'available':False})
        if row['status']=='succeeded':require(row['entered_final_exec'] and row['reason']=='completed' and not inner['available'])
        if row['status']=='failed':
            require(row['entered_final_exec'] and row['reason'] in ('command_failed','command_deadline','invalid_result'))
            if row['reason']!='invalid_result':
                require(inner['available'] and inner['timeout_seconds']==3 and inner['command_class']==('disk_exec' if row['case']=='actual_vm_sample' else 'unknown'))
                if row['reason']=='command_deadline':require(inner['elapsed_seconds']>=3)
                else:require(type(inner['native_exit']) is int and inner['native_exit'] not in (0,126,127))
        if row['status']=='not_run':require(row['reason']!='completed')
    return {'available':True,'cases':rows}


def phase_rows(record):
    require(type(record) is dict and set(record)=={'schema','profile_id','complete','phases'})
    require(type(record['schema']) is int and record['schema']==1 and record['profile_id']==PROFILE and type(record['complete']) is bool)
    require(type(record['phases']) is dict and set(record['phases'])=={'setup','measure','cleanup'})
    for name,limit in (('setup',180),('measure',60),('cleanup',90)):
        row=record['phases'][name]
        if row=={'available':False}:continue
        require(type(row) is dict and set(row)=={'available','phase','status','exit','elapsed_seconds','limit_seconds','stopped'})
        require(row['available'] is True and row['phase']==name and row['status'] in ('executed','not_run') and type(row['limit_seconds']) is int and row['limit_seconds']==limit)
        require(type(row['exit']) is int and -128<=row['exit']<=255 and type(row['stopped']) is bool)
        evidence.number(row['elapsed_seconds'],3600)
    require(record['complete'] is False or all(phase_complete(v) for v in record['phases'].values()))
    return {'available':True,**record}


def component_cleanup(record):
    require(type(record) is dict and set(record)=={'passed','failed_operations','exact_containers','exact_volumes','exact_networks'})
    result=evidence.cleanup(record)
    require(result['exact_containers']<=2 and result['exact_volumes']<=7 and result['exact_networks']<=1)
    return result


def collect(output,destination):
    require(destination.is_absolute() and destination.resolve()==destination and not destination.exists())
    destination.mkdir(mode=0o700,parents=True)
    report={'schema':1,'scope':SCOPE,'diagnostic_only':True,'diagnostic_complete':False,'profile_id':PROFILE,
        'functional_acceptance':False,'full_workload_acceptance':False,'resource_acceptance':False,'capacity_acceptance':False,'production_acceptance':False,
        'native_setup_limit_seconds':180,'native_setup_clock_includes_bootstrap':True,'bootstrap_step_outer_limit_seconds':480,'workflow_job_outer_limit_seconds':720,'measurement_limit_seconds':60,'cleanup_limit_seconds':90,
        'source':{'available':False},'inventory':{'available':False},'cases':{'available':False},'outcome':{'available':False},'cleanup':{'available':False},'native_identity':{'available':False}}
    try:
        source,value=request(output);owner=owner_matches(output,value);plan=finite_read(output/'compose.json')
        expected=lifecycle.make_plan(output,lifecycle.verify_packet(PROFILE)['images'],value['project'],value['nonce'],os.getuid(),os.getgid(),profile_id=PROFILE)
        require(plan==expected and owner['plan_sha256']==lifecycle.digest(output/'compose.json'))
        report['source']={'available':True,'binding':source}
        before=finite_read(output/'component-inventory-before.json');after=finite_read(output/'component-inventory-after.json')
        require(before==after and finite_read(output/'resources.json')==before['resources']);report['inventory']=verified_inventory(before,source,value,plan)
        directories=list(output.glob('engine-*'));require(1<=len(directories)<=4)
        identities=evidence.identities(output);require(identities['available'] and len(identities['samples'])==len(directories))
        require(all(row==identities['samples'][0] for row in identities['samples']))
        expected_daemon='sha256:'+hashlib.sha256(str(owner['daemon']['daemon_id']).encode()).hexdigest()
        expected_endpoint='sha256:'+hashlib.sha256(owner['daemon']['endpoint'].encode()).hexdigest()
        require(identities['samples'][0]['daemon_sha256']==expected_daemon and identities['samples'][0]['endpoint_sha256']==expected_endpoint)
        report['native_identity']=identities
    except Exception:pass
    for key,name,decode in (('cases','component-cases.json',case_rows),('outcome','component-outcome.json',phase_rows),('cleanup','cleanup.json',component_cleanup)):
        try:
            # Cleanup is an owned fact only after source, owner and canonical plan bind.
            if key=='cleanup':require(report['source']['available'])
            report[key]=decode(finite_read(output/name))
        except Exception:pass
    try:
        clean=finite_read(output/'component-cleanup.json');require(clean=={'schema':1,'passed':True})
        require(type(clean['schema']) is int and type(clean['passed']) is bool)
        require(all(report[k]['available'] for k in ('source','inventory','cases','outcome','cleanup','native_identity')))
        require(report['outcome']['complete'] and report['cleanup']['passed'] and report['cleanup']['exact_containers']==2 and report['cleanup']['exact_volumes']==7 and report['cleanup']['exact_networks']==1)
        rows=report['cases']['cases'];require(len(rows)==3 and all(r['entered_final_exec'] and r['status']!='not_run' and r['reason']!='invalid_result' for r in rows))
        require(sum(r['outer_elapsed_seconds'] for r in rows)<=report['outcome']['phases']['measure']['elapsed_seconds'])
        report['diagnostic_complete']=True
    except Exception:pass
    lifecycle.private_json(destination/'component.json',report)
    return report['diagnostic_complete']


def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('run','worker','recover','collect'))
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--public',type=Path)
    parser.add_argument('--phase',choices=('setup','measure','cleanup'));args=parser.parse_args()
    if args.mode=='collect':require(args.public is not None and args.phase is None);return 0 if collect(args.output,args.public) else 1
    require(args.public is None)
    if args.mode=='worker':require(args.phase is not None);return worker(args.output,args.phase)
    require(args.phase is None)
    if args.mode=='recover':return 0 if recover(args.output)['passed'] else 1
    return run(args.output)


if __name__=='__main__':sys.exit(main())
