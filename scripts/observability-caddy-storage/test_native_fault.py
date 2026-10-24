"""Expected-fault classification never accepts unrelated failure or unproved cleanup."""
import json
from pathlib import Path
import tempfile
import unittest
import artifact
import evidence
import native_fault


class ExpectedNativeFault(unittest.TestCase):
    def test_timeout_requires_the_unchanged_supervisor_deadline_not_any_fast_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();output.chmod(0o700)
            run=evidence.Run();run.start('identity');run.pass_case('logging');run.pass_case('identity')
            artifact.write_run(output,run.snapshot())
            cleanup={'diagnostics':'passed','down':'passed','residue':'passed',
                     'source_freshness':{'outcome':'passed','containers':7,'volumes':4,'networks':2}}
            outcome={'exit_code':124,'duration_seconds':2,'monitor_failed':False,'cleanup':cleanup}
            for name,value in (('cleanup.json',cleanup),('worker-outcome.json',outcome)):(output/name).write_text(json.dumps(value))
            with self.assertRaises(ValueError):native_fault.verify(output,'timeout',command_exit=1)
            outcome['duration_seconds']=600
            (output/'worker-outcome.json').write_text(json.dumps(outcome))
            self.assertTrue(native_fault.verify(output,'timeout',command_exit=1))

    def test_failure_requires_exact_phase_outcome_and_typed_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();output.chmod(0o700)
            run=evidence.Run();run.start('identity');run.pass_case('logging');run.pass_case('identity');run.fail('contract')
            artifact.write_run(output,run.snapshot())
            cleanup={'diagnostics':'passed','down':'passed','residue':'passed',
                     'source_freshness':{'outcome':'passed','containers':7,'volumes':4,'networks':2}}
            outcome={'exit_code':1,'duration_seconds':2,'monitor_failed':False,'cleanup':cleanup}
            for name,value in (('cleanup.json',cleanup),('worker-outcome.json',outcome)):(output/name).write_text(json.dumps(value))
            self.assertTrue(native_fault.verify(output,'failure',command_exit=1))
            with self.assertRaises(ValueError):native_fault.verify(output,'failure',command_exit=130)
            cleanup['source_freshness']['networks']=3
            for name,value in (('cleanup.json',cleanup),('worker-outcome.json',outcome)):(output/name).write_text(json.dumps(value))
            with self.assertRaises(ValueError):native_fault.verify(output,'failure',command_exit=1)
