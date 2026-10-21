"""Owning snapshot cap classification only, never native cap-cause evidence."""
import json
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import caddy_storage
import artifact
import evidence
import scenario
from test_ownership_diagnostics import Runtime


class AcquisitionBudget(unittest.TestCase):
    def test_actual_snapshot_128_and_129_refuse_before_any_acquisition_work(self):
        for count in (128,129):
            with self.subTest(count=count):
                run=evidence.Run();run.start('partition')
                def progress(kind,value):
                    self.assertEqual(kind,'failure');run.fail(value)
                experiment=scenario.Scenario(None,'owned_token',None,progress);experiment.acquisitions=count
                with patch.object(scenario.time,'time',side_effect=AssertionError('clock entered')), \
                     patch.object(scenario.time,'monotonic',side_effect=AssertionError('deadline entered')), \
                     patch.object(scenario.time,'sleep',side_effect=AssertionError('wait entered')), \
                     patch.object(scenario.caddy_query,'read_snapshot',side_effect=AssertionError('query entered')), \
                     patch.object(experiment.journal,'record',side_effect=AssertionError('journal entered')):
                    try:experiment.snapshot({'completed_at':1})
                    except RuntimeError as error:experiment.failed(error)
                    else:self.fail('cap admitted an acquisition')
                self.assertEqual(run.snapshot()['reason'],'budget')
                self.assertEqual(experiment.acquisitions,count)

    def test_127_performs_one_query_then_refuses_next_without_more_work(self):
        experiment=scenario.Scenario(None,'owned_token',None,Mock());experiment.acquisitions=127
        report={'state':'observed','transport':{'canonical':'passed'}};acquired={'owned':'fixture'}
        with patch.object(scenario.caddy_query,'read_snapshot',return_value=(report,acquired)) as query, \
             patch.object(scenario.time,'time',side_effect=(10,11)) as clock, \
             patch.object(experiment.journal,'record') as journal:
            self.assertEqual(experiment.snapshot(),(report,acquired))
            self.assertEqual(experiment.acquisitions,128)
            with self.assertRaises(scenario.AcquisitionBudgetRefusal) as caught:experiment.snapshot()
            self.assertIsInstance(caught.exception,RuntimeError)
            self.assertEqual(str(caught.exception),'closed Caddy acquisition cap')
            query.assert_called_once_with('owned_token',previous=None,deadline_seconds=unittest.mock.ANY)
            journal.assert_called_once_with(10,11,'GET',200,count=2)
            self.assertEqual(clock.call_count,2)

        # Real partition predicates, canonical decoding and the actual 127->128 cap.
        from test_observation import acquisition
        def acquired(point,stamp,down=False):
            values,stamps=acquisition(point=point,stamp=stamp)
            if down:values['data']['result'][0]['value'][1]='0'
            return {'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),
                    'evaluated_at':point,'completed_at':point+1}
        for name in ('initial_acquire','initial_state','initial_after_cut','initial_boundary',
                     'compare_acquire','compare_state','compare_journal','compare_after_cut'):
            with self.subTest(partition=name):
                run=evidence.Run();events=[]
                def progress(kind,value):
                    events.append((kind,value))
                    if kind in ('phase','partition_checkpoint'):run.start(value)
                    elif kind=='case':run.pass_case(value)
                    elif kind=='failure':run.fail(value)
                    else:self.fail('unexpected progress kind')
                experiment=scenario.Scenario(Mock(), 'owned_token',None,progress);experiment.deadline=600
                initial=name.startswith('initial_')
                experiment.acquisitions=128 if name=='initial_acquire' else 127 if initial or name=='compare_acquire' else 126
                fixtures=[acquired(100,99,down=name=='initial_state')]
                if not initial and name!='compare_acquire':
                    fixtures.append(acquired(102,102 if name=='compare_journal' else 101,down=name=='compare_state'))
                def query(_,previous,deadline_seconds):
                    current=fixtures.pop(0)
                    report=scenario.status.evaluate(**current,previous=previous)
                    self.assertNotEqual(report['state'],'malformed')
                    report['transport']['canonical']='passed'
                    return report,current
                wall=99 if name=='initial_boundary' else 102 if name=='compare_journal' else 110
                def perform(case,_):
                    method,code=scenario.traffic.CASES[case]
                    return {'started':wall,'completed':wall,'method':method,'code':200 if type(code) is tuple else code}
                with patch.object(scenario.caddy_query,'read_snapshot',side_effect=query) as reads, \
                     patch.object(scenario.traffic,'perform',side_effect=perform), \
                     patch.object(scenario.time,'time',return_value=wall) as clock, \
                     patch.object(scenario.time,'monotonic',return_value=0), \
                     patch.object(scenario.time,'sleep'), \
                     patch.object(experiment,'stamp',wraps=experiment.stamp) as stamp, \
                     patch.object(experiment.journal,'boundary_clear',wraps=experiment.journal.boundary_clear) as boundary, \
                     patch.object(experiment.journal,'verify',wraps=experiment.journal.verify) as verify:
                    try:experiment.partition(99 if name=='initial_after_cut' else 98)
                    except scenario.AcquisitionBudgetRefusal as error:
                        experiment.failed(error)
                        self.assertEqual(str(error),'closed Caddy acquisition cap')
                        tb=error.__traceback__
                        while tb.tb_next is not None:tb=tb.tb_next
                        self.assertEqual(tb.tb_frame.f_code.co_name,'snapshot')
                    else:self.fail('partition cap unexpectedly passed')
                expected_reads=0 if name=='initial_acquire' else 1 if initial or name=='compare_acquire' else 2
                self.assertEqual(reads.call_count,expected_reads)
                self.assertEqual(clock.call_count,2*expected_reads+(0 if initial or name=='compare_acquire' else 1))
                self.assertEqual(stamp.call_count,0 if name in ('initial_acquire','initial_state') else 1 if name=='initial_after_cut' else 3 if name=='compare_after_cut' else 2)
                self.assertEqual(boundary.call_count,0 if name in ('initial_acquire','initial_state','initial_after_cut') else 1)
                self.assertEqual(verify.call_count,1 if name in ('compare_journal','compare_after_cut') else 0)
                self.assertEqual((run.snapshot()['phase'],run.snapshot()['reason']),('partition_'+name,'budget'))
                if name=='initial_state':
                    self.assertIsNotNone(experiment.last_report)
                    self.assertEqual(experiment.last_report['state'],'down')
                    self.assertEqual(experiment.last_report['transport'],{'canonical':'passed','mcp':'unrun'})
                    self.assertIsNone(experiment.last_report['observation'])
                    self.assertIsNone(experiment.last_report['comparison'])
                else:self.assertIsNone(experiment.last_report)
                before=run.snapshot();experiment.phase('reset');experiment.failed(SystemExit('private-canary'))
                self.assertEqual(run.snapshot(),before)
                self.assertNotIn('private-canary',json.dumps(before))
        # Default callers retain the original predicate order/two stamps and emit no checkpoint.
        progress=Mock();experiment=scenario.Scenario(None,'owned_token',None,progress)
        current=acquired(100,99)
        report=scenario.status.evaluate(**current);report['transport']['canonical']='passed'
        with patch.object(scenario.caddy_query,'read_snapshot',return_value=(report,current)) as reads, \
             patch.object(scenario.time,'time',return_value=110), \
             patch.object(experiment,'stamp',wraps=experiment.stamp) as stamp:
            self.assertEqual(experiment.fresh_after(98),(report,current))
        self.assertEqual(stamp.call_count,2);self.assertEqual(reads.call_count,1);progress.assert_not_called()

        # Two real rejected statuses are remembered; a later observed acquisition still follows normal matching.
        experiment=scenario.Scenario(None,'owned_token',None,Mock());experiment.deadline=600
        down=acquired(100,99,down=True);stale=acquired(140,99);fresh=acquired(142,141)
        fixtures=[down,stale,fresh];expected=[]
        def read(_,previous,deadline_seconds):
            current=fixtures.pop(0);report=scenario.status.evaluate(**current,previous=previous)
            report['transport']['canonical']='passed';expected.append(report)
            if len(expected)==2:self.assertEqual(experiment.last_report,expected[0])
            return report,current
        with patch.object(scenario.caddy_query,'read_snapshot',side_effect=read) as reads, \
             patch.object(scenario.time,'time',return_value=150), \
             patch.object(scenario.time,'monotonic',return_value=0),patch.object(scenario.time,'sleep'):
            report,current=experiment.fresh_after(98,_partition=True)
        self.assertEqual([value['state'] for value in expected],['down','stale','observed'])
        self.assertEqual(experiment.last_report,expected[1]);self.assertEqual(reads.call_count,3)
        self.assertEqual((report,current),(expected[2],fresh))
        mcp=scenario.status.evaluate(**fresh);mcp['transport']['mcp']='passed'
        with patch.object(scenario.mcp_snapshot,'read_snapshot',return_value=(mcp,fresh)) as matching:
            self.assertEqual(experiment.matching(fresh),fresh)
        matching.assert_called_once_with(None,'owned_token',evaluated_at=142,previous=None,progress=unittest.mock.ANY)
        self.assertEqual(experiment.last_report['state'],'observed')
        self.assertEqual(experiment.last_report['transport'],{'canonical':'passed','mcp':'passed'})

    def test_classification_never_reads_foreign_metadata_or_matches_text(self):
        class Foreign(RuntimeError):
            def __getattribute__(self,name):raise AssertionError('foreign attribute inspected')
            def __str__(self):raise AssertionError('foreign string inspected')
            def __repr__(self):raise AssertionError('foreign repr inspected')
        class OwnSubclass(scenario.AcquisitionBudgetRefusal):pass
        class Spoof:
            @property
            def __class__(self):raise AssertionError('foreign class inspected')
            def __getattribute__(self,name):raise AssertionError('foreign object inspected')
        class Timeout(TimeoutError):pass
        class Contract(ValueError):pass
        class Interrupted(KeyboardInterrupt):pass
        for error in (RuntimeError('closed Caddy acquisition cap'),RuntimeError('different'),
                      Foreign('private-canary'),OwnSubclass(),Spoof(),SystemExit(1),
                      subprocess.CalledProcessError(1,['private-canary']),OSError('private-canary')):
            self.assertEqual(scenario.failure_reason(error),'unknown')
        for error,reason in ((scenario.AcquisitionBudgetRefusal(),'budget'),(Timeout(),'timeout'),
                             (Contract(),'contract'),(Interrupted(),'interrupted')):
            self.assertEqual(scenario.failure_reason(error),reason)

    def test_worker_actual_scenario_cap_preserves_primary_first_failure_and_cleanup(self):
        from contextlib import contextmanager
        for outer_only,secondary in ((False,None),(False,'same'),(False,'different'),(True,None)):
            with self.subTest(outer_only=outer_only,secondary=secondary),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);seen=[];cleaned=[];failed_writes=[]
                original_write=artifact.write_run
                def write(output,value):
                    original_write(output,value)
                    if value['state']=='failed':
                        failed_writes.append(value['reason'])
                        if len(failed_writes)==2 and secondary is not None:
                            if secondary=='same':raise seen[0]
                            raise OSError('private-canary')
                @contextmanager
                def executable(_):
                    try:
                        if outer_only:
                            original=scenario.AcquisitionBudgetRefusal();seen.append(original);raise original
                        yield '/owned-executable'
                    finally:cleaned.append('executable')
                original_failed=scenario.Scenario.failed
                def failed(experiment,error):
                    seen.append(error);original_failed(experiment,error)
                    # Later progress cannot overwrite the first failure phase or reason.
                    if secondary is None:experiment.phase('reset');experiment.progress('failure','unknown')
                def partition(experiment,_):
                    experiment.phase('partition');experiment.acquisitions=128;experiment.snapshot()
                error,record=runtime.fail_worker(self,extra=(
                    patch.object(caddy_storage.owned.Targets,'caddy_identity'),
                    patch.object(caddy_storage.native_fault,'inject'),
                    patch.object(caddy_storage.native_asset,'executable',side_effect=executable),
                    patch.object(artifact,'write_run',side_effect=write),
                    patch.object(scenario.Scenario,'ready',return_value={}),
                    patch.object(scenario.Scenario,'seed',return_value=0),
                    patch.object(scenario.Scenario,'partition',partition),
                    patch.object(scenario.Scenario,'failed',failed)))
                self.assertTrue(seen,(type(error).__name__,record['phase']));self.assertIs(error,seen[0]);self.assertIs(type(error),scenario.AcquisitionBudgetRefusal)
                self.assertEqual(str(error),'closed Caddy acquisition cap')
                self.assertEqual(cleaned,['executable'])
                self.assertEqual((record['state'],record['reason']),('failed','budget'))
                self.assertEqual(record['phase'],'identity' if outer_only else 'partition')
                self.assertEqual({k:v for k,v in record['cases'].items() if v=='passed'},
                                 {'logging':'passed','identity':'passed'})
                self.assertEqual(set(record),{'schema','scope','state','phase','reason','cases'})
                frames=[];tb=error.__traceback__
                while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                self.assertIn('worker',frames)
                self.assertNotIn('write',frames)
                self.assertEqual(frames[-1],'executable' if outer_only else 'snapshot')
                self.assertNotIn('private-canary',json.dumps(record))

        # Actual worker -> Scenario.partition -> failed -> progress -> first persist.
        import sys
        from test_observation import acquisition
        for checkpoint,observation_fault in (('after_cut',None),('state',None),('state','same'),
                ('state','different'),('state','interrupt'),('state','exit'),('state','invalid'),('state','replace'),('state','close')):
            for kind,reason in (('budget','budget'),('interrupt','interrupted'),('exit','unknown')):
                for secondary in ('same','different'):
                    if observation_fault is not None and (kind!='budget' or secondary!='same'):continue
                    with self.subTest(checkpoint=checkpoint,observation_fault=observation_fault,inner_kind=kind,inner_secondary=secondary),tempfile.TemporaryDirectory() as directory:
                        runtime=Runtime(directory);primaries=[];original_tbs=[];writes=[];failed_writes=[];cleaned=[]
                        primary=None if kind=='budget' else KeyboardInterrupt('private-canary') if kind=='interrupt' else SystemExit('private-canary')
                        original_write=artifact.write_run;original_failed=scenario.Scenario.failed
                        original_observation=artifact.write;observations=[]
                        def observation(output,value):
                            observations.append(value)
                            if observation_fault=='same':raise primaries[0]
                            if observation_fault=='different':raise OSError('private-canary')
                            if observation_fault=='interrupt':raise KeyboardInterrupt('private-canary')
                            if observation_fault=='exit':raise SystemExit('private-canary')
                            if observation_fault=='invalid':return original_observation(output,{**value,'private':'private-canary'})
                            if observation_fault=='replace':
                                with patch.object(artifact.os,'replace',side_effect=OSError('private-canary')):
                                    return original_observation(output,value)
                            if observation_fault=='close':
                                actual_close=artifact.os.close
                                def close(fd):actual_close(fd);raise primaries[0]
                                with patch.object(artifact.os,'close',side_effect=close):return original_observation(output,value)
                            return original_observation(output,value)
                        original_init=scenario.Scenario.__init__
                        def initialize(experiment,*args):
                            original_init(experiment,*args);experiment.acquisitions=127;experiment.deadline=600
                        def failed(experiment,error):
                            primaries.append(error);original_tbs.append(sys.exc_info()[2])
                            original_failed(experiment,error)
                        def write(output,value):
                            original_write(output,value);writes.append(value)
                            if value['state'] in ('failed','interrupted'):
                                failed_writes.append(value)
                                # Both inner and outer writes fail; first failure remains latched.
                                if secondary=='same':raise primaries[0]
                                raise OSError('private-canary')
                        @contextmanager
                        def executable(_):
                            try:yield '/owned-executable'
                            finally:cleaned.append('executable')
                        @contextmanager
                        def storage(*_):
                            try:yield
                            finally:cleaned.append('storage')
                        values,stamps=acquisition()
                        if checkpoint=='state':values['data']['result'][0]['value'][1]='0'
                        acquired={'values':json.dumps(values).encode(),'timestamps':json.dumps(stamps).encode(),
                                  'evaluated_at':100,'completed_at':101}
                        report=scenario.status.evaluate(**acquired);report['transport']['canonical']='passed'
                        def perform(case,_):
                            method,code=scenario.traffic.CASES[case]
                            return {'started':110,'completed':110,'method':method,'code':200 if type(code) is tuple else code}
                        def sleep(_):
                            if primary is not None:raise primary
                        error,record=runtime.fail_worker(self,extra=(
                            patch.object(caddy_storage.pilot,'worker_storage_guard',side_effect=storage),
                            patch.object(caddy_storage.owned.Targets,'caddy_identity'),
                            patch.object(caddy_storage.owned.Targets,'change'),
                            patch.object(caddy_storage.native_fault,'inject'),
                            patch.object(caddy_storage.native_asset,'executable',side_effect=executable),
                            patch.object(artifact,'write_run',side_effect=write),
                            patch.object(artifact,'write',side_effect=observation),
                            patch.object(scenario.Scenario,'__init__',initialize),
                            patch.object(scenario.Scenario,'failed',failed),
                            patch.object(scenario.caddy_query,'read_snapshot',return_value=(report,acquired)),
                            patch.object(scenario.traffic,'perform',side_effect=perform),
                            patch.object(scenario.time,'monotonic',return_value=0),
                            patch.object(scenario.time,'time',return_value=110),
                            patch.object(scenario.time,'sleep',side_effect=sleep)))
                        self.assertEqual(len(primaries),1);self.assertIs(error,primaries[0])
                        if primary is not None:self.assertIs(error,primary)
                        else:self.assertIs(type(error),scenario.AcquisitionBudgetRefusal)
                        self.assertEqual(cleaned,['executable','storage'])
                        self.assertEqual((record['phase'],record['reason']),('partition_initial_'+checkpoint,reason))
                        self.assertEqual(record['state'],'interrupted' if kind=='interrupt' else 'failed')
                        self.assertEqual(len(failed_writes),2)
                        self.assertEqual(failed_writes[0],failed_writes[1])
                        self.assertFalse(any(value['state']=='incomplete' and value['phase'].startswith('partition_') for value in writes))
                        self.assertEqual({k for k,v in record['cases'].items() if v=='passed'},
                                         {'logging','identity','http_get','http_post','unauthorized','fallback','body_limit','upstream_error'})
                        tb=BaseException.__traceback__.__get__(error);frames=[]
                        self.assertIs(tb.tb_next,original_tbs[0])
                        while tb is not None:frames.append(tb.tb_frame.f_code.co_name);tb=tb.tb_next
                        self.assertNotIn('write',frames);self.assertNotIn('failed',frames)
                        self.assertEqual(frames[-1],'snapshot' if kind=='budget' else 'sleep')
                        self.assertNotIn('private-canary',json.dumps(record))
                        if checkpoint=='state':
                            self.assertEqual(observations,[report])
                            self.assertEqual(artifact.read(runtime.output),report if observation_fault in (None,'close') else None)
                            self.assertFalse((runtime.output/('.'+artifact.NAME+'.new')).exists())
                        else:
                            self.assertEqual(observations,[])
                            self.assertIsNone(artifact.read(runtime.output))
