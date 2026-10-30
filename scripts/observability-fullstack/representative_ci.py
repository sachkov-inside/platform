"""Fixed private D7 verification adapter. No public runtime selector or capacity claim."""
from contextlib import contextmanager, ExitStack
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import sys
import time
import unittest

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=('d7-source.json','d7-preparation.json','d7-outcome.json','d7-functional.json','d7-cleanup.json','d7-sdk-phase.json')
LIMIT=65536


def need(value):
    if not value:raise ValueError('private_d7_refused')


def unique(pairs):
    value=dict(pairs);need(len(value)==len(pairs));return value


def present(path):return path.exists() or path.is_symlink()


def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def digest(value):return hashlib.sha256(encoded(value)).hexdigest()


def read(path, maximum=LIMIT):
    need(path==path.resolve() and path.parent==path.parent.resolve())
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(descriptor,'rb') as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==os.getuid()
             and info.st_mode&0o077==0 and 0<info.st_size<=maximum)
        raw=stream.read(maximum+1);after=path.lstat()
        need(len(raw)==info.st_size and (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
             ==(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns))
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:need(False))


def write(path,value):
    raw=encoded(value);need(len(raw)<=LIMIT)
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())


@dataclass(frozen=True)
class Paths:
    metadata:Path
    images:Path
    prepared:Path
    minimal:Path
    public:Path
    host:Path


def paths():
    root=Path(os.environ.get('RUNNER_TEMP',''))
    need(root.is_absolute() and root==root.resolve() and root.is_dir() and root.stat().st_uid==os.getuid())
    values=Paths(*(root/name for name in ('representative-d7-metadata','representative-d7-images.json',
        'representative-d7-private','representative-d7-minimal','representative-d7-public','representative-d7-host')))
    for path in vars(values).values():need(path==path.resolve())
    return values


def require_prerequisites():
    need(os.environ.get('D7_PROTOCOL_RESULT')=='success' and os.environ.get('D7_MINIMAL_RESULT')=='success')
    sha=os.environ.get('GITHUB_SHA','');need(re.fullmatch('[a-f0-9]{40}',sha) is not None and os.environ.get('D7_MINIMAL_SHA')==sha)


def require_protocol_result(result,count):
    need(result.wasSuccessful() and result.testsRun==count and count>0
         and not any((result.skipped,result.errors,result.failures,result.expectedFailures,result.unexpectedSuccesses)))


def protocol(group):
    import protocol_runner
    need(group in protocol_runner.GROUPS)
    selected=protocol_runner.discover()[int(group)-1]
    result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(selected))
    require_protocol_result(result,len(selected))


def modules():
    import representative_witness
    runtime=representative_witness._native_runtime()
    return representative_witness,runtime


def admitted():
    witness,runtime=modules();runtime.require_native_host()
    return witness,runtime,runtime.source(runtime.lifecycle.MCP512_PROFILE)


def minimal_gate():
    _,runtime,source=admitted();output=paths().minimal
    runtime.verify_source(read(output/'source.json',1048576),runtime.lifecycle.MCP512_PROFILE)
    outcome=read(output/'outcome.json');clean=read(output/'cleanup.json')
    functional=read(output/'functional.json');states=read(output/'states.json')
    runtime.evidence.functional(functional)
    observed=runtime.evidence.outcome(outcome,runtime.lifecycle.MCP512_PROFILE)
    cleanup=runtime.evidence.cleanup(clean);healthy=runtime.evidence.states(states)
    need(observed['passed'] is True and observed['worker_exit']==0 and observed['cleanup_passed'] is True
         and outcome['cleanup'].get('roles_healthy') is True and cleanup['passed'] is True
         and cleanup['exact_containers']==len(runtime.lifecycle.SERVICES)
         and cleanup['exact_volumes']==len(runtime.lifecycle.VOLUMES) and cleanup['exact_networks']==1
         and healthy['healthy'] is True and set(healthy['roles'])==set(runtime.lifecycle.SERVICES))
    destination=Path(os.environ['GITHUB_OUTPUT']);need(destination.is_absolute() and not destination.is_symlink())
    with destination.open('a') as stream:stream.write('sha='+source['commit']+'\n')


