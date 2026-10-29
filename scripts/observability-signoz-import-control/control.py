"""Optional native Linux two-role import discriminator, never acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'observability-signoz'))
import disk_component as component
import evidence
import lifecycle
import runtime
import supervisor
import receipts

PROFILE=component.PROFILE
LIMITS={'setup':180,'measure':60,'cleanup':90}
ACTOR=(HERE/'actor.py').read_text()
CASES=('quiet','contended')


def require(value):
    if not value:raise ValueError('closed_import_control')


def import_source(base=None):
    base=runtime.source(PROFILE) if base is None else base
    result={**base,'inputs':dict(base['inputs']),'scope':'independent import-only disk cgroup diagnostic; no functional or capacity acceptance'}
    path=runtime.ROOT/'.github/workflows/observability-signoz-import-control.yml'
    result['inputs'][str(path.relative_to(runtime.ROOT))]=lifecycle.digest(path)
    return result


def verify_import_source(output):
    actual=evidence.read(output/'import-source.json')
    require(actual==import_source())
    return actual


def recover(output):
    if not output.exists():return {'passed':False,'state':'import_output_unavailable'}
    verify_import_source(output)
    return component.recover(output)


def clock_identity():
    return {'boot':hashlib.sha256(Path('/proc/sys/kernel/random/boot_id').read_bytes().strip()).hexdigest(),
        'time_namespace':hashlib.sha256(os.readlink('/proc/self/ns/time').encode()).hexdigest()}


def snapshot(own):
    """Read only the verified owned resident's cgroup, outside timed calls."""
    value=own.validate('disk');pid=value['State']['Pid'];birth=runtime.process_start(pid)
    group=Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()
    require(len(group)==1 and group[0].startswith('0::/'))
    suffix=group[0][3:];require('..' not in Path(suffix).parts)
    root=Path('/sys/fs/cgroup').resolve();path=(root/suffix.lstrip('/')).resolve()
    require(path.is_relative_to(root))
    maximum=[int(v) for v in (path/'cpu.max').read_text().split()]
    require(len(maximum)==2 and maximum[0]*10==maximum[1])
    require(int((path/'memory.max').read_text())==96*1024**2 and int((path/'pids.max').read_text())==128)
    stats={}
    for line in (path/'cpu.stat').read_text().splitlines():
        key,v=line.split();require(key not in stats);stats[key]=int(v)
    keys=('usage_usec','nr_periods','nr_throttled','throttled_usec')
    require(all(k in stats and stats[k]>=0 for k in keys))
    require(runtime.process_start(pid)==birth and own.validate('disk')['State']['Pid']==pid)
    private=':'.join((own.containers['disk'],own.created['disk'],str(pid),birth,suffix))
    return {'generation':hashlib.sha256(private.encode()).hexdigest(),'clock':clock_identity(),
        'cpu':{k:stats[k] for k in keys}}


def sample(own):
    engine=own.engine
    argv=['--config',str(engine.anon),'--host',engine.endpoint,'exec',own.containers['disk'],'python','/driver/inside.py','disk']
    error=None;value=None
    with receipts.observe_raw(engine,argv) as raw:
        try:value=lifecycle.vm_sample(own)
        except BaseException as caught:error=caught
    # A failure retains its own authority, never Engine's shared latest files.
    inner=lifecycle.first_raw_command(error) if error is not None else None
    return {'status':'not_run' if not receipts.full_window(raw) else ('failed' if error is not None else 'succeeded'),
        'raw':dict(raw),'inner':evidence.inner_command(inner),'value':value,
        'failure_reason':('none' if error is None else error.reason if isinstance(error,lifecycle.Refusal)
            and error.reason in ('command_deadline','command_failed','global_deadline') else 'invalid_result')},error


def actor_value(raw):
    require(type(raw) is str and len(raw.encode())<=4096)
    value=json.loads(raw,object_pairs_hook=evidence.observer.unique)
    require(type(value) is dict and set(value)=={'schema','before','after','started','finished','cpu_seconds','imports_completed'})
    require(type(value['schema']) is int and value['schema']==1 and value['imports_completed'] is True)
    for key in ('started','finished','cpu_seconds'):require(receipts.number(value[key]) and value[key]>=0)
    require(0<=value['finished']-value['started']<=60 and value['cpu_seconds']<=min(60,value['finished']-value['started']+.01))
    for side in ('before','after'):
        row=value[side];require(type(row) is dict and set(row)=={'boot','time_namespace','self_generation'})
        require(all(type(v) is str and len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in row.values()))
    require(value['before']==value['after'])
    return value


