"""CPU-policy control at real plan, native dispatch and publication boundaries."""
from test_protocol_runner import inverse_protocol_workflow
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import fullstack

PROFILES=('fixture-capped-v1','app-cpu-unlimited-v1')
ROLES=('api','mcp','material-assets-worker','profile-avatars-worker','video-deletions-worker',
       'billing-worker','notifications-worker','web','postgres','rabbitmq','telegram','logto')
SOURCE='a'*40


def event(body='<!-- monitoring-cpu-control: app-unlimited-v1 -->',action='synchronize'):
    return {'action':action,'number':1566,'repository':{'full_name':'sachkov-inside/platform'},
            'pull_request':{'number':1566,'state':'open','body':body,
                            'head':{'sha':'b'*40},'base':{'sha':'c'*40,'ref':'main','repo':{'full_name':'sachkov-inside/platform'}}}}


def pins():
    return {'schema':3,'source':SOURCE,'owner':'inside-platform-production-smoke-cache-cpu',
            **{role:'sha256:'+character*64 for role,character in zip(('backend','foundation','web','telegram','logto'),'bcdef')}}


def request(root):
    return {'schema':1,'kind':'app-cpu-control-v1','source':SOURCE,'root':str(root),
            'nonce':'0123456789abcdef'*2,'profiles':list(PROFILES),'images':{k:pins()[k] for k in ('backend','foundation','web','telegram','logto')},
            'workload_sha256':hashlib.sha256(fullstack.PROFILE.read_bytes()).hexdigest()}


def private(path,value):
    path.write_text(json.dumps(value));path.chmod(0o600)


def broker_tls_plan_fixture(output,args,options):
    """No crypto claim: TLS issuance is outside the CPU-plan assertion seam."""
    target=output/'runtime/rabbitmq/tls'
    expected=['bash',str(fullstack.ROOT/'infra/production/broker/issue-broker-tls.sh'),str(target),'2','2']
    if args!=expected or options!={'timeout':15} or type(options.get('timeout')) is not int:raise AssertionError('unexpected broker TLS plan request')
    target.mkdir(mode=0o700)
    for name in ('ca.pem','ca-key.pem','server.pem','server-key.pem'):
        path=target/name;path.write_text('CPU-control plan fixture only: '+name+'\n');path.chmod(0o600)
    return ''


def assemble(root,profile,*,control=True):
    """Real plan/configuration with fixed image-ID and broker-TLS ports; no broker crypto proof."""
    images=root/'images.json';private(images,pins())
    if control:private(root/'cpu-control-pair.json',request(root))
    def command(args,**kwargs):
        if args[0]=='git':return SOURCE
        if args[0]=='bash':return broker_tls_plan_fixture(root/profile,args,kwargs)
        for role,suffix in [('backend','-backend:v1'),('foundation','-foundation:local'),('web','-web:v1'),('telegram','-telegram:v1'),('logto','-logto:v1')]:
            if any(arg.endswith(suffix) for arg in args):return pins()[role]
        raise AssertionError('unexpected native boundary')
    output=root/profile
    from collections import namedtuple
    usage=namedtuple('usage','total used free')
    with patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot,'assert_docker_identity'),patch.object(fullstack.pilot,'install_horizon'),patch.object(fullstack.pilot.shutil,'disk_usage',return_value=usage(128*1024**3,64*1024**3,64*1024**3)):
        fullstack.inputs(output,images)
    return output,json.loads((output/'compose.json').read_text())


