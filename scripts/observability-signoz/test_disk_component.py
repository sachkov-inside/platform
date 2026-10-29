"""Closed component dispatch and publication; benign owned processes, never Docker."""
import json
import hashlib
from pathlib import Path
import sys
import tempfile
import time
import threading
import unittest
from unittest.mock import patch

import disk_component as component
import lifecycle
import evidence
import runtime
from test_lifecycle import benign_engine


class ComponentDispatch(unittest.TestCase):
    def test_actual_dispatch_has_fixed_three_cases_and_unchanged_real_vm_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=root/'docker-fixture'
            helper.write_text('#!'+sys.executable+'\n'+'''import json,sys
args=sys.argv[5:]
if args==['exec','owned','/bin/true']:raise SystemExit
if args==['exec','owned','python','-c','import json,os,sys,time;print("disk-component-imports-v1")']:print('disk-component-imports-v1');raise SystemExit
if args==['exec','owned','python','/driver/inside.py','disk']:
 print(json.dumps(dict(fsid=1,device=2,block=4096,blocks=25000000,available=23000000,files=0,free_files=0)));raise SystemExit
raise SystemExit(7)
''');helper.chmod(0o700)
            engine=benign_engine(root);engine.__class__=component.ComponentEngine
            engine.identity={'fixture':True};engine.identify=lambda:engine.identity
            engine.anon=root;engine.endpoint='fixture';engine.invocation=helper;engine.cli=helper.resolve()
            native=helper.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli));engine.deadline=time.monotonic()+30
            class Owned:
                containers={'disk':'owned'}
                def validate(self,role):self_outer.assertEqual(role,'disk')
                def exec(self,args,timeout=10):
                    self.validate('disk');return engine.call(['exec','owned','python','/driver/inside.py',*args],timeout)
            self_outer=self;own=Owned();own.engine=engine
            with patch.object(lifecycle,'vm_sample',wraps=lifecycle.vm_sample) as actual:
                rows=[component.run_case(own,k) for k in ('minimal_exec','python_imports','actual_vm_sample')]
                self.assertEqual(actual.call_count,1)
            self.assertEqual([r['status'] for r in rows],['succeeded']*3)
            self.assertTrue(all(r['entered_final_exec'] and r['declared_final_timeout_seconds']==3 for r in rows))
            self.assertFalse(engine.child)


class ComponentOwnership(unittest.TestCase):
    def test_changed_source_or_request_refuses_recovery_before_native_or_signal(self):
        for changed in ('source','request','owner'):
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp).resolve();source={'commit':'a'*40,'tree':'b'*40,'profile_id':component.PROFILE}
                request={'schema':1,'profile_id':component.PROFILE,'source_sha':'a'*40,'source_tree':'b'*40,
                         'project':'signoz1566-'+'c'*12,'nonce':'d'*32,'cwd':str(runtime.ROOT),'output':str(output)}
                lifecycle.private_json(output/'source.json',source)
                lifecycle.private_json(output/'component-request.json',request)
                owner={**request,'source_sha':'wrong'}
                if changed=='owner':lifecycle.private_json(output/'owner.json',owner)
                if changed=='request':lifecycle.private_json(output/'component-request.json',{**request,'profile_id':lifecycle.BASELINE_PROFILE})
                with patch.object(runtime,'verify_source',side_effect=ValueError('source_changed') if changed=='source' else None),patch.object(runtime,'recover') as recover,patch.object(runtime,'stop_worker') as stop:
                    with self.assertRaises(ValueError):component.recover(output)
                    recover.assert_not_called();stop.assert_not_called()


class ComponentPhases(unittest.TestCase):
    def test_setup_failure_does_not_measure_but_still_runs_separate_bounded_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=(Path(tmp)/'private').resolve();seen=[]
            source={'commit':'a'*40,'tree':'b'*40,'profile_id':component.PROFILE}
            def phase(path,name,started,deadline,cancelled):
                seen.append((name,deadline-started))
                return {'phase':name,'exit':1 if name=='setup' else 0,'elapsed_seconds':1,'limit_seconds':180 if name=='setup' else 90,'stopped':True}
            with patch.object(component,'require_opt_in'),patch.object(runtime,'require_native_host'),patch.object(runtime,'source',return_value=source),patch.object(component,'launch_phase',side_effect=phase):
                self.assertEqual(component.run(output),1)
            self.assertEqual(seen,[('setup',180),('cleanup',90)])
            record=evidence.read(output/'component-outcome.json')
            self.assertEqual(record['phases']['measure'],{'available':False})
            self.assertFalse(record['complete'])


