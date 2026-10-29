"""CPU-policy control at real plan, native dispatch and publication boundaries."""
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


def assemble(root,profile,*,control=True):
    """Real inputs including configuration/certificates; only external image IDs are adapted."""
    images=root/'images.json';private(images,pins())
    if control:private(root/'cpu-control-pair.json',request(root))
    def command(args,**kwargs):
        if args[0]=='git':return SOURCE
        if args[0]=='bash':return subprocess.run(args,capture_output=True,text=True,check=True,timeout=15).stdout
        for role,suffix in [('backend','-backend:v1'),('foundation','-foundation:local'),('web','-web:v1'),('telegram','-telegram:v1'),('logto','-logto:v1')]:
            if any(arg.endswith(suffix) for arg in args):return pins()[role]
        raise AssertionError('unexpected native boundary')
    output=root/profile
    with patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot,'assert_docker_identity'):
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
                        'loadgen_cpu_pressure':{'state':'unthrottled'},'storage_samples':[{},{}],
                        'host_samples':[host,{**host,'cpu_total':100,'cpu_busy':20}],
                        'load':{'completed':True,'latency':[{'label':label,'elapsed_ms':1} for label in labels],
                                'unexpected_failures':0,'unexplained_probe_loss':0,'query_seconds':[1],'ingestion_lag_seconds':2 if mode=='on' else None}})
        result={'state':'measured','source_cache_workload':True,'phases':phases,
                'controlled_outage':{'attempted':1,'acknowledged':0,'explained_loss':1,'post_restart_acknowledged':1,'post_restart_stored':1,'outage_stored':0}}
        result['measured_linux_acceptance']=fullstack.evaluate(result)
        self.assertEqual(result['measured_linux_acceptance']['state'],'passed')
        return result

    def completed(self,root):
        import cpu_control as cpu
        for profile in PROFILES:
            output,_,owner=self.bound(root,profile);rows=self.projection(owner,profile);ids=[r['id'] for r in rows]
            def native(compose,args,**options):return '\n'.join(ids) if args[0]=='ps' else '\n'.join(map(json.dumps,rows))
            with patch.object(fullstack,'invoke',side_effect=native):
                for ordinal,enabled in enumerate((False,True,True,False,False)):
                    fullstack.mode(output,enabled);cpu.capture(fullstack,output,[],SOURCE,ordinal,enabled)
            private(output/'fullstack-proof.json',self.proof())
            self.worker_receipt(output,owner,0,True)
        value=cpu.pair(fullstack,root,SOURCE)
        private(root/cpu.OUTCOME,{'schema':1,'source':SOURCE,'pair':cpu.digest(value),'exits':[0,0],'cleanup':[True,True]})

    def test_actual_collector_emits_only_bound_numerical_control_and_preserves_raw_oracles(self):
        import cpu_control as cpu
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'pair';root.mkdir(mode=0o700);self.completed(root)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':SOURCE},{'ready':True})):
                result=cpu.collect(fullstack,root,base/'metadata',base/'public')
            self.assertEqual(result['state'],'complete');self.assertFalse(result['capacity']);self.assertIsNone(result['minimum_candidate_gib']);self.assertTrue(result['diagnostic_only'])
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
            self.assertEqual(result['profiles'][1]['state'],'complete')

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
        workflow=(fullstack.ROOT/'.github/workflows/observability-resource.yml').read_text()
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