def measure_pair(own,rows=None):
    rows=[] if rows is None else rows
    require(not rows);first_error=None
    for case in CASES:
        before=snapshot(own);actor={};thread=None;sample_error=None
        if case=='contended':
            def importing():
                try:
                    argv=['exec',own.containers['disk'],'python','-B','-c',ACTOR]
                    normalized=['--config',str(own.engine.anon),'--host',own.engine.endpoint,*argv]
                    with receipts.observe_raw(own.engine,normalized) as observed:
                        actor['value']=actor_value(own.engine.call(argv,timeout=10))
                    actor['raw']=dict(observed)
                except BaseException as error:actor['error']=error
            thread=threading.Thread(target=importing,name='owned-signoz-import-only',daemon=False)
            thread.start()
        try:
            row,sample_error=sample(own)
            if sample_error is not None:first_error=first_error or sample_error
        finally:
            if thread is not None:
                thread.join(timeout=max(0,min(10,own.engine.deadline-time.monotonic())))
                own.engine.cancel_thread_children(thread)
                thread.join(timeout=max(0,min(1,own.engine.deadline-time.monotonic())))
                if thread.is_alive():
                    if sample_error is not None:raise sample_error
                    raise ValueError('owned_importer_not_reaped')
        try:after=snapshot(own)
        except BaseException:
            if sample_error is not None:raise sample_error
            raise
        row.update(case=case,before=before,after=after,actor=actor.get('value'),actor_raw=actor.get('raw'),actor_error=actor.get('error') is not None)
        rows.append(row)
        if isinstance(sample_error,(KeyboardInterrupt,SystemExit)):raise sample_error
    return rows,first_error


def closed_inner(value):
    require(type(value) is dict and type(value.get('available')) is bool)
    if value['available']:
        clean=evidence.inner_command({k:v for k,v in value.items() if k!='available'})
        require(clean==value)
    else:require(value=={'available':False})
    return value


def interpret(rows):
    require(type(rows) is list and len(rows)<=2)
    result=[]
    for index,row in enumerate(rows):
        require(type(row) is dict and set(row)=={'status','raw','inner','value','case','before','after','actor','actor_raw','actor_error','failure_reason'})
        require(row['case']==CASES[index] and row['status'] in ('not_run','failed','succeeded'))
        require(type(row['actor_error']) is bool)
        require(row['failure_reason'] in ('none','command_deadline','command_failed','global_deadline','invalid_result'))
        require((row['status']=='succeeded')==(row['failure_reason']=='none') or row['status']=='not_run')
        raw=row['raw'];valid=receipts.full_window(raw)
        before=row['before'];after=row['after']
        for observation in (before,after):
            require(type(observation) is dict and set(observation)=={'generation','clock','cpu'})
            require(type(observation['generation']) is str and len(observation['generation'])==64)
            require(type(observation['clock']) is dict and set(observation['clock'])=={'boot','time_namespace'})
            require(all(type(v) is str and len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in observation['clock'].values()))
            require(type(observation['cpu']) is dict and set(observation['cpu'])=={'usage_usec','nr_periods','nr_throttled','throttled_usec'})
            require(all(type(v) is int and 0<=v<2**64 for v in observation['cpu'].values()))
        stable=before['generation']==after['generation'] and before['clock']==after['clock']
        cpu={k:after['cpu'][k]-v for k,v in before['cpu'].items()}
        require(all(type(v) is int and v>=0 for v in cpu.values()))
        actor=row['actor'];overlap='unknown'
        if row['case']=='contended' and actor is not None:
            actor=actor_value(json.dumps(actor))
            clock={k:actor['before'][k] for k in ('boot','time_namespace')}
            ar=row['actor_raw']
            actor_bound=(type(ar) is dict and ar.get('available') is True and ar.get('reaped') is True and ar.get('native_exit')==0
                and all(receipts.number(ar.get(k)) for k in ('started','finished'))
                and ar['started']<=actor['started']<=actor['finished']<=ar['finished'])
            if stable and valid and actor_bound and not row['actor_error'] and clock==before['clock']:
                overlap='overlap' if max(raw['started'],actor['started'])<min(raw['finished'],raw['started']+3,actor['finished']) else 'none'
        ready=stable and valid and (row['case']=='quiet' or overlap=='overlap')
        result.append({'case':row['case'],'status':row['status'] if ready else 'not_run',
            'raw_seconds':raw['finished']-raw['started'] if valid else None,'overlap':overlap,
            'import_seconds':actor['finished']-actor['started'] if actor is not None else None,
            'import_cpu_seconds':actor['cpu_seconds'] if actor is not None else None,
            'cpu_delta':cpu,'actor_host_pid_attested':False,'first_inner_command':closed_inner(row['inner']),
            'failure_reason':row['failure_reason']})
    return result