@contextmanager
def signals():
    def interrupt(*_):
        for value in (signal.SIGTERM,signal.SIGINT):signal.signal(value,signal.SIG_IGN)
        raise KeyboardInterrupt()
    previous={value:signal.getsignal(value) for value in (signal.SIGTERM,signal.SIGINT)}
    try:
        for value in previous:signal.signal(value,interrupt)
        yield
    finally:
        for value,handler in previous.items():signal.signal(value,handler)


@contextmanager
def guards(runtime, directories, record):
    """Existing 4GiB guards, once per actual native filesystem, on main thread."""
    import disk_feedback
    from storage_policy import admission,GROWTH_BYTES
    rows=[];seen=set();first=None
    try:
        with ExitStack() as stack:
            for directory in directories:
                info=directory.stat();identity=info.st_dev
                if identity in seen:continue
                seen.add(identity);usage=runtime.hosted.runtime.pilot.shutil.disk_usage(directory)
                need(admission(total=usage.total,free=usage.free)['ready'])
                observation=disk_feedback.Record(record['commit']);observation.attempt()
                sample=stack.enter_context(runtime.hosted.runtime.pilot.disk_budget(directory,growth_bytes=GROWTH_BYTES,observe_samples=True))
                observation.entered(sample)
                rows.append(({'device':identity,'total_bytes':usage.total,'free_bytes':usage.free},observation))
            yield rows
    except BaseException:first=sys.exc_info();raise
    finally:
        for _,observation in rows:
            try:observation.seal()
            except BaseException:
                if first is None:raise


def _guard_projection(rows):
    return [{'filesystem':identity,'disk':observation.value} for identity,observation in rows]


def verify_tools():
    import subprocess
    result=subprocess.run(['node','--input-type=module','-e',
        'process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}))'],
        cwd=ROOT,check=True,capture_output=True,timeout=5)
    need(json.loads(result.stdout)=={'version':'v26.10.0','platform':'linux','arch':'x64'})
    result=subprocess.run(['pnpm','--version'],cwd=ROOT,check=True,capture_output=True,timeout=5)
    need(result.stdout==b'11.27.1\n' and json.loads((ROOT/'package.json').read_text())['packageManager']=='pnpm@11.27.1'
        and (ROOT/'.node-version').read_text().strip()=='26.10.0')


def measure_filesystems(runtime,directories):
    seen=set();result=[]
    for directory in directories:
        device=directory.stat().st_dev
        if device in seen:continue
        seen.add(device);usage=runtime.hosted.runtime.pilot.shutil.disk_usage(directory)
        result.append({'device':integer(device),'total_bytes':integer(usage.total),'free_bytes':integer(usage.free)})
    return result


def host_measure():
    require_prerequisites();_,runtime,source=admitted();fixed=paths()
    fixed.host.mkdir(mode=0o700)
    write(fixed.host/'initial.json',{'source':source['commit'],
        'filesystems':measure_filesystems(runtime,(ROOT,Path.home(),fixed.host))})


def host_prepare():
    require_prerequisites();_,runtime,source=admitted();fixed=paths();verify_tools()
    host_initial(read(fixed.host/'initial.json'),source['commit'])
    observations=[];first=None;stage='not_started';checkpoints=[]
    try:
        build_end=None
        with guards(runtime,(ROOT,Path.home(),fixed.host),source) as observations:
            for stage,argv,timeout in (
                ('install',['timeout','--signal=TERM','--kill-after=10s','4m','pnpm','install','--frozen-lockfile'],250),
                ('peers',['pnpm','peers','check'],60),
                ('packages',['pnpm','build:packages'],360),
                ('backend',['pnpm','--filter','@inside/backend','build'],360)):
                if stage=='packages':build_end=time.monotonic()+360
                if stage in ('packages','backend'):
                    timeout=build_end-time.monotonic();need(0<timeout<=360)
                checkpoints.append({'stage':'before_'+stage,'filesystems':measure_filesystems(runtime,(ROOT,Path.home(),fixed.host))})
                runtime.hosted.command(argv,timeout)
                checkpoints.append({'stage':'after_'+stage,'filesystems':measure_filesystems(runtime,(ROOT,Path.home(),fixed.host))})
    except BaseException:first=sys.exc_info()
    finally:
        try:write(fixed.host/'preparation.json',{'source':source['commit'],'stage':stage,'passed':first is None,'filesystems':_guard_projection(observations),'checkpoints':checkpoints})
        except BaseException:
            if first is None:first=sys.exc_info()
    if first is not None:raise first[1].with_traceback(first[2])


