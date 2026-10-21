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
