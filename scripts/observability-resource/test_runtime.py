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
