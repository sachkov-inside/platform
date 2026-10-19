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
        warmup = {'kind':'warmup','samples':[sample]*20}
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
