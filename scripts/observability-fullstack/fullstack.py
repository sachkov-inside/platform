#!/usr/bin/env python3
"""Bounded whole-application monitoring experiment on a task-owned Linux runner."""
import argparse
import copy
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE.parent/'observability-resource'))
import runtime as resource_runtime
import fixture
import preparation
import hosted
import measurements
sys.path.insert(0,str(HERE.parent/'observability-production'))
import production
import measure as technical
import acceptance
pilot=resource_runtime.pilot
PROFILE=ROOT/'infra/observability/fullstack/profile.json'
BACKENDS=production.BACKENDS
APPS=(*BACKENDS,'web','rabbitmq','postgres','umami','provider','loadgen')
CORE=(*pilot.SERVICES,'host-agent','umami-ingest','umami-query')
SERVICES=(*APPS,*CORE,'migrations','broker-config')
PREFIX='inside-observability-fullstack-'
ARTIFACTS=(*(f'fullstack-phase-{index}.json' for index in range(12)),'fullstack-proof.json','fullstack-source.json','evidence.json','cleanup.json','worker-outcome.json','monitor-failure.json')


def invoke(compose,args,**options):return resource_runtime.invoke(compose,args,**options)


def sql(compose,query,*,role='postgres',database='postgres',timeout=15):
    return invoke(compose,['exec','-T','postgres','psql','-X','-qAt','-U',role,'-d',database,'-v','ON_ERROR_STOP=1'],payload=query,timeout=timeout)


