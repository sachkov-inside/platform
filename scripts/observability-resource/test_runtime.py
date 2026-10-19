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

    def test_stdout_partial_on_timeout_never_retries_mutating_commands(self):
        with patch.object(runtime.pilot,'assert_docker_identity'), \
                patch.object(runtime.subprocess,'run',side_effect=runtime.subprocess.TimeoutExpired('fixed',1,output=b'{"kind":"sample"}\n')) as command:
            self.assertEqual(runtime.invoke([],['fixed'],retain_partial=True),'{"kind":"sample"}\n')
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
