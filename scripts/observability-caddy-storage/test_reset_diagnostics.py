"""Closed reset diagnostics through the actual worker, reset caller and owned lifecycle."""
from contextlib import nullcontext
import http.client
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import caddy_storage
import evidence
import scenario
import source_status_scenario as core
from test_ownership_diagnostics import Runtime


class ResetDiagnostics(unittest.TestCase):
    def test_actual_reset_worker_keeps_error_identity_stage_and_closed_category(self):
        cases=(
            ('load',http.client.RemoteDisconnected('private-canary'),'reset_load','http_eof'),
            ('load',http.client.IncompleteRead(b'private-canary'),'reset_load','http_body'),
            ('load',ConnectionResetError('private-canary'),'reset_load','http_reset'),
            ('old',RuntimeError('private-canary'),'reset_old_fresh','runtime'),
            ('stop_check',core.ScenarioFailed('private-canary'),'reset_stop','authority_refusal'),
            ('stop',subprocess.CalledProcessError(1,['private-canary']),'reset_stop','command_exit'),
            ('start',subprocess.TimeoutExpired(['private-canary'],10),'reset_start','command_timeout'),
            ('ready',http.client.BadStatusLine('private-canary'),'reset_ready','http_status'),
            ('ready',OSError('private-canary'),'reset_ready','host_io'),
            ('open',RuntimeError('private-canary'),'reset_mcp_open','runtime'),
            ('new',RuntimeError('private-canary'),'reset_new_fresh','runtime'),
            ('compare',ValueError('private-canary'),'reset_compare','contract'),
            ('new',KeyboardInterrupt('private-canary'),'reset_new_fresh','interrupted'))
        for stage,primary,phase,reason in cases:
            with self.subTest(stage=stage,kind=type(primary).__name__),tempfile.TemporaryDirectory() as directory:
                runtime=Runtime(directory);fresh=[0];resetting=[False]
                def changed(argv,result):
                    if stage=='stop_check' and resetting[0] and argv[-4:-2]==['ps','--all']:raise primary
                    if argv[:2]==['docker',stage] and stage in ('stop','start'):raise primary
                    return result
                runtime.change=changed
                def perform(*_):
                    if stage=='load':raise primary
                    return {'started':100,'completed':100.01,'method':'GET','code':200}
                def fresh_after(*args,**kwargs):
                    fresh[0]+=1
                    if stage==('old' if fresh[0]==1 else 'new'):raise primary
                    return {'comparison':{'state':'reset_observed'}},{'owned':'private-memory-only'}
                def ready(*_):
                    if stage=='ready':raise primary
                def session(*args,**kwargs):
                    if stage=='open':raise primary
                    return nullcontext(None)
                def matching(*args,**kwargs):
                    if stage=='compare':raise primary
                def reset(experiment):
                    resetting[0]=True
                    return scenario.Scenario.reset(experiment)
                error,record=runtime.fail_worker(self,extra=(
                    patch.object(caddy_storage.owned.Targets,'caddy_identity'),
                    patch.object(caddy_storage.native_fault,'inject'),
                    patch.object(caddy_storage.native_asset,'executable',return_value=nullcontext('/owned')),
                    patch.object(scenario.Scenario,'run',reset),
                    patch.object(scenario.Scenario,'fresh_after',side_effect=fresh_after),
                    patch.object(scenario.Scenario,'ready',side_effect=ready),
                    patch.object(scenario.Scenario,'seed',return_value=101),
                    patch.object(scenario.Scenario,'matching',side_effect=matching),
                    patch.object(scenario.mcp_snapshot,'session',side_effect=session),
                    patch.object(scenario.traffic,'perform',side_effect=perform)))
                self.assertIs(error,primary)
                self.assertEqual((record['phase'],record['reason']),(phase,reason))
                self.assertEqual(record['state'],'interrupted' if reason=='interrupted' else 'failed')
                self.assertEqual(record['cases']['counter_reset'],'unrun')
                self.assertNotIn('private-canary',json.dumps(record))
                self.assertEqual(set(record),{'schema','scope','state','phase','reason','cases'})
                import collection,artifact
                metadata=runtime.output/'metadata';metadata.mkdir(mode=0o700)
                public=runtime.output/'public';collection.collect(runtime.output,metadata,public)
                self.assertEqual(artifact.read_run(public),record)

    def test_optional_reset_markers_preserve_primary_and_restart_before_interrupt(self):
        primary=ValueError('private-primary');secondary=KeyboardInterrupt('private-secondary')
        def interrupted(*_):raise secondary
        experiment=scenario.Scenario(None,'owned_token',None,interrupted)
        experiment._reset_checkpoint('reset_load',_primary=primary)
        with self.assertRaises(KeyboardInterrupt) as caught:experiment._reset_checkpoint('reset_load')
        self.assertIs(caught.exception,secondary)
        # The marker between stop and start cannot leave the successfully stopped
        # owned gateway down, even when an operator interrupts that marker.
        changes=[]
        class Targets:
            def change(self,*args):changes.append(args)
        def progress(kind,value):
            if kind=='reset_checkpoint' and value=='reset_start':raise secondary
        experiment=scenario.Scenario(Targets(),'owned_token',None,progress)
        with patch.object(experiment,'_one',return_value={'completed':100}), \
                patch.object(experiment,'fresh_after',return_value=(None,{})):
            with self.assertRaises(KeyboardInterrupt) as caught:experiment.reset()
        self.assertIs(caught.exception,secondary)
        self.assertEqual(changes,[('gateway','stop'),('gateway','start')])
        # Ordinary optional metadata errors cannot prevent the actual fatal I/O.
        def broken(*_):raise RuntimeError('private-marker')
        experiment=scenario.Scenario(None,'owned_token',None,broken)
        with patch.object(experiment,'phase'),patch.object(experiment,'_one',side_effect=primary):
            with self.assertRaises(ValueError) as caught:experiment.reset()
        self.assertIs(caught.exception,primary)
        class ForeignReset(ConnectionResetError):
            def __str__(self):raise AssertionError('foreign text read')
        foreign=ForeignReset('private')
        self.assertEqual(scenario.reset_failure_reason(foreign),'unknown')
        self.assertEqual(scenario.failure_reason(ConnectionResetError('private')),'unknown')
        self.assertEqual(scenario.reset_failure_reason(ValueError('private')),'contract')