def filesystem_observations(value,source):
    import disk_feedback
    need(type(value) is list and 1<=len(value)<=3)
    result=[];devices=set()
    for row in value:
        need(type(row) is dict and set(row)=={'filesystem','disk'})
        fs=row['filesystem'];need(type(fs) is dict and set(fs)=={'device','total_bytes','free_bytes'})
        fs={key:integer(fs[key]) for key in ('device','total_bytes','free_bytes')}
        need(fs['total_bytes']>0 and fs['free_bytes']<=fs['total_bytes'] and fs['device'] not in devices)
        devices.add(fs['device'])
        result.append({'filesystem':fs,'disk':disk_feedback.validate(row['disk'],source)})
    return result


def checkpoint_projection(value,stages):
    need(type(value) is list and len(value)<=2*len(stages))
    result=[]
    for row in value:
        need(type(row) is dict and set(row)=={'stage','filesystems'}
            and row['stage'] in {prefix+stage for prefix in ('before_','after_') for stage in stages}
            and type(row['filesystems']) is list and 1<=len(row['filesystems'])<=3)
        fs=[];devices=set()
        for item in row['filesystems']:
            need(type(item) is dict and set(item)=={'device','total_bytes','free_bytes'})
            point={key:integer(item[key]) for key in ('device','total_bytes','free_bytes')}
            need(point['total_bytes']>0 and point['free_bytes']<=point['total_bytes'] and point['device'] not in devices)
            devices.add(point['device']);fs.append(point)
        result.append({'stage':row['stage'],'filesystems':fs})
    return result


def host_initial(value,source):
    need(type(value) is dict and set(value)=={'source','filesystems'} and value['source']==source)
    return checkpoint_projection([{'stage':'before_setup','filesystems':value['filesystems']}],('setup',))[0]


def host_projection(value,source):
    need(type(value) is dict and set(value)=={'source','stage','passed','filesystems','checkpoints'} and value['source']==source
        and value['stage'] in ('not_started','install','peers','packages','backend') and type(value['passed']) is bool)
    return {'source':source,'stage':value['stage'],'passed':value['passed'],
        'filesystems':filesystem_observations(value['filesystems'],source),
        'checkpoints':checkpoint_projection(value['checkpoints'],('install','peers','packages','backend'))}


def require_host_preparation(fixed,source):
    value=host_projection(read(fixed.host/'preparation.json'),source)
    need([row['stage'] for row in value['checkpoints']]==[prefix+stage for stage in ('install','peers','packages','backend') for prefix in ('before_','after_')])
    need(value['passed'] is True and value['stage']=='backend'
         and all(row['disk']['state']=='observed' and row['disk']['stopping'] is None for row in value['filesystems']))


