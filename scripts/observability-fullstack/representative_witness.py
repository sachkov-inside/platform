"""Private source preparation for one native representative trial, not activation.

The public selector/CI remain closed. One worker owns every native CLI child and
host emitter. SOURCE-MODEL tests do not establish Linux/Engine/storage acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

import representative_owner as owners
import representative_scope as scopes

ROOT=Path(__file__).resolve().parents[2]


def need(ok,reason='representative_witness_contract'):
    if not ok:raise ValueError(reason)


def _native_runtime():
    name='_representative_trial_runtime';path=ROOT/'scripts/observability-signoz/runtime.py'
    if name in sys.modules:
        module=sys.modules[name];need(Path(module.__file__).resolve()==path);return module
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    original=list(sys.path)
    try:
        sys.path.insert(0,str(path.parent));spec.loader.exec_module(module)
    finally:sys.path[:]=original
    sys.modules[name]=module;return module


def _register(process,prepared):
    """Write/fsync exact birth receipt BEFORE releasing this owned child's stdin."""
    need(process.stdin is not None and process.poll() is None and process.pid>1 and os.getpgid(process.pid)==process.pid)
    record={'pid':process.pid,'group':process.pid,'start_ticks':_native_runtime().process_start(process.pid)}
    owners._worker_record(record)
    scopes._write(prepared/'worker.json',scopes._encoded(record))
    need(owners._worker(prepared)==record)
    process.stdin.write(b'1');process.stdin.flush();process.stdin.close()
    return record


def _parallel_corpus(owner,engine,prepared,started,release):
    """Fixed bootstrap/read/agent calls; every failure keeps its original object/TB."""
    failures=[];bootstrap={};read={};lock=threading.Lock()
    def capture(destination,action):
        try:destination['result']=action()
        except BaseException:
            with lock:failures.append(sys.exc_info())
    control=threading.Thread(target=capture,args=(bootstrap,owner.bootstrap),name='representative-control')
    control.start();dispatch=None;read_thread=None
    try:
        owner.prepare_agent()
        _publish_challenge(engine.deadline)
        _sample_sources(owner,engine,prepared)
        web=_web_witness(owner,engine,release)
        cut=int(time.time()*1000)
        dispatch=scopes.mint(owner,8,started,cut,web)
        read_thread=threading.Thread(target=capture,args=(read,dispatch.read),name='representative-read')
        read_thread.start()
        agent=owner.agent()
        read_thread.join(timeout=10)
        need(not read_thread.is_alive(),'representative_read_not_reaped')
        control.join(timeout=10)
        need(not control.is_alive(),'representative_control_not_reaped')
        if failures:raise failures[0][1].with_traceback(failures[0][2])
        need(read['result']=={'ok':True})
        return {'agent':agent,'control':bootstrap['result']}
    except BaseException:
        # Selectively cancel only owned Engine threads. Secondary stop/join errors
        # cannot replace the original failure object and traceback.
        first=failures[0] if failures else sys.exc_info()
        try:owner._cancel_readers(control,read_thread)
        except BaseException:pass
        try:
            if read_thread is not None:read_thread.join(timeout=2)
            control.join(timeout=2)
        except BaseException:pass
        raise first[1].with_traceback(first[2])
    finally:
        if dispatch is not None and not read.get('result'):
            try:dispatch.close()
            except BaseException:pass


_RECEIPT_COUNTERS=('requests','submitted_spans','acknowledged_spans','rejected_spans','partial_responses',
    'partial_warnings','failed_requests','unknown_outcomes')