def collection_fixture(output):
    from test_profiles import owned_fixture
    source={'commit':'a'*40,'tree':'e'*40,'profile_id':component.PROFILE}
    own,native=owned_fixture(output,component.PROFILE)
    for role in component.ROLES:own.validate(role)
    own.containers={k:v for k,v in own.containers.items() if k in component.ROLES}
    own.created={k:v for k,v in own.created.items() if k in component.ROLES}
    own.images={k:v for k,v in own.images.items() if k in component.ROLES}
    own.observed_limits={k:v for k,v in own.observed_limits.items() if k in component.ROLES}
    own.volumes={name:{'Name':name,'CreatedAt':'created','Mountpoint':'/private/'+name,'Driver':'local'} for name in own.volumes}
    own.networks={own.plan['name']+'_backend':'f'*64};own.record()
    value={'schema':1,'profile_id':component.PROFILE,'source_sha':source['commit'],'source_tree':source['tree'],
        'project':own.project,'nonce':own.nonce,'cwd':str(runtime.ROOT),'output':str(output)}
    lifecycle.private_json(output/'source.json',source);lifecycle.private_json(output/'component-request.json',value)
    own.plan=lifecycle.make_plan(output,lifecycle.verify_packet()['images'],own.project,own.nonce,component.os.getuid(),component.os.getgid(),profile_id=component.PROFILE)
    for role in component.ROLES:
        proof=native.image_proofs[own.images[role]['reference']]
        own.images[role]['entrypoint']=proof.config.get('Entrypoint')
        own.images[role]['declared_volume_paths']=list(proof.volume_paths)
    lifecycle.private_json(output/'compose.json',own.plan)
    lifecycle.private_json(output/'owner.json',{**value,'plan_sha256':lifecycle.digest(output/'compose.json'),'daemon':{'daemon_id':'owned-daemon','endpoint':'private-endpoint'}})
    engine=output/'engine-1-abcdef12';engine.mkdir(mode=0o700)
    lifecycle.private_json(engine/'identity.json',{'cli_sha256':'sha256:'+'a'*64,'compose_sha256':'sha256:'+'c'*64,'daemon_sha256':'sha256:'+hashlib.sha256(b'owned-daemon').hexdigest(),'endpoint_sha256':'sha256:'+hashlib.sha256(b'private-endpoint').hexdigest()})
    inventory={'schema':1,'profile_id':component.PROFILE,'source_sha':source['commit'],'source_tree':source['tree'],
        'project':own.project,'nonce':own.nonce,'plan_sha256':lifecycle.digest(output/'compose.json'),
        'resources':evidence.read(output/'resources.json'),'limits':own.observed_limits,'images':own.images}
    for name in ('before','after'):lifecycle.private_json(output/('component-inventory-'+name+'.json'),inventory)
    rows=[{'case':case,'status':'succeeded','entered_final_exec':True,'declared_final_timeout_seconds':3,
           'outer_elapsed_seconds':.01,'reason':'completed','first_inner_command':{'available':False}} for case in component.CASES]
    lifecycle.private_json(output/'component-cases.json',{'schema':1,'cases':rows})
    lifecycle.private_json(output/'component-cleanup.json',{'schema':1,'passed':True})
    lifecycle.private_json(output/'cleanup.json',{'passed':True,'failed_operations':[],'exact_containers':2,'exact_volumes':7,'exact_networks':1})
    phases={name:{'available':True,'phase':name,'status':'executed','exit':0,'elapsed_seconds':1,'limit_seconds':limit,'stopped':True} for name,limit in (('setup',180),('measure',60),('cleanup',90))}
    lifecycle.private_json(output/'component-outcome.json',{'schema':1,'profile_id':component.PROFILE,'complete':True,'phases':phases})
    return inventory,rows


