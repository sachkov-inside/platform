"""Private CI seams: admission cannot borrow partial or stale prerequisite evidence."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import representative_ci as bridge


class Gates(unittest.TestCase):
    def test_each_missing_non_success_or_different_source_prerequisite_refuses(self):
        valid={'D7_PROTOCOL_RESULT':'success','D7_MINIMAL_RESULT':'success','D7_MINIMAL_SHA':'a'*40,'GITHUB_SHA':'a'*40}
        with patch.dict(os.environ,valid,clear=True):bridge.require_prerequisites()
        for key in valid:
            for bad in ('','failure','cancelled','skipped','b'*40):
                with self.subTest(key=key,bad=bad),patch.dict(os.environ,{**valid,key:bad},clear=True),self.assertRaises(ValueError):
                    bridge.require_prerequisites()

    def test_fixed_runner_descendants_and_no_symlink_authority(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'RUNNER_TEMP':str(Path(directory).resolve())}):
            paths=bridge.paths()
            self.assertEqual(paths.prepared,Path(directory).resolve()/'representative-d7-private')
            paths.prepared.symlink_to(Path(directory))
            with self.assertRaises(ValueError):bridge.paths()

    def test_protocol_result_refuses_skips_and_incomplete_execution(self):
        class Result:
            testsRun=2;skipped=[];errors=[];failures=[];expectedFailures=[];unexpectedSuccesses=[]
            def wasSuccessful(self):return True
        bridge.require_protocol_result(Result(),2)
        for name,value in (('testsRun',1),('skipped',[1]),('errors',[1]),('failures',[1]),('expectedFailures',[1]),('unexpectedSuccesses',[1])):
            result=Result();setattr(result,name,value)
            with self.subTest(name=name),self.assertRaises(ValueError):bridge.require_protocol_result(result,2)


class PrivateReads(unittest.TestCase):
    def test_private_reader_refuses_links_extra_hardlinks_nonfinite_duplicate_and_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();path=root/'record.json'
            path.write_text('{"ok":true}');path.chmod(0o600)
            self.assertEqual(bridge.read(path),{'ok':True})
            link=root/'link';link.symlink_to(path)
            with self.assertRaises((ValueError,OSError)):bridge.read(link)
            os.link(path,root/'hardlink')
            with self.assertRaises(ValueError):bridge.read(path)
            (root/'hardlink').unlink()
            for raw in ('{"ok":1,"ok":2}','{"ok":NaN}','x'*65537):
                path.write_text(raw)
                with self.assertRaises(ValueError):bridge.read(path)


class HostPreparation(unittest.TestCase):
    def test_original_install_and_peer_commands_precede_both_builds_inside_one_guard(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        calls=[]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();host=root/'host'
            fixed=SimpleNamespace(host=host);host.mkdir(mode=0o700);bridge.write(host/'initial.json',{'source':'a'*40,'filesystems':[{'device':1,'total_bytes':100,'free_bytes':50}]})
            @contextmanager
            def guard(*args):
                calls.append('enter');yield [];calls.append('exit')
            runtime=SimpleNamespace(hosted=SimpleNamespace(command=lambda argv,timeout:calls.append((argv,timeout))))
            with patch.object(bridge,'require_prerequisites'),patch.object(bridge,'admitted',return_value=(None,runtime,{'commit':'a'*40})), \
                    patch.object(bridge,'paths',return_value=fixed),patch.object(bridge,'guards',side_effect=guard), \
                    patch.object(bridge,'measure_filesystems',return_value=[{'device':1,'total_bytes':100,'free_bytes':50}]),patch.object(bridge,'verify_tools',side_effect=lambda:calls.append('tools')),patch.object(bridge.time,'monotonic',return_value=0):
                bridge.host_prepare()
        self.assertEqual(calls,['tools','enter',
            (['timeout','--signal=TERM','--kill-after=10s','4m','pnpm','install','--frozen-lockfile'],250),
            (['pnpm','peers','check'],60),(['pnpm','build:packages'],360),(['pnpm','--filter','@inside/backend','build'],360),'exit'])

    def test_shared_action_preserves_default_and_rejects_open_install_values(self):
        action=(bridge.ROOT/'.github/actions/setup-platform/action.yml').read_text()
        self.assertIn('install:',action)
        self.assertIn('default: "true"',action)
        self.assertIn("inputs.install == 'true'",action)
        self.assertIn("inputs.install != 'true' && inputs.install != 'false'",action)
        self.assertEqual(action.count("if: ${{ inputs.install == 'true' }}"),2)


class Lifecycle(unittest.TestCase):
    def test_distinct_native_filesystems_share_original_4gib_guards_and_numeric_baselines(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        bridge.modules()
        import disk_feedback
        from disk_samples import DiskSamples
        from storage_policy import GIB
        calls=[]
        @contextmanager
        def guard(directory,**kwargs):
            calls.append((str(directory),kwargs));value=DiskSamples();value._baseline(40*GIB)
            try:yield value
            finally:value._seal()
        pilot=SimpleNamespace(shutil=SimpleNamespace(disk_usage=lambda _:SimpleNamespace(total=100*GIB,free=40*GIB)),disk_budget=guard)
        runtime=SimpleNamespace(hosted=SimpleNamespace(runtime=SimpleNamespace(pilot=pilot)))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();(root/'same').mkdir()
            with bridge.guards(runtime,(root,root/'same',root),{'commit':'a'*40}) as rows:self.assertEqual(len(rows),1)
            self.assertEqual(calls,[(str(root),{'growth_bytes':4*GIB,'observe_samples':True})])
            self.assertEqual(rows[0][1].value['baseline']['free_bytes'],40*GIB)
            disk_feedback.validate(rows[0][1].value,'a'*40)

    def test_expired_original_cleanup_tail_never_stops_worker_or_renews_deadline(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();prepared=root/'prepared';prepared.mkdir()
            fixed=SimpleNamespace(prepared=prepared,images=root/'images')
            bindings={'source':{'commit':'a'*40,'tree':'b'*40}}
            value={'schema':1,'bindings':bindings,'images':{},'source':{},'deadline_mono_ns':1}
            bridge.write(prepared/'representative-trial.json',value);bridge.write(prepared/'d7-bindings.json',bindings);bridge.write(fixed.images,{})
            runtime=SimpleNamespace(verify_source=lambda *_:None,lifecycle=SimpleNamespace(MCP512_PROFILE='fixed'),stop_worker=lambda *_:self.fail('expired worker touched'))
            with patch.object(bridge.time,'monotonic',return_value=1000),self.assertRaises(ValueError):bridge._recover_project(SimpleNamespace(PRIVATE_ADMISSION_MAX_BYTES=1048576),runtime,fixed)

    def test_unknown_cleanup_still_retains_images_and_preserves_original_failure(self):
        from types import SimpleNamespace
        first=RuntimeError('original')
        stage=SimpleNamespace(release=lambda *args,**kwargs:self.assertFalse(kwargs['cleanup_ok']) or {'state':'retained','reason':'recovery_required','retired':[]})
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();fixed=SimpleNamespace(prepared=root/'prepared',metadata=root)
            with patch.object(bridge,'_recover_project',side_effect=ValueError('secondary')):
                failure=bridge.retire(None,None,fixed,stage,False,(RuntimeError,first,first.__traceback__))
            self.assertIs(failure[1],first)
            self.assertEqual(bridge.read(root/'d7-retirement.json')['state'],'retained')


class Projection(unittest.TestCase):
    def test_public_directory_exact_six_fresh_files_rejects_extra_size_and_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();values={name:{'available':False} for name in bridge.PUBLIC}
            bridge.publish(root/'good',values)
            self.assertEqual({path.name for path in (root/'good').iterdir()},set(bridge.PUBLIC))
            with self.assertRaises(ValueError):bridge.publish(root/'good',values)
            with self.assertRaises(ValueError):bridge.publish(root/'extra',{**values,'private.json':{}})
            with self.assertRaises(ValueError):bridge.publish(root/'big',{**values,bridge.PUBLIC[0]:{'raw':'x'*65536}})
            with patch.object(bridge,'read',return_value={'sentinel':'PRIVATE'}),self.assertRaises(ValueError):bridge.publish(root/'replaced',values)
            self.assertFalse((root/'replaced').exists())

    def test_unknown_outcome_fields_and_unbounded_command_context_never_publish(self):
        import representative_witness
        valid={'schema':1,'worker_status':0,'cause':{'availability':'unavailable'},'cleanup':dict.fromkeys(('stop','recovery','reap'),'passed')}
        self.assertEqual(bridge.outcome_projection(representative_witness,valid)['worker_status'],0)
        for invalid in ({**valid,'schema':True},{**valid,'argv':['PRIVATE']},{**valid,'worker_status':True},{**valid,'cause':{'availability':'unavailable','secret':'PRIVATE'}}):
            with self.assertRaises(ValueError):bridge.outcome_projection(representative_witness,invalid)


class FunctionalProjection(unittest.TestCase):
    def fixture(self):
        return {'schema':1,'source':{'commit':'a'*40,'tree':'b'*40},
            'control':{'bootstrap':True,'viewer_admin_denied':True,'viewer_revoked_denied':True,'reads':10,
                'sdk':{'sdk_span_semantics':'passed','sdk_metric_semantics':'passed','stored_spans':3,'logical_series':67,
                    'unknown_fields':['metric.exemplars'],'full_privacy':'unknown','original_vm_oracle':'not_applicable',
                    'native_probe_cases':['zero','latest_zero','future']}},
            'agent':{'schema':1,'reads':10,'gateway_denials':4,'direct_ip_denials':11,'alias_kernel_denials':0,'alias_dns_unknown':11},
            'sdk_host_cost':{'wall_seconds':1,'cpu_user_seconds':.1,'cpu_system_seconds':.1,'observed_peak_rss_bytes':1024,'rss_sample_period_seconds':.01,'child_count':1},
            'helper_requests':1,'helper_acknowledged_spans':3,'full_workload':False,'capacity_acceptance':False,'privacy':'unknown',
            'loadgen_isolation':{'direct_ip_denials':11,'alias_kernel_denials':0,'alias_dns_unknown':11},
            'native_known_probe_cases':['zero','latest_zero','future']}

    def test_only_finite_source_bound_functional_facts_and_known_unknown_fields_publish(self):
        import copy
        value=self.fixture();source=value['source'];projection=bridge.functional_projection(value,source)
        self.assertEqual(projection['privacy'],'unknown');self.assertFalse(projection['capacity_acceptance'])
        self.assertNotIn('source',projection)
        for path,bad in ((('schema',),True),(('source','commit'),'c'*40),(('control','sdk','unknown_fields'),['private.sentinel']),
                (('sdk_host_cost','wall_seconds'),float('nan')),(('agent','reads'),True),(('privacy',),'passed')):
            invalid=copy.deepcopy(value);target=invalid
            for key in path[:-1]:target=target[key]
            target[path[-1]]=bad
            with self.subTest(path=path),self.assertRaises(ValueError):bridge.functional_projection(invalid,source)
        with self.assertRaises(ValueError):bridge.functional_projection({**value,'otlp':'PRIVATE'},source)

    def test_collection_read_detects_replaced_file_and_hardlink_added_during_public_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();path=root/'record';bridge.write(path,{'passed':True})
            original=bridge.os.fstat
            def replaced(descriptor):
                info=original(descriptor);other=root/'other';bridge.write(other,{'passed':True});other.replace(path);return info
            with patch.object(bridge.os,'fstat',side_effect=replaced),self.assertRaises(ValueError):bridge.read(path)
            values={name:{} for name in bridge.PUBLIC};original_write=bridge.write
            def linked(path,value):
                original_write(path,value)
                if path.name==bridge.PUBLIC[-1]:os.link(path,root/'private-link')
            with patch.object(bridge,'write',side_effect=linked),self.assertRaises(ValueError):bridge.publish(root/'public',values)


class Workflow(unittest.TestCase):
    def test_private_workflow_uses_closed_discovery_same_sha_and_two_strict_prerequisites(self):
        value=(bridge.ROOT/'.github/workflows/observability-representative-d7.yml').read_text()
        self.assertIn('group: [1, 2, 3, 4, 5]',value)
        self.assertEqual(value.count('ref: ${{ github.sha }}'),3)
        self.assertIn('needs: [all-five, minimal]',value)
        self.assertIn("needs.all-five.result == 'success' && needs.minimal.result == 'success' && needs.minimal.outputs.sha == github.sha",value)
        self.assertEqual(value.count('persist-credentials: false'),3)
        self.assertIn('representative-d7: verify',value)
        self.assertNotIn('workflow_dispatch',value)
        self.assertNotIn('signoz-functional-public',value)
        self.assertIn('path: ${{ runner.temp }}/representative-d7-public',value)
        self.assertIn('if-no-files-found: error',value)
        self.assertIn("always() && steps.collection.outputs.safe == 'true'",value)
        self.assertIn('install: "false"',value)
        self.assertIn('browsers: ""',value)

    def test_default_shared_setup_semantics_are_byte_identical_after_inverse_of_closed_delta(self):
        import hashlib
        baseline_sha256='110e21a760321af418e043fd9bbce364a4f3c8fefcf54e9c9c9064f6ca6f856f'
        value=(bridge.ROOT/'.github/actions/setup-platform/action.yml').read_text()
        value=value.replace('''  install:
    description: Install frozen workspace dependencies and check peers (false only for owned private preparation)
    required: false
    default: "true"
''','',1).replace('''    - name: Validate closed dependency installation choice
      if: ${{ inputs.install != 'true' && inputs.install != 'false' || inputs.install == 'false' && inputs.browsers != '' }}
      shell: bash
      run: exit 1
''','',1).replace("      if: ${{ inputs.install == 'true' }}\n",'')
        self.assertEqual(hashlib.sha256(value.encode()).hexdigest(),baseline_sha256)


class CanonicalPreparation(unittest.TestCase):
    def test_actual_producer_and_mode_once_with_consumer_held_through_coordinate_and_retirement(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        import fullstack
        import prepare
        import preparation
        import hosted
        import representative_witness
        from test_cpu_control import pins,SOURCE,broker_tls_plan_fixture
        calls=[];held=[False];guarded=[False]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();fixed=bridge.Paths(root/'metadata',root/'images.json',root/'prepared',root/'minimal',root/'public',root/'host')
            source={'commit':SOURCE,'tree':SOURCE}
            @contextmanager
            def in_use():
                held[0]=True
                try:yield
                finally:held[0]=False
            @contextmanager
            def guard(*_):
                guarded[0]=True
                try:yield []
                finally:guarded[0]=False
            def require(consumer):self.assertTrue(held[0]);self.assertEqual(consumer,str(fixed.prepared));calls.append('consumer')
            def retire(consumer,**kwargs):
                self.assertTrue(held[0] and guarded[0]);self.assertEqual(kwargs,{'cleanup_ok':True});calls.append('retire')
                return {'state':'retired','reason':'last_consumer_released','retired':['sha256:'+'b'*64]}
            stage=SimpleNamespace(in_use=in_use,require_consumer=require,release=retire,receipt={'daemon':{'storage':str(root)}})
            def command(argv,**kwargs):
                if argv[0]=='git':return SOURCE
                if argv[0]=='bash':return broker_tls_plan_fixture(fixed.prepared,argv,kwargs)
                for role,suffix in [('backend','-backend:v1'),('foundation','-foundation:local'),('web','-web:v1'),('telegram','-telegram:v1'),('logto','-logto:v1')]:
                    if any(arg.endswith(suffix) for arg in argv):return pins()[role]
                raise AssertionError('unexpected native boundary')
            def coordinate(prepared,bindings,images):
                self.assertTrue(held[0] and guarded[0]);self.assertEqual(images,pins());calls.append('coordinate')
                layout,_=representative_witness.owners._canonical(prepared,bindings,images,admit=True)
                self.assertEqual((len(layout.manifest['roles']),len(layout.manifest['volumes']),len(layout.manifest['networks'])),(38,11,10))
                return {'cleanup':True}
            runtime=representative_witness._native_runtime()
            with patch.object(bridge,'require_prerequisites'),patch.object(bridge,'admitted',return_value=(representative_witness,runtime,source)), \
                    patch.object(bridge,'paths',return_value=fixed),patch.object(bridge,'guards',side_effect=guard),patch.object(bridge,'require_host_preparation'),patch.object(bridge,'measure_filesystems',return_value=[{'device':1,'total_bytes':100,'free_bytes':50}]), \
                    patch.object(hosted,'admission',side_effect=lambda path:path.mkdir(mode=0o700)), \
                    patch.object(hosted,'metadata_source',return_value=({}, {'ready':True})), \
                    patch.object(prepare,'prepare_representative',side_effect=lambda *_:bridge.write(fixed.images,pins())), \
                    patch.object(preparation,'recover_stage',return_value=stage), \
                    patch.object(fullstack.pilot,'command',side_effect=command),patch.object(fullstack.pilot,'assert_docker_identity'), \
                    patch.object(fullstack.pilot,'install_horizon'), \
                    patch.object(fullstack,'inputs',wraps=fullstack.inputs) as constructor, \
                    patch.object(fullstack,'mode',wraps=fullstack.mode) as mode, \
                    patch.object(runtime.lifecycle,'histogram_asset') as histogram, \
                    patch.object(representative_witness,'coordinate',side_effect=coordinate) as coordinator:
                bridge.prepare_trial()
                constructor.assert_called_once_with(fixed.prepared,fixed.images)
                mode.assert_called_once_with(fixed.prepared,True)
                self.assertEqual(histogram.call_count,1);self.assertTrue(histogram.call_args.kwargs['acquire'])
                self.assertEqual(coordinator.call_count,1)
            self.assertEqual(calls,['consumer','coordinate','retire']);self.assertFalse(held[0]);self.assertFalse(guarded[0])


class HostReadiness(unittest.TestCase):
    def test_missing_failed_or_wrong_source_host_build_cannot_reach_image_acquisition(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();host=root/'host';host.mkdir(mode=0o700)
            fixed=SimpleNamespace(host=host)
            with self.assertRaises(FileNotFoundError):bridge.require_host_preparation(fixed,'a'*40)
            for commit,passed,stage in (('b'*40,True,'backend'),('a'*40,False,'backend'),('a'*40,True,'packages')):
                path=host/'preparation.json';bridge.write(path,{'source':commit,'passed':passed,'stage':stage,'filesystems':[],'checkpoints':[]})
                with self.assertRaises(ValueError):bridge.require_host_preparation(fixed,'a'*40)
                path.unlink()


class RecoveryAuthority(unittest.TestCase):
    def test_registered_worker_without_registry_is_unknown_cleanup_and_cannot_release_images(self):
        from types import SimpleNamespace
        calls=[]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();prepared=root/'prepared';prepared.mkdir(mode=0o700)
            fixed=SimpleNamespace(prepared=prepared,images=root/'images')
            bindings={'source':{'commit':'a'*40,'tree':'b'*40}};worker={'pid':1234,'group':1234,'start_ticks':'1'}
            value={'schema':1,'bindings':bindings,'images':{},'source':{},'deadline_mono_ns':100*10**9}
            bridge.write(prepared/'representative-trial.json',value);bridge.write(prepared/'d7-bindings.json',bindings);bridge.write(fixed.images,{})
            witness=SimpleNamespace(PRIVATE_ADMISSION_MAX_BYTES=1048576,owners=SimpleNamespace(_worker=lambda _:worker))
            runtime=SimpleNamespace(verify_source=lambda *_:None,lifecycle=SimpleNamespace(MCP512_PROFILE='fixed'),stop_worker=lambda value:calls.append(value))
            with patch.object(bridge.time,'monotonic',return_value=100):self.assertFalse(bridge._recover_project(witness,runtime,fixed))
            self.assertEqual(calls,[worker])

    def test_canonical_registry_worker_mismatch_refuses_before_stopping_any_birth(self):
        import representative_witness
        from test_representative_owner import Engine,BINDINGS,owners
        from test_cpu_control import assemble,pins
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();prepared,_=assemble(root,'prepared',control=False)
            engine=Engine();owners.CompositeOwner.prepare(engine,prepared,BINDINGS,pins())
            registry=bridge.read(prepared/'representative-owner/resources.json',1048576)
            fixed=SimpleNamespace(prepared=prepared,images=root/'images.json')
            bridge.write(prepared/'d7-bindings.json',BINDINGS)
            bridge.write(prepared/'worker.json',{'pid':1234,'group':1234,'start_ticks':'1'})
            bridge.write(prepared/'representative-trial.json',{'schema':1,'source':{},'bindings':BINDINGS,'images':pins(),'deadline_mono_ns':registry['deadline_mono_ns']})
            runtime=SimpleNamespace(verify_source=lambda *_:None,lifecycle=SimpleNamespace(MCP512_PROFILE='fixed'),stop_worker=lambda *_:self.fail('foreign worker stopped'))
            with self.assertRaises(ValueError):bridge._recover_project(representative_witness,runtime,fixed)