def prepare_trial():
    require_prerequisites();witness,runtime,source=admitted();fixed=paths()
    import prepare
    import fullstack
    import preparation
    import hosted
    require_host_preparation(fixed,source['commit'])
    need(not fixed.metadata.exists() and not fixed.images.exists() and not fixed.prepared.exists())
    hosted.admission(fixed.metadata)
    _,disk=hosted.metadata_source(fixed.metadata);need(disk['ready'])
    prepare.prepare_representative(fixed.metadata,fixed.images,str(fixed.prepared))
    stage=preparation.recover_stage(fixed.images);cleanup=False;first=None;observations=[];checkpoints=[]
    directories=(Path(stage.receipt['daemon']['storage']),ROOT,fixed.prepared.parent)
    with stage.in_use():
        stage.require_consumer(str(fixed.prepared))
        # The future prepared directory shares its fixed parent's filesystem.
        # Hold every distinct guard through constructors, worker, cleanup and retirement.
        try:
            with guards(runtime,directories,source) as observations:
                try:
                    checkpoints.append({'stage':'before_inputs','filesystems':measure_filesystems(runtime,directories)})
                    fullstack.inputs(fixed.prepared,fixed.images)
                    checkpoints.append({'stage':'after_inputs','filesystems':measure_filesystems(runtime,directories)})
                    fullstack.mode(fixed.prepared,True)
                    signoz=fixed.prepared/'signoz';signoz.mkdir(mode=0o700)
                    lock=runtime.lifecycle.verify_packet(runtime.lifecycle.MCP512_PROFILE)
                    runtime.lifecycle.write_private_files(signoz,lock)
                    checkpoints.append({'stage':'before_histogram','filesystems':measure_filesystems(runtime,directories)})
                    runtime.lifecycle.histogram_asset(signoz,lock,acquire=True)
                    checkpoints.append({'stage':'after_histogram','filesystems':measure_filesystems(runtime,directories)})
                    bindings={'source':{key:source[key] for key in ('commit','tree')},
                        'project':'inside-observability-representative-'+secrets.token_hex(6),
                        'nonce':secrets.token_hex(16),'uid':os.getuid(),'gid':os.getgid()}
                    images=read(fixed.images)
                    write(fixed.prepared/'d7-bindings.json',bindings)
                    witness.owners._canonical(fixed.prepared,bindings,images,admit=True)
                    checkpoints.append({'stage':'before_trial','filesystems':measure_filesystems(runtime,directories)})
                    result=witness.coordinate(fixed.prepared,bindings,images)
                    checkpoints.append({'stage':'after_trial','filesystems':measure_filesystems(runtime,directories)})
                    need(result['cleanup'] is True);cleanup=True
                except BaseException:first=sys.exc_info()
                finally:
                    first=retire(witness,runtime,fixed,stage,cleanup,first)
        except BaseException:
            if first is None:first=sys.exc_info()
        finally:
            try:
                write(fixed.metadata/'d7-runtime-disk.json',_guard_projection(observations))
                write(fixed.metadata/'d7-checkpoints.json',checkpoint_projection(checkpoints,('inputs','histogram','trial')))
            except BaseException:
                if first is None:first=sys.exc_info()
    if first is not None:raise first[1].with_traceback(first[2])


def retire(witness,runtime,fixed,stage,cleanup,first):
    try:
        if not cleanup:cleanup=_recover_project(witness,runtime,fixed)
    except BaseException:
        if first is None:first=sys.exc_info()
    try:
        retirement=stage.release(str(fixed.prepared),cleanup_ok=cleanup)
        write(fixed.metadata/'d7-retirement.json',retirement_projection(retirement))
        need(cleanup and retirement['state']=='retired')
    except BaseException:
        if first is None:first=sys.exc_info()
    return first


