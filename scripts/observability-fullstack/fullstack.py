#!/usr/bin/env python3
"""Bounded whole-application monitoring experiment on a task-owned Linux runner."""
import argparse
import copy
from functools import partial
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
import source_cache
import acceptance
import extra
import telegram
import storage
import stage_timing
import source_guard
import contact_job
import stability
import cpu_control
import horizon_build
import slot_refusal
import startup_refusal
import health_timing
import core_layout
pilot=resource_runtime.pilot
PROFILE=ROOT/'infra/observability/fullstack/profile.json'
BACKENDS=production.BACKENDS
APPS=(*BACKENDS,'web','rabbitmq','postgres','umami','provider','loadgen','telegram','bot-provider',*extra.ACTIVE)
CORE=(*pilot.SERVICES,'host-agent','umami-ingest','umami-query')
SERVICES=(*APPS,*CORE,'migrations','broker-config','telegram-migrations','logto-migrations','volume-reader')
PREFIX='inside-observability-fullstack-'
ARTIFACTS=(*(f'fullstack-phase-{index}.json' for index in range(12)),'fullstack-proof.json','fullstack-source.json',stage_timing.NAME,stage_timing.CONTACTS_NAME,'evidence.json','cleanup.json','worker-outcome.json','monitor-failure.json')


def profile(scope='full'):
    if type(scope) is not str or scope not in ('full','technical'):raise ValueError('closed_fullstack_scope')
    path=PROFILE if scope=='full' else PROFILE.with_name('technical-profile.json')
    return acceptance.validate_profile(json.loads(path.read_text()),scope=scope)


def services(scope='full'):
    profile(scope)
    return tuple(name for name in SERVICES if scope=='full' or name not in ('umami','umami-ingest','umami-query'))


def worker_deadline(scope='full'):
    profile(scope)
    if scope=='technical':
        if sys.platform!='linux':raise ValueError('fullstack_linux_required')
        return stage_timing.SCHEMA2_TECHNICAL_FULL_DEADLINE_SECONDS
    return pilot.PILOT_DEADLINE_SECONDS


def prepared_scope(output, *, expected=None, source=None):
    path=output/'fullstack-source.json'
    if not path.exists() and not path.is_symlink():
        # The supervisor passes only output. Surviving technical inputs must never
        # become legacy authority merely because their binding file disappeared.
        selected=output/'selected-profile.json';monitor=output/'monitoring/inputs.json';compose=output/'compose.json'
        if selected.exists() or selected.is_symlink():raise ValueError('fullstack_scope_binding')
        if monitor.exists() or monitor.is_symlink():
            record=stage_timing.read_json(monitor,1_048_576)
            if type(record) is not dict or record.get('scope','full')!='full':raise ValueError('fullstack_scope_binding')
        if compose.exists() or compose.is_symlink():
            plan=stage_timing.read_json(compose,4_194_304)
            if type(plan) is not dict or type(plan.get('services')) is not dict:raise ValueError('fullstack_scope_binding')
            if set(plan['services'])==set(services('technical')):raise ValueError('fullstack_scope_binding')
        if expected not in (None,'full'):raise ValueError('fullstack_scope_binding')
        return 'full'
    value=stage_timing.read_json(path,1_048_576)
    if type(value) is not dict or type(value.get('profile',{})) is not dict or type(value.get('images',{})) is not dict:raise ValueError('fullstack_scope_binding')
    scope=value.get('scope','full')
    settings=profile(scope)
    if expected is not None and scope!=expected:raise ValueError('fullstack_scope_binding')
    if source is not None and value.get('source')!=source:raise ValueError('fullstack_scope_source')
    if scope=='full' and ('scope_binding' in value or value.get('profile',{}).get('name')=='platform-technical-v1' or value.get('images',{}).get('scope')=='technical'):raise ValueError('fullstack_scope_binding')
    if scope=='technical':
        binding=value.get('scope_binding')
        keys={'scope','source','nonce','output_sha256','profile','services','databases'}
        if (type(binding) is not dict or set(binding) not in (keys,keys|{'worker_deadline_seconds'})
                or 'worker_deadline_seconds' in binding and (type(binding['worker_deadline_seconds']) is not int or binding['worker_deadline_seconds']!=stage_timing.SCHEMA2_TECHNICAL_FULL_DEADLINE_SECONDS)
                or binding['scope']!=scope or binding['source']!=value.get('source')
                or not stage_timing.source_ok(binding['source'])
                or type(binding['nonce']) is not str or re.fullmatch('[0-9a-f]{64}',binding['nonce']) is None
                or binding['output_sha256']!=stage_timing.output_binding(output)
                or binding['profile']!=settings['name'] or value.get('profile')!=settings
                or binding['services']!=list(services(scope)) or binding['databases']!=['inside','logto','inside_telegram']
                or value.get('images',{}).get('scope')!=scope or value['images'].get('source')!=binding['source']):raise ValueError('fullstack_scope_binding')
        plan=stage_timing.read_json(output/'compose.json',4_194_304)
        if (type(plan) is not dict or type(plan.get('services')) is not dict or type(plan.get('volumes')) is not dict
                or set(plan['services'])!=set(services(scope)) or set(plan['volumes'])!=set(storage.VOLUMES)):raise ValueError('fullstack_scope_topology')
        mounted=stage_timing.read_json(output/'selected-profile.json',1_048_576)
        if mounted!=settings or any((output/'monitoring').glob('umami*')):raise ValueError('fullstack_scope_inputs')
        production.prepared_scope(output/'monitoring',scope=scope)
    return scope


def timing_options(output,source):
    scope=prepared_scope(output,source=source)
    if scope=='technical':
        binding=stage_timing.read_json(output/'fullstack-source.json',1_048_576)['scope_binding']
        if 'worker_deadline_seconds' in binding:return {'scope_binding':binding}
    return {}


def invoke(compose,args,**options):return resource_runtime.invoke(compose,args,**options)


def sql(compose,query,*,role='postgres',database='postgres',timeout=15):
    return invoke(compose,['exec','-T','postgres','psql','-X','-qAt','-U',role,'-d',database,'-v','ON_ERROR_STOP=1'],payload=query,timeout=timeout)


def assemble_core(primary, core, **binding):
    """Pure, private construction only; representative runtime remains unavailable."""
    return core_layout.construct(primary,core,**binding)


