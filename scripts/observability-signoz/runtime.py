"""Source-bound native Linux functional witness; no production operation."""
import platform


def require_native_host():
    if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):
        raise ValueError('native_linux_amd64_required')

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import secrets
import subprocess
import sys
import threading
import time
import uuid

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE))
import lifecycle
import evidence
import observer
import supervisor
import agent_probe
sys.path.insert(0,str(ROOT/'scripts/observability-resource'))
import binding as source_binding
import hosted

RUNTIME_SECONDS=600
CLEANUP_SECONDS=90


def source():
    hosted.context()
    if (os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted'
            or os.environ.get('RUNNER_OS')!='Linux' or os.environ.get('RUNNER_ARCH')!='X64'):
        raise ValueError('hosted_linux_amd64_provider_required')
    if subprocess.run(['git','status','--porcelain'],cwd=ROOT,check=True,capture_output=True,text=True).stdout:
        raise ValueError('clean_committed_source_required')
    commit=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,check=True,capture_output=True,text=True).stdout.strip()
    tree=subprocess.run(['git','rev-parse','HEAD^{tree}'],cwd=ROOT,check=True,capture_output=True,text=True).stdout.strip()
    if commit!=os.environ['GITHUB_SHA']:raise ValueError('provider_source_changed')
    paths=(*source_binding.inputs(),ROOT/'.github/workflows/observability-signoz.yml')
    return {'schema':1,'commit':commit,'tree':tree,'repository':os.environ['GITHUB_REPOSITORY'],
        'execution_sha':os.environ['GITHUB_SHA'],'pr_head':os.environ['PILOT_PR_HEAD_SHA'],'pr_base':os.environ['PILOT_PR_BASE_SHA'],
        'run_id':os.environ['GITHUB_RUN_ID'],'run_attempt':os.environ['GITHUB_RUN_ATTEMPT'],
        'inputs':{str(p.relative_to(ROOT)):lifecycle.digest(p) for p in paths},
        'scope':'native Linux amd64 SigNoz functional witness only; full workload/capacity/production unproved'}


def verify_source(record):
    if source()!=record:raise ValueError('source_binding_changed')


def engine(output,seconds):
    directory=output/('engine-'+str(os.getpid())+'-'+uuid.uuid4().hex[:8])
    directory.mkdir(mode=0o700)
    value=lifecycle.Engine(directory,time.monotonic()+seconds);value.freeze();return value


def process_start(pid):
    # /proc stat comm can contain spaces/parentheses; split only after its final closing bracket.
    return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]


def session_groups(session):
    groups=set()
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields=path.read_text().rsplit(')',1)[1].split()
            if int(fields[3])==session and fields[0]!='Z':groups.add(int(fields[2]))
        except FileNotFoundError:pass
    if any(group<=1 or group==os.getpgrp() for group in groups):raise ValueError('foreign_process_group')
    return groups


def stop_worker(record):
    pid=record['pid']
    if type(pid) is not int or pid<=1 or record.get('group')!=pid:raise ValueError('worker_identity_required')
    try:current=process_start(pid)
    except FileNotFoundError:current=None
    if current is not None and current!=record['start_ticks']:raise ValueError('worker_PID_reused')
    if current is None:
        # A late recovery cannot prove the generation of a leaderless session.
        # Refuse live groups rather than risk touching a reused foreign session.
        if session_groups(pid):raise ValueError('session_leader_identity_unavailable')
        return
    # Linux retains a session ID while any of its original groups remain. CLI groups
    # deliberately stay in this session, including after launcher SIGKILL.
    for group in session_groups(pid):
        try:os.killpg(group,signal.SIGTERM)
        except ProcessLookupError:pass
    end=time.monotonic()+1
    while time.monotonic()<end and session_groups(pid):time.sleep(.05)
    for group in session_groups(pid):
        try:os.killpg(group,signal.SIGKILL)
        except ProcessLookupError:pass
    end=time.monotonic()+1
    while time.monotonic()<end:
        if not session_groups(pid):return
        time.sleep(.01)
    raise ValueError('worker_session_not_reaped')