def inputs(output, images):
    acceptance.validate_profile(json.loads(PROFILE.read_text()))
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    pins=json.loads(images.read_text())
    if set(pins)!={'schema','source','owner','backend','foundation','web'} or pins['schema']!=2 or pins['source']!=source or not re.fullmatch(r'sha256:[0-9a-f]{64}',pins['web']):raise ValueError('fullstack_source_images')
    base={key:pins[key] for key in ('source','owner','backend','foundation')}|{'schema':1}
    fixture.prepare(output,base)
    found=pilot.command(['docker','image','inspect',pins['owner']+'-web:v1','--format','{{.Id}}']).strip()
    if found!=pins['web']:raise ValueError('web_source_identity')
    plan=json.loads((output/'compose.json').read_text())
    settings=acceptance.validate_profile(json.loads(PROFILE.read_text()))
    monitor=output/'monitoring'
    production.prepare(monitor,data=output/'monitoring-data',project='inside-observability-full-'+os.urandom(6).hex())
    core=json.loads((monitor/'compose.json').read_text())
    for name in ('metrics','logs','traces','grafana'):
        if name!='grafana':core['services'][name]['user']='0:0'
        core['services'][name]['volumes'][0]=name+':'+('/var/lib/grafana' if name=='grafana' else '/data')
    core['services']['alloy']['ports'].append('127.0.0.1:14318:4318')
    plan['services'].update(core['services']);plan['networks'].update(core['networks'])
    for name in ('provider','loadgen','api','migrations','postgres'):plan['services'][name]['networks']=['pilot','telemetry'] if name=='api' else ['pilot']
    api=plan['services']['api'];api['environment']['INSIDE_OTEL_ENDPOINT']='http://inside-telemetry:4318'
    for name in BACKENDS:
        if name=='api':continue
        plan['services'][name]=copy.deepcopy(api)
        plan['services'][name]['command']=['node','dist/entrypoints/'+name+'.js']
        plan['services'][name]['env_file']=[str(output/'runtime/runtime.env'),str(output/'runtime'/ (name+'.env'))]
        plan['services'][name]['healthcheck']={'test':['CMD','node','dist/infrastructure/worker-healthcheck.js'],'interval':'30s','timeout':'3s','retries':2,'start_period':'40s'} if name!='mcp' else {'test':['CMD','node','healthcheck/http-healthcheck.mjs','mcp'],'interval':'30s','timeout':'3s','retries':2}
    plan['services']['web']={'image':pins['web'],'init':True,'networks':['pilot','telemetry'],'mem_limit':'512m','cpus':1,'pids_limit':256,
        'env_file':[str(output/'runtime/runtime.env'),str(output/'runtime/web.env')],'logging':{'driver':'none'}}
    plan['services']['provider']['environment']={'INSIDE_RESOURCE_ACCOUNT_COUNT':str(settings['accounts'])}
    (output/'query/key').write_text((monitor/'reader.key').read_text())
    broker=output/'runtime/rabbitmq';broker.mkdir(mode=0o755)
    pilot.command(['bash',str(ROOT/'infra/production/broker/issue-broker-tls.sh'),str(broker/'tls'),'2','2'],timeout=15)
    (broker/'tls/ca-key.pem').unlink()
    for path in (broker,broker/'tls'):path.chmod(0o755)
    for path in (broker/'tls').iterdir():path.chmod(0o644)
    content=(ROOT/'compose.production.yaml').read_text().split('    content: |\n',1)[1]
    (broker/'rabbitmq.conf').write_text('\n'.join(line[6:] for line in content.splitlines())+'\n')
    plan['services']['rabbitmq']={'image':'ghcr.io/sachkov-inside/rabbitmq:4.2.4-alpine@sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47','hostname':'rabbitmq','user':'rabbitmq','networks':['pilot'],
        'mem_limit':'768m','cpus':1,'pids_limit':512,'volumes':['broker-data:/var/lib/rabbitmq',str(broker)+':/etc/inside/broker:ro',str(broker/'rabbitmq.conf')+':/etc/rabbitmq/rabbitmq.conf:ro'],'logging':{'driver':'none'}}
    plan['volumes']['broker-data']={}
    notify=plan['services']['notifications-worker'];notify['volumes'].append(str(broker/'tls/ca.pem')+':/etc/inside/broker-ca.pem:ro')
    plan['services']['broker-config']=copy.deepcopy(notify)
    plan['services']['broker-config'].pop('healthcheck',None)
    plan['services']['broker-config']['command']=['node','dist/release/write-notification-broker-definitions.js']
    plan['services']['broker-config']['environment']['NOTIFICATIONS_TELEGRAM_BROKER_URL']='amqps://telegram:inside-production-smoke-telegram-password@rabbitmq:5671/inside-production-smoke?heartbeat=30'
    analytics=json.loads((monitor/'umami.compose.json').read_text())
    for name,item in analytics['services'].items():
        name='umami-query' if name=='query' else name
        item.pop('profiles',None);item['networks']=['pilot'] if name=='umami' else ['pilot','telemetry']
        plan['services'][name]=item
    for item in plan['services'].values():item['pull_policy']='never';item.pop('restart',None)
    for name in ('loadgen','provider'):
        plan['services'][name]['volumes'] += [str(HERE/'client.mjs')+':/resource/fullstack.mjs:ro',str(HERE/'responses.mjs')+':/resource/responses.mjs:ro',str(HERE/'test-responses.mjs')+':/resource/test-responses.mjs:ro',str(PROFILE)+':/resource/full-profile.json:ro']
        plan['services'][name]['networks']=['pilot','telemetry',*(['storage'] if name=='loadgen' else [])]
    pilot.write_json(output/'compose.json',plan)
    (output/'compose.json').chmod(0o600)
    pilot.write_json(output/'fullstack-source.json',{'source':source,'images':pins,'profile':settings,
        'capacity_scope':'isolated application subset; Telegram/Logto/Caddy, physical Timeweb verification and seven days remain open'})


def mode(output,enabled):
    plan=json.loads((output/'compose.json').read_text())
    for name in BACKENDS:
        plan['services'][name]['environment']['INSIDE_OTEL_ENABLED']='true' if enabled else 'false'
    for name in (*BACKENDS,'web','rabbitmq','postgres'):
        plan['services'][name]['logging']=production.logging('platform-'+name if name in (*BACKENDS,'web','rabbitmq') else name) if enabled else {'driver':'none'}
    pilot.write_json(output/'compose.json',plan)


def ready(compose,path,host='api',port=3001):
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    def check():
        try:return json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','ready',host,str(port),path,source],timeout=4))['ok'] is True
        except (ValueError,RuntimeError,subprocess.SubprocessError):return False
    pilot.await_fact(check,bool,probe='fullstack_ready')


