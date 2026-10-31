"""The existing stability lifecycle keeps technical evidence outside acceptance."""
import copy
from contextlib import ExitStack, nullcontext
import json
import os
from pathlib import Path
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
                    fullstack.main();recover.assert_called_once_with(output,project_prefix=fullstack.PREFIX,services=fullstack.services('technical'))
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


if __name__=='__main__':unittest.main()