class CpuControl(unittest.TestCase):
    def test_actual_inputs_remove_only_twelve_cpu_keys_for_bound_unlimited_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            output,plan=assemble(root,PROFILES[1])
            self.assertEqual([role for role in ROLES if 'cpus' in plan['services'][role]],[])
            self.assertEqual(plan['services']['loadgen']['cpus'],2)
            self.assertEqual(plan['services']['provider']['cpus'],'0.25')
            for role in ROLES:self.assertEqual(plan['services'][role]['mem_limit'],'768m' if role in ('rabbitmq','logto') else '512m')

    def test_transform_preserves_whole_plan_and_rejects_changed_baseline_or_selector(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output,baseline=assemble(root,PROFILES[0])
            unlimited=cpu.transform(baseline,PROFILES[1]);restored=copy.deepcopy(unlimited)
            for role in ROLES:restored['services'][role]['cpus']=baseline['services'][role]['cpus']
            self.assertEqual(restored,baseline)
            self.assertEqual(cpu.transform(baseline,PROFILES[0]),baseline)
            self.assertEqual(baseline,json.loads((output/cpu.BASELINE).read_text()))
            for selected in (None,True,1,'','private','fixture-capped-v1,app-cpu-unlimited-v1'):
                with self.subTest(selected=selected),self.assertRaises(ValueError):cpu.transform(baseline,selected)
            for key,value in [('cpus',2),('cpus',True),('cpus',1.0),('mem_limit','768m'),('cpu_quota',0),('cpu_period',0),('cpuset',''),('deploy',{})]:
                bad=copy.deepcopy(baseline);bad['services']['api'][key]=value
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):cpu.transform(bad,PROFILES[1])
            bad=copy.deepcopy(baseline);del bad['services']['postgres']
            with self.assertRaises(ValueError):cpu.transform(bad,PROFILES[1])

    def test_event_and_real_entry_reject_unknown_mixed_missing_or_wrong_action_before_stage(self):
        import cpu_control as cpu
        good=event()
        cpu.require_event(good)
        for bad_event in (None,{},[],{'action':'edited','pull_request':{'body':cpu.EVENT_MARKER}},
                      {'action':'opened','pull_request':{'body':None}},
                      {'action':'opened','pull_request':{'body':cpu.EVENT_MARKER.upper()}},
                      {'action':'opened','pull_request':{'body':cpu.EVENT_MARKER*2}},
                      {'action':'opened','pull_request':{'body':cpu.EVENT_MARKER+'<!-- monitoring-cpu-control: private -->'}},
                      {'action':'opened','pull_request':{'body':cpu.EVENT_MARKER+'<!-- monitoring-stability: run -->'}},
                      {'action':'opened','pull_request':{'body':'x'*65537+cpu.EVENT_MARKER}}):
            with self.subTest(event=type(bad_event).__name__),self.assertRaises(ValueError):cpu.require_event(bad_event)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();event_path=root/'event.json';private(event_path,{'action':'opened','pull_request':{'body':'private'}})
            with patch.object(fullstack.hosted,'context'),patch.dict(os.environ,{'GITHUB_EVENT_PATH':str(event_path),'CPU_CONTROL_JOB_STARTED':str(__import__('time').monotonic()),'PILOT_PR_HEAD_SHA':'b'*40,'PILOT_PR_BASE_SHA':'c'*40}),patch.object(fullstack.preparation,'recover_stage') as native:
                with self.assertRaises(ValueError):cpu.run_pair(fullstack,root/'pair',root/'images',root/'metadata')
                native.assert_not_called();self.assertFalse((root/'pair').exists())

    def test_default_and_primed_collectors_refuse_every_cpu_record_before_copy(self):
        import cpu_control as cpu
        for name in cpu.FILES:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700);private(output/name,{})
                with patch.object(fullstack.resource_runtime.ci,'collect') as copying:
                    with self.assertRaises(ValueError):fullstack.collect(output,root/'metadata',root/'ordinary')
                    with self.assertRaises(ValueError):fullstack.stability_collect(output,root/'metadata',root/'primed',protocol=fullstack.stability.PRIMED_PROTOCOL)
                    copying.assert_not_called()
                with patch.object(fullstack.pilot,'command') as native:
                    with self.assertRaises(ValueError):fullstack.worker(output)
                    native.assert_not_called()

    def bound(self,root,profile=PROFILES[1],*,control=True):
        import cpu_control as cpu
        output,plan=assemble(root,profile,control=control)
        owner={'project':fullstack.PREFIX+'a'*12,'cwd':str(fullstack.ROOT),'supervisor_pid':os.getppid(),
               'docker_storage':'/owned','orbstack':None,'daemon':{'fixture':True},'cleanup':[]}
        private(output/'owner.json',owner)
        cpu.bind_worker(fullstack,output,owner,SOURCE)
        return output,plan,owner

    def projection(self,owner,profile):
        return [{'id':format(index+1,'064x'),'project':owner['project'],'service':role,'running':True,
                 'memory':(768 if role in ('rabbitmq','logto') else 512)*1024**2,
                 'nano_cpus':1_000_000_000 if profile==PROFILES[0] else 0,'cpu_quota':0,'cpu_period':0,'cpuset_cpus':''}
                for index,role in enumerate(ROLES)]

    def test_real_bulk_projection_and_five_capture_boundary_reject_identity_limits_and_incomplete_fields(self):
        import cpu_control as cpu
        for profile in PROFILES:
            with self.subTest(profile=profile),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output,_,owner=self.bound(root,profile)
                rows=self.projection(owner,profile);ids=[r['id'] for r in rows]
                def native(compose,args,**options):
                    self.assertGreater(options['timeout'],0);self.assertLessEqual(options['timeout'],2)
                    if args[0]=='ps':self.assertEqual(args,['ps','-q',*ROLES]);return '\n'.join(ids)
                    self.assertEqual(args,['inspect','--format',cpu.PROJECTION,*ids]);return '\n'.join(map(json.dumps,rows))
                compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
                with patch.object(fullstack,'invoke',side_effect=native) as read:
                    for index,enabled in enumerate((False,True,True,False)):
                        fullstack.mode(output,enabled);cpu.capture(fullstack,output,compose,SOURCE,index,enabled)
                    cpu.capture(fullstack,output,compose,SOURCE,4,False)
                    self.assertEqual(read.call_count,10)
                value,_,_=cpu.ledger(fullstack,output,SOURCE);self.assertEqual([s['ordinal'] for s in value['snapshots']],list(range(5)))
                with self.assertRaises(ValueError):cpu.capture(fullstack,output,compose,SOURCE,4,False)
                raw='\n'.join(map(json.dumps,rows));cpu.quota_rows(raw,ids,owner['project'],profile)
                bads=[]
                for key,value in [('project','foreign'),('service','unknown'),('service',ROLES[1]),('id','f'*64),('memory',1),('nano_cpus',2),('cpu_quota',-1),('cpu_period',100000),('cpuset_cpus','0'),('running',False),('memory',True)]:
                    bad=copy.deepcopy(rows);bad[0][key]=value;bads.append(bad)
                for key in ('nano_cpus','cpu_quota','cpu_period','cpuset_cpus'):
                    bad=copy.deepcopy(rows);del bad[0][key];bads.append(bad)
                bads.extend([rows[:-1],rows+[rows[0]]])
                for bad in bads:
                    with self.assertRaises(ValueError):cpu.quota_rows('\n'.join(map(json.dumps,bad)),ids,owner['project'],profile)
                for bad in ('x'*16385,'{','{"id":1,"id":2}','NaN'):
                    with self.assertRaises((ValueError,TypeError)):cpu.quota_rows(bad,ids,owner['project'],profile)

    def test_private_worker_binding_refuses_source_output_profile_owner_plan_and_files_before_native(self):
        import cpu_control as cpu
        for fault in ('source','scope','profile','output','plan','schema','pair','workload','writable','symlink','unknownrole','owner'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output,plan=assemble(root,PROFILES[1]);marker=cpu.read(output/cpu.MARKER)
                owner={'project':fullstack.PREFIX+'a'*12,'cwd':str(fullstack.ROOT),'supervisor_pid':os.getppid(),'docker_storage':'/owned','orbstack':None,'daemon':{},'cleanup':[]}
                if fault in ('source','profile','output','pair','workload'):marker[{'scope':'kind','plan':'plan_sha256','workload':'workload_sha256'}.get(fault,fault)]='private'
                if fault=='scope':marker['kind']='capacity'
                if fault=='schema':marker['schema']=True
                if fault=='plan':plan['services']['caddy']['cpus']=1;private(output/'compose.json',plan)
                if fault=='unknownrole':plan['services']['foreign']={};private(output/'compose.json',plan)
                if fault=='owner':owner['cwd']='/foreign'
                private(output/cpu.MARKER,marker)
                if fault=='writable':(output/cpu.MARKER).chmod(0o666)
                if fault=='symlink':(output/cpu.MARKER).rename(output/'saved');(output/cpu.MARKER).symlink_to(output/'saved')
                with patch.object(fullstack,'invoke') as native:
                    with self.assertRaises((ValueError,OSError)):cpu.bind_worker(fullstack,output,owner,SOURCE)
                    native.assert_not_called();self.assertFalse((output/cpu.QUOTAS).exists())

    def test_pair_real_orchestrator_preserves_first_exit_and_cleanup_before_second_with_two_leases(self):
        import cpu_control as cpu
        from contextlib import nullcontext
        for failure,cleanup in ((17,True),(17,False),(17,'raises'),(0,True)):
            with self.subTest(failure=failure,cleanup=cleanup),tempfile.TemporaryDirectory() as directory:
                base=Path(directory).resolve();root=base/'pair';images=base/'images.json';private(images,pins());events=[]
                stage=fullstack.preparation.begin(images,SOURCE,pins()['owner'],{'fixture':True},str(root/PROFILES[0]),docker=lambda _: '',identify=lambda:{'fixture':True},web=True,applications=True)
                original_release=stage.release
                def release(consumer,**options):
                    events.append(('release',Path(consumer).name,options['cleanup_ok']))
                    return original_release(consumer,**options)
                def run(output,**options):
                    self.assertEqual(set(stage._pending()),{str(root/PROFILES[1])} if output.name==PROFILES[1] else {str(root/p) for p in PROFILES})
                    events.append(('acquire',output.name));_,_,owner=self.bound(root,output.name,control=False)
                    code=failure if output.name==PROFILES[0] else 0
                    good=cleanup is True or output.name==PROFILES[1]
                    self.worker_receipt(output,owner,code,good)
                    events.append(('cleanup',output.name))
                    if output.name==PROFILES[0] and cleanup=='raises':(output/'worker-outcome.json').write_text('{')
                    self.assertEqual(options['worker_script'],Path(cpu.__file__).resolve())
                    if output.name==PROFILES[0] and failure:raise subprocess.CalledProcessError(failure,'owned-worker')
                with patch.object(cpu,'admission',return_value=__import__('time').monotonic()),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(stage,'release',side_effect=release),patch.object(fullstack.pilot,'run',side_effect=run),patch.object(fullstack.resource_runtime.ci,'recover',side_effect=AssertionError('pair repeated native cleanup')):
                    if failure:
                        with self.assertRaises(subprocess.CalledProcessError) as caught:cpu.run_pair(fullstack,root,images,base/'metadata')
                        self.assertEqual(caught.exception.returncode,17)
                    else:cpu.run_pair(fullstack,root,images,base/'metadata')
                acquisitions=[e for e in events if e[0]=='acquire']
                self.assertEqual(acquisitions,[('acquire',PROFILES[0]),('acquire',PROFILES[1])] if cleanup is True else [('acquire',PROFILES[0])])
                if cleanup is True:self.assertLess(events.index(('cleanup',PROFILES[0])),events.index(('acquire',PROFILES[1])))
                result=cpu.read(root/cpu.OUTCOME)
                self.assertEqual(result['exits'],[failure,0] if cleanup is True else [failure,None])
                self.assertEqual(stage._pending(),[] if cleanup is True else [str(root/PROFILES[0])])

    def proof(self):
        labels=('web_home','web_material','api_catalog','api_account','telegram_webhook','logto_discovery')
        phases=[]
        for pair,modes in enumerate((('off','on'),('on','off'))):
            for mode in modes:
                for name in ('idle','steady','spike'):
                    host={'cpu_total':0,'cpu_busy':0,'total_inodes':100,'free_inodes':50,'device_io_reads':0,'device_io_writes':0,'device_io_read_bytes':0,'device_io_written_bytes':0,'memory_free_fraction':.5,'disk_free_fraction':.5,'used_bytes':3*1024**3}
                    phases.append({'pair':pair,'mode':mode,'name':name,'errors':[],
                        'loadgen_cpu_pressure':{'state':'unthrottled','cpu_periods':100,'cpu_throttled_periods':0,'cpu_throttled_ns':0},'storage_samples':[{},{}],
                        'host_samples':[host,{**host,'cpu_total':100,'cpu_busy':20}],
                        'load':{'completed':True,'scheduled':0 if name=='idle' else 400,'success':0 if name=='idle' else 400,'missed':0,
                                'latency':[] if name=='idle' else [{'label':label,'elapsed_ms':1} for label in labels for _ in range(50)],
                                'unexpected_failures':0,'unexplained_probe_loss':0,'query_seconds':[1],'ingestion_lag_seconds':2 if mode=='on' else None},
                        'source_cache_samples':[{'postgresql':'observed','caddy':'observed'}]*{'idle':2,'steady':8,'spike':2}[name] if mode=='on' else []})
        result={'schema':1,'profile':json.loads(fullstack.PROFILE.read_text()),'state':'measured','source_cache_workload':True,'phases':phases,
                'controlled_outage':{'attempted':1,'acknowledged':0,'explained_loss':1,'post_restart_acknowledged':1,'post_restart_stored':1,'outage_stored':0}}
        result['measured_linux_acceptance']=fullstack.evaluate(result)
        self.assertEqual(result['measured_linux_acceptance']['state'],'passed')
        return result

    def completed(self,root,profiles=PROFILES,*,outcome=True,control=True):
        import cpu_control as cpu
        for profile in profiles:
            output,_,owner=self.bound(root,profile,control=control);rows=self.projection(owner,profile);ids=[r['id'] for r in rows]
            def native(compose,args,**options):return '\n'.join(ids) if args[0]=='ps' else '\n'.join(map(json.dumps,rows))
            with patch.object(fullstack,'invoke',side_effect=native):
                for ordinal,enabled in enumerate((False,True,True,False,False)):
                    fullstack.mode(output,enabled);cpu.capture(fullstack,output,[],SOURCE,ordinal,enabled)
            proof=self.proof();private(output/'fullstack-proof.json',proof)
            for ordinal,phase in enumerate(proof['phases']):
                frames=[]
                seconds=40 if phase['name']=='steady' else 10
                for index in (0,1):
                    active=(*fullstack.APPS,*fullstack.CORE) if phase['mode']=='on' else fullstack.APPS
                    values={role:{'cpu_total_ns':index*1_000_000_000,'memory_charged_bytes':1024**2,'cpu_periods':index*100,'cpu_throttled_periods':index*2,'cpu_throttled_ns':index*50_000_000} for role in active}
                    values['loadgen'].update(cpu_throttled_periods=0,cpu_throttled_ns=0)
                    frames.append({'counters':{'at_seconds':100+index*seconds,'services':values,'errors':{}},'host':phase['host_samples'][index],
                                   'counter_clock_anchor':[100000+index*seconds*1000,1800000000000+index*seconds*1000,100001+index*seconds*1000]})
                private(output/('fullstack-phase-'+str(ordinal)+'.json'),{**phase,'samples':frames})
            self.worker_receipt(output,owner,0,True)
        value=cpu.pair(fullstack,root,SOURCE)
        if outcome:private(root/cpu.OUTCOME,{'schema':2,'source':SOURCE,'pair':cpu.digest(value),'exits':[0,0],'cleanup':[True,True],'publication_failed':False})

    def test_failed_first_measurement_survives_second_actual_pilot_reserved_port_failure(self):
        import cpu_control as cpu
        import socket
        from types import SimpleNamespace
        real_pilot=fullstack.pilot.run
        with tempfile.TemporaryDirectory() as directory,socket.socket() as reserved:
            base=Path(directory).resolve();root=base/'pair';images=base/'images.json';private(images,pins())
            reserved.bind(('127.0.0.1',0));port=reserved.getsockname()[1]
            stage=fullstack.preparation.begin(images,SOURCE,pins()['owner'],{'fixture':True},str(root/PROFILES[0]),docker=lambda _: '',identify=lambda:{'fixture':True},web=True,applications=True)
            primary=subprocess.CalledProcessError(1,'observability pilot worker',output='first-oracle-private-sentinel');prepared=[];trace=[]
            def command(argv,**options):
                if argv[:2]==['git','-C']:return ''
                if argv==['docker','context','show']:return 'default'
                if argv==['docker','compose','ls','--format','json']:return '[]'
                raise AssertionError('unexpected native command')
            def run(output,**options):
                if output.name==PROFILES[0]:
                    self.completed(root,(PROFILES[0],),outcome=False,control=False)
                    proof=cpu.read(output/'fullstack-proof.json')
                    for row in proof['phases']:
                        if row['mode']=='on':
                            for sample in row['load']['latency']:sample['elapsed_ms']=2
                    proof['state']='failed';proof['measured_linux_acceptance']=fullstack.evaluate(proof)
                    self.assertEqual(proof['measured_linux_acceptance']['state'],'failed')
                    private(output/'fullstack-proof.json',proof)
                    for ordinal,row in enumerate(proof['phases']):
                        path=output/('fullstack-phase-'+str(ordinal)+'.json');raw=cpu.read(path);raw['load']=row['load'];private(path,raw)
                    self.worker_receipt(output,cpu.read(output/'owner.json'),1,True)
                    raise primary
                self.assertEqual(options['ports'],(18427,13000,14318,1514,13301))
                callback=options['prepare_inputs']
                def prepare(path):prepared.append(path);return callback(path)
                options.update(ports=(port,),prepare_inputs=prepare)
                with patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot.platform,'system',return_value='Linux'),patch.object(fullstack.pilot.daemon,'identify',return_value={'storage':str(base),'endpoint':'fixture'}),patch.object(fullstack.pilot.shutil,'disk_usage',return_value=SimpleNamespace(total=128*1024**3,free=64*1024**3)):
                    return real_pilot(output,**options)
            with patch.object(cpu,'admission',return_value=__import__('time').monotonic()),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.pilot,'run',side_effect=run),patch.object(fullstack.resource_runtime.ci,'recover',side_effect=AssertionError('native cleanup repeated')):
                try:cpu.run_pair(fullstack,root,images,base/'metadata')
                except subprocess.CalledProcessError as error:
                    self.assertIs(error,primary);current=error.__traceback__
                    while current is not None:trace.append(current.tb_frame.f_code);current=current.tb_next
                else:self.fail('original oracle failure was lost')
                self.assertIn(run.__code__,trace);self.assertEqual(prepared,[])
                self.assertFalse((root/PROFILES[1]).exists());self.assertEqual(stage._pending(),[])
                result=cpu.collect(fullstack,root,base/'metadata',base/'public')
            self.assertEqual(result['schema'],3)
            self.assertFalse(result['measurement_complete']);self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])
            first,second=result['profiles'];self.assertEqual(first['state'],'measurement_complete')
            self.assertEqual(first['measurement']['quality']['success'],3200);self.assertEqual(first['original_oracle']['state'],'failed')
            self.assertEqual(second['state'],'admission_failed');self.assertEqual(second['measurement'],{'available':False})
            self.assertFalse(second['cleanup']);self.assertEqual(second['failure'],{'stage':'pilot_admission','category':'os_error','errno':'address_in_use','exit_code':1})
            published=(base/'public'/cpu.NAME).read_text()
            for secret in ('first-oracle-private-sentinel',str(base),'127.0.0.1:'+str(port)):
                self.assertNotIn(secret,published)

    def partial_context(self,root):
        import cpu_control as cpu
        self.completed(root,(PROFILES[0],),outcome=False)
        value=cpu.pair(fullstack,root,SOURCE)
        first=cpu.profile_context(value,PROFILES[0]);first.update(stage='worker',state='returned',prepared=True,exit_code=0)
        second=cpu.profile_context(value,PROFILES[1]);second.update(stage='pilot_admission',state='failed',category='os_error',errno='address_in_use',exit_code=1)
        result={'schema':3,'source':SOURCE,'pair':cpu.digest(value),'exits':[0,1],'cleanup':[True,False],'publication_failed':False,'profiles':[first,second]}
        private(root/cpu.OUTCOME,result)
        return result

    def test_partial_collector_refuses_context_forgery_downgrade_or_present_corruption(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);good=self.partial_context(root);cases=[]
            for field,value in [('schema',True),('schema',2),('schema',4),('source','b'*40),('pair','f'*64),('private','private-sentinel')]:
                bad=copy.deepcopy(good);bad[field]=value;cases.append(bad)
            bad=copy.deepcopy(good);bad['schema']=2;del bad['profiles'];cases.append(bad)
            bad=copy.deepcopy(good);del bad['profiles'];cases.append(bad)
            bad=copy.deepcopy(good);bad['profiles'].reverse();cases.append(bad)
            for field,value in [('context','f'*64),('profile',PROFILES[0]),('stage','private-stage'),('stage','worker'),('prepared',True),
                                ('prepared',1),('state','not_run'),('category','private-error'),('category','value_error'),
                                ('errno',98),('errno','private-errno'),('errno',True),('exit_code',0),('exit_code',True),('private','private-sentinel')]:
                bad=copy.deepcopy(good);bad['profiles'][1][field]=value;cases.append(bad)
            bad=copy.deepcopy(good);bad['exits'][1]=None;cases.append(bad)
            bad=copy.deepcopy(good);bad['cleanup'][1]=True;cases.append(bad)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                for index,bad in enumerate(cases):
                    with self.subTest(index=index):
                        private(root/cpu.OUTCOME,bad);destination=base/('bad-'+str(index))
                        with self.assertRaises(ValueError):cpu.collect(fullstack,root,base/'metadata',destination)
                        self.assertFalse(destination.exists())
                private(root/cpu.OUTCOME,good)
                # A present invalid output never gets reclassified as harmless absence.
                output=root/PROFILES[1];output.mkdir(mode=0o700)
                with self.assertRaises((ValueError,OSError)):cpu.collect(fullstack,root,base/'metadata',base/'present-corrupt')
                self.assertFalse((base/'present-corrupt').exists());output.rmdir()
                output.symlink_to(root/PROFILES[0])
                with self.assertRaises((ValueError,OSError)):cpu.collect(fullstack,root,base/'metadata',base/'replaced')
                self.assertFalse((base/'replaced').exists());output.unlink()
                for stage,category in [('pilot_admission','os_error'),('prepare_inputs','value_error')]:
                    allowed=copy.deepcopy(good);allowed['profiles'][1].update(stage=stage,category=category,errno=None)
                    private(root/cpu.OUTCOME,allowed);result=cpu.collect(fullstack,root,base/'metadata',base/('unknown-'+stage))
                    self.assertIsNone(result['profiles'][1]['failure']['errno']);self.assertFalse(result['measurement_complete'])
                    self.assertFalse(result['profiles'][1]['cleanup']);self.assertIsNone(result['minimum_candidate_gib'])

    def test_collector_cannot_complete_without_active_loadgen_counters(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            path=root/PROFILES[0]/'fullstack-phase-0.json';raw=cpu.read(path)
            for frame in raw['samples']:del frame['counters']['services']['loadgen']
            private(path,raw);destination=base/'missing-loadgen'
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                try:result=cpu.collect(fullstack,root,base/'metadata',destination)
                except ValueError:self.assertFalse(destination.exists())
                else:self.assertFalse(result['measurement_complete'])

    def test_collector_requires_exact_active_cohort_and_known_essential_counters(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root);output=root/PROFILES[0]
            originals=[cpu.read(output/('fullstack-phase-'+str(i)+'.json')) for i in (0,3)]
            cases=[]
            for ordinal,role in ((0,'provider'),(3,'alloy')):
                raw=copy.deepcopy(originals[ordinal//3])
                del raw['samples'][0]['counters']['services'][role]
                cases.append((ordinal,raw,True))
            for field in ('services','errors'):
                raw=copy.deepcopy(originals[0]);raw['samples'][0]['counters'][field]['alloy']={} if field=='services' else 'engine_read_failed'
                cases.append((0,raw,True))
            for role,ordinal in (('loadgen',0),('provider',0),('alloy',3)):
                for key in ('cpu_total_ns','memory_charged_bytes'):
                    for value in ('missing',None,True,-1,2**53):
                        raw=copy.deepcopy(originals[ordinal//3]);service=raw['samples'][0]['counters']['services'][role]
                        if value=='missing':del service[key]
                        else:service[key]=value
                        cases.append((ordinal,raw,value is not None and value!='missing'))
            for index,(ordinal,raw,refusal) in enumerate(cases):
                with self.subTest(case=index,ordinal=ordinal):
                    for i,original in zip((0,3),originals):private(output/('fullstack-phase-'+str(i)+'.json'),original)
                    private(output/('fullstack-phase-'+str(ordinal)+'.json'),raw);destination=base/('cohort-'+str(index))
                    with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                        if refusal:
                            with self.assertRaises(ValueError):cpu.collect(fullstack,root,base/'metadata',destination)
                            self.assertFalse(destination.exists())
                        else:
                            result=cpu.collect(fullstack,root,base/'metadata',destination)
                            self.assertFalse(result['measurement_complete'])
                            self.assertFalse(result['profiles'][0]['measurement']['quality']['counter_complete'])
                            self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])

    def test_collector_recomputes_loadgen_pressure_and_preserves_coherent_unavailable_as_incomplete(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root);output=root/PROFILES[0]
            path=output/'fullstack-phase-0.json';original=cpu.read(path);proof=cpu.read(output/'fullstack-proof.json')
            for kind in ('throttled','reset','unknown'):
                with self.subTest(kind=kind):
                    raw=copy.deepcopy(original)
                    if kind=='throttled':raw['samples'][-1]['counters']['services']['loadgen']['cpu_throttled_ns']=1
                    if kind=='reset':raw['samples'][0]['counters']['services']['loadgen']['cpu_periods']=200
                    if kind=='unknown':raw['samples'][0]['counters']['services']['loadgen']['cpu_throttled_periods']=None
                    private(path,raw);private(output/'fullstack-proof.json',proof);destination=base/('claimed-unthrottled-'+kind)
                    with self.subTest(kind=kind),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                        with self.assertRaises(ValueError):cpu.collect(fullstack,root,base/'metadata',destination)
                        self.assertFalse(destination.exists())
                    # Real producer pressure and error facts remain unknown/throttled, never zero or complete.
                    pressure=fullstack.loadgen_cpu_pressure(raw['samples'])
                    expected={'state':'throttled','cpu_periods':100,'cpu_throttled_periods':0,'cpu_throttled_ns':1} if kind=='throttled' else {'state':'unavailable'}
                    self.assertEqual(pressure,expected)
                    changed=copy.deepcopy(proof);phase=changed['phases'][0]
                    phase['loadgen_cpu_pressure']=raw['loadgen_cpu_pressure']=pressure
                    phase['errors']=raw['errors']=['fixture_loadgen_cpu_'+('throttled' if kind=='throttled' else 'unavailable')]
                    changed['measured_linux_acceptance']=fullstack.evaluate(changed);changed['state']='failed'
                    private(path,raw);private(output/'fullstack-proof.json',changed)
                    self.worker_receipt(output,cpu.read(output/'owner.json'),1,True)
                    outcome=cpu.read(root/cpu.OUTCOME);outcome['exits'][0]=1;private(root/cpu.OUTCOME,outcome)
                    with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                        result=cpu.collect(fullstack,root,base/'metadata',base/('coherent-'+kind))
                    self.assertFalse(result['measurement_complete']);self.assertFalse(result['profiles'][0]['measurement']['quality']['counter_complete'])
                    self.assertEqual(result['profiles'][0]['original_oracle']['state'],'failed')
                    self.assertFalse(result['profiles'][0]['measurement']['assessment_inputs']['complete'])
                    self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])

    def test_actual_collector_emits_only_bound_numerical_control_and_preserves_raw_oracles(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'public')
            self.assertEqual(result['state'],'measurement_complete');self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib']);self.assertTrue(result['diagnostic_only'])
            self.assertEqual([r['profile'] for r in result['profiles']],list(PROFILES))
            self.assertTrue(all(r['original_oracle']['state']=='passed' for r in result['profiles']))
            self.assertEqual(json.loads((base/'public'/(PROFILES[0]+'-verdict.json')).read_text()),self.proof()['measured_linux_acceptance'])
            raw=(base/'public'/cpu.NAME).read_text()
            for secret in (str(root),fullstack.PREFIX+'a'*12,'private-sentinel','0123456789abcdef'*2,format(1,'064x')):self.assertNotIn(secret,raw)
            # First runtime failure cannot become a valid contrast when the second passes.
            outcome=cpu.read(root/cpu.OUTCOME);outcome['exits'][0]=17;private(root/cpu.OUTCOME,outcome)
            self.worker_receipt(root/PROFILES[0],cpu.read(root/PROFILES[0]/'owner.json'),17,True)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'failed')
            self.assertEqual(result['state'],'incomplete');self.assertEqual(result['profiles'][0]['run_exit'],17)
            self.assertEqual(result['profiles'][1]['state'],'measurement_complete')

    def test_collector_refuses_replay_forgery_downgrade_limits_owner_and_partial_cleanup_before_publication(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            output=root/PROFILES[0];marker=cpu.read(output/cpu.MARKER);quotas=cpu.read(output/cpu.QUOTAS)
            cases=[]
            for field,value in [('schema',True),('source','b'*40),('profile',PROFILES[1]),('output','f'*64),('plan_sha256','f'*64),('private','sentinel')]:
                cases.append((output/cpu.MARKER,{**marker,field:value}))
            for field,value in [('schema',0),('source','b'*40),('request','f'*64),('owner','f'*64),('last_ids',{}),('private','sentinel')]:
                cases.append((output/cpu.QUOTAS,{**quotas,field:value}))
            bad=copy.deepcopy(quotas);bad['snapshots'][0]['rows'][0][2]=0;cases.append((output/cpu.QUOTAS,bad))
            bad=copy.deepcopy(quotas);bad['snapshots'][0]['rows'][0][1]=1;cases.append((output/cpu.QUOTAS,bad))
            bad=copy.deepcopy(quotas);bad['snapshots'][1]['ordinal']=0;cases.append((output/cpu.QUOTAS,bad))
            cases.append((output/'owner.json',{**cpu.read(output/'owner.json'),'cwd':'/foreign'}))
            cases.append((output/'cleanup.json',{'down':'passed','residue':'failed'}))
            cases.append((output/'worker-outcome.json',{'exit_code':1}))
            bad=self.proof();bad['phases'][0]['mode']='on';cases.append((output/'fullstack-proof.json',bad))
            bad=self.proof();bad['measured_linux_acceptance']['private']='sentinel';cases.append((output/'fullstack-proof.json',bad))
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                for index,(path,value) in enumerate(cases):
                    saved=path.read_bytes();private(path,value);destination=base/('rejected-'+str(index))
                    with self.subTest(index=index),self.assertRaises((ValueError,KeyError)):cpu.collect(fullstack,root,base/'metadata',destination)
                    self.assertFalse(destination.exists());path.write_bytes(saved)
                saved=(output/cpu.QUOTAS).read_bytes();(output/cpu.QUOTAS).unlink();(output/cpu.QUOTAS).symlink_to(output/'owner.json')
                with self.assertRaises((ValueError,OSError)):cpu.collect(fullstack,root,base/'metadata',base/'symlink')
                self.assertFalse((base/'symlink').exists());(output/cpu.QUOTAS).unlink();(output/cpu.QUOTAS).write_bytes(saved);(output/cpu.QUOTAS).chmod(0o600)
                # An explicitly unfinished ledger is numerical incomplete, not fabricated zeros.
                bad=copy.deepcopy(quotas);bad['snapshots']=bad['snapshots'][:2];private(output/cpu.QUOTAS,bad)
                result=cpu.collect(fullstack,root,base/'metadata',base/'partial')
                self.assertEqual(result['state'],'incomplete');self.assertEqual(len(result['profiles'][0]['snapshots']),2)

    def test_recovery_rejects_changed_owner_plan_before_signal_but_does_not_need_private_or_pr_marker(self):
        import cpu_control as cpu
        from types import SimpleNamespace
        for fault in ('owner','plan',None):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output,plan,owner=self.bound(root)
                (output/cpu.MARKER).unlink()
                if fault=='owner':private(output/'owner.json',{**owner,'project':fullstack.PREFIX+'b'*12})
                if fault=='plan':plan['services']['api']['mem_limit']='1g';private(output/'compose.json',plan)
                stage=SimpleNamespace(receipt={'source':SOURCE},release=__import__('unittest.mock',fromlist=['Mock']).Mock())
                with patch.object(fullstack.resource_runtime.ci,'recover',return_value={'down':'passed','residue':'passed'}) as recovery:
                    if fault:
                        with self.assertRaises(ValueError):cpu.recover_profile(fullstack,stage,output)
                        recovery.assert_not_called();stage.release.assert_not_called()
                    else:
                        self.assertTrue(cpu.recover_profile(fullstack,stage,output));recovery.assert_called_once();stage.release.assert_called_once_with(str(output),cleanup_ok=True)

    def test_publication_replacement_cannot_write_into_a_foreign_directory(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            destination=base/'public';foreign=base/'foreign';foreign.mkdir(mode=0o700)
            (foreign/'keep').write_text('foreign');opened=os.open;replaced=False
            def replace(path,*args,**kwargs):
                nonlocal replaced
                if not replaced and Path(path).name==cpu.NAME:
                    replaced=True;destination.rename(base/'owned-renamed');foreign.rename(destination)
                return opened(path,*args,**kwargs)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(cpu.os,'open',side_effect=replace):
                with self.assertRaises(ValueError):cpu.collect(fullstack,root,base/'metadata',destination)
            self.assertTrue(replaced);self.assertEqual(sorted(p.name for p in destination.iterdir()),['keep'])
            self.assertEqual((destination/'keep').read_text(),'foreign')

    def test_actual_cpu_worker_keeps_twelve_phases_four_modes_original_oracle_and_final_capture(self):
        import cpu_control as cpu
        from contextlib import nullcontext
        for profile,fail in ((PROFILES[0],False),(PROFILES[1],False),(PROFILES[1],True)):
            with self.subTest(profile=profile,fail=fail),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();output,plan=assemble(root,profile)
                owner={'project':fullstack.PREFIX+'a'*12,'cwd':str(fullstack.ROOT),'supervisor_pid':os.getppid(),'docker_storage':'/owned','orbstack':None,'daemon':{},'cleanup':[]}
                private(output/'owner.json',owner);private(output/'evidence.json',{'source':SOURCE})
                rows=self.projection(owner,profile);ids=[r['id'] for r in rows];calls=[];modes=[];primary=RuntimeError('actual_phase_failure')
                def native(compose,args,**options):
                    if args[0]=='ps':return '\n'.join(ids)
                    if args[0]=='inspect':return '\n'.join(map(json.dumps,rows))
                    if args[-1]=='loss':return '{"attempted":1,"acknowledged":0,"explained_loss":1}'
                    if args[-1]=='recover-probe':return '{"post_restart_acknowledged":1,"post_restart_stored":1,"outage_stored":0}'
                    return ''
                def configure(compose,path,enabled,**options):modes.append(enabled);fullstack.mode(path,enabled);return fullstack.APPS
                def phase(compose,project,definition,active,enabled,pair,path,**options):
                    calls.append((pair,enabled,definition['name']))
                    if fail:raise primary
                    return {'mode':'on' if enabled else 'off','pair':pair,'name':definition['name'],'errors':[],
                        'samples':[{'counters':{'errors':{}},'host':{},'counter_clock_anchor':[1,2,3]}],
                        'load':{'completed':True,'query_seconds':[.1],'timing_diagnostics':{}},
                        'source_cache_samples':[{'postgresql':'observed','caddy':'observed'}]*{'idle':2,'steady':8,'spike':2}[definition['name']]}
                with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=SOURCE),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'invoke',side_effect=native),patch.object(fullstack,'seed',return_value={}),patch.object(fullstack,'configure_mode',side_effect=configure),patch.object(fullstack,'phase',side_effect=phase),patch.object(fullstack.technical,'summarize',return_value={}),patch.object(fullstack,'await_collector'),patch.object(fullstack,'evaluate',return_value={'state':'passed'}) as oracle:
                    if fail:
                        with self.assertRaises(RuntimeError) as caught:fullstack.worker(output,cpu=True)
                        self.assertIs(caught.exception,primary);oracle.assert_not_called()
                    else:fullstack.worker(output,cpu=True);oracle.assert_called_once()
                value,_,_=cpu.ledger(fullstack,output,SOURCE)
                self.assertEqual([s['ordinal'] for s in value['snapshots']],[0,4] if fail else list(range(5)))
                if not fail:
                    self.assertEqual(modes,[False,True,True,False])
                    self.assertEqual(calls,[(pair,enabled,name) for pair,order in enumerate(((False,True),(True,False))) for enabled in order for name in ('idle','steady','spike')])

    def interrupted_worker(self,root,phases):
        """Actual producer persists its pending oracle across controlled native interruption."""
        import cpu_control as cpu
        from contextlib import nullcontext
        self.completed(root,profiles=(PROFILES[1],),outcome=False)
        raws=[json.loads((root/PROFILES[1]/('fullstack-phase-'+str(i)+'.json')).read_text()) for i in range(12)]
        output,_=assemble(root,PROFILES[0],control=False)
        owner={'project':fullstack.PREFIX+'a'*12,'cwd':str(fullstack.ROOT),'supervisor_pid':os.getppid(),
               'docker_storage':'/owned','orbstack':None,'daemon':{'fixture':True},'cleanup':[]}
        private(output/'owner.json',owner)
        private(output/'evidence.json',{'source':SOURCE})
        rows=self.projection(owner,PROFILES[0]);ids=[r['id'] for r in rows];primary=TimeoutError('owned worker interrupted');calls=[]
        def native(compose,args,**options):
            if args[0]=='ps':return '\n'.join(ids)
            if args[0]=='inspect':return '\n'.join(map(json.dumps,rows))
            if args[-1]=='loss':return '{"attempted":1,"acknowledged":0,"explained_loss":1}'
            if args[-1]=='recover-probe':raise primary
            return ''
        def configure(compose,path,enabled,**options):
            fullstack.mode(path,enabled);return (*fullstack.APPS,*fullstack.CORE) if enabled else fullstack.APPS
        def phase(*args,**options):
            index=len(calls)
            if index==phases:raise primary
            calls.append(index);return copy.deepcopy(raws[index])
        with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=SOURCE),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'invoke',side_effect=native),patch.object(fullstack,'seed',return_value={}),patch.object(fullstack,'configure_mode',side_effect=configure),patch.object(fullstack,'phase',side_effect=phase),patch.object(fullstack.technical,'summarize',return_value={}),patch.object(fullstack,'await_collector'),patch.object(fullstack,'evaluate',wraps=fullstack.evaluate) as oracle:
            with self.assertRaises(TimeoutError) as caught:fullstack.worker(output,cpu=True)
            self.assertIs(caught.exception,primary);oracle.assert_not_called()
        proof=json.loads((output/'fullstack-proof.json').read_text())
        self.assertEqual(len(proof['phases']),phases);self.assertEqual(proof['state'],'failed')
        self.assertEqual(proof['measured_linux_acceptance'],{'state':'incomplete'})
        self.assertIs(proof['source_cache_workload'],False);self.assertIsNone(proof['controlled_outage'])
        self.worker_receipt(output,owner,124,True)
        value=cpu.pair(fullstack,root,SOURCE)
        private(root/cpu.OUTCOME,{'schema':2,'source':SOURCE,'pair':cpu.digest(value),'exits':[124,0],'cleanup':[True,True],'publication_failed':False})
        return output,proof

    def test_actual_interrupted_worker_publishes_pending_oracle_before_and_after_twelve_phases(self):
        import cpu_control as cpu
        for phases in (3,12):
            with self.subTest(phases=phases),tempfile.TemporaryDirectory() as directory:
                base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700)
                output,proof=self.interrupted_worker(root,phases)
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
                    result=cpu.collect(fullstack,root,base/'metadata',base/'public')
                self.assertEqual(json.loads((output/'fullstack-proof.json').read_text()),proof)
                self.assertEqual(result['state'],'incomplete');self.assertFalse(result['measurement_complete'])
                self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])
                row=result['profiles'][0];self.assertEqual(row['state'],'incomplete');self.assertEqual(row['run_exit'],124)
                self.assertEqual(row['original_oracle'],{'state':'incomplete','minimum_candidate_gib':None})
                measured=row['measurement'];self.assertEqual(measured['available'],phases==12)
                if phases==12:
                    self.assertFalse(measured['quality']['complete']);self.assertEqual(measured['quality']['success'],3200)
                    self.assertFalse(measured['assessment_inputs']['complete'])
                    self.assertTrue(all(gate['passed'] is None for gate in measured['resource_gates'].values()))

    def test_interrupted_pending_oracle_refuses_contradictions_malformed_data_and_promotions(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700)
            output,proof=self.interrupted_worker(root,12);path=output/'fullstack-proof.json';cases=[]
            for key,value in [('state','running'),('state','measured'),('source_cache_workload',True),('source_cache_workload',0),('controlled_outage',{}),('controlled_outage',self.proof()['controlled_outage']),('schema',True),('profile',{}),('measured_linux_acceptance',{}),('measured_linux_acceptance',None),('measured_linux_acceptance',{'state':'passed'}),('measured_linux_acceptance',{'state':'failed'}),('measured_linux_acceptance',{'state':'incomplete','private':'sentinel'}),('measured_linux_acceptance',{'state':False})]:
                bad=copy.deepcopy(proof);bad[key]=value;cases.append((path,bad))
            for key in ('controlled_outage','source_cache_workload'):
                bad=copy.deepcopy(proof);del bad[key];cases.append((path,bad))
            bad=copy.deepcopy(proof);bad['phases'][0]['host_samples'][0]['used_bytes']='private';cases.append((path,bad))
            bad=copy.deepcopy(proof);bad['phases'][0]['source_cache_samples']=[{'postgresql':'private','caddy':'observed'}];cases.append((path,bad))
            rawpath=output/'fullstack-phase-0.json';bad=cpu.read(rawpath,private=False);bad['load']['success']=1;cases.append((rawpath,bad))
            outcome=cpu.read(root/cpu.OUTCOME);bad=copy.deepcopy(outcome);bad['exits'][0]=0;cases.append((root/cpu.OUTCOME,bad))
            bad=copy.deepcopy(outcome);bad['pair']='f'*64;cases.append((root/cpu.OUTCOME,bad))
            bad=cpu.read(output/'worker-outcome.json',private=False);bad['exit_code']=1;cases.append((output/'worker-outcome.json',bad))
            bad=cpu.read(output/'cleanup.json',private=False);bad['down']='failed';cases.append((output/'cleanup.json',bad))
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{})):
                for index,(target,bad) in enumerate(cases):
                    with self.subTest(index=index):
                        saved=target.read_bytes();private(target,bad);destination=base/('refused-'+str(index))
                        try:
                            with self.assertRaises((ValueError,TypeError,KeyError)):cpu.collect(fullstack,root,base/'metadata',destination)
                            self.assertFalse(destination.exists())
                        finally:target.write_bytes(saved)

    def test_preparation_exhausting_job_allowance_never_acquires_worker_or_fakes_public_owner(self):
        import cpu_control as cpu
        from collections import namedtuple
        usage=namedtuple('usage','total used free')
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';images=base/'images.json';private(images,pins());now=[0.0]
            stage=fullstack.preparation.begin(images,SOURCE,pins()['owner'],{'fixture':True},str(root/PROFILES[0]),docker=lambda _: '',identify=lambda:{'fixture':True},web=True,applications=True)
            def prepare(path,images):path.mkdir(mode=0o700);now[0]=2911
            def command(args,**options):
                if args[0]=='git':return '' if args[-1]=='--porcelain' else SOURCE
                if args[:3]==['docker','context','show']:return 'owned'
                if args[:3]==['docker','compose','ls']:return '[]'
                raise AssertionError(args)
            with patch.object(cpu,'admission',return_value=0),patch.object(cpu.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack,'inputs',side_effect=prepare),patch.object(fullstack.pilot.platform,'system',return_value='Linux'),patch.object(fullstack.pilot.daemon,'identify',return_value={'endpoint':'unix:///owned','storage':str(base)}),patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot.shutil,'disk_usage',return_value=usage(128*1024**3,0,64*1024**3)),patch.object(fullstack.pilot,'supervise_worker',side_effect=AssertionError('worker acquired after preparation allowance expired')) as worker:
                with self.assertRaises(ValueError):cpu.run_pair(fullstack,root,images,base/'metadata')
                worker.assert_not_called();self.assertFalse((root/PROFILES[0]/'owner.json').exists())
                result=cpu.read(root/cpu.OUTCOME);self.assertEqual(result['exits'],[1,None]);self.assertEqual(result['cleanup'],[False,False])
                context=result['profiles'][0];self.assertEqual(context['stage'],'prepare_inputs');self.assertEqual(context['state'],'failed');self.assertFalse(context['prepared'])
                self.assertEqual(context['category'],'value_error');self.assertEqual(stage._pending(),[])
                with self.assertRaises((ValueError,OSError)):cpu.collect(fullstack,root,base/'metadata',base/'public')
                self.assertFalse((base/'public').exists())

    def test_actual_event_admission_requires_pr_head_base_repository_and_open_pr_binding(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();path=root/'event.json'
            bads=[{'action':'synchronize','pull_request':{'body':cpu.EVENT_MARKER}}]
            for key,value in [('number',True),('state','closed'),('head',{'sha':'private'}),('base',{'sha':'c'*40,'ref':'other','repo':{'full_name':'sachkov-inside/platform'}})]:
                bad=event();bad['pull_request'][key]=value;bads.append(bad)
            bad=event();bad['repository']['full_name']='foreign/repo';bads.append(bad)
            for bad in bads:
                private(path,bad)
                with patch.object(fullstack.hosted,'context'),patch.dict(os.environ,{'GITHUB_EVENT_PATH':str(path),'CPU_CONTROL_JOB_STARTED':str(__import__('time').monotonic()),'PILOT_PR_HEAD_SHA':'b'*40,'PILOT_PR_BASE_SHA':'c'*40}),self.assertRaises(ValueError):cpu.admission(fullstack)

    def test_cpu_job_is_additive_exact_marker_only_and_keeps_original_outer_bound(self):
        workflow=inverse_protocol_workflow((fullstack.ROOT/'.github/workflows/observability-resource.yml').read_text())
        original,cpu=workflow.split('\n  cpu-control:\n')
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),'ca4ec8506cb187f7256421d910011d016d089bbe407f228c6ab8d436d26187d7')
        self.assertIn("contains(github.event.pull_request.body || '', '<!-- monitoring-cpu-control: app-unlimited-v1 -->')",cpu)
        self.assertIn('timeout-minutes: 60',cpu)
        self.assertLess(cpu.index('cpu-control-admission'),cpu.index('prepare.py'))
        self.assertIn('--consumer "$RUNNER_TEMP/cpu-control-private/fixture-capped-v1"',cpu)
        self.assertIn('cpu-control-run',cpu);self.assertIn('cpu-control-recover',cpu);self.assertIn('cpu-control-collect',cpu)
        for forbidden in ('continue-on-error','workflow_dispatch','secrets:','permissions:','--protocol','monitoring-stability: run'):
            self.assertNotIn(forbidden,cpu)

    def test_second_profile_with_insufficient_outer_budget_is_not_acquired_and_is_incomplete(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';images=base/'images.json';private(images,pins())
            stage=fullstack.preparation.begin(images,SOURCE,pins()['owner'],{'fixture':True},str(root/PROFILES[0]),docker=lambda _: '',identify=lambda:{'fixture':True},web=True,applications=True)
            clock=[100.];acquired=[]
            def run(output,**options):
                acquired.append(output.name);_,_,owner=self.bound(root,output.name,control=False)
                self.worker_receipt(output,owner,0,True);clock[0]+=3000
            with patch.object(cpu,'admission',return_value=100.),patch.object(cpu.time,'monotonic',side_effect=lambda:clock[0]),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.pilot,'run',side_effect=run),patch.object(fullstack.resource_runtime.ci,'recover',side_effect=AssertionError('pair repeated native cleanup')):
                with self.assertRaises(ValueError):cpu.run_pair(fullstack,root,images,base/'metadata')
            self.assertEqual(acquired,[PROFILES[0]]);self.assertFalse((root/PROFILES[1]).exists())
            result=cpu.read(root/cpu.OUTCOME);self.assertEqual(result['exits'],[0,None]);self.assertEqual(result['cleanup'],[True,False])
            self.assertEqual(stage._pending(),[])

    def worker_receipt(self,output,owner,code,good):
        cleanup={'down':'passed' if good else 'failed','residue':'passed'}
        private(output/'worker.json',{'pid':os.getpid(),'group':os.getpid(),'supervisor_pid':owner['supervisor_pid'],'deadline_seconds':600})
        private(output/'worker-outcome.json',{'exit_code':code,'duration_seconds':1,'monitor_failed':False,'cleanup':cleanup})
        private(output/'cleanup.json',cleanup)

    def test_pair_outcome_write_failure_always_settles_preserves_primary_and_blocks_second(self):
        import cpu_control as cpu
        for code,position in ((17,'before'),(17,'after'),(0,'before'),(0,'after')):
            with self.subTest(code=code,position=position),tempfile.TemporaryDirectory() as directory:
                base=Path(directory).resolve();root=base/'pair';images=base/'images.json';private(images,pins())
                stage=fullstack.preparation.begin(images,SOURCE,pins()['owner'],{'fixture':True},str(root/PROFILES[0]),docker=lambda _: '',identify=lambda:{'fixture':True},web=True,applications=True)
                primary=subprocess.CalledProcessError(17,'actual-first-worker');publication=OSError('owned outcome publication failed')
                acquired=[];settled=[];injected=False;real_write=cpu.write;real_settle=cpu.settle_profile
                def run(output,**options):
                    acquired.append(output.name);_,_,owner=self.bound(root,output.name,control=False)
                    self.worker_receipt(output,owner,code,True)
                    if code:raise primary
                def settle(*args,**options):
                    result=real_settle(*args,**options);settled.append(args[2].name);return result
                def write(path,value,**options):
                    nonlocal injected
                    if Path(path).name==cpu.OUTCOME and not options.get('once') and not injected and bool(settled)==(position=='after'):
                        injected=True;raise publication
                    return real_write(path,value,**options)
                with patch.object(cpu,'admission',return_value=__import__('time').monotonic()),patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.pilot,'run',side_effect=run),patch.object(cpu,'settle_profile',side_effect=settle),patch.object(cpu,'write',side_effect=write),patch.object(fullstack.resource_runtime.ci,'recover',side_effect=AssertionError('native cleanup retry')):
                    traceback_codes=[]
                    def invoke_pair():
                        try:cpu.run_pair(fullstack,root,images,base/'metadata')
                        except BaseException as error:
                            current=error.__traceback__
                            while current is not None:
                                traceback_codes.append(current.tb_frame.f_code);current=current.tb_next
                            raise
                    with self.assertRaises(BaseException) as caught:invoke_pair()
                self.assertIn(run.__code__ if code else write.__code__,traceback_codes)
                self.assertTrue(injected);self.assertIs(caught.exception,primary if code else publication)
                self.assertEqual(settled,[PROFILES[0]]);self.assertEqual(acquired,[PROFILES[0]])
                result=cpu.read(root/cpu.OUTCOME);self.assertEqual(result['exits'],[code,None]);self.assertTrue(result['publication_failed'])
                self.assertEqual(stage._pending(),[])

    def test_numeric_failed_capped_corpus_remains_a_measured_comparison_with_raw_failure(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            output=root/PROFILES[0];proof=cpu.read(output/'fullstack-proof.json')
            for phase in proof['phases']:
                if phase['mode']=='on':
                    for latency in phase['load']['latency']:latency['elapsed_ms']=2
            proof['measured_linux_acceptance']=fullstack.evaluate(proof);proof['state']='failed'
            self.assertEqual(proof['measured_linux_acceptance']['state'],'failed')
            private(output/'fullstack-proof.json',proof)
            for ordinal,phase in enumerate(proof['phases']):
                path=output/('fullstack-phase-'+str(ordinal)+'.json');raw=cpu.read(path);raw['load']=phase['load'];private(path,raw)
            self.worker_receipt(output,cpu.read(output/'owner.json'),1,True)
            outcome=cpu.read(root/cpu.OUTCOME);outcome['exits'][0]=1;private(root/cpu.OUTCOME,outcome)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'numeric-failure')
            self.assertEqual(result['state'],'measurement_complete');self.assertTrue(result['measurement_complete'])
            self.assertEqual(result['profiles'][0]['run_exit'],1);self.assertEqual(result['profiles'][0]['original_oracle']['state'],'failed')
            self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])
            measured=result['profiles'][0]['measurement'];self.assertTrue(measured['quality']['complete'])
            self.assertEqual(measured['assessment_inputs']['http_p95_overhead_percent'],100)
            self.assertEqual(measured['quality']['success'],3200)
            self.assertEqual(len(measured['p95_pairs']),12)
            for pair in measured['p95_pairs']:
                self.assertEqual((pair['off_count'],pair['on_count'],pair['off_p95_ms'],pair['on_p95_ms'],pair['overhead_percent']),(100,100,1,2,100))
            self.assertEqual(measured['cfs_phases'][0]['roles'][0]['cpu_throttled_ns'],50_000_000)

    def test_measured_resource_failures_preserve_each_original_gate_without_quality_promotion(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root);output=root/PROFILES[0]
            original=cpu.read(output/'fullstack-proof.json');raws=[cpu.read(output/('fullstack-phase-'+str(i)+'.json')) for i in range(12)]
            for kind,gate in (('cpu','additional_host_cpu_fraction'),('memory','minimum_host_memory_free_fraction'),('disk','minimum_host_disk_free_fraction'),('inodes','host_inode_reserve')):
                proof=copy.deepcopy(original)
                for phase in proof['phases']:
                    if kind=='cpu' and phase['mode']=='on':phase['host_samples'][-1]['cpu_busy']=40
                    for host in phase['host_samples']:
                        if kind=='memory':host['memory_free_fraction']=.2
                        if kind=='disk':host['disk_free_fraction']=.2
                        if kind=='inodes':host['free_inodes']=20
                proof['measured_linux_acceptance']=fullstack.evaluate(proof);proof['state']='failed';private(output/'fullstack-proof.json',proof)
                self.assertEqual(proof['measured_linux_acceptance']['state'],'failed')
                for i,phase in enumerate(proof['phases']):
                    raw=copy.deepcopy(raws[i])
                    for frame,host in zip(raw['samples'],phase['host_samples']):frame['host']=host
                    private(output/('fullstack-phase-'+str(i)+'.json'),raw)
                self.worker_receipt(output,cpu.read(output/'owner.json'),1,True)
                outcome=cpu.read(root/cpu.OUTCOME);outcome['exits'][0]=1;private(root/cpu.OUTCOME,outcome)
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                    result=cpu.collect(fullstack,root,base/'metadata',base/kind)
                self.assertTrue(result['measurement_complete']);measured=result['profiles'][0]['measurement']
                self.assertFalse(measured['resource_gates'][gate]['passed']);self.assertTrue(measured['quality']['complete'])
                if kind=='inodes':self.assertFalse(measured['assessment_inputs']['complete'])
                self.assertEqual(result['profiles'][0]['original_oracle']['state'],'failed');self.assertEqual(result['profiles'][0]['run_exit'],1)
                self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])

    def test_numeric_projection_rejects_private_malformed_values_and_keeps_unknown_counters_unknown(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root);output=root/PROFILES[0]
            good=cpu.read(output/'fullstack-proof.json');path=output/'fullstack-phase-0.json';raw=cpu.read(path)
            bads=[]
            for value in (True,float('nan'),float('inf'),-1,'private-latency'):
                bad=copy.deepcopy(good);bad['phases'][1]['load']['latency'][0]['elapsed_ms']=value;bads.append(bad)
            for field,value in [('label','private-label'),('extra','private-sentinel')]:
                bad=copy.deepcopy(good);bad['phases'][1]['load']['latency'][0][field]=value;bads.append(bad)
            bad=copy.deepcopy(good);bad['profile']['schema']=True;bads.append(bad)
            bad=copy.deepcopy(good);bad['profile']['materials']=512.0;bads.append(bad)
            for field,value in [('schema',True),('schema',0),('state','private-state'),('source_cache_workload','private-source')]:
                bad=copy.deepcopy(good);bad[field]=value;bads.append(bad)
            for index,bad in enumerate(bads):
                private(output/'fullstack-proof.json',bad);destination=base/('invalid-'+str(index))
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})),self.assertRaises((ValueError,TypeError)):
                    cpu.collect(fullstack,root,base/'metadata',destination)
                self.assertFalse(destination.exists())
            private(output/'fullstack-proof.json',good)
            bad=copy.deepcopy(raw)
            for sample in bad['samples']:sample['counters']['services']['api']['cpu_periods']=None
            private(path,bad)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'unknown-counter')
            self.assertFalse(result['measurement_complete']);role=result['profiles'][0]['measurement']['cfs_phases'][0]['roles'][0]
            self.assertFalse(role['available']);self.assertIsNone(role['cpu_periods'])
            self.assertFalse(result['profiles'][0]['measurement']['quality']['counter_complete'])
            # A counter reset is explicit unknown, never a zero delta or a good measurement.
            bad=copy.deepcopy(raw);bad['samples'][0]['counters']['services']['api']['cpu_periods']=200;private(path,bad)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'counter-reset')
            role=result['profiles'][0]['measurement']['cfs_phases'][0]['roles'][0]
            self.assertFalse(result['measurement_complete']);self.assertTrue(role['counter_reset']);self.assertIsNone(role['cpu_periods'])

    def test_quality_loss_oom_enospc_unavailable_source_or_counter_cannot_form_measured_comparison(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root);output=root/PROFILES[0]
            good=cpu.read(output/'fullstack-proof.json');raws=[cpu.read(output/('fullstack-phase-'+str(i)+'.json')) for i in range(12)]
            for kind in ('oom','enospc','source','http_loss','unknown_loss'):
                proof=copy.deepcopy(good);phase=proof['phases'][4]
                if kind=='oom':phase['errors']=['process_replaced_or_oom']
                if kind=='enospc':phase['host_samples'][0]['disk_free_fraction']=0
                if kind=='source':
                    phase['source_cache_samples'][0]['postgresql']='unavailable';proof['source_cache_workload']=False
                if kind=='http_loss':
                    phase['load'].update(completed=False,success=399,missed=1);phase['load']['latency'].pop();proof['source_cache_workload']=False
                if kind=='unknown_loss':phase['load']['unexplained_probe_loss']=None
                proof['measured_linux_acceptance']=fullstack.evaluate(proof);proof['state']='failed';private(output/'fullstack-proof.json',proof)
                for ordinal,summary in enumerate(proof['phases']):
                    raw=copy.deepcopy(raws[ordinal]);raw.update(load=summary['load'],errors=summary['errors'],source_cache_samples=summary['source_cache_samples'])
                    for frame,host in zip(raw['samples'],summary['host_samples']):frame['host']=host
                    private(output/('fullstack-phase-'+str(ordinal)+'.json'),raw)
                self.worker_receipt(output,cpu.read(output/'owner.json'),1,True)
                outcome=cpu.read(root/cpu.OUTCOME);outcome['exits'][0]=1;private(root/cpu.OUTCOME,outcome)
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                    result=cpu.collect(fullstack,root,base/'metadata',base/kind)
                self.assertFalse(result['measurement_complete']);self.assertEqual(result['state'],'incomplete')
                self.assertFalse(result['profiles'][0]['measurement']['quality']['complete'])
                if kind=='unknown_loss':self.assertIsNone(result['profiles'][0]['measurement']['quality']['unexplained_probe_loss'])
                self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib'])
