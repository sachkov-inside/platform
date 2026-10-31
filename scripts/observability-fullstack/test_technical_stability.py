"""The existing stability lifecycle keeps technical evidence outside acceptance."""
import copy
from contextlib import ExitStack, nullcontext
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import fullstack
import stability
import test_stability
import test_technical_scope
import test_protocol_runner
import test_worker_budget


def _prepared(base):
    output,pins=test_technical_scope.TechnicalScope().prepare_inputs(base)
    output.chmod(0o700)
    with patch.object(fullstack,'inputs') as inputs,patch.object(fullstack.pilot,'command',return_value=pins['source']):
        fullstack.stability_inputs(output,base/'images.json',stability.PRIMED_PROTOCOL,scope='technical')
    inputs.assert_called_once_with(output,base/'images.json',scope='technical')
    return output,pins


def _owner(output):
    value={'project':fullstack.PREFIX+'c'*12,'cwd':str(fullstack.ROOT),'supervisor_pid':os.getppid(),
           'docker_storage':'/private-sentinel','orbstack':None,'daemon':None,'cleanup':['private-command']}
    fullstack.pilot.write_json(output/'owner.json',value)
    return value


def _settled(output,*,exit_code=0,cleanup=True):
    owner=json.loads((output/'owner.json').read_text())
    fullstack.pilot.write_json(output/'worker.json',{'pid':54321,'group':54321,'supervisor_pid':owner['supervisor_pid'],'deadline_seconds':900})
    result={'down':'passed' if cleanup else 'failed','residue':'passed'}
    fullstack.pilot.write_json(output/'cleanup.json',result)
    fullstack.pilot.write_json(output/'worker-outcome.json',{'exit_code':exit_code,'duration_seconds':180,'monitor_failed':False,'cleanup':result})


def _phase(*args,**options):
    ordinal=options['diagnostic_ordinal'];measured=test_stability.measurement(ordinal)
    return {'errors':[],'loadgen_cpu_pressure':{'state':'unthrottled'},
        'samples':[{'counters':{'services':{},'errors':{},'at_seconds':i},'counter_clock_anchor':[i,i,i],
                    'diagnostic_context':dict.fromkeys(stability.CONTEXT)} for i in (0,10)],
        'load':{**{key:measured[key] for key in ('completed','scheduled','missed','success','unexpected_failures','latency','slot_refusal')},
            'diagnostic_only':True,'actor_cohort':0,'maximum_inflight':8,'diagnostic_protocol':options['diagnostic_protocol'],
            'diagnostic_definition':args[2],'timing_diagnostics':{'phase':ordinal,'pair':ordinal//6,
                **{key:measured[key] for key in ('requests','phase_start','phase_end')}}}}