def recover(output,deadline=None):
    deadline=deadline if deadline is not None else time.monotonic()+CLEANUP_SECONDS
    if not (output/'owner.json').exists():return {'passed':True,'state':'no_registered_project'}
    owner=evidence.read(output/'owner.json');verify_source(evidence.read(output/'source.json'))
    if (output.resolve()!=output or owner.get('cwd')!=str(ROOT)
            or re.fullmatch(r'signoz1566-[a-f0-9]{12}',owner.get('project','')) is None
            or re.fullmatch(r'[a-f0-9]{32}',owner.get('nonce','')) is None
            or lifecycle.digest(output/'compose.json')!=owner['plan_sha256']):raise ValueError('recovery_ownership_refused')
    worker_path=output/'worker.json'
    if worker_path.exists():stop_worker(evidence.read(worker_path))
    current=engine(output,max(.001,deadline-time.monotonic()));current.deadline=deadline
    if current.identity!=owner['daemon']:raise ValueError('recovery_daemon_changed')
    own=lifecycle.Owned(current,output,{},owner['project'],owner['nonce']);own.plan=evidence.read(output/'compose.json')
    lock=lifecycle.verify_packet()
    # Acquisition may have failed part-way. Only actual owned roles need cached images.
    prior_path=output/'resources.json'
    prior=evidence.read(prior_path) if prior_path.exists() else None
    if prior is not None and (prior.get('project')!=owner['project'] or prior.get('nonce')!=owner['nonce']):raise ValueError('recovery_receipt_changed')
    own.discover()
    if prior is not None:
        for role,cid in own.containers.items():
            if role in prior['containers'] and (prior['containers'][role]!=cid or prior['created'][role]!=own.created[role]):raise ValueError('recovery_container_replaced')
        for name,identity in own.volumes.items():
            if name in prior['volumes'] and prior['volumes'][name]!=identity:raise ValueError('recovery_volume_replaced')
        for name,identity in own.networks.items():
            if name in prior['networks'] and prior['networks'][name]!=identity:raise ValueError('recovery_network_replaced')
    prior_cleanup=evidence.read(output/'cleanup.json') if (output/'cleanup.json').exists() else None
    prior_states=evidence.read(output/'states.json') if (output/'states.json').exists() else None
    if prior_cleanup is not None and prior_cleanup.get('passed') is True and not own.containers and not own.volumes and not own.networks:return {'passed':True,'state':'already_clean'}
    rows={r['repository'].split('/')[-1]:r for r in lock['images']}
    for role in own.containers:own.images[role]=lifecycle.checked_image(current,rows[lifecycle.ROLE_IMAGES[role]],'amd64')
    # Resource identity is a monotonic registry, including objects already removed.
    # A later cleanup retry must still refuse a recreated role/volume/network.
    registry={'project':owner['project'],'nonce':owner['nonce']}
    for key,current_values in (('containers',own.containers),('created',own.created),('volumes',own.volumes),('networks',own.networks)):
        registry[key]={**(prior.get(key,{}) if prior is not None else {}),**current_values}
    own.record();passed=own.cleanup_exact()
    lifecycle.private_json(output/'resources.json',registry)
    if prior_cleanup is not None:
        lifecycle.private_json(output/'recovery-cleanup.json',json.loads((output/'cleanup.json').read_text()))
        lifecycle.private_json(output/'cleanup.json',prior_cleanup)
        lifecycle.private_json(output/'recovery-states.json',evidence.read(output/'states.json'))
        if prior_states is not None:lifecycle.private_json(output/'states.json',prior_states)
    if passed:
        for name in ('private','driver','agent-driver','agent-admission'):
            if (output/name).exists():shutil.rmtree(output/name)
    return {'passed':passed,'roles_healthy':lifecycle.healthy_states(evidence.read(output/'states.json'))}