def helper_receipt(value,*,binding,source_sha256,previous=None):
    """Validate the fixed private helper read envelope; never fill missing counts."""
    need(type(value) is dict and set(value)=={'receipt','identity','process_start_ticks','cgroup_sha256','source_sha256','read_start_ns','read_end_ns'})
    info=value['identity'];need(type(info) is list and len(info)==4 and all(type(v) is int and v>=0 for v in info)
        and info[1]>0 and info[2]==os.getuid() and info[3]==1,'representative_helper_inode')
    need(type(value['read_start_ns']) is int and type(value['read_end_ns']) is int
        and 0<value['read_start_ns']<=value['read_end_ns']<=time.monotonic_ns() and value['read_end_ns']-value['read_start_ns']<3*10**9)
    need(value['source_sha256']==source_sha256 and scopes._hex(source_sha256,64))
    receipt=value['receipt'];need(type(receipt) is dict and set(receipt)=={'schema','binding','instance','pid','process_start_ticks','cgroup_sha256',*_RECEIPT_COUNTERS})
    need(type(receipt['schema']) is int and receipt['schema']==1 and receipt['binding']==binding
        and scopes._hex(receipt['instance'],32) and type(receipt['pid']) is int and receipt['pid']==1
        and type(receipt['process_start_ticks']) is int and receipt['process_start_ticks']>0
        and receipt['process_start_ticks']==value['process_start_ticks'] and scopes._hex(receipt['cgroup_sha256'],64)
        and receipt['cgroup_sha256']==value['cgroup_sha256'])
    need(all(type(receipt[k]) is int and 0<=receipt[k]<=2**53-1 for k in _RECEIPT_COUNTERS))
    need(receipt['acknowledged_spans']+receipt['rejected_spans']<=receipt['submitted_spans'])
    if previous is not None:
        need(all(receipt[k]==previous[k] for k in ('binding','instance','pid','process_start_ticks','cgroup_sha256'))
            and all(receipt[k]>=previous[k] for k in _RECEIPT_COUNTERS),'representative_helper_replay')
    need(all(receipt[k]==0 for k in ('rejected_spans','partial_responses','partial_warnings','failed_requests','unknown_outcomes')),
        'representative_helper_unproved_outcome')
    return receipt