def launch(output,phase,started,deadline,cancelled):
    registration=output/('component-cleaner.json' if phase=='cleanup' else 'worker.json')
    lifecycle.private_json(output/'component-phase.json',{'phase':phase,'deadline':deadline})
    process=None;code=124;stopped=False
    try:
        if time.monotonic()<deadline:
            process=subprocess.Popen([sys.executable,'-B',str(HERE/'control.py'),'worker','--output',str(output),'--phase',phase],
                start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            lifecycle.private_json(registration,{'pid':process.pid,'group':process.pid,'start_ticks':runtime.process_start(process.pid)})
            code=supervisor.wait(process,deadline,cancelled)
    finally:
        if process is not None:
            try:runtime.stop_worker(evidence.read(registration));process.wait(timeout=1);stopped=True
            except Exception:supervisor.stop(process)
    return {'available':True,'phase':phase,'status':'executed' if process is not None else 'not_run',
        'exit':code,'elapsed_seconds':time.monotonic()-started,'limit_seconds':LIMITS[phase],'stopped':stopped}


def run(output):
    component.require_opt_in();runtime.require_native_host()
    started=time.monotonic();source=runtime.source(PROFILE)
    require(not output.exists() and output.is_absolute() and output.resolve()==output)
    output.mkdir(mode=0o700);lifecycle.private_json(output/'source.json',source)
    lifecycle.private_json(output/'import-source.json',import_source(source))
    lifecycle.private_json(output/'component-request.json',{'schema':1,'profile_id':PROFILE,'source_sha':source['commit'],
        'source_tree':source['tree'],'project':'signoz1566-'+uuid.uuid4().hex[:12],'nonce':uuid.uuid4().hex,
        'cwd':str(runtime.ROOT),'output':str(output)})
    phases={k:{'available':False} for k in LIMITS};cancelled=[False]
    def cancel(*_args):cancelled[0]=True
    previous={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT)}
    for s in previous:signal.signal(s,cancel)
    try:
        phases['setup']=launch(output,'setup',started,started+180,lambda:cancelled[0])
        if component.phase_complete(phases['setup']) and not cancelled[0]:
            start=time.monotonic();phases['measure']=launch(output,'measure',start,start+60,lambda:cancelled[0])
    finally:
        for s in previous:signal.signal(s,signal.SIG_IGN)
        try:
            start=time.monotonic();phases['cleanup']=launch(output,'cleanup',start,start+90,lambda:False)
        finally:
            for s,v in previous.items():signal.signal(s,v)
        complete=not cancelled[0] and all(component.phase_complete(v) for v in phases.values())
        lifecycle.private_json(output/'component-outcome.json',{'schema':1,'profile_id':PROFILE,'complete':complete,'phases':phases})
    return 0 if complete else 1


def worker(output,phase):
    if phase!='cleanup':component.require_opt_in()
    runtime.require_native_host();verify_import_source(output)
    source,value,deadline=component.registered_phase(output,phase)
    def interrupted(*_args):raise lifecycle.Refusal('import_control_interrupted')
    for s in (signal.SIGTERM,signal.SIGINT):signal.signal(s,interrupted)
    if phase=='cleanup':
        if (output/'owner.json').exists() or (output/'owner.json').is_symlink():component.recovery_preflight(output,source,value)
        result=runtime.recover(output,deadline,profile_id=PROFILE)
        lifecycle.private_json(output/'component-cleanup.json',{'schema':1,'passed':result['passed']})
        return 0 if result['passed'] else 1
    directory=output/('engine-'+str(os.getpid())+'-'+uuid.uuid4().hex[:8]);directory.mkdir(mode=0o700)
    engine=lifecycle.Engine(directory,deadline);engine.freeze()
    try:
        if phase=='setup':component.prepare(output,source,value,engine)
        else:
            own=component.existing(output,source,value,engine);before=evidence.read(output/'component-inventory-before.json')
            initial=evidence.read(output/'component-host-initial.json');rows=[]
            try:
                lifecycle.check_host(initial,lifecycle.host_snapshot(engine,output))
                rows,_error=measure_pair(own,rows)
                lifecycle.check_host(initial,lifecycle.host_snapshot(engine,output))
                require(component.live_inventory(own,source,value)==before)
                lifecycle.private_json(output/'component-inventory-after.json',before)
                component.request(output);verify_import_source(output)
            finally:
                lifecycle.private_json(output/'import-cases.json',{'schema':1,'source_sha':source['commit'],'source_tree':source['tree'],'cases':rows})
    finally:engine.cancel_children()
    return 0