def client_namespace(own):
    value=own.validate('agent');helper=own.validate('disk')
    pid=value['State']['Pid'];helper_pid=helper['State']['Pid']
    lifecycle.need(type(pid) is int and pid>1 and type(helper_pid) is int and helper_pid>1,'native_namespace_PID')
    birth=process_start(pid);namespace=os.readlink('/proc/'+str(pid)+'/ns/net')
    host=os.readlink('/proc/self/ns/net');backend=os.readlink('/proc/'+str(helper_pid)+'/ns/net')
    lifecycle.need(all(re.fullmatch(r'net:\[[1-9][0-9]*\]',v) for v in (namespace,host,backend)),'native_namespace_identity')
    lifecycle.need(len({namespace,host,backend})==3 and own.validate('agent')['State']['Pid']==pid
        and process_start(pid)==birth,'native_namespace_changed')
    return namespace,{'schema':1,'network_mode':'none','namespace_inode':int(namespace[5:-1]),
        'host_namespace_inode':int(host[5:-1]),'backend_namespace_inode':int(backend[5:-1])}


def functional_with_client(own,output,remaining):
    current=own.engine;client={'schema':1,'nonce':secrets.token_hex(16),'agent_key':secrets.token_hex(32)}
    lifecycle.private_json(output/'private/client.json',client)
    completed={}
    def functional():
        try:completed['value']=json.loads(own.exec(['functional'],timeout=remaining))
        except BaseException as error:completed['error']=error
    thread=threading.Thread(target=functional,name='owned-signoz-functional',daemon=False);thread.start()
    try:
        identity=None
        while time.monotonic()<current.deadline:
            if 'error' in completed:raise completed['error']
            if not thread.is_alive():raise lifecycle.Refusal('limited_client_gateway_missing')
            candidate=json.loads(own.exec(['socket-identity'],timeout=10))
            lifecycle.need(type(candidate) is dict and type(candidate.get('available')) is bool,'closed_socket_identity')
            if candidate['available']:
                lifecycle.need(set(candidate)=={'available','identity'},'closed_socket_identity')
                identity=candidate['identity'];break
            lifecycle.need(set(candidate)=={'available'},'closed_socket_identity');time.sleep(.1)
        lifecycle.need(identity is not None,'global_deadline')
        own.start('agent');namespace,isolation=client_namespace(own)
        targets={role:own.validate(role)['NetworkSettings']['Networks'][own.plan['networks']['backend']['name']]['IPAddress'] for role in agent_probe.ENDPOINTS}
        config=agent_probe.admission({**client,'remaining_seconds':int(current.deadline-time.monotonic())-1,
            'socket_identity':identity,'targets':targets,'network_namespace':namespace})
        lifecycle.private_json(output/'private/client.json',config)
        lifecycle.private_json(output/'agent-admission/fixture.json',config)
        isolation['socket_identity']=identity;lifecycle.private_json(output/'isolation.json',isolation)
        own.validate('agent')
        raw=own.engine.call(['exec',own.containers['agent'],'python','-B','/driver/agent_probe.py'],
            timeout=max(.001,current.deadline-time.monotonic()))
        result=agent_probe.result(json.loads(raw,object_pairs_hook=agent_probe.unique),config)
        lifecycle.need(client_namespace(own)[0]==namespace,'native_namespace_changed')
        lifecycle.private_json(output/'agent.json',result)
        delivered=json.loads(own.exec(['agent-result',json.dumps(result,separators=(',',':'))],timeout=10))
        lifecycle.need(delivered=={'stored':1},'limited_client_result_unavailable')
        thread.join(timeout=max(0,current.deadline-time.monotonic()))
        lifecycle.need(not thread.is_alive(),'global_deadline')
        if 'error' in completed:raise completed['error']
        return completed['value']
    finally:
        if thread.is_alive():
            current.cancel_thread_children(thread);thread.join(timeout=2)
        lifecycle.need(not thread.is_alive(),'functional_thread_not_reaped')