class ComponentCollection(unittest.TestCase):
    def test_complete_component_remains_distinct_and_replacement_or_cleanup_cannot_be_green(self):
        import copy
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
            inventory,rows=collection_fixture(output)
            with patch.object(runtime,'verify_source'):
                self.assertTrue(component.collect(output,root/'good'))
                report=json.loads((root/'good/component.json').read_text())
                self.assertTrue(report['diagnostic_complete'])
                for key in ('functional_acceptance','full_workload_acceptance','resource_acceptance','capacity_acceptance','production_acceptance'):self.assertIs(report[key],False)
                self.assertNotIn('passed',report);self.assertNotIn('private/',json.dumps(report));self.assertNotIn(inventory['nonce'],json.dumps(report))
                with patch.object(runtime,'verify_source',side_effect=ValueError('unbound-source')):
                    self.assertFalse(component.collect(output,root/'unbound-cleanup'))
                unbound=json.loads((root/'unbound-cleanup/component.json').read_text())
                self.assertFalse(unbound['cleanup']['available'])
                wrong=copy.deepcopy(inventory);wrong['resources']['created']['disk']='replacement'
                lifecycle.private_json(output/'component-inventory-after.json',wrong)
                self.assertFalse(component.collect(output,root/'replacement'))
                lifecycle.private_json(output/'component-inventory-after.json',inventory)
                lifecycle.private_json(output/'cleanup.json',{'passed':False,'failed_operations':['container'],'exact_containers':2,'exact_volumes':7,'exact_networks':1})
                self.assertFalse(component.collect(output,root/'cleanup-failed'))
                lifecycle.private_json(output/'component-cases.json',{'schema':1,'cases':[{**rows[0],'reason':'private-token'},*rows[1:]]})
                self.assertFalse(component.collect(output,root/'unknown'))


def measurement_fixture(output):
    """Native adapter only: real existing/Owned/run_case/collector, controlled cost."""
    import copy
    from test_profiles import owned_fixture
    inventory,_=collection_fixture(output)
    (output/'component-inventory-after.json').unlink()
    _,template=owned_fixture(output,component.PROFILE)
    plan=evidence.read(output/'compose.json')
    class Native:
        identity={'daemon_id':'owned-daemon','endpoint':'private-endpoint','storage':str(output)}
        image_proofs=template.image_proofs
        clock=1000.
        deadline=1060.
        commands=0
        executions=[]
        after_exec=None
        component_entered=False
        values=copy.deepcopy(template.values)
        ids=dict(inventory['resources']['containers'])
        def inspect(self,kind,identity):
            args=[kind,'inspect',identity] if kind in ('image','volume','network') else ['inspect',identity]
            return json.loads(self.call(args))[0]
        def call(self,args,timeout=10):
            self.commands+=1;self.clock+=.7
            if self.clock>=self.deadline:raise lifecycle.Refusal('global_deadline')
            if args[:2]==['ps','-aq']:return '\n'.join(self.ids.values())
            if args[:2]==['volume','ls']:
                name=args[-1].removeprefix('name=^').removesuffix('$')
                return name if name in self.values else ''
            if args[:2]==['network','ls']:return 'f'*64
            if args[0]=='exec':
                if timeout!=3 or args!=self.component_argv:raise AssertionError('fixed final dispatch required')
                self.component_entered=True;self.executions.append(list(args))
                if self.after_exec:self.after_exec(len(self.executions))
                if args[2:]==['/bin/true']:return ''
                if args[2:]==['python','-c',component.IMPORTS]:return 'disk-component-imports-v1\n'
                if args[2:]==['python','/driver/inside.py','disk']:
                    return json.dumps(dict(fsid=1,device=2,block=4096,blocks=25000000,available=23000000,files=0,free_files=0))
                raise AssertionError('unexpected native command')
            if args[0]=='inspect':return json.dumps([self.values[args[1]]])
            if args[:2] in (['image','inspect'],['volume','inspect'],['network','inspect']):
                return json.dumps([self.values[args[2]]])
            raise AssertionError('unexpected native command')
    native=Native()
    for role,cid in native.ids.items():
        spec=plan['services'][role];row=native.values[cid]
        row['Config'].update(User=spec['user'],Entrypoint=spec.get('entrypoint',[]),
            Cmd=spec['command'],Env=[k+'='+v for k,v in spec.get('environment',{}).items()])
    for name,spec in plan['volumes'].items():
        identity=inventory['resources']['volumes'][spec['name']]
        native.values[spec['name']]={**identity,'Labels':spec['labels'],'Options':None}
    spec=next(iter(plan['networks'].values()))
    native.values['f'*64]={'Id':'f'*64,'Name':spec['name'],'Labels':spec['labels'],'Internal':True,'Driver':'bridge'}
    pin=next(r for r in lifecycle.verify_packet(component.PROFILE)['images'] if r['repository'].endswith('/python'))
    proof=native.image_proofs[pin['pinned']]
    native.values[proof.runtime_reference]={'Id':proof.config_digest,'Os':'linux','Architecture':'amd64',
        'Config':dict(proof.config),'RootFS':{'Type':'layers','Layers':list(proof.diff_ids)},'RepoDigests':[proof.runtime_reference]}
    owner=evidence.read(output/'owner.json');owner['daemon']=native.identity
    lifecycle.private_json(output/'owner.json',owner)
    lifecycle.private_json(output/'component-host-initial.json',lifecycle.host_snapshot(native,output))
    return evidence.read(output/'source.json'),evidence.read(output/'component-request.json'),native,inventory