def seed(compose,output):
    resource_runtime.wait_ready(compose)
    invoke(compose,['run','--rm','--no-deps','migrations'],timeout=60)
    definitions=invoke(compose,['run','--rm','--no-deps','broker-config'],timeout=15)
    (output/'runtime/rabbitmq/definitions.json').write_text(definitions)
    (output/'runtime/rabbitmq/definitions.json').chmod(0o644)
    invoke(compose,['up','-d','rabbitmq','provider','loadgen','api'],timeout=30)
    ready(compose,'/health/ready')
    invoke(compose,['exec','-T','api','env','NODE_ENV=development','LOCAL_SEED_DEMO=published','node','dist/development/seed-local.js'],timeout=30)
    sql(compose,(ROOT/'infra/observability/fullstack/corpus.sql').read_text(),role='platform',database='inside')
    from importlib.util import spec_from_file_location,module_from_spec
    spec=spec_from_file_location('fullstack_database_setup',HERE.parent/'observability-umami/setup_database.py');owner=module_from_spec(spec);spec.loader.exec_module(owner)
    password=(output/'monitoring/umami.database.password').read_text().strip()
    sql(compose,owner.sql(password))
    invoke(compose,['up','-d','umami','umami-query','umami-ingest'],timeout=30)
    ready(compose,'/api/heartbeat','umami',3000)
    seeded=json.loads(invoke(compose,['exec','-T','umami-query','python','/pilot/fixture.py','seed'],timeout=45))
    (output/'provider/umami.json').write_text(json.dumps(seeded));(output/'provider/umami.json').chmod(0o600)
    (output/'monitoring/umami.reader.key').write_text(seeded['key']+'\n')
    established=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','establish'],timeout=45))
    if (set(established)!={'created','accounts'} or established['created']!=128 or not isinstance(established['accounts'],list) or len(established['accounts'])!=128 or any(not isinstance(value,str) or re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',value) is None for value in established['accounts']) or len(set(established['accounts']))!=128):raise ValueError('all_accounts_required')
    (output/'provider/accounts.json').write_text(json.dumps(established['accounts']));(output/'provider/accounts.json').chmod(0o600)
    corpus=json.loads(sql(compose,"SELECT json_build_object('accounts',(SELECT count(*) FROM accounts.accounts WHERE logto_subject LIKE 'resource-corpus-account-%'),'materials',(SELECT count(*) FROM materials.materials WHERE slug LIKE 'resource-material-%' AND publication_state='published'),'public_materials',(SELECT count(*) FROM materials.published_materials WHERE slug LIKE 'resource-material-%'));",role='platform',database='inside'))
    if corpus!={'accounts':128,'materials':512,'public_materials':512}:raise ValueError('representative_dataset_incomplete')


def host():
    memory={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:','MemAvailable:'))}
    cpu=list(map(int,Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
    disk=pilot.shutil.disk_usage('/var/lib/docker')
    device=os.stat('/var/lib/docker').st_dev;major,minor=os.major(device),os.minor(device)
    io=next((list(map(int,row.split()[3:])) for row in Path('/proc/diskstats').read_text().splitlines()
        if row.split()[:2]==[str(major),str(minor)]),None)
    fs=os.statvfs('/var/lib/docker')
    return {'cpu_logical_count':os.cpu_count(),'cpu_total':sum(cpu[:8]),'cpu_busy':sum(cpu[:8])-cpu[3]-cpu[4],
        'memory_total_bytes':memory['MemTotal'],'memory_available_bytes':memory['MemAvailable'],
        'disk_total_bytes':disk.total,'disk_free_bytes':disk.free,
        'memory_free_fraction':memory['MemAvailable']/memory['MemTotal'],'used_bytes':memory['MemTotal']-memory['MemAvailable'],
        'disk_free_fraction':disk.free/disk.total,'disk_used_bytes':disk.total-disk.free,
        'free_inodes':fs.f_favail,'total_inodes':fs.f_files,'device_io_reads':io[0] if io else None,'device_io_writes':io[4] if io else None}


def phase(compose,project,definition,active,enabled,pair):
    states=technical.owned(compose,project,active)
    samples=[];stop=threading.Event();errors=[]
    def sampling():
        try:
            while not stop.is_set():
                samples.append({'counters':technical.capture(states),'host':host()})
                stop.wait(2)
        except BaseException:errors.append('sampler_failed')
    worker=threading.Thread(target=sampling)
    worker.start()
    try:
        value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','load',json.dumps(definition),'on' if enabled else 'off',str(pair)],timeout=definition['seconds']+65))
    finally:
        stop.set();worker.join(timeout=15)
        if worker.is_alive():raise RuntimeError('fullstack_sampler_unsettled')
    samples.append({'counters':technical.capture(states),'host':host()})
    current=technical.owned(compose,project,active)
    if any(current[name]['id']!=states[name]['id'] or current[name]['oom'] or current[name]['restarts']!=states[name]['restarts'] for name in active):errors.append('process_replaced_or_oom')
    return {'name':definition['name'],'mode':'on' if enabled else 'off','pair':pair,'load':value,'samples':samples,'errors':errors}


def await_collector(output):
    pilot.await_fact(lambda:technical.check.read_ready((output/'monitoring/reader.key').read_text().strip()),technical.check.query_one,probe='collector_recovery_query')


def worker(output):
    if sys.platform!='linux':raise ValueError('fullstack_linux_required')
    owner=json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid']!=os.getppid():raise ValueError('external_supervisor_required')
    compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
    profile=acceptance.validate_profile(json.loads(PROFILE.read_text()))
    report={'schema':1,'state':'running','profile':profile,'phases':[],'acceptance':{'state':'incomplete'},'application_subset_acceptance':{'state':'incomplete'},'missing':['Telegram/Logto/Caddy processes and workload','physical Timeweb host verification','seven days'],'controlled_outage':None}
    pilot.write_json(output/'fullstack-proof.json',report)
    try:
        with pilot.worker_storage_guard(owner,compose,output):
            mode(output,False)
            invoke(compose,['up','-d','postgres','provider','loadgen'],timeout=30)
            invoke(compose,['exec','-T','loadgen','node','--test','/resource/test-responses.mjs'],timeout=10)
            seed(compose,output)
            grafana_uid=json.loads((output/'compose.json').read_text())['services']['grafana']['user']
            if not re.fullmatch(r'[0-9]+:[0-9]+',grafana_uid):raise ValueError('invalid_grafana_fixture_identity')
            invoke(compose,['run','--rm','--no-deps','--user','0:0','--cap-add','CHOWN','--entrypoint','chown','grafana',grafana_uid,'/var/lib/grafana'],timeout=30)
            production.pilot.install_plugin(output/'monitoring')
            for pair,order in enumerate(profile['pairs']):
                for state in order:
                    enabled=state=='on';mode(output,enabled)
                    if enabled:
                        invoke(compose,['up','-d',*pilot.SERVICES],timeout=30)
                        invoke(compose,['--profile','host-metrics','up','-d','host-agent','umami-ingest','umami-query'],timeout=30)
                    else:
                        invoke(compose,['stop','--timeout','2',*CORE],timeout=30)
                    invoke(compose,['up','-d','--force-recreate','--no-deps','postgres','rabbitmq'],timeout=30)
                    resource_runtime.wait_ready(compose)
                    invoke(compose,['up','-d','--force-recreate','--no-deps',*BACKENDS,'web'],timeout=30)
                    ready(compose,'/health/ready');ready(compose,'/_health/ready','web',3000)
                    for name in BACKENDS:
                        command=['node','healthcheck/http-healthcheck.mjs',name] if name in ('api','mcp') else ['node','dist/infrastructure/worker-healthcheck.js']
                        def healthy(name=name,command=command):
                            try:invoke(compose,['exec','-T',name,*command],timeout=5);return True
                            except (RuntimeError,subprocess.SubprocessError):return False
                        pilot.await_fact(healthy,bool,probe='fullstack_'+name+'_ready')
                    active=(*APPS,*CORE) if enabled else APPS
                    for definition in profile['phases']:
                        measured=phase(compose,owner['project'],definition,active,enabled,pair)
                        pilot.write_json(output/('fullstack-phase-'+str(len(report['phases']))+'.json'),measured)
                        measured['host_samples']=[sample['host'] for sample in measured['samples']]
                        measured['counter_summary']=technical.summarize([sample['counters'] for sample in measured['samples']])
                        if any(sample['counters']['errors'] for sample in measured['samples']):measured['errors'].append('counter_missing')
                        del measured['samples']
                        report['phases'].append(measured)
                        pilot.write_json(output/'fullstack-proof.json',report)
            # One explicitly accounted outage, then a fresh known probe after restart.
            invoke(compose,['up','-d',*pilot.SERVICES],timeout=30)
            invoke(compose,['stop','--timeout','2','alloy'],timeout=10)
            lost=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','loss'],timeout=10))
            invoke(compose,['up','-d','alloy'],timeout=15)
            await_collector(output)
            reconciled=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','recover-probe'],timeout=65))
            report['controlled_outage']={**lost,**reconciled}
            report['state']='measured'
            report['application_subset_acceptance']=evaluate(report)
            if report['application_subset_acceptance']['state']!='passed':raise ValueError('fullstack_resource_acceptance_failed')
    except BaseException:
        report['state']='failed';raise
    finally:pilot.write_json(output/'fullstack-proof.json',report)


def evaluate(report):
    phases=report['phases'];loads=[row['load'] for row in phases]
    pairs=[]
    for pair in (0,1):
        for label in ('web_home','web_material','api_catalog','api_account'):
            before=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='off' for sample in row['load']['latency'] if sample['label']==label]
            after=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='on' for sample in row['load']['latency'] if sample['label']==label]
            a,b=measurements.percentile(before,.95),measurements.percentile(after,.95)
            pairs.append((b/a-1)*100 if a and b and len(before)==len(after) else None)
    def cpu(mode):
        values=[]
        for row in phases:
            if row['mode']!=mode or row['name']=='idle':continue
            first,last=row['host_samples'][0],row['host_samples'][-1];total=last['cpu_total']-first['cpu_total']
            if total<=0:return None
            values.append((last['cpu_busy']-first['cpu_busy'])/total)
        return sum(values)/len(values) if values else None
    off,on=cpu('off'),cpu('on')
    hosts=[sample for row in phases for sample in row['host_samples']]
    return acceptance.assess({'complete':len(phases)==12 and all(not row['errors'] and row['load']['completed'] for row in phases) and all(row['load']['unexplained_probe_loss']==0 and (row['name']=='idle' or row['mode']=='off' or row['load']['ingestion_lag_seconds'] is not None) for row in phases) and report['controlled_outage']=={'attempted':1,'acknowledged':0,'explained_loss':1,'post_restart_acknowledged':1,'post_restart_stored':1,'outage_stored':0},
        'oom':any('process_replaced_or_oom' in row['errors'] for row in phases),
        'enospc':any(row['disk_free_fraction']==0 or row['free_inodes']==0 for row in hosts),
        'unexplained_loss':sum(row['unexpected_failures']+(row['unexplained_probe_loss'] or 0) for row in loads),
        'query_max_seconds':max((query for row in loads for query in row['query_seconds']),default=None),
        'ingestion_lag_seconds':max((row['ingestion_lag_seconds'] for row in loads if row['ingestion_lag_seconds'] is not None),default=None),
        'http_p95_overhead_percent':max(pairs) if all(value is not None for value in pairs) else None,
        'additional_host_cpu_fraction':max(0,on-off) if on is not None and off is not None else None,
        'minimum_host_memory_free_fraction':min((row['memory_free_fraction'] for row in hosts),default=None),
        'minimum_host_disk_free_fraction':min((row['disk_free_fraction'] for row in hosts),default=None),
        'peak_host_used_bytes':max((row['used_bytes'] for row in hosts),default=None)})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('run','worker','recover','collect'))
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--images',type=Path)
    parser.add_argument('--metadata',type=Path);parser.add_argument('--public',type=Path);args=parser.parse_args()
    if args.action=='worker':return worker(args.output)
    if args.action=='collect':
        hosted.metadata_source(args.metadata)
        return resource_runtime.ci.collect(args.output,args.metadata,args.public,artifacts=ARTIFACTS)
    if args.action=='recover':
        if args.images is None or not preparation.directory(args.images).exists():return resource_runtime.ci.recover(args.output,project_prefix=PREFIX,services=SERVICES)
        stage=preparation.recover_stage(args.images)
        with stage.in_use():
            if not (args.output/'owner.json').exists() and not (args.output/'owner.json').is_symlink():
                return stage.release(str(args.output.resolve()),cleanup_ok=True)
            result=resource_runtime.ci.recover(args.output,project_prefix=PREFIX,services=SERVICES)
            stage.release(str(args.output.resolve()),cleanup_ok=result.get('down')=='passed' and result.get('residue')=='passed')
            return result
    if args.images is None:parser.error('--images required')
    stage=preparation.recover_stage(args.images)
    with stage.in_use():
        stage.require_consumer(str(args.output.resolve()))
        pilot.run(args.output,prepare_inputs=lambda output:inputs(output,args.images),worker_script=Path(__file__).resolve(),
            ports=(18427,13000,14318,1514,13301),services=SERVICES,project_prefix=PREFIX,
            scope='representative application subset resource corpus; full acceptance incomplete',missing=['Telegram/Logto/Caddy processes and workload','physical Timeweb verification and seven days'],worker_pass_fds=stage.pass_fds())


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    main()