def worker(output):
    require_native_host();record=json.loads((output/'source.json').read_text());verify_source(record)
    owner=json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid']!=os.getppid():raise ValueError('external_supervisor_required')
    # No native command may begin before the external supervisor durably registers
    # this session. SIGKILL in the launch/registration gap cannot leak native resources.
    registration_deadline=min(owner['deadline'],time.monotonic()+5)
    while not (output/'worker.json').exists() and time.monotonic()<registration_deadline:time.sleep(.01)
    registration=evidence.read(output/'worker.json')
    if registration!={'pid':os.getpid(),'group':os.getpid(),'start_ticks':process_start(os.getpid())}:raise ValueError('worker_registration_required')
    current=engine(output,max(.001,owner['deadline']-time.monotonic()));current.deadline=owner['deadline']
    if current.identity!=owner['daemon']:raise ValueError('worker_daemon_changed')
    own=lifecycle.Owned(current,output,{},owner['project'],owner['nonce']);own.plan=json.loads((output/'compose.json').read_text());lock=lifecycle.verify_packet()
    def interrupted(*_args):raise lifecycle.Refusal('worker_interrupted_or_storage')
    for signum in (signal.SIGTERM,signal.SIGINT,signal.SIGUSR1):signal.signal(signum,interrupted)
    phase='acquire'
    try:
        with lifecycle.storage_guard(current,own,output) as admit_vm:
            helper_row=next(r for r in lock['images'] if r['repository'].endswith('/python'))
            current.call(['pull','--platform','linux/amd64',helper_row['pinned']],timeout=180)
            helper=lifecycle.checked_image(current,helper_row,'amd64');own.images={s:helper for s in ('volume-init','disk','histogram-init')}
            lifecycle.require_declared_volume_coverage(own.plan,own.images)
            own.compose(['create','--no-build','--pull','never','volume-init','disk']);own.discover();own.record()
            own.start('volume-init');own.wait('volume-init',20);own.start('disk');admit_vm()
            own.images=lifecycle.inspect_images(current,lock,acquire=True);lifecycle.private_json(output/'images.json',own.images)
            lifecycle.require_declared_volume_coverage(own.plan,own.images);lifecycle.histogram_asset(output,lock,acquire=True)
            phase='native_create';lifecycle.stage(output,phase)
            own.compose(['--profile','functional','create','--no-build','--pull','never']);own.discover();own.record()
            lifecycle.need(set(own.containers)==set(lifecycle.SERVICES),'complete_owned_roles')
            for name in lifecycle.SERVICES:own.validate(name)
            own.start('histogram-init');own.wait('histogram-init',20)
            phase='PG_keeper';lifecycle.stage(output,phase);own.start('keeper','postgres');own.exec(['ready','postgres'],timeout=60)
            phase='CH';lifecycle.stage(output,phase);own.start('clickhouse');own.exec(['ready','clickhouse'],timeout=60)
            phase='migrations';lifecycle.stage(output,phase);own.start('migrator');own.wait('migrator',240)
            phase='collector_server';lifecycle.stage(output,phase);own.start('collector','server');own.exec(['ready','collector'],timeout=60);own.exec(['ready','server'],timeout=60)
            phase='postgres_counts';lifecycle.stage(output,phase)
            counts=observer.observe(own);lifecycle.private_json(output/'postgres.json',counts)
            lifecycle.need(counts['available'] and counts['counts']['applied_migrations']>0,'migration_counts_unavailable')
            phase='native_MCP';lifecycle.stage(output,phase);own.start('mcp')
            remaining=int(current.deadline-time.monotonic())
            lifecycle.need(remaining>1,'global_deadline')
            lifecycle.private_json(output/'private/admission.json',{'remaining_seconds':remaining-1,'owner':lifecycle.OWNER})
            phase='functional';lifecycle.stage(output,phase)
            result=functional_with_client(own,output,remaining)
            required=evidence.FACTS
            lifecycle.need(all(type(result.get(k)) is int and result[k]==1 for k in required),'incomplete_functional_witness')
            lifecycle.private_json(output/'functional.json',result)
            final_states=own.snapshot_states();lifecycle.private_json(output/'final-states.json',final_states)
            lifecycle.need(lifecycle.healthy_states(final_states),'unhealthy_final_roles')
    except BaseException as error:
        lifecycle.private_json(output/'failure.json',{'phase':phase,'category':type(error).__name__,'reason':error.reason if isinstance(error,lifecycle.Refusal) else 'functional_failure','native_failure_capture_unavailable':getattr(current,'failure_capture_unavailable',False)})
        raise


