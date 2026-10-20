"""Actual worker/Core ownership refusals; command-boundary JSON only, no Docker/network."""
from contextlib import ExitStack, nullcontext
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import caddy_storage
import evidence
import overlay
import owned
import pilot
import runtime_identity
import source_status_scenario as core
from test_runtime_identity import GATEWAY
from test_source_status_scenario import FakePilot


class Runtime:
    def __init__(self,directory):
        self.output=Path(directory).resolve()/'private';overlay.prepare(self.output)
        self.fake=FakePilot(self.output);self.fake.plan=overlay.plan(self.output)
        self.commands=[];self.change=None
        self.owner={'project':self.fake.compose[3],'cwd':str(pilot.ROOT),'supervisor_pid':os.getppid(),
                    'docker_storage':{},'orbstack':{},'daemon':{},'cleanup':{}}

    def read(self,argv,**_):
        self.commands.append(argv)
        if argv[-2:] in (['config','--quiet'],['up','-d']):return ''
        if argv[:4]==['docker','inspect','--format',runtime_identity.INSPECT]:
            role=next(role for role,cid in self.fake.ids.items() if cid==argv[-1])
            service=self.fake.plan['services'][role];ports={}
            for value in service.get('ports',[]):
                host,source,target=value.split(':');ports[target+'/tcp']=[{'HostIp':host,'HostPort':source}]
            value={**GATEWAY,'logging':service['logging']['driver'],'ports':ports,
                   'cap_add':['CAP_NET_BIND_SERVICE'] if role=='gateway' else None,'user':service.get('user','')}
            result=json.dumps(value)
            return self.change(argv,result) if self.change is not None else result
        if argv[:2]==['docker','exec'] and self.change is not None:return self.change(argv,'')
        result=self.fake.command(argv)
        if self.change is not None:return self.change(argv,result)
        return result

    def fail_worker(self,case,extra=()):
        with ExitStack() as stack:
            for context in (patch.object(caddy_storage.native_fault,'owner',return_value=self.owner),
                patch.object(pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(pilot,'install_plugin'),
                patch.object(pilot,'assert_docker_identity'),patch.object(pilot,'command',side_effect=self.read),*extra):stack.enter_context(context)
            try:caddy_storage.worker(self.output)
            except BaseException as error:caught=error
            else:case.fail('controlled ownership failure unexpectedly passed')
        return caught,json.loads((self.output/'caddy-run.json').read_text())


class OwnershipDiagnostics(unittest.TestCase):
    def test_actual_worker_reports_fixed_role_and_image_guard_without_image_value(self):
        for role in core.CORE_ROLES:
            with self.subTest(role=role),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory)
                def change(argv,result):
                    if argv[:4]==['docker','inspect','--format',core.INSPECT] and argv[-1]==runtime.fake.ids[role]:
                        value=json.loads(result);value['image']='private-controlled-image';return json.dumps(value)
                    return result
                runtime.change=change
                error,run=runtime.fail_worker(self)
                self.assertIs(type(error),core.ScenarioFailed)
                self.assertEqual(run['phase'],'ownership_'+role+'_inspect_image')
                self.assertEqual(run['reason'],'contract')
                self.assertEqual(set(run['cases'].values()),{'unrun'})
                self.assertNotIn('private-controlled',json.dumps(run))
                self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_unknown_ownership_exception_subclasses_are_not_reclassified_or_inspected(self):
        class ForeignTimeout(TimeoutError):
            @property
            def reason(self):raise AssertionError('foreign property inspected')
            def __str__(self):raise AssertionError('foreign exception string inspected')
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);original=ForeignTimeout('private-controlled-error')
            def change(argv,result):raise original
            runtime.change=change
            error,run=runtime.fail_worker(self)
            self.assertIs(error,original)
            self.assertEqual(run['phase'],'ownership_metrics_lookup_read')
            self.assertEqual(run['reason'],'unknown')
            self.assertNotIn('private-controlled',json.dumps(run))

    def test_all_139_literal_role_gate_phases_reach_the_actual_owning_boundary(self):
        expected_roles=('metrics','logs','traces','alloy','vmauth','gateway','grafana')
        expected_gates=('lookup_read','lookup_empty','lookup_id','lookup_duplicate','inspect_read','inspect_decode',
            'inspect_shape','inspect_id','inspect_image','inspect_project','inspect_service','inspect_config',
            'inspect_mount_plan','inspect_mount_shape','inspect_mount_set','inspect_network_set','inspect_network_ids',
            'runtime_read','runtime_contract')
        expected={'ownership_'+role+'_'+gate for role in expected_roles for gate in expected_gates}
        expected.update('ownership_'+gate for gate in ('plan','registry_shape','registry_networks',
            'registry_volumes','registry_network_count','witness'))
        observed=set()
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory)
            targets=owned.Targets(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read,
                ownership_checkpoint=lambda role,gate:observed.add(evidence.ownership_phase(role,gate)))
            before=observed.copy();targets.check('metrics');self.assertEqual(observed,before)
            self.assertIsNone(targets._ownership_observer)
        for role in expected_roles:
            for value,gate in (('','lookup_empty'),('private-controlled-id','lookup_id')):
                with self.subTest(role=role,gate=gate),tempfile.TemporaryDirectory() as directory:
                    runtime=Runtime(directory)
                    def change(argv,result):
                        return value if argv==runtime.fake.compose+['ps','-q',role] else result
                    runtime.change=change
                    _,run=runtime.fail_worker(self);observed.add(run['phase'])
                    self.assertEqual(run['phase'],'ownership_'+role+'_'+gate)
                    self.assertEqual(run['reason'],'contract')
        self.assertEqual(observed,expected)
        self.assertEqual(len(observed),139)
        self.assertEqual(set(evidence.OWNERSHIP_PHASES),expected)
        for phase in expected:
            run=evidence.Run();run.start(phase);run.fail('contract');record=evidence.validate(run.snapshot())
            self.assertEqual(set(record),{'schema','scope','state','phase','reason','cases'})
            self.assertLess(len(json.dumps(record).encode()),8192)
            self.assertLess(len(phase.encode()),64)
        for role,gate in (('private-controlled-role','inspect_image'),('metrics','private-controlled-gate'),
                          (None,'inspect_image'),('metrics','witness'),(1,'lookup_read'),('metrics',{})):
            with self.subTest(role_type=type(role).__name__,gate_type=type(gate).__name__),self.assertRaises(ValueError):
                evidence.ownership_phase(role,gate)

    def test_actual_inspect_guards_keep_role_and_complete_raw_validation(self):
        mutations=(('inspect_decode',lambda item:'{"private-controlled":1,"private-controlled":2}'),
            ('inspect_shape',lambda item:{key:value for key,value in item.items() if key!='id'}),
            ('inspect_id',lambda item:{**item,'id':'f'*64}),
            ('inspect_project',lambda item:{**item,'project':'private-controlled-project'}),
            ('inspect_service',lambda item:{**item,'service':'private-controlled-role'}),
            ('inspect_config',lambda item:{**item,'config_files':'private-controlled-path'}),
            ('inspect_shape',lambda item:{**item,'mounts':None}),
            ('inspect_mount_shape',lambda item:{**item,'mounts':[{**item['mounts'][0],'RW':'private-controlled'}]}),
            ('inspect_mount_set',lambda item:{**item,'mounts':[]}),
            ('inspect_network_set',lambda item:{**item,'networks':{}}),
            ('inspect_network_ids',lambda item:{**item,'networks':{key:{'NetworkID':'private-controlled'} for key in item['networks']}}))
        for role in core.CORE_ROLES:
            for gate,mutate in mutations:
                with self.subTest(role=role,gate=gate),tempfile.TemporaryDirectory() as directory:
                    runtime=Runtime(directory)
                    def change(argv,result):
                        if argv[:4]==['docker','inspect','--format',core.INSPECT] and argv[-1]==runtime.fake.ids[role]:
                            value=mutate(json.loads(result));return value if type(value) is str else json.dumps(value)
                        return result
                    runtime.change=change;error,run=runtime.fail_worker(self)
                    self.assertIs(type(error),core.ScenarioFailed)
                    self.assertEqual(error.args,('source freshness scenario failed; raw diagnostics withheld',))
                    self.assertEqual(error.reason,'ownership')
                    self.assertEqual(run['phase'],'ownership_'+role+'_'+gate)
                    self.assertEqual(run['reason'],'contract')
                    self.assertNotIn('private-controlled',json.dumps(run))
                    self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_default_core_matches_frozen_owner_commands_short_circuit_and_exceptions(self):
        import runpy
        baseline=runpy.run_path(str(Path(__file__).with_name('fixtures')/'core_ownership_f578.py'))['OwnedTargets']
        actual_decode=core.source_status.decode_json
        fields=('id','image','project','service','config_files','mounts','networks')
        cases=('valid','wrong_id_and_image','wrong_image_and_mounts','wrong_config_and_mounts',
               'invalid_mounts_and_networks','missing_tmpfs_destination','invalid_rw_and_type','decode_duplicate') + tuple(
                   'pair:'+first+':'+second for index,first in enumerate(fields) for second in fields[index+1:])
        for case in cases:
            outcomes=[]
            for owner_type in (baseline,core.OwnedTargets):
                with tempfile.TemporaryDirectory() as directory:
                    runtime=Runtime(directory);access=[]
                    def change(argv,result):
                        if argv[:4]!=['docker','inspect','--format',core.INSPECT] or argv[-1]!=runtime.fake.ids['metrics']:return result
                        item=json.loads(result)
                        if case.startswith('pair:'):
                            for field in case.split(':')[1:]:item[field]=None if field in ('mounts','networks') else 'private-controlled'
                        elif case=='wrong_id_and_image':item.update(id='private-controlled',image='private-controlled')
                        elif case=='wrong_image_and_mounts':item.update(image='private-controlled',mounts=None)
                        elif case=='wrong_config_and_mounts':item.update(config_files='private-controlled',mounts=None)
                        elif case=='invalid_mounts_and_networks':item.update(mounts=None,networks=[])
                        elif case=='missing_tmpfs_destination':item['mounts']=[{'Type':'tmpfs','RW':False}]
                        elif case=='invalid_rw_and_type':item['mounts']=[{'Type':'invalid','RW':'private-controlled'}]
                        elif case=='decode_duplicate':return '{"id":1,"id":2}'
                        return json.dumps(item)
                    runtime.change=change
                    class Access(dict):
                        def __getitem__(self,key):
                            access.append(key);return super().__getitem__(key)
                    def instrument(raw):
                        value=actual_decode(raw)
                        if type(value) is dict:
                            if type(value.get('mounts')) is list:value['mounts']=[Access(m) for m in value['mounts']]
                            return Access(value)
                        return value
                    with patch.object(core.source_status,'decode_json',side_effect=instrument):
                        try:targets=owner_type(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read)
                        except BaseException as error:outcome=(type(error),error.args,getattr(error,'reason',None))
                        else:
                            targets.check('metrics')
                            outcome=('valid',json.loads((runtime.output/'source-freshness-owned.json').read_text()))
                    commands=[[part.replace(str(runtime.output),'OWN_OUTPUT') for part in argv] for argv in runtime.commands]
                    outcomes.append((outcome,commands,access))
            with self.subTest(case=case):self.assertEqual(outcomes[0],outcomes[1])

    def test_owned_read_failures_preserve_identity_and_exact_type_categories(self):
        originals=(subprocess.CalledProcessError(1,['private-controlled-command'],stderr='private-controlled-detail'),
            FileNotFoundError('private-controlled-path'),PermissionError('private-controlled-path'),OSError('private-controlled-error'),
            TimeoutError('private-controlled-error'),subprocess.TimeoutExpired(['private-controlled-command'],10),
            RuntimeError('private-controlled-error'),KeyboardInterrupt())
        for original in originals:
            with self.subTest(error_type=type(original).__name__),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory)
                def change(argv,result):raise original
                runtime.change=change;error,run=runtime.fail_worker(self)
                self.assertIs(error,original)
                expected='timeout' if type(original) in (TimeoutError,subprocess.TimeoutExpired) else 'interrupted' if type(original) is KeyboardInterrupt else 'unknown' if type(original) is RuntimeError else 'transport'
                self.assertEqual(run['reason'],expected)
                self.assertEqual(run['phase'],'ownership_metrics_lookup_read')
                self.assertNotIn('private-controlled',json.dumps(run))

    def test_plan_and_witness_io_are_distinct_and_keep_the_actual_exception(self):
        actual_plan=overlay.plan;actual_write=Path.write_text
        for gate in ('plan','witness'):
            with self.subTest(gate=gate),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);calls=0;original=PermissionError('private-controlled-detail')
                def plan(output):
                    nonlocal calls
                    calls+=1
                    if gate=='plan' and calls==2:raise original
                    return actual_plan(output)
                def write(path,*args,**kwargs):
                    if gate=='witness' and path.name=='source-freshness-owned.json':raise original
                    return actual_write(path,*args,**kwargs)
                error,run=runtime.fail_worker(self,(patch.object(overlay,'plan',side_effect=plan),patch.object(Path,'write_text',write)))
                self.assertIs(error,original);self.assertEqual(run['phase'],'ownership_'+gate)
                self.assertEqual(run['reason'],'transport')
                self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_runtime_reads_and_whole_authority_checks_keep_the_source_role(self):
        for role in core.CORE_ROLES:
            for gate in ('runtime_read','runtime_contract'):
                with self.subTest(role=role,gate=gate),tempfile.TemporaryDirectory() as directory:
                    runtime=Runtime(directory);original=subprocess.CalledProcessError(1,['private-controlled'])
                    def change(argv,result):
                        if gate=='runtime_read' and argv==runtime.fake.compose+['ps','--all','-q',role]:raise original
                        if gate=='runtime_contract' and argv[:4]==['docker','inspect','--format',runtime_identity.INSPECT] and argv[-1]==runtime.fake.ids[role]:
                            value=json.loads(result);value['logging']='none' if value['logging']!='none' else 'json-file';return json.dumps(value)
                        return result
                    runtime.change=change;error,run=runtime.fail_worker(self)
                    self.assertEqual(run['phase'],'ownership_'+role+'_'+gate)
                    self.assertEqual(run['reason'],'transport' if gate=='runtime_read' else 'contract')
                    if gate=='runtime_read':self.assertIs(error,original)
                    self.assertEqual(set(run['cases'].values()),{'unrun'})
                    self.assertTrue((runtime.output/'source-freshness-owned.json').exists())

    def test_registry_counts_consistency_and_constructor_shape_stay_closed(self):
        for gate in ('registry_shape','registry_networks','registry_volumes','registry_network_count'):
            with self.subTest(gate=gate),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);observed=[]
                if gate=='registry_shape':runtime.fake.plan['volumes']['private-controlled']={}
                elif gate=='registry_volumes':runtime.fake.plan['services']['metrics']['volumes']=['logs:/data']
                elif gate=='registry_network_count':
                    for service in runtime.fake.plan['services'].values():service['networks']=['pilot']
                else:
                    def change(argv,result):
                        if argv[:4]==['docker','inspect','--format',core.INSPECT] and argv[-1]==runtime.fake.ids['logs']:
                            value=json.loads(result);value['networks'][runtime.fake.compose[3]+'_pilot']['NetworkID']='d'*64;return json.dumps(value)
                        return result
                    runtime.change=change
                with self.assertRaises(core.ScenarioFailed) as caught:
                    core.OwnedTargets(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read,
                        ownership_checkpoint=lambda role,stage:observed.append(evidence.ownership_phase(role,stage)))
                self.assertEqual(observed[-1],'ownership_'+gate)
                self.assertEqual(caught.exception.args,('source freshness scenario failed; raw diagnostics withheld',))
                self.assertEqual(caught.exception.reason,'ownership')
                self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_terminal_persistence_refusal_preserves_primary_identity_and_traceback(self):
        import traceback
        actual_write=caddy_storage.artifact.write_run
        for primary in (RuntimeError('private-controlled-primary'),KeyboardInterrupt()):
            with self.subTest(primary_type=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);secondary=PermissionError('private-controlled-secondary')
                def raise_original(argv,result):raise primary
                runtime.change=raise_original
                def write(output,run):
                    if run['state'] in ('failed','interrupted'):raise secondary
                    return actual_write(output,run)
                error,run=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=write),))
                self.assertIs(error,primary)
                self.assertIn('raise_original',[frame.name for frame in traceback.extract_tb(error.__traceback__)])
                self.assertNotIn('write',[frame.name for frame in traceback.extract_tb(error.__traceback__)])
                self.assertEqual(run['state'],'incomplete')
                self.assertEqual(set(run['cases'].values()),{'unrun'})

    def test_marker_persistence_refusal_prevents_the_blocking_lookup(self):
        actual_write=caddy_storage.artifact.write_run
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);original=PermissionError('private-controlled-marker')
            def write(output,run):
                if run['phase']=='ownership_metrics_lookup_read':raise original
                return actual_write(output,run)
            error,run=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=write),))
            self.assertIs(error,original)
            self.assertNotIn(runtime.fake.compose+['ps','-q','metrics'],runtime.commands)
            self.assertEqual(set(run['cases'].values()),{'unrun'})
            self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_predicate_markers_are_memory_only_and_stop_after_initial_registration(self):
        actual_write=caddy_storage.artifact.write_run
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);written=[];original=RuntimeError('controlled native boundary not acquired')
            def change(argv,result):
                if argv[:2]==['docker','exec']:raise original
                return result
            runtime.change=change
            def write(output,run):
                written.append((run['phase'],run['state'],run['cases']['logging']));return actual_write(output,run)
            error,run=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=write),))
            self.assertIs(error,original);self.assertEqual(run['phase'],'identity')
            self.assertEqual(run['cases']['logging'],'passed');self.assertEqual(run['cases']['identity'],'unrun')
            self.assertTrue((runtime.output/'source-freshness-owned.json').exists())
            ownership=[phase for phase,state,logging in written if phase in evidence.OWNERSHIP_PHASES and logging=='unrun']
            self.assertEqual([phase for phase,state,logging in written if phase in evidence.OWNERSHIP_PHASES and logging=='passed'],['ownership_grafana_runtime_contract'])
            allowed={'ownership_plan','ownership_witness'}|{'ownership_'+role+'_'+gate for role in core.CORE_ROLES for gate in ('lookup_read','inspect_read','runtime_read')}
            self.assertEqual(set(ownership),allowed)
            self.assertEqual(len(ownership),24)  # Two real plan reads, three reads per role, one witness write.

    def test_public_phase_decoder_refuses_invalid_present_or_hostile_values(self):
        import artifact
        class Hostile(str):
            def __str__(self):raise AssertionError('foreign string conversion')
            def __eq__(self,other):raise AssertionError('foreign equality')
        for role,gate in ((Hostile('metrics'),'lookup_read'),('metrics',Hostile('lookup_read'))):
            with self.assertRaises(ValueError):evidence.ownership_phase(role,gate)
        run=evidence.Run();run.start('ownership_gateway_inspect_mount_set');run.fail('contract');first=run.snapshot()
        for phase in evidence.OWNERSHIP_PHASES:run.start(phase);run.fail('unknown')
        self.assertEqual(run.snapshot(),first)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();root.chmod(0o700)
            for raw in (json.dumps({**first,'phase':'private-controlled'}),json.dumps({**first,'role':'gateway'}),
                        json.dumps(first).replace('"schema": 1','"schema":1,"schema":1'),
                        json.dumps(first).replace('"schema": 1','"schema":NaN'),json.dumps(first)+' '*8193):
                (root/'caddy-run.json').write_text(raw)
                with self.assertRaises(ValueError):artifact.read_run(root)

    def test_missing_registration_witness_still_refuses_typed_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory)
            runtime.change=lambda argv,result:'' if argv==runtime.fake.compose+['ps','-q','metrics'] else result
            _,run=runtime.fail_worker(self)
            (runtime.output/'owner.json').write_text(json.dumps(runtime.owner))
            (runtime.output/'cleanup.json').write_text(json.dumps({'diagnostics':'passed','down':'passed','residue':'passed'}))
            with self.assertRaisesRegex(RuntimeError,'Caddy typed resource absence unproved'):caddy_storage.verify_cleanup(runtime.output)
            self.assertEqual(run['phase'],'ownership_metrics_lookup_empty')
            self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_duplicate_lookup_is_refused_before_any_inspection_of_the_reused_id(self):
        for role in core.CORE_ROLES[1:]:
            with self.subTest(role=role),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory)
                runtime.change=lambda argv,result:runtime.fake.ids['metrics'] if argv==runtime.fake.compose+['ps','-q',role] else result
                _,run=runtime.fail_worker(self)
                self.assertEqual(run['phase'],'ownership_'+role+'_lookup_duplicate')
                self.assertEqual(run['reason'],'contract')
                reads=[argv for argv in runtime.commands if argv[:4]==['docker','inspect','--format',core.INSPECT] and argv[-1]==runtime.fake.ids['metrics']]
                self.assertEqual(len(reads),1)
                self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_malformed_expected_mount_plan_is_classified_at_its_owning_guard(self):
        import copy
        for role in core.CORE_ROLES:
            with self.subTest(role=role),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);plan=copy.deepcopy(runtime.fake.plan);plan['services'][role]['volumes']=['private-controlled']
                stages=[]
                with self.assertRaises(core.ScenarioFailed):
                    core.OwnedTargets(runtime.output,runtime.fake.compose,plan,runtime.read,
                        ownership_checkpoint=lambda source_role,gate:stages.append(evidence.ownership_phase(source_role,gate)))
                self.assertEqual(stages[-1],'ownership_'+role+'_inspect_mount_plan')
                self.assertFalse((runtime.output/'source-freshness-owned.json').exists())

    def test_default_none_preserves_direct_foreign_role_inspect_and_check_contracts(self):
        import runpy
        baseline=runpy.run_path(str(Path(__file__).with_name('fixtures')/'core_ownership_f578.py'))['OwnedTargets']
        foreign_error=RuntimeError('controlled foreign role evaluation')
        class ForeignRole:
            def __hash__(self):raise foreign_error
            def __eq__(self,other):raise foreign_error
            def __str__(self):raise AssertionError('foreign role string inspected')
        for role in ('metrics','private-controlled-role',None,1,[],{},ForeignRole()):
            for method in ('inspect','check'):
                outcomes=[]
                for owner_type in (baseline,core.OwnedTargets):
                    with tempfile.TemporaryDirectory() as directory:
                        runtime=Runtime(directory)
                        targets=owner_type(runtime.output,runtime.fake.compose,runtime.fake.plan,runtime.read)
                        runtime.commands=[]
                        try:
                            result=targets.inspect(role,runtime.fake.ids['metrics']) if method=='inspect' else targets.check(role)
                        except BaseException as error:
                            outcome=(type(error),error.args,error.reason if type(error) is core.ScenarioFailed else None)
                            if type(role) is ForeignRole:self.assertIs(error,foreign_error)
                        else:outcome=('valid',result)
                        commands=[[part.replace(str(runtime.output),'OWN_OUTPUT') for part in argv] for argv in runtime.commands]
                        outcomes.append((outcome,commands))
                with self.subTest(role_type=type(role).__name__,method=method):self.assertEqual(outcomes[0],outcomes[1])

    def test_inspect_checkpoint_refusal_preserves_callback_exception_before_docker_read(self):
        actual_write=caddy_storage.artifact.write_run
        for original in (ValueError('closed Caddy artifact refused'),KeyError('controlled callback'),
                         TypeError('controlled callback'),AttributeError('controlled callback')):
            with self.subTest(error_type=type(original).__name__),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory)
                def write(output,run):
                    if run['phase']=='ownership_metrics_inspect_read':raise original
                    return actual_write(output,run)
                error,run=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=write),))
                self.assertIs(error,original)
                self.assertFalse(any(argv[:4]==['docker','inspect','--format',core.INSPECT] for argv in runtime.commands))
                self.assertEqual(set(run['cases'].values()),{'unrun'})

    def test_terminal_rethrow_of_same_exception_cannot_append_secondary_traceback(self):
        import traceback
        actual_write=caddy_storage.artifact.write_run
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);primary=RuntimeError('controlled primary')
            def raise_original(argv,result):raise primary
            runtime.change=raise_original
            def terminal_write(output,run):
                if run['state']=='failed':raise primary
                return actual_write(output,run)
            error,_=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=terminal_write),))
            self.assertIs(error,primary)
            names=[frame.name for frame in traceback.extract_tb(error.__traceback__)]
            self.assertIn('raise_original',names)
            self.assertNotIn('terminal_write',names)

    def test_traceback_restore_uses_original_object_without_foreign_getter_or_override(self):
        import sys
        class Foreign(RuntimeError):
            @property
            def __traceback__(self):raise AssertionError('foreign traceback getter')
            def with_traceback(self,tb):raise AssertionError('foreign traceback override')
        actual_write=caddy_storage.artifact.write_run
        with tempfile.TemporaryDirectory() as directory:
            runtime=Runtime(directory);primary=Foreign('private-controlled-primary');original=[]
            def raise_original(argv,result):raise primary
            runtime.change=raise_original
            def terminal_write(output,run):
                if run['state']=='failed':
                    original.append(sys.exc_info()[2]);raise primary
                return actual_write(output,run)
            error,run=runtime.fail_worker(self,(patch.object(caddy_storage.artifact,'write_run',side_effect=terminal_write),))
            self.assertIs(error,primary);self.assertEqual(len(original),1)
            caught_tb=BaseException.__traceback__.__get__(error)
            self.assertIs(caught_tb.tb_next,original[0])
            self.assertNotIn('private-controlled',json.dumps(run))

    def test_wrong_private_live_user_refuses_without_publishing_identity(self):
        for role in ('alloy','gateway','vmauth'):
            with self.subTest(role=role),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory)
                def change(argv,result):
                    if argv[:4]==['docker','inspect','--format',runtime_identity.INSPECT] and argv[-1]==runtime.fake.ids[role]:
                        value=json.loads(result);value['user']='private-user-canary';return json.dumps(value)
                    return result
                runtime.change=change
                error,run=runtime.fail_worker(self)
                self.assertIs(type(error),ValueError)
                self.assertEqual(run['phase'],'ownership_'+role+'_runtime_contract')
                self.assertEqual(set(run['cases'].values()),{'unrun'})
                self.assertNotIn('private-user',json.dumps(run))
                self.assertFalse(any(argv[:2]==['docker','exec'] for argv in runtime.commands))
