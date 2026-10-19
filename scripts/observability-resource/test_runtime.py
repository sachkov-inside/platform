"""Lifecycle seam delegates one exact project to the existing external supervisor."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import runtime


class Lifecycle(unittest.TestCase):
    def test_deadline_and_identity_preflight_leave_no_budget_for_late_command(self):
        with patch.object(runtime.pilot, 'assert_docker_identity') as identity, \
                patch.object(runtime.time, 'monotonic', side_effect=[100, 106]), \
                patch.object(runtime.subprocess, 'run') as command:
            with self.assertRaises(TimeoutError):
                runtime.invoke([], ['up', '-d'], timeout=5)
            identity.assert_called_once_with(deadline=105)
            command.assert_not_called()

    def test_registered_supervisor_required_before_docker_or_worker_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output/'owner.json').write_text(json.dumps({'supervisor_pid': -1}))
            with patch.object(runtime.pilot, 'worker_storage_guard') as guard, \
                    patch.object(runtime, 'invoke') as invoke:
                with self.assertRaises(RuntimeError):
                    runtime.worker(output)
                guard.assert_not_called()
                invoke.assert_not_called()

    def test_raw_ownership_rejects_foreign_duplicate_and_unknown_services(self):
        rows = [{'Id':'a'*64, 'Config':{'Labels':{'com.docker.compose.project':'owned', 'com.docker.compose.service':'api'}}, 'HostConfig':{'CgroupnsMode':'private'}, 'State':{'Running':True, 'OOMKilled':False, 'ExitCode':0, 'Restarting':False}, 'RestartCount':0}]
        self.assertEqual(runtime.owned(rows, 'owned')['api']['container'], 'a'*64)
        for invalid in (rows+rows, [{**rows[0], 'Id':'bad'}], [{**rows[0], 'Config':{'Labels':{'com.docker.compose.project':'foreign','com.docker.compose.service':'api'}}}]):
            with self.assertRaises(ValueError):
                runtime.owned(invalid, 'owned')

    def test_partial_client_samples_are_retained_and_unstarted_latency_is_unknown(self):
        sample = {'label':'public_index','outcome':'ok','status':200,'elapsed_ms':3}
        warmup = {'kind':'warmup','samples':[{**sample,'label':runtime.resource_profile.LABELS[index%2]} for index in range(20)]}
        raw = json.dumps(warmup)+'\n'+json.dumps({'kind':'sample','index':0,**sample})+'\n'+ '{"private-body-interrupted'
        value = runtime.parse_phase(raw)
        self.assertEqual(value['received_samples'],1)
        self.assertEqual(value['samples'][0],sample)
        self.assertEqual(value['samples'][1]['outcome'],'phase_aborted')
        self.assertIsNone(value['samples'][1]['elapsed_ms'])
        self.assertIsNone(value['client_cpu_seconds'])
        self.assertFalse(value['client_completed'])
        with self.assertRaises(ValueError):
            runtime.parse_phase(json.dumps({'kind':'warmup','samples':[sample]*20,'token':'secret'})+'\n')

    def test_startup_diagnostics_retain_only_closed_stage_and_http_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            sample={'label':'protected_account','outcome':'ok','status':201,'elapsed_ms':4}
            with patch.object(runtime,'client',return_value=sample):
                self.assertEqual(runtime.startup_client(output,[],'establish','off'),sample)
            value=json.loads((output/'startup-client.json').read_text())
            self.assertEqual(value,{'schema':1,'stage':'api_off_establish','state':'sampled','sample':sample})
            for invalid in ({**sample,'token':'private-sentinel'},{**sample,'status':200},{**sample,'elapsed_ms':float('nan')},{**sample,'label':'public_index'}):
                with patch.object(runtime,'client',return_value=invalid),self.assertRaises(ValueError):
                    runtime.startup_client(output,[],'establish','off')
                value=json.loads((output/'startup-client.json').read_text())
                self.assertEqual(value,{'schema':1,'stage':'api_off_establish','state':'client_error','error_type':'invalid_sample'})
                self.assertNotIn('private-sentinel',json.dumps(value))
            with patch.object(runtime,'client',side_effect=runtime.subprocess.TimeoutExpired('private-sentinel',5)):
                with self.assertRaises(runtime.subprocess.TimeoutExpired):
                    runtime.startup_client(output,[],'protected-ready','on')
            self.assertEqual(json.loads((output/'startup-client.json').read_text()),{'schema':1,'stage':'api_on_protected_ready','state':'client_error','error_type':'transport'})
            denied={'label':'protected_account','outcome':'unexpected_response','status':401,'elapsed_ms':3}
            with patch.object(runtime,'client',return_value=denied):
                self.assertEqual(runtime.startup_client(output,[],'protected-ready','off'),denied)
            self.assertEqual(json.loads((output/'startup-client.json').read_text())['sample'],denied)
            with patch.object(runtime,'client') as command:
                for action,mode in [('load','off'),('ready','unknown')]:
                    with self.assertRaises(ValueError):runtime.startup_client(output,[],action,mode)
                command.assert_not_called()

    def test_sdk_diagnostic_artifact_is_partial_before_measurement_and_confines_bad_response(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);records=[]
            value={'schema':1,'queries':{name:{'state':'known','value':None} for name in runtime.sdk_diagnostics.NAMES}}
            with patch.object(runtime,'invoke',return_value=json.dumps(value)) as command,patch.object(runtime.time,'time',return_value=200):
                record=runtime.begin_sdk_probe(output,[],records,pair=0,started=100)
                self.assertEqual(command.call_count,1)
                self.assertIn('metric-probe',command.call_args.args[1])
                self.assertEqual(json.loads((output/'resource-sdk-diagnostics.json').read_text())['phases'][0]['state'],'before_measurement')
                self.assertIsNone(record['after'])
                runtime.finish_sdk_probe(output,[],records,record,{'state':'known','latest_seconds':None})
            self.assertEqual(record['state'],'observed')
            self.assertEqual(record['facts']['interpretation'],'observations_only')
            with patch.object(runtime,'invoke',return_value='private-response-sentinel'),patch.object(runtime.time,'time',return_value=200):
                bad=runtime.begin_sdk_probe(output,[],records,pair=1,started=100)
                self.assertEqual(bad['before']['state'],'invalid_response')
            self.assertNotIn('private-response-sentinel',(output/'resource-sdk-diagnostics.json').read_text())
            with patch.object(runtime,'invoke',side_effect=RuntimeError('private-identity-sentinel')):
                with self.assertRaises(RuntimeError):runtime.finish_sdk_probe(output,[],records,bad,{'state':'unknown','latest_seconds':None})
            self.assertNotIn('private-identity-sentinel',(output/'resource-sdk-diagnostics.json').read_text())
            self.assertIsNone(bad['after'])
            self.assertEqual(bad['state'],'after_failed')
            with patch.object(runtime,'invoke') as command,self.assertRaises(ValueError):
                runtime.begin_sdk_probe(output,[],records,pair=2,started=100)
            command.assert_not_called()

    def test_latency_diagnostic_runs_after_original_and_keeps_phase_and_failure_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);records=[]
            probe={'schema':1,'queries':{name:{'state':'known','value':None} for name in runtime.sdk_diagnostics.NAMES}}
            latency={'schema':1,'attempts':[{'evaluated_seconds':120,'default':{'state':'known','value':90},'immediate':{'state':'known','value':115}}]}
            with patch.object(runtime,'invoke',side_effect=[json.dumps(probe),json.dumps(probe),json.dumps(latency)]) as command,patch.object(runtime.time,'time',return_value=121):
                record=runtime.begin_sdk_probe(output,[],records,pair=1,started=100)
                runtime.finish_sdk_probe(output,[],records,record,{'state':'known','latest_seconds':None})
            self.assertEqual(record['latency']['attempts'][0]['fresh'],{'default':False,'immediate':True})
            self.assertEqual(record['pair'],1)
            self.assertEqual(record['original'],{'state':'known','latest_seconds':None})
            self.assertEqual(command.call_args.args[1],['exec','-T','loadgen','node','/resource/client.mjs','metric-latency-probe','/query/key','100'])
            self.assertEqual(command.call_args.kwargs,{'timeout':10})
            with patch.object(runtime,'invoke',side_effect=[json.dumps(probe),RuntimeError('private-sentinel')]),patch.object(runtime.time,'time',return_value=121):
                with self.assertRaises(RuntimeError):runtime.finish_sdk_probe(output,[],records,record,{'state':'known','latest_seconds':None})
            result=json.loads((output/'resource-sdk-diagnostics.json').read_text())['phases'][0]
            self.assertEqual(result['state'],'latency_failed')
            self.assertEqual(result['latency'],{'state':'command_failed','attempts':[]})
            self.assertNotIn('private-sentinel',str(result))

    def test_sdk_probe_command_failure_keeps_closed_partial_state_and_propagates(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);records=[]
            with patch.object(runtime,'invoke',side_effect=runtime.subprocess.TimeoutExpired('private-sentinel',1)):
                with self.assertRaises(runtime.subprocess.TimeoutExpired):
                    runtime.begin_sdk_probe(output,[],records,pair=0,started=100)
            value=json.loads((output/'resource-sdk-diagnostics.json').read_text())
            self.assertEqual(value['phases'][0]['state'],'before_failed')
            self.assertEqual(value['phases'][0]['error_type'],'command_failed')
            self.assertIsNone(value['phases'][0]['before'])
            self.assertNotIn('private-sentinel',json.dumps(value))

    def test_stdout_partial_on_timeout_never_retries_mutating_commands(self):
        with patch.object(runtime.pilot,'assert_docker_identity'), \
                patch.object(runtime.subprocess,'run',side_effect=runtime.subprocess.TimeoutExpired('fixed',1,output=b'{"kind":"sample"}\n')) as command:
            self.assertEqual(runtime.invoke([],['fixed'],retain_partial=True),('{"kind":"sample"}\n',False))
            self.assertEqual(command.call_count,1)

    def test_malformed_container_shapes_fail_closed(self):
        for value in (None,{},[None],[{'Config':None}],[{'Config':{'Labels':[]},'State':{},'HostConfig':{}}]):
            with self.subTest(value=value),self.assertRaises(ValueError):
                runtime.owned(value,'owned')

    def test_preexisting_private_inputs_are_not_deleted_when_acquisition_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            (output/'runtime').mkdir()
            private=output/'runtime/api.env'
            private.write_text('owner-sentinel')
            runtime.cleanup_private(output)
            self.assertEqual(private.read_text(),'owner-sentinel')

    def test_worker_foreign_project_or_cwd_refused_before_registration_and_docker(self):
        for owner in ({'supervisor_pid':runtime.os.getppid(),'cwd':str(runtime.ROOT),'project':'inside-platform'},
                      {'supervisor_pid':runtime.os.getppid(),'cwd':'/foreign','project':runtime.PROJECT_PREFIX+'a'*12}):
            with tempfile.TemporaryDirectory() as directory:
                output=Path(directory);(output/'owner.json').write_text(json.dumps(owner))
                with patch.object(runtime,'registration') as registered,patch.object(runtime.pilot,'worker_storage_guard') as guard:
                    with self.assertRaises(RuntimeError):
                        runtime.worker(output)
                    registered.assert_not_called();guard.assert_not_called()

    def test_worker_registration_binds_pid_group_and_external_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            with patch.object(runtime.os,'getpid',return_value=123),patch.object(runtime.os,'getpgrp',return_value=123),patch.object(runtime.os,'getppid',return_value=122):
                for record in ({'pid':124,'group':123,'supervisor_pid':122},{'pid':123,'group':124,'supervisor_pid':122},{'pid':123,'group':123,'supervisor_pid':121}):
                    (output/'worker.json').write_text(json.dumps(record))
                    with self.assertRaises(ValueError):
                        runtime.registration(output)
                (output/'worker.json').write_text(json.dumps({'pid':123,'group':123,'supervisor_pid':122}))
                runtime.registration(output)

    def test_main_refused_output_keeps_preexisting_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);(output/'runtime').mkdir();private=output/'runtime/api.env';private.write_text('preserve')
            cache=output/'cache.json';cache.write_text('{}')
            def refused(output,**kwargs):
                raise FileExistsError('fixed')
            with patch.object(runtime.sys,'argv',['resource','run','--output',str(output),'--images',str(cache)]),patch.object(runtime.pilot,'run',side_effect=refused):
                with self.assertRaises(FileExistsError):
                    runtime.main()
            self.assertEqual(private.read_text(),'preserve')

    def test_sdk_unknown_and_nonfinite_timestamp_cannot_confirm_activation(self):
        with patch.object(runtime.time,'time',return_value=100):
            for value in ({'state':'unknown','latest_seconds':None},{'state':'known','latest_seconds':float('nan')},{'state':'known','latest_seconds':1000}):
                result=runtime.sdk_observation(value,90,'on')
                self.assertIsNone(result['matches_configured_mode'])
            self.assertTrue(runtime.sdk_observation({'state':'known','latest_seconds':95},90,'on')['matches_configured_mode'])
            self.assertTrue(runtime.sdk_observation({'state':'known','latest_seconds':None},90,'off')['matches_configured_mode'])
        with self.assertRaises(ValueError):
            runtime.sdk_observation({'state':'known','latest_seconds':None,'body':'secret'},90,'off')

    def test_observed_counter_phase_boundary_and_off_never_turn_unknown_into_absence(self):
        cases = [(95,True,True,False),(90,True,True,False),(89,False,False,True),(None,False,False,True)]
        with patch.object(runtime.time,'time',return_value=100):
            for latest,fresh,on_match,off_match in cases:
                for mode,match in [('on',on_match),('off',off_match)]:
                    result=runtime.sdk_observation({'state':'known','latest_seconds':latest},90,mode)
                    self.assertEqual(result['phase_started_seconds'],90)
                    self.assertEqual(result['fresh_sample_observed'],fresh)
                    self.assertEqual(result['matches_configured_mode'],match)
            for mode in ('on','off'):
                result=runtime.sdk_observation({'state':'unknown','latest_seconds':None},90,mode)
                self.assertIsNone(result['fresh_sample_observed'])
                self.assertIsNone(result['matches_configured_mode'])