def inputs(output, images, *, core=None, scope='full'):
    settings=profile(scope)
    if scope=='technical' and core is not None:raise ValueError('technical_primary_core_required')
    if core is not None:core_layout.require_runtime(core)
    acceptance.validate_profile(json.loads(PROFILE.read_text()))
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    pins=json.loads(images.read_text())
    if cpu_control.present(output.parent/cpu_control.PAIR):
        request=cpu_control.pair(sys.modules[__name__],output.parent,source,scope=scope)
        cpu_control.selector(output.name)
        cpu_control.need(not cpu_control.present(output) and cpu_control.read(images)==pins
                         and {k:pins[k] for k in cpu_control.IMAGES}==request['images'])
    if (set(pins)!=({'schema','source','owner','backend','foundation','web','telegram','logto'}|({'scope'} if scope=='technical' else set())) or pins.get('scope','full')!=scope or pins['schema']!=3
            or pins['source']!=source or any(type(pins[role]) is not str or re.fullmatch(r'sha256:[0-9a-f]{64}',pins[role]) is None for role in ('web','telegram','logto'))):raise ValueError('fullstack_source_images')
    base={key:pins[key] for key in ('source','owner','backend','foundation')}|{'schema':1}
    fixture.prepare(output,base,telegram_provider=True)
    for role in ('web','telegram','logto'):
        found=pilot.command(['docker','image','inspect',pins['owner']+'-'+role+':v1','--format','{{.Id}}']).strip()
        if found!=pins[role]:raise ValueError('application_source_identity')
    plan=json.loads((output/'compose.json').read_text())
    # Production intentionally omits development entry points. Reuse the owning corpus
    # only inside this already supervised migration service's separate ephemeral tmpfs.
    seeder=plan['services']['migrations']
    seeder['tmpfs'].append('/app/dist/development:size=1m,mode=1777')
    seeder['volumes']=[str(HERE/'seed-runtime.mjs')+':/resource/seed-runtime.mjs:ro',
        *(str(ROOT/'apps/backend/src/development'/(name+'.ts'))+':/resource/development/'+name+'.ts:ro'
          for name in ('seed-local-development','seed-local-offer-catalog'))]
    monitor=output/'monitoring'
    production.prepare(monitor,data=output/'monitoring-data',project='inside-observability-full-'+os.urandom(6).hex(),**({'scope':scope} if scope=='technical' else {}))
    core=json.loads((monitor/'compose.json').read_text())
    # Every fixture service is acquired explicitly; unprofiled down must include this owner.
    core['services']['host-agent'].pop('profiles',None)
    watchdog=output/'watchdog-fixture';watchdog.mkdir(mode=0o755);watchdog.chmod(0o755)
    expected_mount={'type':'bind','source':'/var/lib/inside/watchdog/metrics','target':'/watchdog-metrics','read_only':True,'bind':{'create_host_path':False}}
    for mount in core['services']['host-agent'].get('volumes',[]):
        if type(mount) is dict and mount.get('target')=='/watchdog-metrics':
            if mount!=expected_mount:raise ValueError('closed_watchdog_source_mount')
            mount['source']=str(watchdog)
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
    plan['services']['web']={'image':pins['web'],'init':True,'networks':{'pilot':{},'telemetry':{'aliases':['inside-web-http']}},'mem_limit':'512m','cpus':1,'pids_limit':256,
        'environment':{'INSIDE_WEB_HTTP_METRICS_ENABLED':'false','INSIDE_WEB_HTTP_METRICS_ENVIRONMENT':'isolated-pilot'},
        'env_file':[str(output/'runtime/runtime.env'),str(output/'runtime/web.env')],'logging':{'driver':'none'}}
    plan['services']['provider']['environment']={'INSIDE_RESOURCE_ACCOUNT_COUNT':str(settings['accounts'])}
    # Whole-process TLS + OTLP/query client needs an unthrottled measurement clock.
    # This is a finite fixture budget, not product/monitoring capacity evidence.
    plan['services']['loadgen']['cpus']=2
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
    if scope=='full':
        analytics=json.loads((monitor/'umami.compose.json').read_text())
        for name,item in analytics['services'].items():
            name='umami-query' if name=='query' else name
            item.pop('profiles',None);item['networks']=['pilot'] if name=='umami' else ['pilot','telemetry']
            plan['services'][name]=item
    extra.configure(output,plan,pins)
    telegram.configure(output,plan,pins)
    storage.configure(output,plan)
    for item in plan['services'].values():item['pull_policy']='never';item.pop('restart',None)
    selected=PROFILE
    if scope=='technical':
        selected=output/'selected-profile.json';pilot.write_json(selected,settings)
    for name in ('loadgen','provider'):
        plan['services'][name]['volumes'] += [str(HERE/'client.mjs')+':/resource/fullstack.mjs:ro',str(HERE/'phase-timing.mjs')+':/resource/phase-timing.mjs:ro',str(HERE/'stability-protocol.mjs')+':/resource/stability-protocol.mjs:ro',str(HERE/'responses.mjs')+':/resource/responses.mjs:ro',str(HERE/'test-responses.mjs')+':/resource/test-responses.mjs:ro',str(selected)+':/resource/full-profile.json:ro']
        plan['services'][name]['networks']=['pilot','telemetry',*(['storage'] if name=='loadgen' else [])]
    if cpu_control.present(output.parent/cpu_control.PAIR):
        plan=cpu_control.prepare_plan(sys.modules[__name__],output,source,plan,scope=scope)
    pilot.write_json(output/'compose.json',plan)
    (output/'compose.json').chmod(0o600)
    prepared={'source':source,'images':pins,'profile':settings,
        'capacity_scope':'whole isolated process topology; source-cache sampler workload, physical Timeweb verification and seven days remain open'}
    if scope=='technical':
        prepared.update({'scope':scope,'scope_binding':{'scope':scope,'source':source,'nonce':os.urandom(32).hex(),
            'output_sha256':stage_timing.output_binding(output),'profile':settings['name'],
            'services':list(services(scope)),'databases':['inside','logto','inside_telegram'],'worker_deadline_seconds':stage_timing.SCHEMA2_TECHNICAL_FULL_DEADLINE_SECONDS}})
    pilot.write_json(output/'fullstack-source.json',prepared)
    prepared_scope(output,expected=scope,source=source)
    # Compiler output can reside on another filesystem than Docker's storage.
    compiler_storage=monitor/'horizon'
    disk=pilot.shutil.disk_usage(compiler_storage)
    admission=pilot.check_disk(total=disk.total,free=disk.free)
    if not admission['ready']:raise RuntimeError(admission['reason'])
    with pilot.disk_budget(compiler_storage):pilot.install_horizon(monitor)


def mode(output,enabled):
    plan=json.loads((output/'compose.json').read_text())
    plan['services']['web']['environment']['INSIDE_WEB_HTTP_METRICS_ENABLED']='true' if enabled else 'false'
    for name in (*BACKENDS,'telegram'):
        plan['services'][name]['environment']['INSIDE_OTEL_ENABLED']='true' if enabled else 'false'
    for name in (*BACKENDS,'web','rabbitmq','postgres','telegram','logto','caddy'):
        plan['services'][name]['logging']=production.logging('platform-'+name if name in (*BACKENDS,'web','rabbitmq') else name) if enabled else {'driver':'none'}
    pilot.write_json(output/'compose.json',plan)


READINESS_ROLES=('loadgen','telegram','bot-provider')
READINESS_STATES=('created','running','paused','restarting','removing','exited','dead')


def readiness_output(raw,outcome):
    """Only a closed child observation survives. Parent outcome independently controls readiness."""
    result={'outcome':outcome,'output':'empty','observation':None}
    try:
        if isinstance(raw,bytes):
            if len(raw)>65536:return {**result,'output':'oversized'}
            raw=raw.decode('utf-8',errors='strict')
        if type(raw) is not str or not raw:return result
        if len(raw.encode())>65536:return {**result,'output':'oversized'}
        def pairs(items):
            value={}
            for key,item in items:
                if key in value:raise ValueError()
                value[key]=item
            return value
        value=json.loads(raw,object_pairs_hook=pairs)
    except (ValueError,UnicodeError,RecursionError):return {**result,'output':'invalid_json'}
    if (type(value) is not dict or set(value)!={'ok','status','cause'} or type(value['ok']) is not bool
            or value['status'] is not None and (type(value['status']) is not int or not 0<=value['status']<=599)
            or value['cause'] not in ('ready','transport_unavailable','http_unavailable','unexpected_response','database_unavailable','membership_unavailable')
            or value['ok']!=(value['cause']=='ready') or value['ok'] and value['status']!=200):
        return {**result,'output':'invalid_projection'}
    return {**result,'output':'valid','observation':value}


def readiness_containers(compose,*,roles=READINESS_ROLES):
    """Fixed disposable owner only; no logs, paths, labels, IDs or raw errors are published."""
    if (type(roles) is not tuple or not 1<=len(roles)<=3 or len(set(roles))!=len(roles)
            or any(name not in (*READINESS_ROLES,*BACKENDS,'rabbitmq') for name in roles)):
        raise ValueError('fixed_readiness_roles_required')
    unavailable={name:{'state':'unavailable'} for name in roles}
    if (type(compose) is not list or len(compose)!=6 or compose[:3]!=['docker','compose','-p']
            or compose[4]!='-f' or type(compose[3]) is not str
            or re.fullmatch(PREFIX+r'[0-9a-f]{12}',compose[3]) is None):return unavailable
    deadline=time.monotonic()+4
    def read(prefix,args):
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        return invoke(prefix,args,timeout=remaining)
    try:
        ids=read(compose,['ps','--all','--quiet',*roles]).split()
        if not ids:return {name:{'state':'missing'} for name in roles}
        if len(ids)>3 or len(set(ids))!=len(ids) or any(re.fullmatch(r'[a-f0-9]{64}',value) is None for value in ids):return unavailable
        projection='{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"state":{{json .State.Status}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"exit_code":{{json .State.ExitCode}},"restarts":{{json .RestartCount}}}'
        raw=read(['docker'],['inspect','--format',projection,*ids])
        if len(raw.encode())>4096:return unavailable
        result={name:{'state':'missing'} for name in roles};seen=set()
        for line in raw.splitlines():
            row=json.loads(line)
            if (type(row) is not dict or set(row)!={'id','project','service','state','running','oom','exit_code','restarts'}
                    or type(row['id']) is not str or row['id'] not in ids or row['id'] in seen
                    or row['project']!=compose[3] or row['service'] not in roles
                    or result[row['service']]['state']!='missing' or row['state'] not in READINESS_STATES
                    or type(row['running']) is not bool or type(row['oom']) is not bool
                    or type(row['exit_code']) is not int or not -255<=row['exit_code']<=255
                    or type(row['restarts']) is not int or not 0<=row['restarts']<=2147483647):return unavailable
            seen.add(row['id'])
            result[row['service']]={key:row[key] for key in ('state','running','oom','exit_code','restarts')}
        return result if seen==set(ids) else unavailable
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):return unavailable


def ready(compose,path,host='api',port=3001):
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    if host not in (*BACKENDS,'telegram','web','logto','umami'):raise ValueError('fixed_readiness_target_required')
    last={'ok':False,'status':None,'cause':'observation_unavailable'}
    probe=readiness_output(None,'unrun')
    def check():
        nonlocal last,probe
        try:raw=invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','ready',host,str(port),path,source],timeout=4)
        except subprocess.TimeoutExpired as error:
            probe=readiness_output(error.stdout,'timeout');return False
        except subprocess.SubprocessError:
            probe=readiness_output(None,'subprocess_failed');return False
        except (RuntimeError,ValueError,OSError):
            probe=readiness_output(None,'command_failed');return False
        probe=readiness_output(raw,'completed')
        if probe['observation'] is None:return False
        last=probe['observation']
        return last['ok']
    try:pilot.await_fact(check,bool,probe='fullstack_ready')
    except BaseException as primary:
        traceback=primary.__traceback__
        try:
            containers=readiness_containers(compose)
            print(json.dumps({'fullstack_readiness':{'target':host,**last,'probe':probe,'containers':containers}},sort_keys=True),flush=True)
        except BaseException:BaseException.__traceback__.__set__(primary,traceback)
        raise