def run(output):
    require_native_host();started=time.monotonic();record=source()
    if output.exists() or output.resolve()!=output or not output.is_absolute():raise ValueError('fresh_absolute_private_output_required')
    output.mkdir(mode=0o700);lifecycle.private_json(output/'source.json',record)
    status=1;process=None;cleanup={'passed':False};cancelled=[False]
    def cancel(*_args):cancelled[0]=True
    previous={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT)}
    for s in previous:signal.signal(s,cancel)
    try:
        current=engine(output,max(.001,RUNTIME_SECONDS-(time.monotonic()-started)));lock=lifecycle.verify_packet()
        project='signoz1566-'+uuid.uuid4().hex[:12];nonce=uuid.uuid4().hex
        lifecycle.write_private_files(output,lock)
        plan=lifecycle.make_plan(output,lock['images'],project,nonce,os.getuid(),os.getgid());lifecycle.private_json(output/'compose.json',plan)
        lifecycle.private_json(output/'owner.json',{'project':project,'nonce':nonce,'cwd':str(ROOT),'daemon':current.identity,'supervisor_pid':os.getpid(),'deadline':started+RUNTIME_SECONDS,'plan_sha256':lifecycle.digest(output/'compose.json')})
        if cancelled[0]:raise lifecycle.Refusal('supervisor_interrupted')
        process=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'worker','--output',str(output)],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        lifecycle.private_json(output/'worker.json',{'pid':process.pid,'group':process.pid,'start_ticks':process_start(process.pid)})
        status=supervisor.wait(process,started+RUNTIME_SECONDS,lambda:cancelled[0])
    finally:
        cleanup_started=time.monotonic();cleanup_deadline=cleanup_started+CLEANUP_SECONDS
        worker_seconds=cleanup_started-started
        for s in previous:signal.signal(s,signal.SIG_IGN)
        stopped=True
        if process is not None:
            try:stop_worker(evidence.read(output/'worker.json'))
            except Exception:stopped=False
            finally:
                try:
                    if stopped:process.wait(timeout=1)
                    else:supervisor.stop(process)
                except Exception:stopped=False
        try:cleanup=recover(output,cleanup_deadline)
        except Exception:cleanup={'passed':False,'state':'exact_cleanup_unavailable'}
        cleanup['passed']=cleanup['passed'] and stopped
        for s,value in previous.items():signal.signal(s,value)
        accepted=status==0 and worker_seconds<=RUNTIME_SECONDS and cleanup['passed'] and cleanup.get('roles_healthy') is True
        lifecycle.private_json(output/'outcome.json',{'passed':accepted,'worker_exit':status,'worker_seconds':worker_seconds,'runtime_limit_seconds':RUNTIME_SECONDS,'cleanup':cleanup,'full_workload':False,'capacity_acceptance':False})
    return 0 if accepted else 1


def collect(output,destination):
    return evidence.collect(output,destination,verify_source)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('run','worker','recover','collect'));parser.add_argument('--output',type=Path,required=True);parser.add_argument('--public',type=Path);args=parser.parse_args()
    if args.mode=='collect':return 0 if collect(args.output,args.public) else 1
    require_native_host()
    if args.mode=='run':return run(args.output)
    if args.mode=='worker':worker(args.output);return 0
    return 0 if recover(args.output)['passed'] else 1


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:
        print('{"signoz_witness_failed":1}');raise SystemExit(1)