def collect(output,public):
    require(public!=output and not public.is_relative_to(output))
    report={'schema':1,'diagnostic_only':True,'diagnostic_complete':False,
        'functional_acceptance':False,'resource_acceptance':False,'capacity_acceptance':False,
        'full_workload_acceptance':False,'production_acceptance':False,'source':{'available':False},
        'cases':[],'cleanup':{'available':False},'actor_host_pid_attested':False,'comparison':'unavailable',
        'overlap_scope':'total_raw_Docker_exec_window_only'}
    try:
        source,value=component.request(output);own_source=verify_import_source(output)
        report['source']={'available':True,'binding':own_source}
        component.recovery_preflight(output,source,value)
        report['cleanup']=evidence.cleanup(evidence.read(output/'cleanup.json'))
        plan=evidence.read(output/'compose.json');before=component.finite_read(output/'component-inventory-before.json')
        after=component.finite_read(output/'component-inventory-after.json');require(after==before)
        report['inventory']=component.verified_inventory(before,source,value,plan)
        record=component.finite_read(output/'import-cases.json')
        require(type(record) is dict and set(record)=={'schema','source_sha','source_tree','cases'})
        require(type(record['schema']) is int and record['schema']==1 and record['source_sha']==source['commit'] and record['source_tree']==source['tree'])
        report['cases']=interpret(record['cases'])
        if len(report['cases'])==2:
            quiet,contended=(r['status'] for r in report['cases'])
            if quiet=='failed':report['comparison']='uninterpretable'
            elif quiet=='succeeded' and contended=='failed':
                last=report['cases'][1];inner=last['first_inner_command']
                genuine=(last['failure_reason']=='command_deadline' and inner.get('available') is True
                    and inner.get('command_class')=='disk_exec' and inner.get('timeout_seconds')==3
                    and inner.get('native_exit') is None and inner.get('alive_before_reap') is True
                    and inner.get('elapsed_seconds',0)>=3)
                report['comparison']='supports_import_contention' if genuine else 'uninterpretable'
            elif quiet==contended=='succeeded':report['comparison']='not_reproduced'
        report['cleanup']=evidence.cleanup(evidence.read(output/'cleanup.json'))
        require(report['cleanup']=={'available':True,'passed':True,'failed_operations':[],
            'exact_containers':2,'exact_volumes':7,'exact_networks':1})
        outcome=component.finite_read(output/'component-outcome.json')
        require(type(outcome) is dict and outcome['schema']==1 and outcome['profile_id']==PROFILE and outcome['complete'] is True)
        require(set(outcome['phases'])==set(LIMITS) and all(component.phase_complete(p) for p in outcome['phases'].values()))
        report['diagnostic_complete']=len(report['cases'])==2 and all(row['status']!='not_run' for row in report['cases'])
    except (OSError,ValueError,TypeError,KeyError,RecursionError):pass
    require(not public.is_symlink());public.mkdir(parents=True,exist_ok=True)
    require(not any(public.iterdir()));lifecycle.private_json(public/'import-control.json',report)
    return report['diagnostic_complete']


def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('run','worker','recover','collect'))
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--public',type=Path)
    parser.add_argument('--phase',choices=tuple(LIMITS));args=parser.parse_args()
    if args.mode=='run':return run(args.output)
    if args.mode=='worker':require(args.phase is not None);return worker(args.output,args.phase)
    if args.mode=='recover':return 0 if recover(args.output)['passed'] else 1
    require(args.public is not None);return 0 if collect(args.output,args.public) else 1


if __name__=='__main__':raise SystemExit(main())