class ComponentMeasurement(unittest.TestCase):
    def test_actual_measure_preserves_three_cases_and_complete_identity_with_bounded_native_cost(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
            source,value,native,before=measurement_fixture(output)
            with patch.object(component,'time',SimpleNamespace(monotonic=lambda:native.clock)):
                component.measure(output,source,value,native)
            self.assertLess(native.clock-1000,60)
            self.assertEqual(len(native.executions),3)
            self.assertEqual(evidence.read(output/'component-inventory-after.json'),before)
            rows=evidence.read(output/'component-cases.json')['cases']
            self.assertEqual([row['status'] for row in rows],['succeeded']*3)
            outcome=evidence.read(output/'component-outcome.json')
            outcome['phases']['measure']['elapsed_seconds']=native.clock-1000
            lifecycle.private_json(output/'component-outcome.json',outcome)
            with patch.object(runtime,'verify_source'):
                self.assertTrue(component.collect(output,root/'public'))
            self.assertTrue(evidence.read(root/'public/component.json')['diagnostic_complete'])

    def test_complete_after_inventory_rejects_container_volume_replacement_and_quota_changes(self):
        import copy
        from types import SimpleNamespace
        for changed in ('container_created','container_replaced','volume_created','quota'):
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
                source,value,native,before=measurement_fixture(output)
                def mutate(count):
                    if count!=3:return
                    cid=native.ids['disk'];row=native.values[cid]
                    if changed=='container_created':row['Created']='replacement'
                    elif changed=='container_replaced':
                        native.ids['disk']='e'*64;native.values['e'*64]=copy.deepcopy(row)
                        native.values['e'*64]['Id']='e'*64
                    elif changed=='volume_created':
                        name=next(iter(before['resources']['volumes']))
                        native.values[name]['CreatedAt']='replacement'
                    else:row['HostConfig']['MemorySwap']+=1
                native.after_exec=mutate
                with patch.object(component,'time',SimpleNamespace(monotonic=lambda:native.clock)):
                    with self.assertRaises((lifecycle.Refusal,ValueError)):component.measure(output,source,value,native)
                self.assertEqual(len(native.executions),3)
                self.assertFalse((output/'component-inventory-after.json').exists())
                with patch.object(runtime,'verify_source'):
                    self.assertFalse(component.collect(output,root/'public'))

    def test_each_case_still_validates_disk_before_its_final_native_command(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
            source,value,native,_=measurement_fixture(output)
            def mutate(count):
                if count==1:native.values[native.ids['disk']]['HostConfig']['MemorySwap']+=1
            native.after_exec=mutate
            with patch.object(component,'time',SimpleNamespace(monotonic=lambda:native.clock)):
                with self.assertRaises(lifecycle.Refusal):component.measure(output,source,value,native)
            self.assertEqual(len(native.executions),1)
            rows=evidence.read(output/'component-cases.json')['cases']
            self.assertEqual([row['status'] for row in rows],['succeeded','not_run','not_run'])
            self.assertTrue(all(not row['entered_final_exec'] for row in rows[1:]))
            self.assertFalse((output/'component-inventory-after.json').exists())
            with patch.object(runtime,'verify_source'):
                self.assertFalse(component.collect(output,root/'public'))

    def test_interrupted_partial_measurement_keeps_cases_but_cannot_complete_collection(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
            source,value,native,_=measurement_fixture(output)
            def interrupt(count):
                if count==3:raise KeyboardInterrupt
            native.after_exec=interrupt
            with patch.object(component,'time',SimpleNamespace(monotonic=lambda:native.clock)):
                with self.assertRaises(KeyboardInterrupt):component.measure(output,source,value,native)
            self.assertEqual(len(evidence.read(output/'component-cases.json')['cases']),2)
            self.assertFalse((output/'component-inventory-after.json').exists())
            with patch.object(runtime,'verify_source'):
                self.assertFalse(component.collect(output,root/'public'))


class ComponentNegativeContracts(unittest.TestCase):
    def test_raw_deadline_is_retained_and_children_reaped_without_a_real_three_second_pause(self):
        import types
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=root/'controlled-cli'
            helper.write_text('#!'+sys.executable+'\n'+'''from pathlib import Path
import time
r=Path(__file__).parent;(r/'entered').touch();time.sleep(30)
''');helper.chmod(0o700)
            engine=benign_engine(root);engine.__class__=component.ComponentEngine
            engine.identity={};engine.identify=lambda:{};engine.anon=root;engine.endpoint='fixture'
            engine.invocation=helper;engine.cli=helper.resolve();native=helper.lstat()
            engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(engine.cli));engine.deadline=time.monotonic()+5
            class Owned:
                containers={'disk':'owned'}
                def validate(self,role):pass
            own=Owned();own.engine=engine;real_clock=time.monotonic;calls=[0];offset=[0]
            def clock():
                calls[0]+=1;value=real_clock()+offset[0]
                # Preempt after the component's budget check, before original raw's redundant clamp.
                if calls[0]==2:offset[0]=4
                return value+(20 if (root/'entered').exists() else 0)
            with patch.object(component,'time',types.SimpleNamespace(monotonic=clock)),patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=clock)):
                row=component.run_case(own,'minimal_exec')
            self.assertEqual((row['status'],row['reason']),('failed','command_deadline'))
            self.assertEqual(row['first_inner_command']['timeout_seconds'],3)
            self.assertGreaterEqual(row['first_inner_command']['elapsed_seconds'],20)
            self.assertTrue(row['first_inner_command']['alive_before_reap']);self.assertFalse(engine.child)
            engine.deadline=time.monotonic()+2
            row=component.run_case(own,'minimal_exec')
            self.assertEqual((row['status'],row['reason']),('not_run','component_full_budget_unavailable'))
            self.assertFalse(row['entered_final_exec']);self.assertFalse(engine.child)
            self.assertTrue(component.math.isfinite(engine.deadline))
            failures=[]
            def foreign_thread():
                try:engine.raw(['private-unapproved-command'])
                except ValueError:failures.append('refused')
            thread=threading.Thread(target=foreign_thread);thread.start();thread.join(1)
            self.assertFalse(thread.is_alive());self.assertEqual(failures,['refused'])
            self.assertFalse(engine.child);self.assertTrue(component.math.isfinite(engine.deadline))
            (root/'entered').unlink();engine.deadline=real_clock()+1
            def preflight_clock():return real_clock()+(20 if (root/'entered').exists() else 0)
            with patch.object(lifecycle,'time',types.SimpleNamespace(monotonic=preflight_clock)):
                with self.assertRaises(lifecycle.Refusal) as refusal:engine.raw(['preflight-control'],timeout=10)
            actual=lifecycle.first_raw_command(refusal.exception)
            self.assertGreater(actual['timeout_seconds'],0);self.assertLessEqual(actual['timeout_seconds'],1)
            self.assertFalse(engine.child)

    def test_publication_refuses_unknown_nonfinite_duplicate_partial_and_mixed_boundaries(self):
        import copy
        mutations=[]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();output=root/'private';output.mkdir(mode=0o700)
            inventory,rows=collection_fixture(output)
            originals={p.name:p.read_bytes() for p in output.iterdir() if p.is_file()}
            def change(name,edit):
                value=json.loads(originals[name]);edit(value);return (name,json.dumps(value).encode())
            mutations.extend([
                change('component-request.json',lambda d:d.update(profile_id=lifecycle.BASELINE_PROFILE)),
                change('component-request.json',lambda d:d.update(raw='private-token')),
                change('component-inventory-after.json',lambda d:d['resources']['containers'].update(disk='f'*64)),
                change('component-inventory-before.json',lambda d:d['limits']['disk'].update(memory_bytes=134217728)),
                change('component-inventory-before.json',lambda d:d['images']['disk'].update(config_digest='sha256:'+'f'*64)),
                change('resources.json',lambda d:d['created'].update(disk='replacement')),
                change('component-cases.json',lambda d:d['cases'][0].update(outer_elapsed_seconds=float('nan'))),
                change('component-cases.json',lambda d:d['cases'][0].update(raw='private-token')),
                change('component-cases.json',lambda d:d['cases'][0].update(entered_final_exec=False)),
                change('component-cases.json',lambda d:d.update(cases=d['cases'][:2])),
                change('component-cases.json',lambda d:d['cases'][0].update(case='private-token')),
                change('component-outcome.json',lambda d:d['phases']['measure'].update(elapsed_seconds=61)),
                change('component-outcome.json',lambda d:(d.update(complete=False),d['phases']['measure'].update(exit=124))),
                change('component-outcome.json',lambda d:d['phases']['setup'].update(limit_seconds=181)),
                change('cleanup.json',lambda d:d.update(exact_volumes=6)),
                change('cleanup.json',lambda d:d.update(raw='private-token')),
                ('component-cases.json',b'{"schema":1,"schema":1,"cases":[]}'),
                ('component-cases.json',b'x'*1048577),
            ])
            with patch.object(runtime,'verify_source'):
                for index,(name,raw) in enumerate(mutations):
                    with self.subTest(index=index,name=name):
                        for filename,original in originals.items():(output/filename).write_bytes(original)
                        (output/name).write_bytes(raw)
                        self.assertFalse(component.collect(output,root/str(index)))
                        report=json.loads((root/str(index)/'component.json').read_text())
                        self.assertNotIn('private-token',json.dumps(report));self.assertFalse(report['diagnostic_complete'])

    def test_original_functional_workflow_is_byte_identical_and_new_job_is_opt_in(self):
        workflow=(runtime.ROOT/'.github/workflows/observability-signoz.yml').read_text()
        original,separator,job=workflow.partition('\n  disk_component:')
        self.assertTrue(separator)
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),'623312eb0dc195d05ec8ce051c459d1dbfdc8fa8839183c8e3fc2eb986f2eae6')
        self.assertIn("${{ github.event_name == 'pull_request' && contains(github.event.pull_request.body, '<!-- signoz-disk-component: run -->') }}",job)
        self.assertIn('if: >-',job);self.assertIn('timeout-minutes: 12',job);self.assertIn('persist-credentials: false',job)
        self.assertIn('node scripts/observability-signoz/verify.mjs',job)
        self.assertIn('timeout-minutes: 8\n        run: >-\n          bash scripts/heavy-check.sh python3 -B scripts/observability-signoz/disk_component.py run',job)
        self.assertEqual(job.count('scripts/observability-signoz/disk_component.py'),3)
        self.assertNotIn('secrets.',job);self.assertNotIn('permissions:',job);self.assertNotIn('environment:',job)

    def test_external_phase_real_process_is_reaped_on_exit_and_deadline(self):
        import subprocess
        import supervisor
        for action in ('success','failure','timeout'):
            with self.subTest(action=action),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp);spawned=[];real_popen=subprocess.Popen
                def launch(argv,**kwargs):
                    self.assertEqual(argv[-2:],['--phase','setup'])
                    program='import time;time.sleep(30)' if action=='timeout' else 'raise SystemExit('+('0' if action=='success' else '7')+')'
                    process=real_popen([sys.executable,'-B','-c',program],**kwargs);spawned.append(process);return process
                def stop(record):
                    self.assertEqual(record,{'pid':spawned[0].pid,'group':spawned[0].pid,'start_ticks':'owned-fixture'})
                    supervisor.stop(spawned[0])
                started=time.monotonic()
                try:
                    with patch.object(component.subprocess,'Popen',side_effect=launch),patch.object(runtime,'process_start',return_value='owned-fixture'),patch.object(runtime,'stop_worker',side_effect=stop):
                        # This adapter owns the real Popen; production retains Linux birth/session checks.
                        row=component.launch_phase(output,'setup',started,started+(.05 if action=='timeout' else 3),lambda:False)
                    self.assertEqual(row['exit'],{'success':0,'failure':7,'timeout':124}[action])
                    self.assertTrue(row['stopped']);self.assertIsNotNone(spawned[0].returncode)
                finally:
                    for process in spawned:
                        if process.poll() is None:supervisor.stop(process)

    def test_recovery_stops_both_registered_phases_even_before_owner_acquisition(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp).resolve();self.assertFalse(component.recover(output/'absent')['passed'])
            source={'commit':'a'*40,'tree':'b'*40,'profile_id':component.PROFILE}
            value={'schema':1,'profile_id':component.PROFILE,'source_sha':'a'*40,'source_tree':'b'*40,
                   'project':'signoz1566-'+'c'*12,'nonce':'d'*32,'cwd':str(runtime.ROOT),'output':str(output)}
            lifecycle.private_json(output/'source.json',source);lifecycle.private_json(output/'component-request.json',value)
            registrations=[{'pid':pid,'group':pid,'start_ticks':'owned-'+str(pid)} for pid in (12345,12346)]
            for name,record in zip(('worker.json','component-cleaner.json'),registrations):lifecycle.private_json(output/name,record)
            with patch.object(runtime,'verify_source'),patch.object(runtime,'stop_worker') as stop,patch.object(runtime,'recover') as native:
                self.assertTrue(component.recover(output)['passed'])
                self.assertEqual([call.args[0] for call in stop.call_args_list],registrations)
                native.assert_not_called()

    def test_exhausted_bootstrap_budget_never_starts_setup_and_retains_actual_elapsed(self):
        import types
        with tempfile.TemporaryDirectory() as tmp:
            output=(Path(tmp)/'private').resolve();clock=[1000.];real_phase=component.launch_phase
            def source(profile):
                self.assertEqual(profile,component.PROFILE);clock[0]=1181.
                return {'commit':'a'*40,'tree':'b'*40,'profile_id':profile}
            def launch(path,name,started,deadline,cancelled):
                if name=='cleanup':return {'available':True,'phase':'cleanup','status':'executed','exit':0,'elapsed_seconds':0,'limit_seconds':90,'stopped':True}
                return real_phase(path,name,started,deadline,cancelled)
            with patch.object(component,'require_opt_in'),patch.object(runtime,'require_native_host'),patch.object(runtime,'source',side_effect=source),patch.object(component,'time',types.SimpleNamespace(monotonic=lambda:clock[0])),patch.object(component,'launch_phase',side_effect=launch),patch.object(component.subprocess,'Popen') as native,patch.object(component,'component_engine') as engine,patch.object(lifecycle,'acquire_image') as acquire:
                self.assertEqual(component.run(output),1)
                native.assert_not_called();engine.assert_not_called();acquire.assert_not_called()
            row=evidence.read(output/'component-outcome.json')['phases']['setup']
            self.assertEqual(row['status'],'not_run');self.assertEqual(row['elapsed_seconds'],181)
            self.assertEqual(row['exit'],124);self.assertEqual(row['limit_seconds'],180)

    def test_exact_case_sensitive_opt_in_is_required_at_run_and_worker_before_native_authority(self):
        payloads=[None,[],{}, {'action':'synchronize','pull_request':{}},
                  {'action':'synchronize','pull_request':{'body':None}},
                  {'action':'synchronize','pull_request':{'body':123}},
                  {'action':'synchronize','pull_request':{'body':'<!-- SIGNOZ-DISK-COMPONENT: RUN -->'}},
                  {'action':'synchronize','pull_request':{'body':'<!-- signoz-disk-component: Run -->'}},
                  {'action':'edited','pull_request':{'body':'<!-- signoz-disk-component: run -->'}}]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();event=root/'event.json';output=root/'output'
            for index,payload in enumerate(payloads):
                event.write_text(json.dumps(payload))
                for entry in ('run','setup','measure'):
                    with self.subTest(index=index,entry=entry),patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'require_native_host'),patch.object(runtime,'source') as source,patch.object(component,'registered_phase') as registered,patch.object(component.subprocess,'Popen') as process,patch.object(component,'component_engine') as engine,patch.object(lifecycle,'acquire_image') as acquire:
                        with self.assertRaises(ValueError):
                            component.run(output) if entry=='run' else component.worker(output,entry)
                        source.assert_not_called();registered.assert_not_called();process.assert_not_called();engine.assert_not_called();acquire.assert_not_called()
            event.write_text(json.dumps({'action':'synchronize','pull_request':{'body':'context\n<!-- signoz-disk-component: run -->\ncontext'}}))
            with patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'require_native_host'),patch.object(runtime,'source',side_effect=ValueError('source reached')) as source:
                with self.assertRaisesRegex(ValueError,'source reached'):component.run(output)
                source.assert_called_once_with(component.PROFILE)
            for raw in (b'{',b'{"action":"synchronize","action":"opened","pull_request":{"body":"<!-- signoz-disk-component: run -->"}}}',b'x'*1048577):
                event.write_bytes(raw)
                with patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'source') as source,patch.object(component.subprocess,'Popen') as native:
                    with self.assertRaisesRegex(ValueError,'exact_component_opt_in_required'):component.run(output)
                    source.assert_not_called();native.assert_not_called()
            event.unlink()
            with patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'source') as source:
                with self.assertRaisesRegex(ValueError,'exact_component_opt_in_required'):component.run(output)
                source.assert_not_called()
            event.write_text(json.dumps({'action':'synchronize','pull_request':{'body':'<!-- signoz-disk-component: run -->'}}))
            for phase in ('setup','measure'):
                with patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'require_native_host'),patch.object(component,'registered_phase',side_effect=ValueError('registered reached')) as registered:
                    with self.assertRaisesRegex(ValueError,'registered reached'):component.worker(output,phase)
                    registered.assert_called_once_with(output,phase)
            # Removing opt-in must not strand a source-bound owned project.
            output.mkdir(mode=0o700);collection_fixture(output)
            event.write_text(json.dumps({'action':'synchronize','pull_request':{'body':''}}))
            with patch.dict(component.os.environ,{'GITHUB_EVENT_NAME':'pull_request','GITHUB_EVENT_PATH':str(event)}),patch.object(runtime,'verify_source'),patch.object(runtime,'recover',return_value={'passed':True}) as recovery:
                self.assertTrue(component.recover(output)['passed'])
                recovery.assert_called_once_with(output,None,profile_id=component.PROFILE)

    def test_recovery_preflights_plan_and_partial_registry_before_any_signal(self):
        import copy
        for changed in ('compose','digest','compose_and_digest','profile_id','project','nonce','owner_symlink','resources_symlink'):
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp).resolve();collection_fixture(output)
                lifecycle.private_json(output/'component-cleaner.json',{'pid':12345,'group':12345,'start_ticks':'owned'})
                if changed in ('compose','compose_and_digest'):
                    plan=evidence.read(output/'compose.json');plan['services']['disk']['command']=['changed-command']
                    lifecycle.private_json(output/'compose.json',plan)
                    if changed=='compose_and_digest':
                        owner=evidence.read(output/'owner.json');owner['plan_sha256']=lifecycle.digest(output/'compose.json');lifecycle.private_json(output/'owner.json',owner)
                elif changed=='digest':
                    owner=evidence.read(output/'owner.json');owner['plan_sha256']='f'*64;lifecycle.private_json(output/'owner.json',owner)
                elif changed in ('owner_symlink','resources_symlink'):
                    name='owner.json' if changed=='owner_symlink' else 'resources.json'
                    (output/name).unlink();(output/name).symlink_to(output/'missing-private-receipt')
                else:
                    registry=evidence.read(output/'resources.json');registry[changed]={'profile_id':lifecycle.BASELINE_PROFILE,'project':'signoz1566-'+'f'*12,'nonce':'f'*32}[changed];lifecycle.private_json(output/'resources.json',registry)
                with patch.object(runtime,'verify_source'),patch.object(runtime,'stop_worker') as stop,patch.object(runtime,'engine') as engine,patch.object(component,'component_engine') as current,patch.object(runtime,'recover') as delegated,patch.object(lifecycle,'acquire_image') as acquire:
                    with self.assertRaises((ValueError,lifecycle.Refusal,OSError)):component.recover(output)
                    stop.assert_not_called();engine.assert_not_called();current.assert_not_called();delegated.assert_not_called();acquire.assert_not_called()
        for primitive in (None,False,0,1.5,'private-receipt',[],[1]):
            for entry in ('recover','cleanup_worker'):
                with self.subTest(receipt=type(primitive).__name__,entry=entry),tempfile.TemporaryDirectory() as tmp:
                    output=Path(tmp).resolve();collection_fixture(output)
                    source=evidence.read(output/'source.json');value=evidence.read(output/'component-request.json')
                    lifecycle.private_json(output/'resources.json',primitive)
                    lifecycle.private_json(output/'component-cleaner.json',{'pid':12345,'group':12345,'start_ticks':'owned'})
                    with patch.object(runtime,'require_native_host'),patch.object(runtime,'verify_source'),patch.object(component,'registered_phase',return_value=(source,value,time.monotonic()+90)),patch.object(component,'require_opt_in',side_effect=AssertionError('cleanup must ignore marker')),patch.object(runtime,'stop_worker') as stop,patch.object(runtime,'engine') as engine,patch.object(component,'component_engine') as current,patch.object(runtime,'recover',return_value={'passed':True}) as delegated,patch.object(lifecycle,'acquire_image') as acquire:
                        with self.assertRaises((ValueError,lifecycle.Refusal,OSError)):
                            component.recover(output) if entry=='recover' else component.worker(output,'cleanup')
                        stop.assert_not_called();engine.assert_not_called();current.assert_not_called();delegated.assert_not_called();acquire.assert_not_called()
        for state in ('partial','absent'):
            with self.subTest(valid=state),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp).resolve();collection_fixture(output)
                cleaner={'pid':12345,'group':12345,'start_ticks':'owned'};lifecycle.private_json(output/'component-cleaner.json',cleaner)
                if state=='absent':(output/'resources.json').unlink()
                else:
                    registry=copy.deepcopy(evidence.read(output/'resources.json'))
                    registry['containers']={'disk':registry['containers']['disk']};registry['created']={'disk':registry['created']['disk']}
                    registry['volumes']={next(iter(registry['volumes'])):next(iter(registry['volumes'].values()))};registry['networks']={}
                    lifecycle.private_json(output/'resources.json',registry)
                with patch.object(runtime,'verify_source'),patch.object(runtime,'stop_worker') as stop,patch.object(runtime,'recover',return_value={'passed':True}) as delegated,patch.object(component,'require_opt_in',side_effect=AssertionError('cleanup must ignore marker')):
                    self.assertTrue(component.recover(output)['passed'])
                    stop.assert_called_once_with(cleaner);delegated.assert_called_once_with(output,None,profile_id=component.PROFILE)