def coordinate(prepared,bindings,images):
    """Private D7 call site, never registered as a CLI/selector/workflow in D2-D6.

    Callers must separately satisfy the reviewed source/minimal-MCP native gate.
    This function itself requires the actual owning hosted Linux source context.
    """
    runtime=_native_runtime();runtime.require_native_host()
    source=runtime.source(runtime.lifecycle.MCP512_PROFILE)
    need(bindings['source']=={k:source[k] for k in ('commit','tree')},'representative_native_source')
    owners._canonical(prepared,bindings,images,admit=True)
    deadline=time.monotonic()+600
    admission={'schema':1,'bindings':bindings,'images':images,'deadline_mono_ns':int(deadline*10**9),'source':source}
    scopes._write(prepared/'representative-trial.json',scopes._encoded(admission))
    process=None;record=None;first=None;status=None;cleanup=None
    try:
        # Literal worker entrypoint. No role/argv/module/path policy from an agent.
        process=subprocess.Popen([sys.executable,'-I','-B',str(Path(__file__).resolve()),'--worker',str(prepared)],
            cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        record=_register(process,prepared)
        status=runtime.supervisor.wait(process,deadline,lambda:False)
    except BaseException:first=sys.exc_info()
    finally:
        try:
            if record is not None:runtime.stop_worker(record)
            elif process is not None:runtime.supervisor.stop(process)
        except BaseException:
            if first is None:first=sys.exc_info()
        # Independent cleanup runs after the worker session is stopped. Its
        # bounded tail ends at the ORIGINAL owner deadline+90, never a retry600.
        if (prepared/'representative-owner/resources.json').exists():
            try:
                end=min(deadline+90,time.monotonic()+90)
                need(time.monotonic()<end,'representative_cleanup_deadline')
                engine=runtime.engine(prepared,end-time.monotonic());engine.deadline=end
                owner=owners.CompositeOwner.recover(engine,prepared,bindings,images)
                cleanup=owner.cleanup_exact()
            except BaseException:
                if first is None:first=sys.exc_info()
        if process is not None:
            try:process.wait(timeout=2)
            except BaseException:
                if first is None:first=sys.exc_info()
    if first is not None:raise first[1].with_traceback(first[2])
    need(status==0 and cleanup is True,'representative_trial_failed')
    return {'functional_evidence':True,'full_workload':False,'capacity_acceptance':False,'cleanup':True}


def _worker(prepared):
    runtime=_native_runtime();runtime.require_native_host()
    need(sys.stdin.buffer.read(1)==b'1','representative_registration_barrier')
    record=owners._worker(prepared)
    need(record=={'pid':os.getpid(),'group':os.getpgrp(),'start_ticks':runtime.process_start(os.getpid())})
    raw,_=scopes._read(prepared/'representative-trial.json',private=True,maximum=65536)
    admission=json.loads(raw,object_pairs_hook=scopes._unique)
    need(type(admission) is dict and set(admission)=={'schema','bindings','images','deadline_mono_ns','source'}
        and admission['schema']==1 and type(admission['deadline_mono_ns']) is int)
    deadline=admission['deadline_mono_ns']/10**9;need(0<deadline-time.monotonic()<=600)
    runtime.verify_source(admission['source'],runtime.lifecycle.MCP512_PROFILE)
    engine=runtime.engine(prepared,deadline-time.monotonic());engine.deadline=deadline
    owner=owners.CompositeOwner.prepare(engine,prepared,admission['bindings'],admission['images'])
    result=None;first=None
    try:
        owner.create();_startup(owner,engine,prepared)
        started=int(time.time()*1000)-1
        observed,cost=_emit_sdk(prepared,admission['bindings']['source']['commit'],deadline)
        owner.prepare_native_session(observed)
        binding={**admission['bindings']['source'],'nonce':admission['bindings']['nonce'],'project':admission['bindings']['project']}
        source_hash=hashlib.sha256((ROOT/'scripts/observability-fullstack/trace_sanitizer.py').read_bytes()).hexdigest()
        before=helper_receipt(owner.helper_receipt(),binding=binding,source_sha256=source_hash)
        result=_parallel_corpus(owner,engine,prepared,started,admission['bindings']['source']['commit'])
        after=helper_receipt(owner.helper_receipt(),binding=binding,source_sha256=source_hash,previous=before)
        need(after['submitted_spans']>before['submitted_spans'] and after['acknowledged_spans']==after['submitted_spans'],
            'representative_before_storage_path_unproved')
        loadgen=_loadgen_isolation(owner,engine)
        need(owner.snapshot()['roles_healthy'],'representative_roles_unhealthy')
        scopes._write(prepared/'representative-functional.json',scopes._encoded({'schema':1,'source':admission['bindings']['source'],
            'control':result['control'],'agent':result['agent'],'sdk_host_cost':cost,'helper_requests':after['requests'],
            'helper_acknowledged_spans':after['acknowledged_spans'],'full_workload':False,'capacity_acceptance':False,
            'privacy':'unknown','loadgen_isolation':loadgen,'native_known_probe_cases':result['control']['sdk']['native_probe_cases']}))
    except BaseException:first=sys.exc_info()
    finally:
        # Worker does not reap its leader or broaden cleanup authority. The outer
        # coordinator retains the born leader and performs exact independent reap.
        if first is not None:
            try:scopes._write(prepared/'representative-failure.json',scopes._encoded({'schema':1,'failed':True,'native_proof':'incomplete'}))
            except BaseException:pass
    if first is not None:raise first[1].with_traceback(first[2])


def _startup(owner,engine,prepared):
    """Fixed existing38-role catalogue, with all eight one-shot receipts."""
    plan=json.loads((prepared/'compose.json').read_bytes())
    need(plan['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED']=='true'
        and all(plan['services'][role]['environment']['INSIDE_OTEL_ENABLED']=='true' for role in owners.core_layout.BACKENDS),
        'representative_prepared_on_mode_required')
    lifecycle=owners.core_layout.signoz_lifecycle()
    lifecycle.histogram_asset(prepared/'signoz',lifecycle.verify_packet(),acquire=False)
    owner.start('sig-volume-init');owner.wait('sig-volume-init')
    owner.start('sig-disk','sig-histogram-init');owner.wait('sig-histogram-init')
    owner.start('sig-keeper','sig-postgres','postgres');_await_healthy(owner,'postgres',engine.deadline)
    owner.start('sig-clickhouse','sig-migrator');owner.wait('sig-migrator')
    owner.start('sig-collector','sig-server','sig-mcp','sig-agent','sig-trace-sanitizer')
    disk=owner.validate('sig-disk')
    raw=engine.call(['exec',disk['Id'],'python','/driver/inside.py','ready','server'],timeout=min(60,engine.deadline-time.monotonic()))
    need(json.loads(raw)=={'ready':1});owner.validate('sig-disk')
    owner.start('migrations','telegram-migrations','logto-migrations')
    for role in ('migrations','telegram-migrations','logto-migrations'):owner.wait(role)
    broker=owner.validate('broker-config')
    raw=engine.call(['start','-a',broker['Id']],timeout=min(30,engine.deadline-time.monotonic()))
    need(0<len(raw.encode())<=65536 and type(json.loads(raw)) is dict,'representative_broker_definitions')
    owner.wait('broker-config')
    path=prepared/'runtime/rabbitmq/definitions.json'
    scopes._write(path,raw.encode());path.chmod(0o644)
    owner.start('rabbitmq','provider','bot-provider','loadgen','logto','web','caddy','umami','umami-ingest','umami-query')
    owner.start(*owners.core_layout.BACKENDS,'telegram','alloy','host-agent')
    for role in ('api','web','rabbitmq','logto','telegram'): _await_healthy(owner,role,engine.deadline)
    import fullstack
    import ssl
    caddy=owner.validate('caddy')
    ca=engine.call(['exec',caddy['Id'],'sh','-c',fullstack.extra.CA_READ],timeout=min(5,engine.deadline-time.monotonic()))
    need(128<=len(ca.encode())<=16384);ssl.PEM_cert_to_DER_cert(ca)
    scopes._write(prepared/'provider/caddy-root.pem',ca.encode())
    loadgen=owner.validate('loadgen')
    warmup=engine.call(['exec',loadgen['Id'],'node','/resource/fullstack.mjs','source-warmup'],timeout=min(4,engine.deadline-time.monotonic()))
    need(json.loads(warmup)=={'ok':True})
    owner.start('volume-reader');owner.wait('volume-reader')
    need(owner.snapshot()['roles_healthy'],'representative_startup_failed')


def _await_healthy(owner,role,deadline):
    # Only startup readiness waits. No query failure is retried or hidden.
    while time.monotonic()<deadline:
        value=owner.validate(role);state=value['State']
        need(state['Running'] and not state['OOMKilled'] and state['ExitCode']==0)
        check=value['Config'].get('Healthcheck',{}).get('Test',[])
        if not check or check==['NONE']:return
        health=state.get('Health');need(type(health) is dict and health.get('Status') in ('starting','healthy','unhealthy'))
        if health['Status']=='healthy':return
        need(health['Status']!='unhealthy','representative_startup_health')
        time.sleep(min(.1,max(0,deadline-time.monotonic())))
    raise ValueError('representative_startup_deadline')


def _emit_sdk(prepared,release,deadline):
    """Existing compiled production emitter, one S3 request, inherited worker session."""
    import selectors
    import resource
    path=ROOT/'scripts/observability-sdk-storage/sdk_storage.py'
    spec=importlib.util.spec_from_file_location('_representative_sdk_producer',path)
    module=importlib.util.module_from_spec(spec);original=list(sys.path)
    for name in ('oracle','diagnostics','sdk_semantics','emitter_phase'):
        existing=sys.modules.get(name)
        need(existing is None or Path(existing.__file__).resolve()==path.with_name(name+'.py'),'representative_sdk_import_substitution')
    try:
        sys.path.insert(0,str(path.parent));spec.loader.exec_module(module)
    finally:sys.path[:]=original
    budget=min(30,deadline-time.monotonic());need(budget>0)
    # The owning emitter supplies source, module, trace/root and flush diagnostics.
    # rusage delta includes the single emitter child in this otherwise quiescent
    # host-child window. Peak RSS is measured from that born Linux PID itself.
    child=None;stop=threading.Event();samples=[];birth=None;first=None
    before=resource.getrusage(resource.RUSAGE_CHILDREN);started=time.monotonic()
    try:
        with module.emitter_phase.OwnedSdkPhase(prepared,source=release) as phase:
            environment=phase.environment({**os.environ,'SDK_STORAGE_RELEASE':release})
            child=subprocess.Popen(['node',str(path.with_name('emitter.mjs'))],cwd=ROOT,env=environment,
                stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            birth=_native_runtime().process_start(child.pid)
            need(os.getsid(child.pid)==os.getsid(0),'representative_emitter_session')
            def sample():
                while not stop.is_set():
                    try:
                        need(_native_runtime().process_start(child.pid)==birth)
                        fields=Path('/proc/'+str(child.pid)+'/status').read_text().splitlines()
                        peaks=[line.split()[1] for line in fields if line.startswith('VmHWM:')]
                        if peaks:samples.append(int(peaks[0])*1024)
                    except FileNotFoundError:return
                    except BaseException:return
                    stop.wait(.01)
            monitor=threading.Thread(target=sample,name='representative-emitter-cost');monitor.start()
            data=bytearray();end=min(deadline,started+budget)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout,selectors.EVENT_READ)
                    while True:
                        remaining=end-time.monotonic();need(remaining>0,'representative_emitter_deadline')
                        need(selector.select(remaining),'representative_emitter_deadline')
                        part=os.read(child.stdout.fileno(),min(65536,524289-len(data)))
                        if not part:break
                        data.extend(part);need(len(data)<=524288,'representative_emitter_size')
                need(child.wait(timeout=max(.001,end-time.monotonic()))==0,'representative_emitter_exit')
            finally:stop.set();monitor.join(timeout=1);need(not monitor.is_alive(),'representative_emitter_monitor_reap')
            observed=module.witness(json.loads(data,object_pairs_hook=scopes._unique))
        after=resource.getrusage(resource.RUSAGE_CHILDREN)
        need(samples,'representative_emitter_cost_unknown')
        return observed,{'wall_seconds':time.monotonic()-started,'cpu_user_seconds':after.ru_utime-before.ru_utime,
            'cpu_system_seconds':after.ru_stime-before.ru_stime,'observed_peak_rss_bytes':max(samples),'rss_sample_period_seconds':.01,'child_count':1}
    except BaseException as error:first=error;raise
    finally:
        if child is not None:
            try:
                if child.poll() is None:
                    child.terminate()
                    try:child.wait(timeout=1)
                    except subprocess.TimeoutExpired:child.kill();child.wait(timeout=1)
                child.stdout.close()
            except BaseException:
                if first is None:raise


def _web_witness(owner,engine,release):
    native=owner.validate('loadgen')
    raw=engine.call(['exec',native['Id'],'node','/resource/fullstack.mjs','web-http-witness',release],timeout=min(8,engine.deadline-time.monotonic()))
    owner.validate('loadgen');value=json.loads(raw,object_pairs_hook=scopes._unique)
    # Reuse the same exact scope validator, including real process epoch and two
    # actual incremented request counters from the source-owned Web producer.
    cut=int(time.time()*1000)
    scopes._window(4,cut-60000,cut,value)
    return value


def _sample_sources(owner,engine,prepared):
    import fullstack
    cache=fullstack.source_cache
    postgres=owner.validate('postgres');caddy=owner.validate('caddy')
    bootstrap=cache.postgres_setup_sql()
    engine.call(['exec',postgres['Id'],'psql','-X','-qAt','-U','postgres','-d','inside','-v','ON_ERROR_STOP=1','-c',bootstrap],timeout=min(3,engine.deadline-time.monotonic()))
    adapted=engine.call(['exec',caddy['Id'],'caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],timeout=min(3,engine.deadline-time.monotonic()))
    partition=cache.select_caddy_server(adapted.encode())
    def postgres_read(query):
        need(query==cache.postgres_sql())
        raw=engine.call(['exec',postgres['Id'],'psql','-X','-qAt','-U','postgres_source_reader','-d','inside','-v','ON_ERROR_STOP=1','-c',query],timeout=min(3,engine.deadline-time.monotonic()))
        need(len(raw.encode())<=4096);owner.validate('postgres');return raw.encode()
    def caddy_read():
        raw=engine.call(['exec',caddy['Id'],'wget','-Y','off','-q','-T','2','-O','-','http://127.0.0.1:9091/metrics'],timeout=min(3,engine.deadline-time.monotonic()))
        need(len(raw.encode())<=65536);owner.validate('caddy');return raw.encode()
    result=cache.sample(prepared/'watchdog-fixture',postgres_read=postgres_read,caddy_read=caddy_read,caddy_server=partition,clock=time.time)
    need(result=={'postgresql':'observed','caddy':'observed'},'representative_source_producer_unavailable')
    return result


def _publish_challenge(deadline):
    """Real OTLP through retained Alloy; never INSERT fabricated storage rows."""
    import http.client
    # Literal unchanged primary challenge and precondition run before the explicit
    # link-metadata extension. Neither is edited or replaced by this adapter.
    original=list(sys.path);directory=ROOT/'scripts/observability-signoz'
    try:
        for name in ('control','gateway','agent_probe','metric_recipe'):
            module=sys.modules.get(name)
            need(module is None or Path(module.__file__).resolve()==directory/(name+'.py'),'representative_source_import_substitution')
        sys.path.insert(0,str(directory))
        path=directory/'functional_witness.py';spec=importlib.util.spec_from_file_location('_representative_privacy_corpus',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    finally:sys.path[:]=original
    import collector_privacy
    import representative_stored
    payload=collector_privacy.challenge(module.corpus());collector_privacy.require_supported_links(payload)
    secondary=representative_stored.private_link_challenge(payload)
    for corpus in (payload,{'traces':secondary['traces']}):
        for signal,body in corpus.items():
            connection=http.client.HTTPConnection('127.0.0.1',14318,timeout=min(5,deadline-time.monotonic()));first=None
            try:
                connection.request('POST','/v1/'+signal,scopes._encoded(body),{'Content-Type':'application/json','Connection':'close'})
                response=connection.getresponse();raw=response.read(16385)
                need(response.status==200 and len(raw)<=16384 and time.monotonic()<deadline)
                value={} if not raw else json.loads(raw,object_pairs_hook=scopes._unique)
                need(type(value) is dict and set(value)<={'partialSuccess'} and value.get('partialSuccess',{})=={},'representative_ingest_partial')
            except BaseException as error:first=error;raise
            finally:
                try:connection.close()
                except BaseException:
                    if first is None:raise


_LOADGEN_DENIAL=r"""const net=require('node:net');const dns=require('node:dns/promises');
const config=JSON.parse(process.argv[1]);
function denied(host,port){return new Promise((resolve,reject)=>{
 const socket=net.createConnection({host,port});
 socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('kernel_denial_required'));});
 socket.once('connect',()=>{socket.destroy();reject(new Error('backend_reachable'));});
 socket.once('error',error=>{socket.destroy();error.code==='ENETUNREACH'?resolve():reject(new Error('kernel_denial_required'));});
});}
(async()=>{let direct=0,alias=0,unknown=0;
 for(const value of Object.values(config)){
  for(const port of value.ports){await denied(value.ip,port);direct++;}
  let addresses;try{addresses=await dns.lookup(value.alias,{all:true,family:4});}catch{unknown+=value.ports.length;continue;}
  if(addresses.length!==1||addresses[0].address!==value.ip)throw new Error('alias_identity');
  for(const port of value.ports){await denied(value.alias,port);alias++;}
 }
 process.stdout.write(JSON.stringify({direct_ip_denials:direct,alias_kernel_denials:alias,alias_dns_unknown:unknown}),()=>process.exit(0));
})().catch(()=>process.exit(1));"""


def _loadgen_isolation(owner,engine):
    import representative_agent as agent
    config={}
    for role,(alias,ports) in agent.ENDPOINTS.items():
        value=owner.validate('sig-'+role)
        backends=[row for name,row in value['NetworkSettings']['Networks'].items() if name.endswith('_sig-backend')]
        need(len(backends)==1 and backends[0].get('IPAddress'))
        config[role]={'ip':backends[0]['IPAddress'],'alias':alias,'ports':list(ports)}
    native=owner.validate('loadgen')
    raw=engine.call(['exec',native['Id'],'node','-e',_LOADGEN_DENIAL,json.dumps(config,separators=(',',':'))],timeout=min(5,engine.deadline-time.monotonic()))
    owner.validate('loadgen');value=json.loads(raw,object_pairs_hook=scopes._unique)
    need(type(value) is dict and set(value)=={'direct_ip_denials','alias_kernel_denials','alias_dns_unknown'}
        and all(type(v) is int and 0<=v<=11 for v in value.values()) and value['direct_ip_denials']==11
        and value['alias_kernel_denials']+value['alias_dns_unknown']==11,'representative_loadgen_kernel_denial')
    # host-agent's trusted hostsource bridge is deliberately outside the ordinary
    # reader/loadgen denial matrix. No claim of its equivalent isolation is made.
    return value


if __name__=='__main__':
    try:
        need(len(sys.argv)==3 and sys.argv[1]=='--worker')
        prepared=Path(sys.argv[2]);need(prepared.is_absolute() and prepared==prepared.resolve())
        _worker(prepared)
    except BaseException:
        # Keep native exception/key/telemetry text private. The outer coordinator
        # retains the first owned Engine error and the independent cleanup result.
        sys.exit(1)