def seed(compose,output,*,timing=None):
    call=partial(stage_timing.call,timing)
    scope=prepared_scope(output)
    actors=profile(scope)['accounts']
    call('seed_database_ready',resource_runtime.wait_ready,compose)
    call('seed_migrate',invoke,compose,['run','--rm','--no-deps','migrations'],timeout=60)
    definitions=call('seed_broker_config',invoke,compose,['run','--rm','--no-deps','broker-config'],timeout=15)
    (output/'runtime/rabbitmq/definitions.json').write_text(definitions)
    (output/'runtime/rabbitmq/definitions.json').chmod(0o644)
    call('seed_api_up',invoke,compose,['up','-d','rabbitmq','provider','loadgen','api'],timeout=30)
    call('seed_api_ready',ready,compose,'/health/ready')
    call('seed_accounts',invoke,compose,['run','--rm','--no-deps','-e','NODE_ENV=development','-e','LOCAL_SEED_DEMO=published',
        '-e','INSIDE_RESOURCE_SEED_ENABLED=true','migrations','node','/resource/seed-runtime.mjs'],timeout=30)
    call('seed_corpus',sql,compose,(ROOT/'infra/observability/fullstack/corpus.sql').read_text(),role='platform',database='inside')
    call('seed_extra',extra.initialize,output,compose,invoke)
    adapted=call('seed_caddy_adapt',invoke,compose,['exec','-T','caddy','caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],timeout=3).encode()
    public_server=source_cache.select_caddy_server(adapted)
    pilot.write_json(output/'caddy-source.json',{'server':public_server});(output/'caddy-source.json').chmod(0o600)
    call('seed_telegram_initialize',telegram.initialize,output,compose,invoke,sql)
    call('seed_telegram_ready',ready,compose,'/ready','telegram',3002)
    call('seed_logto_ready',ready,compose,'/oidc/.well-known/openid-configuration','logto',3001)
    argv=[sys.executable,str(Path(__file__).resolve()),'contacts','--output',str(output)]
    with contact_job.start(output,argv,timing=timing) as contacts:
        # Own fresh fixture only: establish a real statistics epoch before the ordinary reader.
        call('seed_statistics_epoch',sql,compose,'SELECT pg_stat_reset();',database='inside')
        if scope=='full':
            from importlib.util import spec_from_file_location,module_from_spec
            spec=spec_from_file_location('fullstack_database_setup',HERE.parent/'observability-umami/setup_database.py');owner=module_from_spec(spec);spec.loader.exec_module(owner)
            password=(output/'monitoring/umami.database.password').read_text().strip()
            call('seed_umami_database',sql,compose,owner.sql(password))
        # Umami first preserves existing PUBLIC CONNECT rights before it revokes PUBLIC.
        # Establish the dedicated source reader afterward with only its own inside CONNECT.
        bootstrap=source_cache.postgres_setup_sql()
        call('seed_source_bootstrap',sql,compose,bootstrap)
        guard_proof=call('seed_source_authority',source_guard.prove,compose,sql,bootstrap)
        if scope=='full':
            call('seed_umami_up',invoke,compose,['up','-d','umami','umami-query','umami-ingest'],timeout=30)
            call('seed_umami_ready',ready,compose,'/api/heartbeat','umami',3000)
            seeded=json.loads(call('seed_umami',invoke,compose,['exec','-T','umami-query','python','/pilot/fixture.py','seed'],timeout=45))
            (output/'provider/umami.json').write_text(json.dumps(seeded));(output/'provider/umami.json').chmod(0o600)
            (output/'monitoring/umami.reader.key').write_text(seeded['key']+'\n')
        established=json.loads(call('seed_establish',invoke,compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','establish'],timeout=45))
        if (set(established)!={'created','accounts'} or established['created']!=actors or not isinstance(established['accounts'],list) or len(established['accounts'])!=actors or any(not isinstance(value,str) or re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',value) is None for value in established['accounts']) or len(set(established['accounts']))!=actors):raise ValueError('all_accounts_required')
        (output/'provider/accounts.json').write_text(json.dumps(established['accounts']));(output/'provider/accounts.json').chmod(0o600)
        corpus=json.loads(call('seed_validate_corpus',sql,compose,"SELECT json_build_object('accounts',(SELECT count(*) FROM accounts.accounts WHERE logto_subject LIKE 'resource-corpus-account-%'),'materials',(SELECT count(*) FROM materials.materials WHERE slug LIKE 'resource-material-%' AND publication_state='published'),'public_materials',(SELECT count(*) FROM materials.published_materials WHERE slug LIKE 'resource-material-%'));",role='platform',database='inside'))
        if corpus!={'accounts':actors,'materials':512,'public_materials':512}:raise ValueError('representative_dataset_incomplete')
        grafana_uid=json.loads((output/'compose.json').read_text())['services']['grafana']['user']
        if not re.fullmatch(r'[0-9]+:[0-9]+',grafana_uid):raise ValueError('invalid_grafana_fixture_identity')
        call('grafana_permissions',invoke,compose,['run','--rm','--no-deps','--user','0:0','--cap-add','CHOWN','--entrypoint','chown','grafana',grafana_uid,'/var/lib/grafana'],timeout=30)
        call('horizon_install',horizon_build.verify,output/'monitoring')
        call('plugin_install',production.pilot.install_plugin,output/'monitoring')
        call('seed_contacts_join',contacts.wait)
    return guard_proof


def contacts_worker(output,token):
    if sys.platform!='linux':raise ValueError('fullstack_linux_required')
    source=contact_job.verify(output,token)
    if pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()!=source:raise ValueError('contacts_source_changed')
    prepared_scope(output,source=source)
    owner=json.loads((output/'owner.json').read_text())
    pilot.restore_daemon(owner)
    compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
    scope=prepared_scope(output)
    actors=profile(scope)['accounts']
    timing=stage_timing.Timing(output,source,name=stage_timing.CONTACTS_NAME)
    call=partial(stage_timing.call,timing)
    try:
        call('seed_contacts',telegram.establish,compose,invoke,pilot.await_fact,sql,actors)
        contacts=int(call('seed_contact_count',sql,compose,f"SELECT count(*) FROM bot_contacts WHERE telegram_user_id BETWEEN 1000001 AND {1000000+actors};",role='telegram_owner',database='inside_telegram'))
        if contacts!=actors:raise ValueError('all_telegram_contacts_required')
    finally:timing.finish()


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
        'free_inodes':fs.f_favail,'total_inodes':fs.f_files,'device_io_reads':io[0] if io else None,'device_io_writes':io[4] if io else None,
        'device_io_read_bytes':io[2]*512 if io else None,'device_io_written_bytes':io[6]*512 if io else None}


def sample_sources(compose,output,*,observer=None):
    path=output/'caddy-source.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size>64:raise ValueError('source_caddy_partition')
    partition=json.loads(path.read_text())
    if type(partition) is not dict or set(partition)!={'server'} or type(partition['server']) is not str or re.fullmatch(r'srv(?:[0-9]|[1-5][0-9]|6[0-3])',partition['server']) is None:raise ValueError('source_caddy_partition')
    def postgres_read(query):
        raw=sql(compose,query,role='postgres_source_reader',database='inside',timeout=3).encode()
        if len(raw)>4096:raise ValueError('source_postgres_body')
        return raw
    def caddy_read():
        raw=invoke(compose,['exec','-T','caddy','wget','-Y','off','-q','-T','2','-O','-','http://127.0.0.1:9091/metrics'],timeout=3).encode()
        if len(raw)>65536:raise ValueError('source_caddy_body')
        return raw
    return source_cache.sample(output/'watchdog-fixture',postgres_read=postgres_read,caddy_read=caddy_read,caddy_server=partition['server'],clock=time.time,observer=observer)


def await_sources(compose,output,*,enabled=True):
    if sample_sources(compose,output)!={'postgresql':'observed','caddy':'observed'}:raise ValueError('source_cache_native_unavailable')
    if not enabled:return
    deadline=time.monotonic()+10
    def available():
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('source_cache_stored_deadline')
        value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','cache-ready'],timeout=min(4,remaining)))
        if time.monotonic()>=deadline:raise TimeoutError('source_cache_stored_deadline')
        return value=={'ok':True}
    pilot.await_fact(available,bool,budget=10,probe='source_cache_stored_ready')


def initialize_web_http(compose):
    """Initial series ingestion is readiness, not proof of a newly issued request."""
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    deadline=time.monotonic()+pilot.FACT_TIMEOUT_SECONDS
    def remaining():
        value=deadline-time.monotonic()
        if value<=0:raise TimeoutError('web_http_initial_series_deadline')
        return value
    seeded=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','web-http-seed'],timeout=min(4,remaining())))
    remaining()
    if type(seeded) is not dict or set(seeded)!={'ok'} or seeded['ok'] is not True:
        raise ValueError('web_http_initial_seed_unavailable')
    def stored():
        value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','web-http-initial-ready',source],timeout=min(4,remaining())))
        remaining()
        return type(value) is dict and set(value)=={'ok'} and value['ok'] is True
    pilot.await_fact(stored,bool,budget=remaining(),probe='web_http_initial_series_ready')
    return {'state':'observed','source_sha':source,'initial_series_elapsed_seconds':time.monotonic()-(deadline-pilot.FACT_TIMEOUT_SECONDS)}


def prove_web_http(compose):
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    raw=invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','web-http-witness',source],timeout=8)
    deadline=time.monotonic()+10
    witness=json.loads(raw)
    fields={'ok','positive_count','not_found_count','process_start_seconds','observed_at_seconds'}
    if type(witness) is not dict or set(witness)!=fields or witness['ok'] is not True or any(
            type(witness[key]) not in (int,float) or not math.isfinite(witness[key]) or not 0<witness[key]<=9007199254740991
            for key in fields-{'ok'}) or any(type(witness[key]) is not int for key in ('positive_count','not_found_count')) or witness['observed_at_seconds']>=1e12 or witness['process_start_seconds']>witness['observed_at_seconds']:
        raise ValueError('web_http_boundary_unavailable')
    expected=json.dumps(witness,separators=(',',':'))
    def stored():
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('web_http_stored_deadline')
        value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','web-http-ready',source,expected],timeout=min(4,remaining)))
        if time.monotonic()>=deadline:raise TimeoutError('web_http_stored_deadline')
        return type(value) is dict and set(value)=={'ok'} and value['ok'] is True
    pilot.await_fact(stored,bool,budget=10,probe='web_http_stored_ready')
    return {'state':'observed','source_sha':source,'positive_status':200,'not_found_status':404,'url_sentinel':'absent','stored_source_age_seconds_maximum':10,'minimum_completed_counts':{'health':witness['positive_count'],'not_found':witness['not_found_count']},'raw_process_start_seconds':witness['process_start_seconds'],'post_witness_source_cut_seconds':witness['observed_at_seconds'],'stored_elapsed_seconds':time.monotonic()-(deadline-10)}


def loadgen_cpu_pressure(samples):
    """Preserve counter resets/unsupported values as UNKNOWN, never zero pressure."""
    keys=('cpu_periods','cpu_throttled_periods','cpu_throttled_ns')
    rows=[sample['counters']['services'].get('loadgen',{}) for sample in samples]
    if len(rows)<2 or any(type(row.get(key)) is not int or not 0<=row[key]<=2**63-1 for row in rows for key in keys):
        return {'state':'unavailable'}
    if any(row['cpu_throttled_periods']>row['cpu_periods'] for row in rows):return {'state':'unavailable'}
    if any(b[key]<a[key] for a,b in zip(rows,rows[1:]) for key in keys):return {'state':'unavailable'}
    delta={key:rows[-1][key]-rows[0][key] for key in keys}
    return {'state':'throttled' if delta['cpu_throttled_periods'] or delta['cpu_throttled_ns'] else 'unthrottled',**delta}


class SourcePublicationTiming:
    """Bounded phase-only diagnostics; no source or acceptance decision reads this ledger."""
    def __init__(self,enabled):
        self.value={'schema':1,'state':'off' if not enabled else 'complete','cycles':0,
                    'invalid_rows':0,'overflow_rows':0,'rows':[]}
        self.active=None;self.seen=[];self.deliveries=0

    def _invalid(self,count=1):
        self.value['invalid_rows']=min(129,self.value['invalid_rows']+count)
        if self.value['state']!='overflow':self.value['state']='invalid'

    def begin(self,cycle):
        if type(cycle) is not int or cycle!=self.value['cycles']:
            self._invalid();self.active=None;return
        self.active=cycle;self.seen=[];self.deliveries=0
        if cycle<64:self.value['cycles']=cycle+1
        else:self.value['state']='overflow'

    @staticmethod
    def _anchor():
        primary=sys.exception()
        try:
            values=[time.monotonic(),time.time(),time.monotonic()]
            if any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=(2**53-1)/1000 for v in values):return None
            if values[0]>values[2]:return None
            return [v*1000 for v in values]
        except BaseException as error:
            if primary is None and not isinstance(error,Exception):raise
            return None

    def observe(self,row):
        self.deliveries=min(129,self.deliveries+1)
        if self.active is None:self._invalid();return
        if self.active>=64 or len(self.value['rows'])>=128:
            self.value['state']='overflow';self.value['overflow_rows']=min(129,self.value['overflow_rows']+1);return
        clocks=('read_start_monotonic_ms','read_end_monotonic_ms','publish_start_monotonic_ms','publish_end_monotonic_ms')
        fields={'source','read_outcome','projection_state','publication_outcome','observed_at_seconds',*clocks}
        if (type(row) is not dict or set(row)!=fields or type(row.get('source')) is not str
                or len(self.seen)>=2 or row['source']!=('postgresql','caddy')[len(self.seen)]
                or row['read_outcome'] not in ('completed','failed','interrupted')
                or row['projection_state'] not in ('observed','unavailable','unknown')
                or row['publication_outcome'] not in ('completed','failed','not_attempted')):
            self._invalid();return
        for key in (*clocks,'observed_at_seconds'):
            v=row[key]
            if v is not None and (type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=2**53-1):
                self._invalid();return
        known=[row[key] for key in clocks if row[key] is not None]
        if known!=sorted(known):self._invalid();return
        if ((row['projection_state']=='unknown')!=(row['observed_at_seconds'] is None)
                or row['observed_at_seconds'] is not None and row['observed_at_seconds']<=0
                or row['publication_outcome']=='not_attempted' and any(row[k] is not None for k in clocks[2:])
                or row['publication_outcome']!='not_attempted' and row['projection_state']=='unknown'
                or row['read_outcome']!='completed' and row['projection_state']=='observed'
                or row['read_outcome']=='interrupted' and row['projection_state']!='unknown'):
            self._invalid();return
        anchor=self._anchor()
        if anchor is not None and known and known[-1]>anchor[0]:anchor=None
        self.seen.append(row['source'])
        self.value['rows'].append({**row,'cycle':self.active,'clock_anchor':anchor})
        required=clocks[:2] if row['publication_outcome']=='not_attempted' else clocks
        if anchor is None or any(row[k] is None for k in required):self._invalid()

    def end(self):
        if self.active is not None and self.active<64 and (self.deliveries!=2 or self.seen!=['postgresql','caddy']):
            self._invalid(max(1,2-len(self.seen)))
        self.active=None


def phase(compose,project,definition,active,enabled,pair,output,*,timing=None,group=-1,index=-1,diagnostic_ordinal=None,diagnostic_protocol=stability.COLD_PROTOCOL):
    call=partial(stage_timing.call,timing,group=group,phase=index)
    scope=prepared_scope(output)
    states=call('phase_ownership_before',technical.owned,compose,project,active)
    def captured(*,boundary=None):
        # Counter and Node clocks need an explicit host bridge, never inferred phase timing.
        def clock_ms(read):
            try:
                value=read()
                if type(value) not in (int,float):return None
                value*=1000
            except Exception:return None
            return value if 0<=value<=2**53-1 and math.isfinite(value) else None
        before=clock_ms(time.monotonic);epoch=clock_ms(time.time)
        counters=technical.capture(states);host_sample=host()
        diagnostic_context=stability.context() if diagnostic_ordinal is not None else None
        after=clock_ms(time.monotonic);at=counters.get('at_seconds')
        anchor=None
        if (before is not None and epoch is not None and after is not None
                and type(at) in (int,float) and 0<=at<=(2**53-1)/1000 and math.isfinite(at)
                and before<=at*1000<=after):anchor=[before,epoch,after]
        result={'counters':counters,'host':host_sample,'counter_clock_anchor':anchor,**({'diagnostic_context':diagnostic_context} if diagnostic_ordinal is not None else {})}
        if scope=='technical' and diagnostic_ordinal is None and boundary is not None:
            result['primary_host_context']=stability.primary_context(boundary)
        return result
    # A delayed native source read must not let the load outrun its CPU baseline.
    samples=[call('phase_baseline',captured,boundary='baseline')]
    stop=threading.Event();errors=[];storage_samples=[];source_samples=[]
    publications=SourcePublicationTiming(enabled)
    def sampling():
        next_source=time.monotonic()
        try:
            while not stop.is_set():
                if enabled and time.monotonic()>=next_source:
                    if len(source_samples)>=64:
                        publications.begin(64)
                        raise ValueError('source_sample_budget')
                    publications.begin(len(source_samples))
                    try:source_samples.append(sample_sources(compose,output,observer=publications.observe))
                    finally:publications.end()
                    next_source+=5
                samples.append(captured())
                stop.wait(min(2,max(0,next_source-time.monotonic())) if enabled else 2)
        except BaseException:errors.append('sampler_failed')
    worker=threading.Thread(target=sampling)
    worker.start()
    def observed(position):
        return storage.observe(compose,
            lambda *args,**options:call('phase_storage_'+position+'_reader',invoke,*args,**options),
            lambda *args,**options:call('phase_storage_'+position+'_database',sql,*args,**options),
            **({'scope':'technical'} if scope=='technical' else {}))
    try:
        storage_samples.append(observed('before'))
        if diagnostic_ordinal is None:
            command=['load',json.dumps(definition),'on' if enabled else 'off',str(pair)]
            value=json.loads(call('phase_load',invoke,compose,['exec','-T','loadgen','node','/resource/fullstack.mjs',*command],timeout=definition['seconds']+65))
        else:
            value=call('phase_load',stability.invoke_client,compose,invoke,definition,enabled,diagnostic_ordinal,diagnostic_protocol)
        phase_id=pair*6+(3 if enabled else 0)+('idle','steady','spike').index(definition['name'])
        if diagnostic_ordinal is not None:phase_id=diagnostic_ordinal
        acknowledged=value.get('telegram_acknowledged')
        if type(acknowledged) is not int or not 0<=acknowledged<=1000:raise ValueError('synthetic_telegram_acknowledgement')
        value['telegram_processed']=call('phase_telegram',pilot.await_fact,lambda:telegram.processed(compose,sql,2000000+phase_id*1000,2001000+phase_id*1000,acknowledged),bool,budget=30,probe='synthetic_telegram_phase_processed')
        storage_samples.append(observed('after'))
    finally:
        stop.set();call('phase_sampler_join',worker.join,timeout=15)
        if worker.is_alive():raise RuntimeError('fullstack_sampler_unsettled')
    samples.append(call('phase_final_counters',captured,boundary='final'))
    current=call('phase_ownership_after',technical.owned,compose,project,active)
    if any(current[name]['id']!=states[name]['id'] or current[name]['oom'] or current[name]['restarts']!=states[name]['restarts'] for name in active):errors.append('process_replaced_or_oom')
    pressure=loadgen_cpu_pressure(samples)
    if pressure['state']!='unthrottled':errors.append('fixture_loadgen_cpu_'+pressure['state'])
    result={'loadgen_cpu_pressure':pressure,'name':definition['name'],'mode':'on' if enabled else 'off','pair':pair,'load':value,'samples':samples,'storage_samples':storage_samples,'source_cache_samples':source_samples,'source_publication_timing':publications.value,'errors':errors}
    if scope=='technical':
        result['process_roles']=list(states)
        result['scope_binding']=stage_timing.read_json(output/'fullstack-source.json',1_048_576)['scope_binding']
    # Outside the original latency/counter/pressure windows; next-phase offsets can change.
    if diagnostic_ordinal is None and timing is not None and stage_timing.source_ok(timing.source) and type(index) is int and 0<=index<12:
        result['health_probe_timing']=health_timing.capture(project,states,current,timing.source,output,index,resource_runtime.invoke)
    return result


def await_collector(output):
    # Same empty native OTLP readiness read as pilot.await_otlp_ready. The query
    # store remains alive during an Alloy outage, so query1 alone cannot guard the
    # one counted recovery probe. Both observations share the former 60s budget.
    deadline=time.monotonic()+pilot.FACT_TIMEOUT_SECONDS
    def recovered():
        receiver=pilot.request('/v1/traces',body={'resourceSpans':[]},method='POST',port=14318)
        if time.monotonic()>=deadline:raise TimeoutError('collector_recovery_deadline')
        if receiver[0]!=200:return False
        value=technical.check.read_ready((output/'monitoring/reader.key').read_text().strip())
        if time.monotonic()>=deadline:raise TimeoutError('collector_recovery_deadline')
        return technical.check.query_one(value)
    pilot.await_fact(recovered,bool,budget=pilot.FACT_TIMEOUT_SECONDS,probe='collector_recovery_query')


def await_startup_role(compose,output,role,command):
    if role not in (*BACKENDS,'rabbitmq'):raise ValueError('fixed_startup_role_required')
    last={'reason':'unavailable','exit_code':None}
    def healthy():
        nonlocal last
        try:invoke(compose,['exec','-T',role,*command],timeout=5);return True
        except resource_runtime.CommandFailure as error:
            last={'reason':error.reason,'exit_code':error.exit_code};return False
        except subprocess.TimeoutExpired:
            last={'reason':'timeout','exit_code':None};return False
        except (RuntimeError,subprocess.SubprocessError):
            last={'reason':'unavailable','exit_code':None};return False
    try:pilot.await_fact(healthy,bool,probe='fullstack_'+role+'_ready')
    except BaseException as primary:
        traceback=primary.__traceback__
        try:
            source=stage_timing.source(output)
            roles=(role,) if role=='rabbitmq' else (role,'rabbitmq')
            value={'schema':1,'source':source,'role':role,'probe':last,
                   'containers':readiness_containers(compose,roles=roles)}
            startup_refusal.write(output,value,source,BACKENDS)
        except BaseException:BaseException.__traceback__.__set__(primary,traceback)
        raise


def configure_mode(compose,output,enabled,*,timing=None,group=-1,report=None):
    mode_call=partial(stage_timing.call,timing,group=group)
    report={} if report is None else report
    scope=prepared_scope(output)
    apps=tuple(name for name in APPS if scope=='full' or name!='umami')
    core=tuple(name for name in CORE if scope=='full' or name not in ('umami-ingest','umami-query'))
    mode_call('mode_configure',mode,output,enabled)
    if enabled:
        mode_call('mode_core_up',invoke,compose,['up','-d',*pilot.SERVICES],timeout=30)
        mode_call('mode_source_up',invoke,compose,['--profile','host-metrics','up','-d','host-agent',*(['umami-ingest','umami-query'] if scope=='full' else [])],timeout=30)
    else:
        mode_call('mode_core_stop',invoke,compose,['stop','--timeout','2',*core],timeout=30)
    mode_call('mode_database_broker_recreate',invoke,compose,['up','-d','--force-recreate','--no-deps','postgres','rabbitmq'],timeout=30)
    mode_call('mode_database_ready',resource_runtime.wait_ready,compose)
    # Preserve production's RabbitMQ service_healthy dependency before worker startup.
    mode_call('mode_broker_ready',await_startup_role,compose,output,'rabbitmq',
              ['rabbitmq-diagnostics','-q','check_port_listener','5671'])
    mode_call('mode_applications_recreate',invoke,compose,['up','-d','--force-recreate','--no-deps',*BACKENDS,'web','telegram','logto','caddy'],timeout=30)
    mode_call('mode_api_ready',ready,compose,'/health/ready');mode_call('mode_web_ready',ready,compose,'/_health/ready','web',3000)
    mode_call('mode_telegram_ready',ready,compose,'/ready','telegram',3002)
    mode_call('mode_logto_ready',ready,compose,'/oidc/.well-known/openid-configuration','logto',3001)
    for name in BACKENDS:
        command=['node','healthcheck/http-healthcheck.mjs',name] if name in ('api','mcp') else ['node','dist/infrastructure/worker-healthcheck.js']
        mode_call('mode_backend_'+name+'_ready',await_startup_role,compose,output,name,command)
    mode_call('mode_warmup',extra.warmup,compose,invoke)
    if enabled:
        report.setdefault('web_http_initial_series',[]).append(mode_call('mode_web_initial_series',initialize_web_http,compose))
        report.setdefault('web_http',[]).append(mode_call('mode_web_witness',prove_web_http,compose))
    # The bounded Web witness must not age a previously ready source cohort.
    mode_call('mode_source_barrier',await_sources,compose,output,enabled=enabled)
    active=(*apps,*core) if enabled else apps
    return active


def worker(output,*,cpu=False):
    if not cpu:cpu_control.reject(output)
    if sys.platform!='linux':raise ValueError('fullstack_linux_required')
    owner=cpu_control.read(output/'owner.json',private=False) if cpu else json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid']!=os.getppid():raise ValueError('external_supervisor_required')
    compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
    cpu_source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip() if cpu else None
    if cpu:cpu_control.bind_worker(sys.modules[__name__],output,owner,cpu_source)
    cpu_enabled=False
    if (output/stability.MARKER).exists() or (output/stability.MARKER).is_symlink():
        return stability_worker(output,owner,compose)
    scope=prepared_scope(output,source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip())
    if scope=='technical' and 'stability' in cpu_control.read(output/'fullstack-source.json',private=False):
        raise ValueError('diagnostic_plan_binding')
    settings=profile(scope)
    report={'schema':1,'state':'running','profile':settings,'phases':[],'acceptance':{'state':'incomplete'},'measured_linux_acceptance':{'state':'incomplete'},'missing':['PG/Caddy source-cache sampler workload','physical Timeweb host verification','seven days'],'source_cache_workload':False,'controlled_outage':None}
    if scope=='technical':
        report.update({'scope':scope,'scope_binding':stage_timing.read_json(output/'fullstack-source.json',1_048_576)['scope_binding'],
            'full_spec_acceptance':'deferred'})
    pilot.write_json(output/'fullstack-proof.json',report)
    timing_source=stage_timing.source(output)
    timing=stage_timing.Timing(output,timing_source,**timing_options(output,timing_source))
    call=partial(stage_timing.call,timing)
    try:
        with pilot.worker_storage_guard(owner,compose,output):
            call('initial_mode',mode,output,False)
            call('initial_up',invoke,compose,['up','-d','postgres','provider','loadgen'],timeout=30)
            call('response_contract',invoke,compose,['exec','-T','loadgen','node','--test','/resource/test-responses.mjs'],timeout=10)
            report['source_role_authority']=seed(compose,output,timing=timing)
            pilot.write_json(output/'fullstack-proof.json',report)
            for pair,order in enumerate(settings['pairs']):
                for position,state in enumerate(order):
                    group=pair*2+position
                    active=configure_mode(compose,output,enabled=state=='on',timing=timing,group=group,report=report)
                    enabled=state=='on'
                    if cpu:
                        cpu_enabled=enabled
                        cpu_control.capture(sys.modules[__name__],output,compose,cpu_source,group,enabled)
                    for definition in settings['phases']:
                        index=len(report['phases'])
                        measured=phase(compose,owner['project'],definition,active,enabled,pair,output,timing=timing,group=group,index=index)
                        call('phase_report',pilot.write_json,output/('fullstack-phase-'+str(index)+'.json'),measured,group=group,phase=index)
                        measured['host_samples']=[sample['host'] for sample in measured['samples']]
                        measured['counter_summary']=technical.summarize([sample['counters'] for sample in measured['samples']])
                        if any(sample['counters']['errors'] for sample in measured['samples']):measured['errors'].append('counter_missing')
                        del measured['samples']
                        # Detailed windows stay in the already collected raw phase,
                        # avoiding twelve duplicate ledgers in the bounded summary.
                        measured['load'].pop('timing_diagnostics',None)
                        measured['load'].pop('slot_refusal',None)
                        measured['load'].pop('source_cache_sample_diagnostic',None)
                        measured.pop('source_publication_timing',None)
                        measured.pop('health_probe_timing',None)
                        report['phases'].append(measured)
                        call('phase_report',pilot.write_json,output/'fullstack-proof.json',report,group=group,phase=index)
            # One explicitly accounted outage, then a fresh known probe after restart.
            call('outage_core_up',invoke,compose,['up','-d',*pilot.SERVICES],timeout=30)
            call('outage_collector_stop',invoke,compose,['stop','--timeout','2','alloy'],timeout=10)
            lost=json.loads(call('outage_loss',invoke,compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','loss'],timeout=10))
            call('outage_collector_up',invoke,compose,['up','-d','alloy'],timeout=15)
            call('outage_ready',await_collector,output)
            reconciled=json.loads(call('outage_recover',invoke,compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','recover-probe'],timeout=65))
            report['controlled_outage']={**lost,**reconciled}
            report['source_cache_workload']=all(row['mode']=='off' or row['load']['completed'] and bool(row['load']['query_seconds']) and len(row['source_cache_samples'])>=({'idle':2,'steady':8,'spike':2}[row['name']]) and all(state=={'postgresql':'observed','caddy':'observed'} for state in row['source_cache_samples']) for row in report['phases'])
            if report['source_cache_workload']:report['missing'].remove('PG/Caddy source-cache sampler workload')
            report['state']='measured'
            report['measured_linux_acceptance']=call('evaluate',evaluate,report)
            if report['measured_linux_acceptance']['state']!='passed':raise ValueError('fullstack_resource_acceptance_failed')
        timing.finish()
    except BaseException:
        report['state']='failed'
        try:pilot.write_json(output/'fullstack-proof.json',report)
        except BaseException:pass
        raise
    else:pilot.write_json(output/'fullstack-proof.json',report)
    finally:
        timing.finish()
        if cpu:
            # Failed final attestation cannot mask the original worker failure.
            failed=sys.exc_info()[0] is not None
            try:cpu_control.capture(sys.modules[__name__],output,compose,cpu_source,4,cpu_enabled)
            except BaseException:
                if not failed:raise


def p95_pair(before,after):
    a,b=measurements.percentile(before,.95),measurements.percentile(after,.95)
    return {'off_count':len(before),'on_count':len(after),'off_p95_ms':a,'on_p95_ms':b,
            'overhead_percent':(b/a-1)*100 if a and b and len(before)==len(after) else None}


def assessment_inputs(report):
    phases=report['phases'];loads=[row['load'] for row in phases]
    pairs=[]
    for pair in (0,1):
        for label in ('web_home','web_material','api_catalog','api_account','telegram_webhook','logto_discovery'):
            before=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='off' for sample in row['load']['latency'] if sample['label']==label]
            after=[sample['elapsed_ms'] for row in phases if row['pair']==pair and row['mode']=='on' for sample in row['load']['latency'] if sample['label']==label]
            pairs.append(p95_pair(before,after)['overhead_percent'])
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
    return {'complete':report.get('source_cache_workload') is True and len(phases)==12 and all(row.get('loadgen_cpu_pressure',{}).get('state')=='unthrottled' for row in phases) and all(len(row.get('storage_samples',[]))==2 for row in phases) and all(row['total_inodes']>0 and row['free_inodes']/row['total_inodes']>=.25 for row in hosts) and all(type(sample.get(key)) is int for sample in hosts for key in ('device_io_reads','device_io_writes','device_io_read_bytes','device_io_written_bytes')) and all(not row['errors'] and row['load']['completed'] for row in phases) and all(row['load']['unexplained_probe_loss']==0 and (row['name']=='idle' or row['mode']=='off' or row['load']['ingestion_lag_seconds'] is not None) for row in phases) and report['controlled_outage']=={'attempted':1,'acknowledged':0,'explained_loss':1,'post_restart_acknowledged':1,'post_restart_stored':1,'outage_stored':0},
        'oom':any('process_replaced_or_oom' in row['errors'] for row in phases),
        'enospc':any(row['disk_free_fraction']==0 or row['free_inodes']==0 for row in hosts),
        'unexplained_loss':sum(row['unexpected_failures']+(row['unexplained_probe_loss'] or 0) for row in loads),
        'query_max_seconds':max((query for row in loads for query in row['query_seconds']),default=None),
        'ingestion_lag_seconds':max((row['ingestion_lag_seconds'] for row in loads if row['ingestion_lag_seconds'] is not None),default=None),
        'http_p95_overhead_percent':max(pairs) if all(value is not None for value in pairs) else None,
        'additional_host_cpu_fraction':max(0,on-off) if on is not None and off is not None else None,
        'minimum_host_memory_free_fraction':min((row['memory_free_fraction'] for row in hosts),default=None),
        'minimum_host_disk_free_fraction':min((row['disk_free_fraction'] for row in hosts),default=None),
        'peak_host_used_bytes':max((row['used_bytes'] for row in hosts),default=None)}


HTTP_LANES=('web_home','web_material','api_catalog','api_account','mcp_discovery','telegram_webhook','logto_discovery')


def validate_technical_phase(row,pair,mode,definition,*,complete=False):
    def need(condition):
        if not condition:raise ValueError('technical_fullstack_closure')
    count=definition['seconds']*definition['requests_per_second']
    need(type(row) is dict and row.get('pair')==pair and type(row.get('pair')) is int and row.get('mode')==mode and row.get('name')==definition['name'])
    apps=tuple(name for name in APPS if name!='umami')
    roles=(*apps,*(name for name in CORE if name not in ('umami-ingest','umami-query'))) if mode=='on' else apps
    observed=row.get('process_roles')
    need(type(observed) is list and all(type(name) is str for name in observed) and len(observed)==len(roles) and set(observed)==set(roles))
    samples=row.get('storage_samples')
    need(type(samples) is list and len(samples)==2)
    for sample in samples:
        need(type(sample) is dict and sample.get('absent_databases')==['umami'])
        storage.validate_volumes(sample.get('volumes'))
        databases=sample.get('database_bytes')
        need(type(databases) is dict and set(databases)=={'inside','logto','inside_telegram'}
             and all(type(number) is int and 0<number<2**63 for number in databases.values()))
    load=row.get('load')
    need(type(load) is dict and load.get('scope')=='technical')
    for key in ('scheduled','success','missed','disabled_operations','attempted_probe_points','acknowledged_probe_points'):
        need(type(load.get(key)) is int and 0<=load[key]<=count)
    need(load['success']+load['missed']<=load['scheduled'])
    operations=load.get('http_operations')
    need(type(operations) is dict and set(operations)==set(HTTP_LANES))
    attempted=completed=successful=0
    for value in operations.values():
        need(type(value) is dict and set(value)=={'attempted','completed','successful'}
            and all(type(number) is int and 0<=number<=count//8 for number in value.values()))
        need(value['successful']<=value['completed']<=value['attempted'])
        attempted+=value['attempted'];completed+=value['completed'];successful+=value['successful']
        if complete:need(value=={'attempted':count//8,'completed':count//8,'successful':count//8})
    need(attempted+load['disabled_operations']<=load['scheduled']-load['missed'])
    need(successful+load['disabled_operations']==load['success'])
    probes=load['attempted_probe_points']
    need((mode=='on' and load['acknowledged_probe_points']<=probes<=load['scheduled']-load['missed']) or (mode=='off' and probes==load['acknowledged_probe_points']==0))
    monitoring=load.get('monitoring_http')
    need(type(monitoring) is dict and set(monitoring)=={'attempted','completed'}
         and all(type(number) is int and 0<=number<100_000 for number in monitoring.values())
         and monitoring['completed']<=monitoring['attempted'])
    if mode=='off':need(monitoring=={'attempted':0,'completed':0})
    if complete:
        need(load.get('completed') is True and load['scheduled']==count and load['success']==count and load['missed']==0 and load['disabled_operations']==count//8)
        need(probes==(count if mode=='on' else 0) and load['acknowledged_probe_points']==probes)
        if mode=='on':need(monitoring['attempted']>0 and monitoring['completed']==monitoring['attempted'])
    return {'scheduled_slots':load['scheduled'],'disabled_slots':load['disabled_operations'],
        'application_http_attempted':attempted,'application_http_completed':completed,
        'otlp_probe_attempted':probes,'monitoring_http':monitoring,'per_lane':operations}


def technical_closure(report):
    settings=profile('technical')
    if report.get('scope')!='technical' or report.get('profile')!=settings or report.get('full_spec_acceptance')!='deferred':raise ValueError('technical_fullstack_closure')
    expected=[(pair,mode,definition) for pair,modes in enumerate(settings['pairs']) for mode in modes for definition in settings['phases']]
    phases=report.get('phases')
    if type(phases) is not list or len(phases)!=len(expected):raise ValueError('technical_fullstack_closure')
    summary={'scheduled_slots':0,'disabled_slots':0,'application_http_attempted':0,'application_http_completed':0,'otlp_probe_attempted':0,
        'monitoring_http':{'attempted':0,'completed':0},'per_lane':{label:{'attempted':0,'completed':0,'successful':0} for label in HTTP_LANES}}
    binding=report.get('scope_binding')
    if type(binding) is not dict:raise ValueError('technical_fullstack_closure')
    for row,(pair,mode,definition) in zip(phases,expected):
        if row.get('scope_binding')!=binding:raise ValueError('technical_fullstack_closure')
        measured=validate_technical_phase(row,pair,mode,definition,complete=True)
        for key in ('scheduled_slots','disabled_slots','application_http_attempted','application_http_completed','otlp_probe_attempted'):summary[key]+=measured[key]
        for key in ('attempted','completed'):summary['monitoring_http'][key]+=measured['monitoring_http'][key]
        for label in HTTP_LANES:
            for key in ('attempted','completed','successful'):summary['per_lane'][label][key]+=measured['per_lane'][label][key]
    return summary


def evaluate(report):
    if report.get('scope')=='technical' or report.get('profile',{}).get('name')=='platform-technical-v1':
        report['technical_workload']=technical_closure(report)
    return acceptance.assess(assessment_inputs(report))


def collect(output, metadata, destination, *, scope='full'):
    profile(scope)
    cpu_control.reject(output)
    if any((output/name).exists() or (output/name).is_symlink() for name in (stability.MARKER,stability.NAME,stability.OWNER)):raise ValueError('diagnostic_is_not_acceptance')
    import preparation_evidence
    if output.is_symlink() or metadata.is_symlink():raise ValueError('unsafe fullstack timing source')
    source,_=hosted.metadata_source(metadata)
    path=metadata/preparation_evidence.NAME
    evidence=preparation_evidence.read(path,source['checkout_sha']) if path.exists() or path.is_symlink() else None
    # Admission and image preparation precede creation of the runtime directory.
    # Publish only metadata and an explicit incomplete result in that case. An
    # existing output still requires its runtime binding, even after record loss.
    if scope=='technical' and not output.exists():
        resource_runtime.ci.collect(output,metadata,destination,artifacts=())
        pilot.write_json(destination/'fullstack-proof.json',{'schema':1,'state':'preparation_only','scope':scope,
            'source':source['checkout_sha'],'profile':profile(scope),'phases':[],
            'measured_linux_acceptance':{'state':'incomplete'},'full_spec_acceptance':'deferred'})
        if evidence is not None:pilot.write_json(destination/preparation_evidence.NAME,evidence)
        return
    prepared_scope(output,expected=scope,source=source['checkout_sha'])
    if scope=='technical':
        prepared=stage_timing.read_json(output/'fullstack-source.json',1_048_576)
        if 'stability' in prepared:raise ValueError('diagnostic_is_not_acceptance')
        proof_path=output/'fullstack-proof.json'
        if proof_path.exists() or proof_path.is_symlink():
            proof=stage_timing.read_json(proof_path,4_194_304)
            if type(proof) is not dict or type(proof.get('measured_linux_acceptance',{})) is not dict:raise ValueError('fullstack_scope_evidence')
            if proof.get('scope')!=scope or proof.get('scope_binding')!=prepared['scope_binding'] or proof.get('profile')!=prepared['profile'] or proof.get('full_spec_acceptance')!='deferred':raise ValueError('fullstack_scope_evidence')
            expected=[(pair,mode,definition) for pair,modes in enumerate(prepared['profile']['pairs']) for mode in modes for definition in prepared['profile']['phases']]
            phases=proof.get('phases')
            if type(phases) is not list or len(phases)>len(expected):raise ValueError('fullstack_scope_evidence')
            for row,(pair,mode,definition) in zip(phases,expected):
                if type(row) is not dict or row.get('scope_binding')!=prepared['scope_binding']:raise ValueError('fullstack_scope_evidence')
                validate_technical_phase(row,pair,mode,definition)
            if proof.get('measured_linux_acceptance',{}).get('state')=='passed':technical_closure(proof)
    refusal=startup_refusal.read(output,source['checkout_sha'],BACKENDS)
    timings={}
    clock_options=timing_options(output,source['checkout_sha'])
    for name in (stage_timing.NAME,stage_timing.CONTACTS_NAME):
        path=output/name
        if path.exists() or path.is_symlink():timings[name]=stage_timing.read(output,source['checkout_sha'],name=name,**(clock_options if name==stage_timing.NAME else {}))
    settings=profile(scope)
    definitions=settings['phases'];canonical_modes=settings['pairs'][0]
    # Filenames follow execution order; client phases retain canonical OFF/ON order.
    expected=[(pair,mode,definition,pair*len(canonical_modes)*len(definitions)+canonical_modes.index(mode)*len(definitions)+index)
        for pair,modes in enumerate(settings['pairs']) for mode in modes for index,definition in enumerate(definitions)]
    for ordinal,(pair,mode,definition,phase) in enumerate(expected):
        path=output/('fullstack-phase-'+str(ordinal)+'.json')
        if path.exists() or path.is_symlink():
            row=stability.read_json(path)
            if (type(row) is not dict or type(row.get('load')) is not dict or type(row.get('pair')) is not int
                    or row['pair']!=pair or row.get('mode')!=mode or row.get('name')!=definition['name']):raise ValueError('closed_slot_refusal')
            load=row['load']
            if scope=='technical':
                if load.get('scope')!=scope or row.get('scope_binding')!=prepared['scope_binding']:raise ValueError('fullstack_scope_evidence')
                validate_technical_phase(row,pair,mode,definition)
                stability.primary_endpoints(row.get('samples',[]))
            leaf=slot_refusal.validate(load.get('slot_refusal'),phase,mode=='on',load.get('missed'))
            if load.get('completed') is True and leaf['state']=='captured':raise ValueError('closed_slot_refusal')
            if 'health_probe_timing' in row:health_timing.validate(row['health_probe_timing'],source['checkout_sha'],output,ordinal)
    resource_runtime.ci.collect(output,metadata,destination,artifacts=tuple(name for name in ARTIFACTS if name not in (stage_timing.NAME,stage_timing.CONTACTS_NAME)))
    for name,value in timings.items():stage_timing.write(destination,value,source['checkout_sha'],binding_output=output,name=name,**(clock_options if name==stage_timing.NAME else {}))
    if evidence is not None:pilot.write_json(destination/preparation_evidence.NAME,evidence)
    if refusal is not None:startup_refusal.write(destination,refusal,source['checkout_sha'],BACKENDS)



def stability_inputs(output,images,protocol=stability.COLD_PROTOCOL,*,scope='full'):
    if scope=='full':inputs(output,images)
    else:inputs(output,images,scope=scope)
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    if scope=='technical':
        mode(output,False)
        prepared=cpu_control.read(output/'fullstack-source.json',private=False)
        prepared['stability']={'protocol':stability.require_protocol(protocol),'plan_sha256':cpu_control.digest(cpu_control.read(output/'compose.json')),
                               'images_sha256':cpu_control.digest(prepared['images'])}
        pilot.write_json(output/'fullstack-source.json',prepared)
        cpu_control.write(output/stability.MARKER,stability.technical_plan(sys.modules[__name__],output,source,protocol),once=True)
    else:pilot.write_json(output/stability.MARKER,stability.plan(source,protocol))


def stability_worker(output,owner,compose):
    source=pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()
    scope=prepared_scope(output,source=source)
    marker=stability.read_json(output/stability.MARKER)
    if scope=='technical':
        marker=stability.technical_request(sys.modules[__name__],output,source)
        stability.technical_owner(sys.modules[__name__],output,source,owner,bind=True)
        protocol=marker['protocol']
    else:protocol=stability.plan_protocol(marker,source)
    prepared=stability.read_json(output/'fullstack-source.json')
    if prepared.get('source')!=source:raise ValueError('diagnostic_image_source')
    images={key:prepared['images'][key] for key in ('backend','foundation','web','telegram','logto')}
    roles=services(scope)
    def persist(value):
        stability.validate(value,source,roles,protocol=protocol);pilot.write_json(output/stability.NAME,value)
    active=None
    def configure(enabled):
        nonlocal active
        active=configure_mode(compose,output,enabled)
    def measure(row):
        measured=phase(compose,owner['project'],row['definition'],active,row['enabled'],row['ordinal']//6,output,diagnostic_ordinal=row['ordinal'],diagnostic_protocol=protocol)
        return stability.project(measured,row['ordinal'],roles,protocol=protocol)
    # Persist before setup, so deadline/seed failures still have non-acceptance evidence.
    persist(stability.record(source,roles,images,protocol=protocol))
    with pilot.worker_storage_guard(owner,compose,output):
        mode(output,False);invoke(compose,['up','-d','postgres','provider','loadgen'],timeout=30)
        invoke(compose,['exec','-T','loadgen','node','--test','/resource/test-responses.mjs'],timeout=10)
        seed(compose,output)
        stability.experiment(source,configure,measure,persist,roles,images,protocol=protocol)


def stability_collect(output,metadata,destination,*,protocol=stability.COLD_PROTOCOL,scope='full'):
    cpu_control.reject(output)
    stability.require_protocol(protocol)
    source,_=hosted.metadata_source(metadata)
    roles=services(scope)
    prepared=(output/'fullstack-source.json').exists() or (output/'fullstack-source.json').is_symlink()
    runtime=any(cpu_control.present(output/name) for name in ('owner.json','worker.json','worker-outcome.json','cleanup.json',stability.OWNER,stability.NAME))
    images={}
    if scope=='technical':
        cpu_control.need(output.absolute()==output.resolve() and destination.absolute()==destination.resolve() and not cpu_control.present(destination))
        if prepared:
            stability.technical_request(sys.modules[__name__],output,source['checkout_sha'],protocol=protocol)
            images={key:cpu_control.read(output/'fullstack-source.json',private=False)['images'][key] for key in cpu_control.IMAGES}
            if cpu_control.present(output/'owner.json'):
                good=stability.technical_settlement(sys.modules[__name__],output,source['checkout_sha'])
            else:
                cpu_control.need(not runtime);good=False
        else:
            prepared_scope(output,expected=None,source=source['checkout_sha'])
            cpu_control.need(not runtime and not cpu_control.present(output/stability.MARKER));good=False
    else:prepared_scope(output,expected='full',source=source['checkout_sha'] if prepared else None)
    marker=output/stability.MARKER
    if scope=='full' and (marker.exists() or marker.is_symlink()):
        stability.plan_protocol(stability.read_json(marker),source['checkout_sha'],expected=protocol)
    refusal=startup_refusal.read(output,source['checkout_sha'],BACKENDS)
    if (output/stability.NAME).exists() or (output/stability.NAME).is_symlink():
        value=stability.validate(stability.read_json(output/stability.NAME),source['checkout_sha'],roles,protocol=protocol)
        if scope=='technical':cpu_control.need(value['images']==images)
        if scope=='technical' and value['state']=='complete':
            outcome=cpu_control.read(output/'worker-outcome.json',private=False)
            if not good or outcome['exit_code']!=0 or outcome['monitor_failed'] or not cpu_control.present(output/stability.OWNER):
                value['state']='incomplete';pilot.write_json(output/stability.NAME,value)
    else:
        output.mkdir(mode=0o700,parents=True,exist_ok=True)
        pilot.write_json(output/stability.NAME,stability.record(source['checkout_sha'],roles,images,protocol=protocol))
    resource_runtime.ci.collect(output,metadata,destination,artifacts=(stability.NAME,'cleanup.json','worker-outcome.json','monitor-failure.json'))
    if refusal is not None:startup_refusal.write(destination,refusal,source['checkout_sha'],BACKENDS)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('run','worker','contacts','recover','collect','diagnostic-run','diagnostic-collect','diagnostic-admission','cpu-control-admission','cpu-control-run','cpu-control-recover','cpu-control-collect'))
    parser.add_argument('--output',type=Path);parser.add_argument('--images',type=Path)
    parser.add_argument('--protocol',choices=(stability.COLD_PROTOCOL,stability.PRIMED_PROTOCOL))
    parser.add_argument('--core',choices=core_layout.CORES)
    parser.add_argument('--scope',choices=('full','technical'),default='full')
    parser.add_argument('--contacts-token');parser.add_argument('--metadata',type=Path);parser.add_argument('--public',type=Path);args=parser.parse_args()
    if args.scope=='technical' and args.action not in ('run','recover','collect','diagnostic-admission','diagnostic-run','diagnostic-collect','cpu-control-admission','cpu-control-run','cpu-control-recover','cpu-control-collect'):parser.error('--scope technical requires a scope-bound action')
    if args.scope=='technical' and args.core is not None:parser.error('technical scope uses primary core')
    if args.core is not None:
        if args.action!='run':parser.error('--core requires run action')
        core_layout.require_runtime(args.core)
    if args.protocol is not None and args.action not in ('diagnostic-run','diagnostic-collect'):parser.error('--protocol requires diagnostic action')
    protocol=args.protocol or stability.COLD_PROTOCOL
    cpu_options={'scope':args.scope} if args.scope=='technical' else {}
    if args.action=='cpu-control-admission':return cpu_control.admission(sys.modules[__name__],**cpu_options)
    if args.action=='diagnostic-admission':
        return stability.admission(sys.modules[__name__],args.scope)
    if args.output is None:parser.error('--output required')
    if args.action.startswith('cpu-control-'):
        if args.action=='cpu-control-run':
            try:return cpu_control.run_pair(sys.modules[__name__],args.output,args.images,args.metadata,**cpu_options)
            except subprocess.CalledProcessError as error:raise SystemExit(error.returncode if 0<error.returncode<=255 else 1)
        if args.action=='cpu-control-recover':return cpu_control.recover_pair(sys.modules[__name__],args.output,args.images,**cpu_options)
        return cpu_control.collect(sys.modules[__name__],args.output,args.metadata,args.public,**cpu_options)
    if args.action in ('run','diagnostic-run'):cpu_control.reject(args.output)
    if args.action=='contacts':return contacts_worker(args.output,args.contacts_token)
    if args.action=='worker':return worker(args.output)
    if args.action=='diagnostic-collect':return stability_collect(args.output,args.metadata,args.public,protocol=protocol,**cpu_options)
    if args.action=='collect':
        return collect(args.output,args.metadata,args.public,scope=args.scope)
    if args.action=='recover':
        bound=(args.output/'fullstack-source.json').exists() or (args.output/'fullstack-source.json').is_symlink()
        registered=(args.output/'owner.json').exists() or (args.output/'owner.json').is_symlink()
        # Check surviving prepared inputs even without the binding, before either
        # project recovery or image retirement. No acquired project remains safe.
        prepared_scope(args.output,expected=args.scope if bound or registered else None,
            **({'source':pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip()} if args.scope=='technical' and bound else {}))
        marked=cpu_control.present(args.output/stability.MARKER) or cpu_control.present(args.output/stability.OWNER)
        if marked and args.scope=='full' and stability.read_json(args.output/stability.MARKER).get('scope')=='technical':
            raise ValueError('diagnostic_plan_binding')
        diagnostic=args.scope=='technical' and (marked or bound and 'stability' in cpu_control.read(args.output/'fullstack-source.json',private=False))
        if diagnostic:
            stability.technical_request(sys.modules[__name__],args.output,pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip())
            if registered:stability.technical_registration(sys.modules[__name__],args.output,pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip())
        def recover_project():
            if diagnostic and cpu_control.present(args.output/'cleanup.json'):
                good=stability.technical_settlement(sys.modules[__name__],args.output,pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip())
                if not good:raise ValueError('diagnostic_cleanup_incomplete')
                return cpu_control.read(args.output/'cleanup.json',private=False)
            return resource_runtime.ci.recover(args.output,project_prefix=PREFIX,services=services(args.scope))
        if args.images is None or not preparation.directory(args.images).exists():return recover_project()
        stage=preparation.recover_stage(args.images)
        with stage.in_use():
            if not (args.output/'owner.json').exists() and not (args.output/'owner.json').is_symlink():
                return stage.release(str(args.output.resolve()),cleanup_ok=True)
            result=recover_project()
            stage.release(str(args.output.resolve()),cleanup_ok=result.get('down')=='passed' and result.get('residue')=='passed')
            return result
    if args.images is None:parser.error('--images required')
    deadline=worker_deadline(args.scope)
    stage=preparation.recover_stage(args.images)
    with stage.in_use():
        stage.require_consumer(str(args.output.resolve()))
        try:
            pilot.run(args.output,prepare_inputs=lambda output:stability_inputs(output,args.images,protocol,**cpu_options) if args.action=='diagnostic-run' else inputs(output,args.images,scope='technical') if args.scope=='technical' else inputs(output,args.images),worker_script=Path(__file__).resolve(),
                ports=(18427,13000,14318,1514,13301),services=services(args.scope),project_prefix=PREFIX,
                scope=('diagnostic_only; not capacity acceptance' if args.action=='diagnostic-run' else 'technical-only platform-technical-v1 whole-process Linux resource corpus; full-spec acceptance deferred' if args.scope=='technical' else 'representative whole-process Linux resource corpus; production rollout evidence incomplete'),missing=['PG/Caddy source-cache sampler workload','physical Timeweb verification and seven days'],worker_pass_fds=stage.pass_fds(),worker_deadline_seconds=deadline)
        finally:
            if args.action=='diagnostic-run' and args.scope=='technical' and cpu_control.present(args.output/'owner.json'):
                stability.technical_settlement(sys.modules[__name__],args.output,pilot.command(['git','-C',str(ROOT),'rev-parse','HEAD']).strip())


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    main()
