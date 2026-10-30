"""Primary endpoint context remains numerical and separate from capacity acceptance."""
from contextlib import ExitStack, nullcontext
import copy
import json
import hashlib
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import fullstack
import stability


class PrimaryContext(unittest.TestCase):
    def test_actual_aggregate_context_adds_reaped_children_with_its_own_clock_bracket(self):
        with tempfile.TemporaryDirectory() as directory:
            proc=Path(directory);(proc/'pressure').mkdir()
            (proc/'stat').write_text('cpu 1 2 3 4 5 6 7 8 9 10\nctxt 42\nprocs_running 3\nprocs_blocked 1\n')
            (proc/'pressure/cpu').write_text('some avg10=1 total=75\n')
            context=stability.context
            def usage(who):
                return SimpleNamespace(ru_utime=1 if who==stability.resource.RUSAGE_SELF else 3,ru_stime=2,ru_maxrss=8)
            with patch.object(stability,'context',side_effect=lambda:context(proc)),patch.object(stability.resource,'getrusage',side_effect=usage) as calls,patch.object(stability.os,'cpu_count',return_value=4),patch.object(stability.os,'sysconf',return_value=100),patch.object(stability.sys,'platform','linux'),patch.object(stability.time,'monotonic',side_effect=[10,11,12,13]),patch.object(stability.time,'time',return_value=100):
                leaf=stability.primary_context('baseline')
            self.assertEqual(leaf,{'schema':1,'boundary':'baseline','anchor':[10000,100000,13000],
                'values':{'logical_cpus':4,'cpu_total_ticks':36,'clock_ticks_per_second':100,'steal_ticks':8,'runqueue':3,'blocked':1,
                    'context_switches':42,'cpu_some_total_us':75,'process_cpu_seconds':3,'process_max_rss_bytes':8192,'capture_elapsed_ms':1000},
                'children_cpu_seconds':5})
            self.assertEqual([args.args[0] for args in calls.call_args_list],[stability.resource.RUSAGE_SELF,stability.resource.RUSAGE_CHILDREN])
            self.assertLessEqual(len(json.dumps(leaf).encode()),2048)
            self.assertIs(stability.validate_primary_context(leaf,'baseline'),leaf)


    def phase_fixture(self,output,*,scope='technical',diagnostic=None,capture_error=None,context_error=None,phase_call=None):
        events=[];original=[];hosts=[];tick=[0]
        def monotonic():
            events.append('monotonic');tick[0]+=1;return tick[0]
        def epoch():events.append('epoch');return 100
        def capture(_):
            events.append('counter')
            if capture_error is not None:raise capture_error
            value={'at_seconds':monotonic(),'services':{'loadgen':{'cpu_periods':1,'cpu_throttled_periods':0,'cpu_throttled_ns':0}},'errors':{}}
            original.append(value);return value
        def host():
            events.append('host');value={'unchanged':1};hosts.append(value);return value
        class Stop:
            stopped=False
            def is_set(self):return self.stopped
            def set(self):self.stopped=True
            def wait(self,_):self.stopped=True
        class Worker:
            def __init__(self,target):self.target=target
            def start(self):self.target()
            def join(self,**_):pass
            def is_alive(self):return False
        owned={'loadgen':{'id':'fixed','oom':False,'restarts':0}}
        def context():
            events.append('context')
            if context_error is not None:raise context_error
            return dict.fromkeys(stability.CONTEXT)
        def usage(_):events.append('children');return SimpleNamespace(ru_utime=3,ru_stime=2)
        if not (output/'fullstack-source.json').exists():
            (output/'fullstack-source.json').write_text(json.dumps({'scope_binding':{'nonce':'a'*64}}))
        with ExitStack() as patches:
            for target,name,options in (
                (fullstack,'prepared_scope',{'return_value':scope}),
                (fullstack.technical,'owned',{'return_value':owned}),
                (fullstack.technical,'capture',{'side_effect':capture}),
                (fullstack,'host',{'side_effect':host}),
                (fullstack.time,'monotonic',{'side_effect':monotonic}),
                (fullstack.time,'time',{'side_effect':epoch}),
                (fullstack.threading,'Event',{'side_effect':Stop}),
                (fullstack.threading,'Thread',{'side_effect':Worker}),
                (stability,'context',{'side_effect':context}),
                (stability.resource,'getrusage',{'side_effect':usage}),
                (fullstack.storage,'observe',{'return_value':{}}),
                (fullstack,'invoke',{'return_value':json.dumps({'telegram_acknowledged':0,'completed':True})}),
                (stability,'invoke_client',{'return_value':{'telegram_acknowledged':0,'completed':True}}),
                (fullstack.pilot,'await_fact',{'return_value':True})):
                patches.enter_context(patch.object(target,name,**options))
            value=(fullstack.phase if phase_call is None else phase_call)([],'owned',{'name':'spike','seconds':10,'requests_per_second':40},('loadgen',),False,0,output,diagnostic_ordinal=diagnostic)
        return value,events,original,hosts

    def test_primary_only_endpoints_follow_unchanged_counter_reads_and_sampler_has_no_context(self):
        with tempfile.TemporaryDirectory() as directory:
            value,events,original,hosts=self.phase_fixture(Path(directory))
        samples=value['samples'];self.assertEqual(len(samples),3)
        self.assertEqual([row.get('primary_host_context',{}).get('boundary') for row in samples],['baseline',None,'final'])
        counter=['monotonic','epoch','counter','monotonic','host','monotonic']
        context=['monotonic','epoch','context','children','monotonic']
        self.assertEqual(events,counter+context+['monotonic']+counter+counter+context)
        self.assertEqual([row['counter_clock_anchor'] for row in samples],[[1000,100000,3000],[7000,100000,9000],[10000,100000,12000]])
        self.assertEqual(samples[0]['primary_host_context']['anchor'],[4000,100000,5000])
        self.assertEqual(samples[-1]['primary_host_context']['anchor'],[13000,100000,14000])
        for row,counters,host in zip(samples,original,hosts):
            self.assertIs(row['counters'],counters);self.assertIs(row['host'],host)
        self.assertEqual(value['errors'],[])

    def test_full_and_optional_diagnostic_keep_their_old_context_schema(self):
        for scope,diagnostic in (('full',None),('technical',1),('full',1)):
            with self.subTest(scope=scope,diagnostic=diagnostic),tempfile.TemporaryDirectory() as directory:
                value,events,_,_=self.phase_fixture(Path(directory),scope=scope,diagnostic=diagnostic)
            self.assertTrue(all('primary_host_context' not in row for row in value['samples']))
            self.assertEqual(events.count('context'),0 if diagnostic is None else 3)
            self.assertEqual(events.count('children'),0)
            self.assertEqual(all('diagnostic_context' in row for row in value['samples']),diagnostic is not None)

    def test_primary_counter_error_precedes_context_and_is_not_replaced(self):
        failure=RuntimeError('counter-primary-error')
        with tempfile.TemporaryDirectory() as directory,patch.object(stability,'primary_context',side_effect=AssertionError('context before counter')) as context:
            with self.assertRaises(RuntimeError) as caught:self.phase_fixture(Path(directory),capture_error=failure)
            self.assertIs(caught.exception,failure);context.assert_not_called()


    def prepared_fixture(self,base):
        output=base/'owned';output.mkdir();metadata=base/'metadata';metadata.mkdir()
        settings=fullstack.profile('technical');source='a'*40
        binding={'scope':'technical','source':source,'nonce':'a'*64,'output_sha256':fullstack.stage_timing.output_binding(output),
            'profile':settings['name'],'services':list(fullstack.services('technical')),'databases':['inside','logto','inside_telegram']}
        fullstack.pilot.write_json(output/'fullstack-source.json',{'scope':'technical','source':source,'scope_binding':binding,
            'profile':settings,'images':{'scope':'technical','source':source}})
        fullstack.pilot.write_json(output/'compose.json',{'services':dict.fromkeys(binding['services'],{}),'volumes':dict.fromkeys(fullstack.storage.VOLUMES,{})})
        fullstack.pilot.write_json(output/'selected-profile.json',settings)
        monitor=output/'monitoring';monitor.mkdir();(monitor/'owner-overview').mkdir()
        path=Path(fullstack.production.__file__)
        fullstack.pilot.write_json(monitor/'inputs.json',{'scope':'technical','inputs':{str(path.relative_to(fullstack.ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()}})
        fullstack.pilot.write_json(monitor/'owner-overview/dashboard.json',{'panels':[panel for panel in fullstack.production.dashboard(scope='technical')['dashboard']['panels'] if panel['id']==201]})
        fullstack.pilot.write_json(output/'evidence.json',{'source':source})
        fullstack.pilot.write_json(metadata/'source.json',{'checkout_sha':source})
        fullstack.pilot.write_json(metadata/'admission.json',{'ready':True})
        self.assertEqual(fullstack.prepared_scope(output,expected='technical',source=source),'technical')
        return output,metadata,binding

    def persisted_fixture(self,base):
        from test_technical_scope import TechnicalScope
        output,metadata,binding=self.prepared_fixture(base)
        captured,_,_,_=self.phase_fixture(output)
        row=TechnicalScope().technical_report()['phases'][0]
        row.update(samples=captured['samples'],scope_binding=binding)
        row['load']['slot_refusal']={'schema':1,'state':'not_refused'}
        fullstack.pilot.write_json(output/'fullstack-phase-0.json',row)
        return output,metadata,row

    def test_collector_refuses_partial_endpoint_before_any_public_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);output,metadata,row=self.persisted_fixture(base)
            del row['samples'][-1]['primary_host_context']
            fullstack.pilot.write_json(output/'fullstack-phase-0.json',row)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})):
                with self.assertRaisesRegex(ValueError,'closed_primary_host_context'):
                    fullstack.collect(output,metadata,base/'public',scope='technical')
            self.assertFalse((base/'public').exists())


    def test_unavailable_context_and_children_are_unknown_without_private_errors_or_control_loss(self):
        for fault in ('context','children','clock','partial'):
            with self.subTest(fault=fault),ExitStack() as patches:
                values={key:1 for key in stability.CONTEXT}
                if fault=='partial':values.update(steal_ticks='private-sentinel',logical_cpus=True,runqueue=1.5,process_cpu_seconds=float('inf'))
                patches.enter_context(patch.object(stability,'context',side_effect=OSError('private-sentinel') if fault=='context' else None,return_value=values))
                patches.enter_context(patch.object(stability.resource,'getrusage',side_effect=OSError('private-sentinel') if fault=='children' else None,return_value=SimpleNamespace(ru_utime=2,ru_stime=3)))
                patches.enter_context(patch.object(stability.time,'monotonic',return_value=10))
                patches.enter_context(patch.object(stability.time,'time',side_effect=OSError('private-sentinel') if fault=='clock' else None,return_value=100))
                leaf=stability.primary_context('final')
                stability.validate_primary_context(leaf,'final')
                self.assertNotIn('private-sentinel',json.dumps(leaf))
                if fault=='context':self.assertEqual(leaf['values'],dict.fromkeys(stability.CONTEXT))
                if fault=='children':self.assertIsNone(leaf['children_cpu_seconds'])
                if fault=='clock':self.assertIsNone(leaf['anchor'])
                if fault=='partial':
                    for key in ('steal_ticks','logical_cpus','runqueue','process_cpu_seconds'):self.assertIsNone(leaf['values'][key])
                    self.assertEqual(leaf['values']['blocked'],1)
        for target,name in ((stability,'context'),(stability.resource,'getrusage'),(stability.time,'monotonic')):
            for control in (KeyboardInterrupt(),SystemExit(7)):
                with self.subTest(target=name,control=type(control).__name__),patch.object(target,name,side_effect=control):
                    with self.assertRaises(type(control)) as caught:stability.primary_context('baseline')
                    self.assertIs(caught.exception,control)
        original=stability.context
        with tempfile.TemporaryDirectory() as directory,patch.object(stability,'context',side_effect=lambda:original(Path(directory))):
            leaf=stability.primary_context('baseline')
            self.assertIsNone(leaf['values']['steal_ticks']);self.assertIsNone(leaf['values']['cpu_some_total_us'])
            self.assertIsNotNone(leaf['values']['process_cpu_seconds'])

    def test_closed_schema_rejects_non_numeric_fractional_extra_and_unbounded_values(self):
        leaf={'schema':1,'boundary':'baseline','anchor':[1,100,2],'values':dict.fromkeys(stability.CONTEXT),'children_cpu_seconds':None}
        bads=[]
        for key,value in (('schema',True),('schema',1.0),('boundary','private-sentinel'),('anchor',[2,100,1]),('anchor',[1,100,True]),
                          ('anchor',[1,2]),('children_cpu_seconds','private-sentinel'),('children_cpu_seconds',float('nan'))):
            bads.append({**leaf,key:value})
        bads.extend(({**leaf,'extra':'private-sentinel'},{**leaf,'values':{**leaf['values'],'extra':1}}))
        for key in stability.CONTEXT:
            for value in (True,-1,2**53,10**1000,float('inf'),float('nan'),'private-sentinel'):
                bads.append({**leaf,'values':{**leaf['values'],key:value}})
        for key in stability.PRIMARY_CONTEXT_INTEGERS:
            bads.append({**leaf,'values':{**leaf['values'],key:1.5}})
        for index,bad in enumerate(bads):
            with self.subTest(case=index),self.assertRaisesRegex(ValueError,'closed_primary_host_context'):
                stability.validate_primary_context(bad,'baseline')
        maximum={**leaf,'values':{key:2**53-1 for key in stability.CONTEXT},'children_cpu_seconds':2**53-1,'anchor':[2**53-1]*3}
        self.assertIs(stability.validate_primary_context(maximum,'baseline'),maximum)
        self.assertLess(len(json.dumps(maximum,indent=2).encode()),2048)
        self.assertLess(sum(len(json.dumps({'primary_host_context':item},indent=2).encode()) for item in (maximum,{**maximum,'boundary':'final'})),4096)

    def test_actual_persistence_and_public_collector_keep_endpoints_and_read_legacy_as_unknown(self):
        for legacy in (False,True):
            with self.subTest(legacy=legacy),tempfile.TemporaryDirectory() as directory:
                base=Path(directory);output,metadata,row=self.persisted_fixture(base)
                if legacy:
                    for sample in row['samples']:sample.pop('primary_host_context',None)
                    fullstack.pilot.write_json(output/'fullstack-phase-0.json',row)
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})):
                    fullstack.collect(output,metadata,base/'public',scope='technical')
                copied=stability.read_json(base/'public/fullstack-phase-0.json')
                self.assertEqual(copied,row)
                endpoints=stability.primary_endpoints(copied['samples'])
                if legacy:self.assertIsNone(endpoints)
                else:self.assertEqual([leaf['boundary'] for leaf in endpoints],['baseline','final'])
                self.assertNotIn('private-sentinel',(base/'public/fullstack-phase-0.json').read_text())

    def test_malformed_extra_and_duplicate_endpoints_and_oversized_raw_refuse_before_publication(self):
        for fault in ('partial','middle','duplicate','null','extra','fraction','schema','oversized','duplicate_json','invalid_utf8'):
            with self.subTest(fault=fault),tempfile.TemporaryDirectory() as directory:
                base=Path(directory);output,metadata,row=self.persisted_fixture(base);samples=row['samples']
                if fault=='partial':del samples[0]['primary_host_context']
                if fault=='middle':samples[1]['primary_host_context']=copy.deepcopy(samples[0]['primary_host_context'])
                if fault=='duplicate':samples[-1]['primary_host_context']['boundary']='baseline'
                if fault=='null':samples[0]['primary_host_context']=None
                if fault=='extra':samples[0]['primary_host_context']['extra']='private-sentinel'
                if fault=='fraction':samples[0]['primary_host_context']['values']['steal_ticks']=.5
                if fault=='schema':samples[0]['primary_host_context']['schema']=True
                path=output/'fullstack-phase-0.json';fullstack.pilot.write_json(path,row)
                if fault=='oversized':path.write_text(path.read_text()+' '*stability.MAX_BYTES)
                if fault=='duplicate_json':path.write_text(path.read_text().replace('"schema": 1','"schema": 1, "schema": 1',1))
                if fault=='invalid_utf8':path.write_bytes(path.read_bytes()+b'\xff')
                with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})),patch.object(fullstack.resource_runtime.ci,'collect',wraps=fullstack.resource_runtime.ci.collect) as collect:
                    with self.assertRaises((ValueError,UnicodeError)):fullstack.collect(output,metadata,base/'public',scope='technical')
                    collect.assert_not_called()
                self.assertFalse((base/'public').exists())

    def test_actual_worker_writes_24_endpoints_across_12_phases_then_removes_samples_from_summary(self):
        from test_technical_scope import TechnicalScope
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);output,metadata,binding=self.prepared_fixture(base)
            fullstack.pilot.write_json(output/'owner.json',{'supervisor_pid':os.getppid(),'project':'owned'})
            rows=iter(TechnicalScope().technical_report()['phases']);calls=[];actual_phase=fullstack.phase
            def phase(*args,**options):
                captured,_,_,_=self.phase_fixture(output,phase_call=actual_phase)
                row=next(rows);row.update(samples=captured['samples'],scope_binding=binding,errors=[],source_cache_samples=[])
                row['load'].update(slot_refusal={'schema':1,'state':'not_refused'},query_seconds=[1])
                calls.append((args[4],args[5],args[2]['name']));return row
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'mode'),patch.object(fullstack,'invoke',return_value='{}'),patch.object(fullstack,'seed',return_value={}),patch.object(fullstack,'configure_mode',return_value=fullstack.services('technical')),patch.object(fullstack,'phase',side_effect=phase),patch.object(fullstack,'await_collector'),patch.object(fullstack,'evaluate',return_value={'state':'fixture_nonacceptance'}):
                with self.assertRaisesRegex(ValueError,'fullstack_resource_acceptance_failed'):fullstack.worker(output)
            self.assertEqual(calls,[(mode=='on',pair,definition['name']) for pair,modes in enumerate(fullstack.profile('technical')['pairs']) for mode in modes for definition in fullstack.profile('technical')['phases']])
            summary=stability.read_json(output/'fullstack-proof.json');self.assertEqual(len(summary['phases']),12)
            self.assertNotIn('primary_host_context',json.dumps(summary))
            self.assertTrue(all('samples' not in row for row in summary['phases']))
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})):
                fullstack.collect(output,metadata,base/'public',scope='technical')
            endpoints=[leaf for index in range(12) for leaf in stability.primary_endpoints(stability.read_json(base/f'public/fullstack-phase-{index}.json')['samples'])]
            self.assertEqual(len(endpoints),24)
            self.assertEqual(summary['measured_linux_acceptance'],{'state':'fixture_nonacceptance'})


    def test_24_snapshots_use_48_aggregate_reads_48_rusage_calls_and_120_clock_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            proc=Path(directory);(proc/'pressure').mkdir()
            (proc/'stat').write_text('cpu 1 2 3 4 5 6 7 8\nctxt 42\nprocs_running 3\nprocs_blocked 1\n')
            (proc/'pressure/cpu').write_text('some avg10=1 total=75\n')
            original_context=stability.context;original_read=Path.read_text
            with patch.object(stability,'context',side_effect=lambda:original_context(proc)),patch.object(Path,'read_text',autospec=True,side_effect=original_read) as reads,patch.object(stability.resource,'getrusage',return_value=SimpleNamespace(ru_utime=1,ru_stime=2,ru_maxrss=8)) as usage,patch.object(stability.time,'monotonic',return_value=10) as monotonic,patch.object(stability.time,'time',return_value=100) as epoch,patch.object(stability.os,'cpu_count',return_value=4),patch.object(stability.os,'sysconf',return_value=100):
                leaves=[stability.primary_context(boundary) for _ in range(12) for boundary in ('baseline','final')]
            self.assertEqual(len(leaves),24);self.assertEqual(reads.call_count,48);self.assertEqual(usage.call_count,48)
            self.assertEqual(monotonic.call_count,96);self.assertEqual(epoch.call_count,24)
            self.assertEqual({call.args[0] for call in reads.call_args_list},{proc/'stat',proc/'pressure/cpu'})
            self.assertEqual([call.args[0] for call in usage.call_args_list],[stability.resource.RUSAGE_SELF,stability.resource.RUSAGE_CHILDREN]*24)

    def test_existing_source_gate_includes_both_owners_and_rejects_changed_hashes(self):
        import binding
        ci=fullstack.resource_runtime.ci;hosted=fullstack.hosted
        commit=ci.read_command(['git','-C',str(fullstack.ROOT),'rev-parse','HEAD'])
        tree=ci.read_command(['git','-C',str(fullstack.ROOT),'rev-parse','HEAD^{tree}'])
        bound=binding.source(commit,tree)
        owners=('scripts/observability-fullstack/fullstack.py','scripts/observability-fullstack/stability.py')
        for name in owners:self.assertEqual(bound['inputs'][name],hashlib.sha256((fullstack.ROOT/name).read_bytes()).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            metadata=Path(directory)
            source={'checkout_sha':commit,'checkout_tree':tree,'repository':hosted.REPOSITORY,'run_id':'1','run_attempt':'1',
                'event':'pull_request','provider_execution_sha':commit,'provider_pr_head_sha':commit,'provider_pr_base_sha':commit,
                'inputs':bound['inputs'],'scope':hosted.SCOPE}
            fullstack.pilot.write_json(metadata/'source.json',source)
            fullstack.pilot.write_json(metadata/'admission.json',{'ready':False,'error_type':'OSError'})
            self.assertEqual(hosted.metadata_source(metadata)[0],source)
            for name in owners:
                bad=copy.deepcopy(source);bad['inputs'][name]='0'*64;fullstack.pilot.write_json(metadata/'source.json',bad)
                with self.subTest(owner=name),self.assertRaisesRegex(ValueError,'resource_source_inputs_changed'):hosted.metadata_source(metadata)


    def test_primary_context_unavailability_keeps_load_and_phase_errors_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            value,_,_,_=self.phase_fixture(Path(directory),context_error=OSError('private-sentinel'))
        self.assertTrue(value['load']['completed']);self.assertEqual(value['errors'],[])
        for leaf in stability.primary_endpoints(value['samples']):
            self.assertEqual(leaf['values'],dict.fromkeys(stability.CONTEXT));self.assertEqual(leaf['children_cpu_seconds'],5)
        self.assertNotIn('private-sentinel',json.dumps(value))

    def test_interrupted_unpublished_phase_stays_incomplete_and_collector_does_not_invent_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);output,metadata,_=self.prepared_fixture(base)
            fullstack.pilot.write_json(output/'owner.json',{'supervisor_pid':os.getppid(),'project':'owned'})
            control=KeyboardInterrupt()
            with patch.object(fullstack.sys,'platform','linux'),patch.object(fullstack.pilot,'command',return_value='a'*40),patch.object(fullstack.pilot,'worker_storage_guard',return_value=nullcontext()),patch.object(fullstack,'mode'),patch.object(fullstack,'invoke',return_value='{}'),patch.object(fullstack,'seed',return_value={}),patch.object(fullstack,'configure_mode',return_value=fullstack.services('technical')),patch.object(fullstack,'phase',side_effect=control):
                with self.assertRaises(KeyboardInterrupt) as caught:fullstack.worker(output)
                self.assertIs(caught.exception,control)
            with patch.object(fullstack.hosted,'metadata_source',return_value=({'checkout_sha':'a'*40},{})):
                fullstack.collect(output,metadata,base/'public',scope='technical')
            summary=stability.read_json(base/'public/fullstack-proof.json')
            self.assertEqual(summary['phases'],[]);self.assertEqual(summary['state'],'failed')
            self.assertEqual(summary['measured_linux_acceptance'],{'state':'incomplete'})
            self.assertFalse(list((base/'public').glob('fullstack-phase-*.json')))


if __name__=='__main__':unittest.main()