class TechnicalStability(unittest.TestCase):
    def test_scope_bound_diagnostic_lifecycle_preserves_legacy_and_refuses_foreign_evidence(self):
        source='a'*40;protocol=stability.PRIMED_PROTOCOL
        event={'action':'synchronize','number':1716,'repository':{'full_name':'sachkov-inside/platform'},
               'pull_request':{'number':1716,'state':'open','body':'<!-- observability-scope: technical -->\n<!-- monitoring-stability: run -->',
                    'head':{'sha':source},'base':{'sha':'b'*40,'ref':'main','repo':{'full_name':'sachkov-inside/platform'}}}}
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();event_path=base/'event.json';event_path.write_text(json.dumps(event))
            workflow=(fullstack.ROOT/'.github/workflows/observability-resource.yml').read_text()
            test_protocol_runner.inverse_protocol_workflow(workflow)
            normalized=test_protocol_runner.inverse_stability_technical_scope(workflow)
            self.assertEqual(workflow.count('&& 30 || 12'),2)
            self.assertEqual(normalized.count('&& 30 || 12'),1)
            self.assertEqual(workflow.split('  stability:\n')[0],normalized.split('  stability:\n')[0])
            body=workflow.split('  stability:\n')[1].split('  cpu-control:\n')[0]
            for before,after in (("&& 30 || 12","&& 31 || 12"),("&& 30 || 12","&& 30 || 13"),
                    ('diagnostic-admission --scope','diagnostic-admission --unknown-scope'),
                    ('hosted_disk.py','hosted_disk.py --force'),('select-scope >>','select-other >>'),
                    ("'stability-technical'","'stability'"),('fixed-actor-primed400-v1','fixed-actor-cold400-v1'),
                    ('--scope "${{ steps.scope.outputs.scope }}"','--scope full')):
                with self.subTest(wiring=before),self.assertRaises(ValueError):
                    test_protocol_runner.inverse_protocol_workflow(workflow.replace(body,body.replace(before,after,1),1))
                with self.subTest(raw_stability=before),self.assertRaises(ValueError):
                    test_protocol_runner.inverse_stability_technical_scope(workflow.replace(body,body.replace(before,after,1),1))
            raw_bad=workflow.replace('&& 30 || 12','&& 31 || 12',1)
            normalized_bad=test_protocol_runner.inverse_stability_technical_scope(raw_bad)
            self.assertIn('&& 31 || 12',normalized_bad.split('  stability:\n')[0])
            with patch.object(Path,'read_text',return_value=raw_bad):
                with self.assertRaises(AssertionError):
                    test_worker_budget.WorkerBudget('test_only_technical_measurement_step_gets_30_minutes').test_only_technical_measurement_step_gets_30_minutes()
            legacy=base/'legacy';legacy.mkdir()
            with patch.object(fullstack,'inputs') as inputs,patch.object(fullstack.pilot,'command',return_value=source):
                fullstack.stability_inputs(legacy,base/'images.json')
                inputs.assert_called_once_with(legacy,base/'images.json')
            self.assertEqual(json.loads((legacy/stability.MARKER).read_text()),{'schema':2,'source':source,'scope':'diagnostic_only','protocol':'fixed-actor-cold400-v1'})
            fullstack.pilot.write_json(legacy/'fullstack-source.json',{'source':'b'*40,'profile':fullstack.profile(),'images':{'scope':'full'}})
            _owner(legacy)
            with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--output',str(legacy)]),patch.object(fullstack.pilot,'command') as command,patch.object(fullstack.resource_runtime.ci,'recover',return_value={'down':'passed','residue':'passed'}) as recover:
                self.assertEqual(fullstack.main(),{'down':'passed','residue':'passed'})
                recover.assert_called_once_with(legacy,project_prefix=fullstack.PREFIX,services=fullstack.services())
                command.assert_not_called()
            with patch.dict(os.environ,{'GITHUB_EVENT_PATH':str(event_path),'PILOT_PR_HEAD_SHA':source,'PILOT_PR_BASE_SHA':'b'*40}),patch.object(fullstack.hosted,'context'),patch.object(fullstack.sys,'argv',['fullstack.py','diagnostic-admission','--scope','technical']):
                fullstack.main()
                bads=[]
                for body in (event['pull_request']['body']+'\n<!-- monitoring-stability: run -->',
                             event['pull_request']['body']+'\n<!-- Monitoring-Stability: run -->',
                             event['pull_request']['body'].replace('monitoring-stability','Monitoring-Stability'),
                             event['pull_request']['body']+'\n<!-- monitoring-cpu-control: app-unlimited-v1 -->'):
                    bad=copy.deepcopy(event);bad['pull_request']['body']=body;bads.append(bad)
                for key,value in (('action','edited'),('number',True),('repository',{'full_name':'foreign/platform'})):
                    bad=copy.deepcopy(event);bad[key]=value;bads.append(bad)
                for path,value in ((('head','sha'),'c'*40),(('base','sha'),'c'*40),(('base','ref'),'other')):
                    bad=copy.deepcopy(event);bad['pull_request'][path[0]][path[1]]=value;bads.append(bad)
                for bad in bads:
                    with self.subTest(admission=bad):
                        event_path.write_text(json.dumps(bad))
                        with self.assertRaises(ValueError):fullstack.main()
            output,pins=_prepared(base);owner=_owner(output)
            self.assertFalse((output/'worker.json').exists(),'the post-Popen receipt must not gate startup')
            compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
            def configure(compose,output,enabled):
                fullstack.mode(output,enabled)
                return fullstack.services('technical')
            with ExitStack() as stack:
                for target,name,options in ((fullstack.pilot,'command',{'return_value':source}),
                        (fullstack.pilot,'worker_storage_guard',{'return_value':nullcontext()}),
                        (fullstack,'invoke',{}),(fullstack,'seed',{}),
                        (fullstack,'configure_mode',{'side_effect':configure}),(fullstack,'phase',{'side_effect':_phase})):
                    stack.enter_context(patch.object(target,name,**options))
                fullstack.stability_worker(output,owner,compose)
            private=json.loads((output/'fullstack-source.json').read_text())
            marker=json.loads((output/stability.MARKER).read_text())
            record=json.loads((output/stability.NAME).read_text())
            self.assertEqual(record['state'],'complete');self.assertEqual(record['schema'],4)
            self.assertEqual(record['service_roles'],list(fullstack.services('technical')))
            self.assertEqual(record['acceptance'],{'state':'not_applicable','capacity':False,'minimum_candidate_gib':None})
            self.assertEqual([row['ordinal'] for row in record['warmup']],[0,2,4,6,8,10])
            self.assertEqual([row['ordinal'] for row in record['measurements']],[1,3,5,7,9,11])
            self.assertEqual(sum(row['definition']['seconds']*row['definition']['requests_per_second'] for row in stability.schedule(protocol)),4800)
            _settled(output)
            metadata=base/'metadata';metadata.mkdir()
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':source},{})):
                fullstack.stability_collect(output,metadata,base/'public',scope='technical',protocol=protocol)
                public=(base/'public'/stability.NAME).read_text()
                self.assertEqual(json.loads(public),record)
                for secret in ('private-sentinel','private-command',private['scope_binding']['nonce'],'scope_binding','plan_sha256'):
                    self.assertNotIn(secret,public)
                self.assertEqual(sorted(p.name for p in (base/'public').iterdir()),['cleanup.json',stability.NAME,'worker-outcome.json'])
                with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,base/'wrong-scope',protocol=protocol)
                with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,base/'wrong-protocol',scope='technical')
                # Each corruption must stop worker mutation, recovery and collection.
                snapshots={name:(output/name).read_text() for name in ('fullstack-source.json','compose.json',stability.MARKER,stability.OWNER,'worker.json','owner.json',stability.NAME)}
                # Presence is only a veto. Every surviving runtime witness needs settlement.
                runtime_names=('owner.json','worker.json','worker-outcome.json','cleanup.json',stability.OWNER,stability.NAME,'evidence.json','monitor-failure.json')
                runtime_bytes={name:(output/name).read_bytes() for name in runtime_names if (output/name).exists()}
                runtime_bytes.update({'evidence.json':b'{"source":"'+source.encode()+b'"}',
                    'monitor-failure.json':b'{"source":"host","exception_class":"RuntimeError","reason":"invalid_sample"}'})
                prepared_bytes=(output/'fullstack-source.json').read_bytes();marker_bytes=(output/stability.MARKER).read_bytes()
                settled_names=set(runtime_names[:6])
                def restore_runtime(kept=settled_names,*,lost=False,dangling=None):
                    for name in (*runtime_names,stability.MARKER,'fullstack-proof.json'):(output/name).unlink(missing_ok=True)
                    (output/'fullstack-source.json').write_bytes(prepared_bytes)
                    (output/stability.MARKER).write_bytes(marker_bytes);(output/stability.MARKER).chmod(0o600)
                    for name in kept:
                        (output/name).write_bytes(runtime_bytes[name]);(output/name).chmod(0o600)
                    if lost:
                        for name in (stability.MARKER,stability.OWNER):(output/name).unlink(missing_ok=True)
                        prepared=json.loads(prepared_bytes);prepared.pop('stability')
                        fullstack.pilot.write_json(output/'fullstack-source.json',prepared)
                    if dangling is not None:
                        (output/dangling).unlink(missing_ok=True);(output/dangling).symlink_to(base/'missing-runtime-target')
                states=[('prepared_only',set(),False,None,False),('good_cleanup',settled_names,False,None,False),
                    ('good_cleanup_without_OWNER',settled_names-{stability.OWNER},False,None,False),
                    ('good_cleanup_without_NAME',settled_names-{stability.NAME},False,None,False),
                    ('owner_deleted',settled_names-{'owner.json'},False,None,True)]
                states += [('orphan_'+name,{name},False,None,True) for name in runtime_names]
                states += [('dangling_'+name,set(),False,name,True) for name in runtime_names]
                states += [('lost_NAME',settled_names,True,None,True),('lost_dangling_NAME',settled_names,True,stability.NAME,True)]
                original_recover=fullstack.resource_runtime.ci.recover
                try:
                    for label,kept,lost,dangling,refuse in states:
                        for images in (False,True):
                            with self.subTest(runtime_state=label,images=images):
                                restore_runtime(kept,lost=lost,dangling=dangling)
                                stage=unittest.mock.Mock();stage.in_use.side_effect=lambda:nullcontext()
                                stage.release.return_value={'state':'prepared fixture released'}
                                argv=['fullstack.py','recover','--scope','technical','--output',str(output)]
                                if images:argv+=['--images',str(base/'images.json')]
                                def native(*args,**options):
                                    if label=='prepared_only':return original_recover(*args,**options)
                                    raise AssertionError('native_cleanup_forbidden_for_diagnostic_runtime')
                                error=None;result=None
                                with patch.object(fullstack.sys,'argv',argv),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.preparation,'directory',return_value=base),patch.object(fullstack.preparation,'recover_stage',return_value=stage) as acquire,patch.object(fullstack.resource_runtime.ci,'recover',side_effect=native) as recover:
                                    try:result=fullstack.main()
                                    except Exception as caught:error=caught
                                if refuse:
                                    self.assertIsInstance(error,(OSError,ValueError))
                                    acquire.assert_not_called();recover.assert_not_called();stage.release.assert_not_called()
                                else:
                                    self.assertIsNone(error)
                                    if images:stage.release.assert_called_once_with(str(output),cleanup_ok=True)
                                    elif label.startswith('good_cleanup'):self.assertEqual(result,{'down':'passed','residue':'passed'})
                                    if label.startswith('good_cleanup'):recover.assert_not_called()
                        if refuse:
                            with self.subTest(runtime_collection=label):
                                restore_runtime(kept,lost=lost,dangling=dangling)
                                destination=base/('r3-public-'+label)
                                with self.assertRaises((OSError,ValueError)):
                                    fullstack.stability_collect(output,metadata,destination,scope='technical',protocol=protocol)
                                self.assertFalse(destination.exists())
                    for dangling in (None,stability.NAME,stability.OWNER):
                        with self.subTest(worker_lost_discriminator=dangling):
                            restore_runtime(settled_names,lost=True,dangling=dangling)
                            if dangling==stability.OWNER:(output/stability.NAME).unlink()
                            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'invoke',side_effect=RuntimeError('native_primary_fallback_forbidden')) as invoke:
                                with self.assertRaises((OSError,ValueError)):fullstack.worker(output)
                                invoke.assert_not_called()
                            self.assertFalse((output/'fullstack-proof.json').exists())
                finally:restore_runtime()
                variants=[]
                for key,value in (('source','b'*40),('scope','full'),('protocol',stability.COLD_PROTOCOL),('schema',True),('raw','private-sentinel')):
                    bad=copy.deepcopy(marker);bad[key]=value;variants.append((stability.MARKER,bad))
                for key,value in (('worker_deadline_seconds',600),('worker_deadline_seconds',True),('output_sha256','0'*64),('nonce','invalid'),('services',list(fullstack.SERVICES))):
                    bad=copy.deepcopy(private);bad['scope_binding'][key]=value;variants.append(('fullstack-source.json',bad))
                bad=copy.deepcopy(private);bad['images']['scope']='full';variants.append(('fullstack-source.json',bad))
                bad=copy.deepcopy(private);bad['images']['backend']='sha256:'+'0'*64;variants.append(('fullstack-source.json',bad))
                bad=json.loads(snapshots['compose.json']);bad['services']['umami']={};variants.append(('compose.json',bad))
                bad=copy.deepcopy(owner);bad['supervisor_pid']=999;variants.append(('owner.json',bad))
                bad=json.loads(snapshots[stability.OWNER]);bad['owner']='0'*64;variants.append((stability.OWNER,bad))
                for key,value in (('deadline_seconds',600),('deadline_seconds',True),('supervisor_pid',999),('group',123),('pid',False)):
                    bad=json.loads(snapshots['worker.json']);bad[key]=value;variants.append(('worker.json',bad))
                for index,(name,bad) in enumerate(variants):
                    with self.subTest(corruption=index):
                        fullstack.pilot.write_json(output/name,bad)
                        destination=base/('bad-'+str(index))
                        with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,destination,scope='technical',protocol=protocol)
                        self.assertFalse(destination.exists())
                        with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output),'--images',str(base/'images.json')]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.resource_runtime.ci,'recover') as recover,patch.object(fullstack.preparation,'recover_stage') as acquire:
                            with self.assertRaises(ValueError):fullstack.main()
                            recover.assert_not_called();acquire.assert_not_called()
                        if name not in ('worker.json',stability.NAME):
                            with patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack,'invoke') as invoke:
                                with self.assertRaises((ValueError,FileExistsError)):fullstack.stability_worker(output,owner,compose)
                                invoke.assert_not_called()
                        (output/name).write_text(snapshots[name])
                for key,value in (('service_roles',list(fullstack.SERVICES)),('images',{}),('acceptance',{'state':'passed','capacity':True,'minimum_candidate_gib':4}),('raw','private-sentinel')):
                    with self.subTest(public=key):
                        bad=copy.deepcopy(record);bad[key]=value;fullstack.pilot.write_json(output/stability.NAME,bad)
                        with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,base/('forged-'+key),scope='technical',protocol=protocol)
                        self.assertFalse((base/('forged-'+key)).exists())
                (output/stability.NAME).write_text(snapshots[stability.NAME])
                for name in (stability.MARKER,'worker-outcome.json'):
                    with self.subTest(missing=name):
                        saved=(output/name).read_text();(output/name).unlink()
                        with self.assertRaises((ValueError,OSError)):fullstack.stability_collect(output,metadata,base/('missing-'+name),scope='technical',protocol=protocol)
                        (output/name).write_text(saved);(output/name).chmod(0o600)
                for name in (stability.MARKER,stability.NAME,stability.OWNER):(output/name).unlink()
                with self.assertRaises(ValueError):fullstack.collect(output,metadata,base/'lost-request-primary',scope='technical')
                self.assertFalse((base/'lost-request-primary').exists())
                with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack,'invoke') as invoke:
                    with self.assertRaises(ValueError):fullstack.worker(output)
                    invoke.assert_not_called()
                for name in (stability.MARKER,stability.NAME,stability.OWNER):
                    (output/name).write_text(snapshots[name]);(output/name).chmod(0o600)
                for raw in ('{"schema":3,"schema":3}', '{"schema":NaN}', '[]'):
                    with self.subTest(marker=raw):
                        (output/stability.MARKER).write_text(raw)
                        with self.assertRaises(ValueError):fullstack.stability_collect(output,metadata,base/'malformed',scope='technical',protocol=protocol)
                (output/stability.MARKER).write_text(snapshots[stability.MARKER])
                (output/stability.MARKER).unlink();(output/stability.MARKER).symlink_to(base/'event.json')
                with self.assertRaises((ValueError,OSError)):fullstack.stability_collect(output,metadata,base/'symlink-marker',scope='technical',protocol=protocol)
                (output/stability.MARKER).unlink();(output/stability.MARKER).write_text(snapshots[stability.MARKER]);(output/stability.MARKER).chmod(0o600)
                (base/'alias').symlink_to(output,target_is_directory=True)
                with self.assertRaises(ValueError):fullstack.stability_collect(base/'alias',metadata,base/'symlink-output',scope='technical',protocol=protocol)
                (output/'cleanup.json').unlink();(output/'worker-outcome.json').unlink()
                with self.assertRaises((ValueError,OSError)):fullstack.stability_collect(output,metadata,base/'partial-runtime',scope='technical',protocol=protocol)
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output)]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.resource_runtime.ci,'recover',return_value={'down':'passed','residue':'passed'}) as recover:
                    with self.assertRaises((OSError,ValueError)):fullstack.main()
                    recover.assert_not_called()
                partial_stage=unittest.mock.Mock();partial_stage.in_use.side_effect=lambda:nullcontext()
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output),'--images',str(base/'images.json')]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.preparation,'directory',return_value=base),patch.object(fullstack.preparation,'recover_stage',return_value=partial_stage),patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                    with self.assertRaises((OSError,ValueError)):fullstack.main()
                    recover.assert_not_called();partial_stage.release.assert_not_called()
                _settled(output,exit_code=1,cleanup=False)
                fullstack.stability_collect(output,metadata,base/'failed',scope='technical',protocol=protocol)
                self.assertEqual(json.loads((base/'failed'/stability.NAME).read_text())['state'],'incomplete')
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output)]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                    with self.assertRaises(ValueError):fullstack.main()
                    recover.assert_not_called()
                _settled(output)
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output)]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                    self.assertEqual(fullstack.main(),{'down':'passed','residue':'passed'})
                    recover.assert_not_called()
                stage=unittest.mock.Mock();stage.in_use.side_effect=lambda:nullcontext()
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(output),'--images',str(base/'images.json')]),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.preparation,'directory',return_value=base),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.resource_runtime.ci,'recover') as recover:
                    fullstack.main();recover.assert_not_called()
                    stage.release.assert_called_once_with(str(output),cleanup_ok=True)
                # Admission/prepare failure has no runtime and no invented completion.
                absent=base/'absent'
                fullstack.stability_collect(absent,metadata,base/'absent-public',scope='technical',protocol=protocol)
                self.assertEqual(json.loads((base/'absent-public'/stability.NAME).read_text())['state'],'incomplete')
            # CLI dispatch keeps one actual900s supervisor and the legacy default600s.
            from types import SimpleNamespace
            stage=SimpleNamespace(in_use=lambda:nullcontext(),require_consumer=lambda _:None,pass_fds=lambda:())
            for scope,deadline in (('technical',900),('full',600)):
                with self.subTest(dispatch=scope),patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.sys,'argv',['fullstack.py','diagnostic-run','--output',str(output),'--images',str(base/'images.json'),'--scope',scope,'--protocol',protocol]),patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.pilot,'run') as run,patch.object(fullstack,'stability_inputs') as inputs:
                    fullstack.main();options=run.call_args.kwargs
                    self.assertEqual(options['worker_deadline_seconds'],deadline)
                    self.assertEqual(options['services'],fullstack.services(scope))
                    options['prepare_inputs'](output)
                    inputs.assert_called_once_with(output,base/'images.json',protocol,**({'scope':'technical'} if scope=='technical' else {}))
            argv=['fullstack.py','diagnostic-run','--scope','technical','--output',str(output),'--images',str(base/'images.json'),'--protocol',protocol]
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.sys,'argv',argv),patch.object(fullstack.pilot,'command',return_value=source),patch.object(fullstack.preparation,'recover_stage',return_value=stage):
                ordinary_root=base/'ordinary-root';ordinary_root.mkdir()
                ordinary,_=test_technical_scope.TechnicalScope().prepare_inputs(ordinary_root)
                _owner(ordinary)
                ordinary_parent=base/'ordinary-parent';ordinary_parent.symlink_to(ordinary_root,target_is_directory=True)
                ordinary_alias=ordinary_parent/ordinary.name
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(ordinary_alias)]),patch.object(fullstack.resource_runtime.ci,'recover',return_value={'down':'passed','residue':'passed'}) as recover:
                    fullstack.main()
                    recover.assert_called_once_with(ordinary_alias,project_prefix=fullstack.PREFIX,services=fullstack.services('technical'))
                diagnostic_parent=base/'diagnostic-parent';diagnostic_parent.symlink_to(base,target_is_directory=True)
                with patch.object(fullstack.sys,'argv',['fullstack.py','recover','--scope','technical','--output',str(diagnostic_parent/output.name)]),patch.object(fullstack.resource_runtime.ci,'recover') as recover,patch.object(fullstack.preparation,'recover_stage') as acquire:
                    with self.assertRaises(ValueError):fullstack.main()
                    recover.assert_not_called();acquire.assert_not_called()
                for mode in ('popen','before_supervise','malformed_settlement'):
                    with self.subTest(primary_failure=mode):
                        _settled(output,exit_code=1)
                        primary=OSError('private-popen-sentinel') if mode=='popen' else RuntimeError('private-primary-sentinel')
                        if mode=='popen':(output/'worker.json').unlink()
                        if mode=='before_supervise':
                            for name in ('worker.json','worker-outcome.json','cleanup.json',stability.OWNER):(output/name).unlink()
                        if mode=='malformed_settlement':fullstack.pilot.write_json(output/'worker.json',{'deadline_seconds':600})
                        origin=[]
                        def fail(*args,**options):
                            try:raise primary
                            except BaseException as error:
                                origin.append(error.__traceback__);raise
                        caught=None;frames=[]
                        with patch.object(fullstack.pilot,'run',side_effect=fail):
                            try:fullstack.main()
                            except BaseException as error:
                                caught=error;frame=error.__traceback__
                                while frame is not None:frames.append(frame);frame=frame.tb_next
                        self.assertIs(caught,primary)
                        self.assertIn(origin[0],frames,'settlement must retain the original failure traceback')
                        if not (output/stability.OWNER).exists():
                            (output/stability.OWNER).write_text(snapshots[stability.OWNER]);(output/stability.OWNER).chmod(0o600)
                for secondary in (subprocess.SubprocessError('private-observer'),subprocess.CalledProcessError(7,['git']),
                        subprocess.TimeoutExpired(['git'],1),RecursionError('private-json-depth')):
                    with self.subTest(observer_failure=type(secondary).__name__):
                        _settled(output,exit_code=1);primary=RuntimeError('private-primary');origin=[]
                        def fail(*args,**options):
                            try:raise primary
                            except BaseException as error:origin.append(error.__traceback__);raise
                        target=stability if isinstance(secondary,RecursionError) else fullstack.pilot
                        name='technical_settlement' if isinstance(secondary,RecursionError) else 'command'
                        caught=None;frames=[]
                        with patch.object(fullstack.pilot,'run',side_effect=fail),patch.object(target,name,side_effect=secondary) as observer:
                            try:fullstack.main()
                            except BaseException as error:
                                caught=error;frame=error.__traceback__
                                while frame is not None:frames.append(frame);frame=frame.tb_next
                            observer.assert_called_once()
                        self.assertIs(caught,primary);self.assertIn(origin[0],frames)
                        _settled(output)
                        with patch.object(fullstack.pilot,'run',return_value=None),patch.object(target,name,side_effect=secondary),self.assertRaises(type(secondary)) as observed:
                            fullstack.main()
                        self.assertIs(observed.exception,secondary)
                for name,value in (('owner.json',None),('worker.json',None),('worker.json',{'pid':True}),
                        ('worker-outcome.json',None),('worker-outcome.json',{'exit_code':0}),
                        ('cleanup.json',None),('cleanup.json',False)):
                    with self.subTest(successful_run_bad_receipt=name,value=value):
                        _settled(output)
                        if value is None:(output/name).unlink()
                        else:fullstack.pilot.write_json(output/name,value)
                        with patch.object(fullstack.pilot,'run',return_value=None),self.assertRaises((OSError,ValueError)):
                            fullstack.main()
                        if name=='owner.json':fullstack.pilot.write_json(output/'owner.json',owner)
                for mode in ('failed_cleanup','malformed_cleanup','failed_outcome','monitor_failure'):
                    with self.subTest(successful_run_contradiction=mode):
                        _settled(output,exit_code=1 if mode=='failed_outcome' else 0,cleanup=mode!='failed_cleanup')
                        outcome=json.loads((output/'worker-outcome.json').read_text())
                        if mode=='malformed_cleanup':
                            fullstack.pilot.write_json(output/'cleanup.json',False);outcome['cleanup']=False
                        if mode=='monitor_failure':outcome['monitor_failed']=True
                        fullstack.pilot.write_json(output/'worker-outcome.json',outcome)
                        with patch.object(fullstack.pilot,'run',return_value=None),self.assertRaises(ValueError):fullstack.main()


if __name__=='__main__':unittest.main()