def _recover_project(witness,runtime,fixed):
    admission=fixed.prepared/'representative-trial.json'
    registry=fixed.prepared/'representative-owner/resources.json'
    if not present(admission):
        # No coordinator registration, therefore no project acquisition authority.
        need(not present(registry) and not present(fixed.prepared/'worker.json'));return True
    value=read(admission,witness.PRIVATE_ADMISSION_MAX_BYTES)
    need(type(value) is dict and set(value)=={'schema','bindings','images','deadline_mono_ns','source'}
         and type(value['schema']) is int and value['schema']==1)
    runtime.verify_source(value['source'],runtime.lifecycle.MCP512_PROFILE)
    need(value['bindings']==read(fixed.prepared/'d7-bindings.json') and value['images']==read(fixed.images))
    end=value['deadline_mono_ns']/10**9+90
    need(type(value['deadline_mono_ns']) is int and 0<end-time.monotonic()<=690)
    worker=witness.owners._worker(fixed.prepared)
    if not present(registry):
        runtime.stop_worker(worker)
        # A registered worker may have crossed acquisition. Missing registry is unknown.
        return False
    layout,inputs=witness.owners._canonical(fixed.prepared,value['bindings'],value['images'],admit=True)
    record=read(registry,1048576);witness.owners._registry(record,layout)
    need(record['binding']==value['bindings'] and record['inputs']==inputs
         and record['root']==layout.manifest['root_identity'] and record['worker']==worker
         and record['deadline_mono_ns']==value['deadline_mono_ns']
         and record['plan_sha256']==layout.manifest['plan_sha256']
         and record['manifest_sha256']==hashlib.sha256(layout._manifest.encode()).hexdigest())
    runtime.stop_worker(worker)
    engine=runtime.engine(fixed.prepared,end-time.monotonic());engine.deadline=end
    owner=witness.owners.CompositeOwner.recover(engine,fixed.prepared,value['bindings'],value['images'])
    return owner.cleanup_exact() is True


def recover():
    witness,runtime,_=admitted();fixed=paths()
    import preparation
    if not preparation.directory(fixed.images).exists():
        need(not fixed.images.exists() and not fixed.prepared.exists());return
    stage=preparation.recover_stage(fixed.images)
    with stage.in_use():
        # A normal successful retirement is already durable; do not replay release.
        if present(fixed.metadata/'d7-retirement.json'):
            prior=read(fixed.metadata/'d7-retirement.json')
            if prior['state']=='retired':
                need(present(stage.path/('release-'+preparation.consumer_key(str(fixed.prepared))+'.json')));return
        cleanup=False;first=None
        try:cleanup=_recover_project(witness,runtime,fixed)
        except BaseException:first=sys.exc_info()
        try:
            retirement=stage.release(str(fixed.prepared),cleanup_ok=cleanup)
            write(fixed.metadata/'d7-recovery.json',retirement_projection(retirement))
            need(cleanup and retirement['state']=='retired')
        except BaseException:
            if first is None:first=sys.exc_info()
        if first is not None:raise first[1].with_traceback(first[2])


def retirement_projection(value):
    need(type(value) is dict and value.get('state') in ('retained','retired')
         and value.get('reason') in ('recovery_required','named_consumer','last_consumer_released','build_result_unavailable','protected_reference','retirement_failed'))
    result={key:value[key] for key in ('state','reason')}
    for key in ('retired','protected'):
        items=value.get(key,[]);need(type(items) is list and len(items)<=5
            and all(type(item) is str and re.fullmatch('sha256:[a-f0-9]{64}',item) is not None for item in items))
        result[key+'_count']=len(items)
    return result


def integer(value,maximum=2**63-1):
    need(type(value) is int and 0<=value<=maximum);return value


def number(value,maximum=690):
    need(type(value) in (int,float) and math.isfinite(value) and 0<=value<=maximum);return value


def flags():
    return {'privacy':'unknown','full_workload':False,'capacity_acceptance':False,'production_acceptance':False}


def functional_projection(value,source):
    import representative_stored
    need(type(value) is dict and set(value)=={'schema','source','control','agent','sdk_host_cost','helper_requests',
        'helper_acknowledged_spans','full_workload','capacity_acceptance','privacy','loadgen_isolation','native_known_probe_cases'}
        and type(value['schema']) is int and value['schema']==1 and value['source']==source and value['full_workload'] is False
        and value['capacity_acceptance'] is False and value['privacy']=='unknown')
    control=value['control'];need(type(control) is dict and set(control)=={'bootstrap','viewer_admin_denied','viewer_revoked_denied','reads','sdk'}
        and all(control[key] is True for key in ('bootstrap','viewer_admin_denied','viewer_revoked_denied')) and integer(control['reads'],10)==10)
    sdk=control['sdk'];need(type(sdk) is dict and set(sdk)=={'sdk_span_semantics','sdk_metric_semantics','stored_spans','logical_series',
        'unknown_fields','full_privacy','original_vm_oracle','native_probe_cases'} and sdk['sdk_span_semantics']==sdk['sdk_metric_semantics']=='passed'
        and integer(sdk['stored_spans'],3)==3 and integer(sdk['logical_series'],67)==67 and sdk['full_privacy']=='unknown'
        and sdk['original_vm_oracle']=='not_applicable' and sdk['native_probe_cases']==['zero','latest_zero','future']
        and value['native_known_probe_cases']==sdk['native_probe_cases'])
    unknown=set(representative_stored.UNKNOWN)|{'span.'+key for key in ('link_metadata','trace_state','status_message','scope.version','scope.attributes')}|{
        'metric.'+key for key in ('exemplars','flags','kind','monotonic','temporality','unit','scope.version','scope.attributes')}
    need(type(sdk['unknown_fields']) is list and 1<=len(sdk['unknown_fields'])<=32
        and all(type(key) is str and key in unknown for key in sdk['unknown_fields']))
    agent=value['agent'];need(type(agent) is dict and set(agent)=={'schema','reads','gateway_denials','direct_ip_denials','alias_kernel_denials','alias_dns_unknown'}
        and integer(agent['schema'],1)==1 and integer(agent['reads'],10)==10 and integer(agent['gateway_denials'],4)==4
        and integer(agent['direct_ip_denials'],11)==11 and integer(agent['alias_kernel_denials'],11)+integer(agent['alias_dns_unknown'],11)==11)
    isolation=value['loadgen_isolation'];need(type(isolation) is dict and set(isolation)=={'direct_ip_denials','alias_kernel_denials','alias_dns_unknown'}
        and integer(isolation['direct_ip_denials'],11)==11 and integer(isolation['alias_kernel_denials'],11)+integer(isolation['alias_dns_unknown'],11)==11)
    cost=value['sdk_host_cost'];need(type(cost) is dict and set(cost)=={'wall_seconds','cpu_user_seconds','cpu_system_seconds','observed_peak_rss_bytes','rss_sample_period_seconds','child_count'}
        and cost['rss_sample_period_seconds']==.01 and integer(cost['child_count'],1)==1)
    cost={**{key:number(cost[key]) for key in ('wall_seconds','cpu_user_seconds','cpu_system_seconds')},
        'observed_peak_rss_bytes':integer(cost['observed_peak_rss_bytes']), 'rss_sample_period_seconds':.01,'child_count':1}
    return {'availability':'available','control':{key:control[key] for key in ('bootstrap','viewer_admin_denied','viewer_revoked_denied','reads')},
        'sdk':{key:sdk[key] for key in ('sdk_span_semantics','sdk_metric_semantics','stored_spans','logical_series','unknown_fields','native_probe_cases')},
        'agent':{key:integer(agent[key],100) for key in agent},'loadgen_isolation':{key:integer(isolation[key],11) for key in isolation},
        'host_sdk_cost':cost,'helper_requests':integer(value['helper_requests']),
        'helper_acknowledged_spans':integer(value['helper_acknowledged_spans']),**flags()}


def cleanup_projection(witness,prepared,layout):
    directory=prepared/'representative-owner';path=directory/'cleanup.json'
    if not present(path):return {'availability':'unavailable',**flags()}
    value=read(path);roles=set(layout.manifest['roles']);volumes=set(layout.manifest['volumes']);networks=set(layout.manifest['networks'])
    operations={'scope_recovery','scope_cleanup','discover','prior_states','states','record','cleanup_receipt','residue:ps','residue:volume','residue:network'}
    operations|={'state:'+role for role in roles}|{'container:'+role for role in roles}|{'volumes:'+name for name in volumes}|{'networks:'+name for name in networks}
    need(type(value) is dict and set(value)=={'passed','failed_operations','roles_healthy'} and type(value['passed']) is bool
        and type(value['roles_healthy']) is bool and type(value['failed_operations']) is list and len(value['failed_operations'])<=100
        and all(type(item) is str and item in operations for item in value['failed_operations'])
        and value['passed'] is (not value['failed_operations']))
    states=read(directory/'states.json',1048576);need(type(states) is dict and set(states)<=roles)
    projected={}
    for role,row in states.items():
        need(type(row) is dict and set(row)=={'state','restart_count'} and type(row['state']) is dict)
        native=row['state'];need(type(native.get('Running')) is bool and type(native.get('OOMKilled')) is bool
            and type(native.get('ExitCode')) is int and -255<=native['ExitCode']<=255
            and native.get('Status') in ('running','created','exited'))
        projected[role]={'running':native['Running'],'oom_killed':native['OOMKilled'],'exit_code':native['ExitCode'],
            'status':native['Status'],'restart_count':integer(row['restart_count'],1000000)}
    need(value['roles_healthy'] is witness.owners._healthy(states,layout.manifest))
    return {'availability':'available','passed':value['passed'],'roles_healthy':value['roles_healthy'],
        'failed_operations':list(value['failed_operations']),'roles':projected,**flags()}


def outcome_projection(witness,value):
    need(type(value) is dict and set(value)=={'schema','worker_status','cause','cleanup'} and type(value['schema']) is int and value['schema']==1)
    status=value['worker_status'];need(status is None or type(status) is int and -255<=status<=255)
    cleanup=value['cleanup'];need(type(cleanup) is dict and set(cleanup)=={'stop','recovery','reap'}
        and all(type(v) is str and v in ('not_attempted','passed','failed') for v in cleanup.values()))
    cause=value['cause'];need(type(cause) is dict and cause.get('availability') in ('available','unavailable'))
    if cause['availability']=='available':
        need(set(cause)=={'availability','stage','reason','category','first_command'} and cause['stage'] in witness._STAGES
            and cause['reason']=='stage_failed' and cause['category'] in witness._CATEGORIES)
        cause={**{key:cause[key] for key in ('availability','stage','reason','category')},'first_command':witness._command_context(cause['first_command'])}
        # Explicit finite JSON encoding also rejects NaN accepted by legacy numeric comparisons.
        encoded(cause)
    else:need(set(cause)=={'availability'});cause={'availability':'unavailable'}
    return {'availability':'available','worker_status':status,'cause':cause,'cleanup':dict(cleanup),**flags()}


def collect():
    witness,runtime,source=admitted();fixed=paths()
    import hosted
    import preparation_evidence
    admitted_source,_=hosted.metadata_source(fixed.metadata)
    need(admitted_source['checkout_sha']==source['commit'] and admitted_source['checkout_tree']==source['tree'])
    selected={key:source[key] for key in ('commit','tree')};layout=None
    if present(fixed.prepared/'d7-bindings.json'):
        bindings=read(fixed.prepared/'d7-bindings.json');need(bindings['source']==selected)
        layout,_=witness.owners._canonical(fixed.prepared,bindings,read(fixed.images),admit=True)
    source_public={key:source[key] for key in ('schema','profile_id','commit','tree','repository','execution_sha','pr_head','pr_base','run_id','run_attempt')}
    source_public.update(inputs_sha256=digest(source['inputs']),resource_inputs_sha256=digest(admitted_source['inputs']),**flags())
    prep={'availability':'unavailable',**flags()}
    if present(fixed.metadata/preparation_evidence.NAME):
        raw=preparation_evidence.read(fixed.metadata/preparation_evidence.NAME,source['commit'])
        prep={'availability':'available','checkpoints':raw,**flags()}
    for name,key in (('d7-retirement.json','retirement'),('d7-recovery.json','recovery')):
        if present(fixed.metadata/name):
            value=read(fixed.metadata/name)
            need(type(value) is dict and set(value)=={'state','reason','retired_count','protected_count'})
            # Reconstruct only the closed retirement fields, never copy private receipts.
            need(value['state'] in ('retired','retained') and value['reason'] in ('recovery_required','named_consumer','last_consumer_released','build_result_unavailable','protected_reference','retirement_failed'))
            prep[key]={'state':value['state'],'reason':value['reason'],
                'retired_count':integer(value['retired_count'],5),'protected_count':integer(value['protected_count'],5)}
    if present(fixed.host/'initial.json'):prep['host_before_setup']=host_initial(read(fixed.host/'initial.json'),source['commit'])
    if present(fixed.host/'preparation.json'):prep['host']=host_projection(read(fixed.host/'preparation.json'),source['commit'])
    if present(fixed.metadata/'d7-runtime-disk.json'):
        prep['runtime_filesystems']=filesystem_observations(read(fixed.metadata/'d7-runtime-disk.json'),source['commit'])
    if present(fixed.metadata/'d7-checkpoints.json'):
        prep['runtime_checkpoints']=checkpoint_projection(read(fixed.metadata/'d7-checkpoints.json'),('inputs','histogram','trial'))
    outcome={'availability':'unavailable',**flags()}
    if present(fixed.prepared/'representative-outcome.json'):outcome=outcome_projection(witness,read(fixed.prepared/'representative-outcome.json'))
    functional={'availability':'unavailable',**flags()}
    if present(fixed.prepared/'representative-functional.json'):functional=functional_projection(read(fixed.prepared/'representative-functional.json'),selected)
    cleanup=cleanup_projection(witness,fixed.prepared,layout) if layout is not None else {'availability':'unavailable',**flags()}
    import importlib.util
    path=ROOT/'scripts/observability-sdk-storage/emitter_phase.py';spec=importlib.util.spec_from_file_location('_d7_emitter_phase',path)
    emitter_phase=importlib.util.module_from_spec(spec);spec.loader.exec_module(emitter_phase)
    phase={'availability':'unavailable',**flags()}
    if present(fixed.prepared/emitter_phase.NAME):
        phase={'availability':'available','sdk':emitter_phase.load_for_collection(fixed.prepared,source=source['commit']),**flags()}
    values=dict(zip(PUBLIC,(source_public,prep,outcome,functional,cleanup,phase)))
    runtime.verify_source(source,runtime.lifecycle.MCP512_PROFILE)
    publish(fixed.public,values)
    runtime.verify_source(source,runtime.lifecycle.MCP512_PROFILE)
    output=Path(os.environ['GITHUB_OUTPUT']);need(output.is_absolute() and not output.is_symlink())
    with output.open('a') as stream:stream.write('safe=true\n')
    need(outcome.get('worker_status')==0 and functional['availability']=='available' and cleanup.get('passed') is True
        and cleanup.get('roles_healthy') is True and prep.get('retirement',{}).get('state')=='retired')


def publish(destination,values):
    need(type(values) is dict and set(values)==set(PUBLIC) and not destination.exists() and destination==destination.resolve())
    payload={name:encoded(values[name]) for name in PUBLIC}
    need(all(0<len(raw)<=LIMIT for raw in payload.values()) and sum(map(len,payload.values()))<=6*LIMIT)
    staging=destination.with_name(destination.name+'.staging')
    need(not present(staging) and staging==staging.resolve())
    staging.mkdir(mode=0o700)
    for name in PUBLIC:write(staging/name,values[name])
    need({path.name for path in staging.iterdir()}==set(PUBLIC))
    for name in PUBLIC:need(encoded(read(staging/name))==payload[name])
    need(not present(destination));os.rename(staging,destination)
    need({path.name for path in destination.iterdir()}==set(PUBLIC))
    for name in PUBLIC:need(encoded(read(destination/name))==payload[name])


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('protocol','minimal-gate','host-measure','host-prepare','trial','recover','collect'))
    parser.add_argument('--group',choices=('1','2','3','4','5'))
    args=parser.parse_args();need((args.action=='protocol')==(args.group is not None))
    with signals():
        if args.action=='protocol':protocol(args.group)
        elif args.action=='minimal-gate':minimal_gate()
        elif args.action=='host-measure':host_measure()
        elif args.action=='host-prepare':host_prepare()
        elif args.action=='trial':prepare_trial()
        elif args.action=='recover':recover()
        else:collect()


if __name__=='__main__':
    try:main()
    except BaseException:
        # Raw schema errors, native buffers and private paths never reach CI logs.
        print('{"private_d7_refused":1}');sys.exit(1)
