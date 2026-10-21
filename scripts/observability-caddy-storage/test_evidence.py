"""Run progress never upgrades partial cases or overwrites a primary failure."""
import unittest
import json
from pathlib import Path
import tempfile
import artifact
import evidence


class NativeRunEvidence(unittest.TestCase):
    def test_every_case_is_required_and_failure_snapshot_survives_late_progress(self):
        run=evidence.Run()
        with self.assertRaises(ValueError):run.finish()
        run.start('mcp_discovery');run.fail('contract')
        first=run.snapshot()
        for case in evidence.CASES:run.pass_case(case)
        run.start('complete');run.fail('unknown')
        self.assertEqual(run.snapshot(),first)
        self.assertEqual(first['state'],'failed')
        self.assertEqual(first['phase'],'mcp_discovery')
        complete=evidence.Run()
        for case in evidence.CASES:complete.pass_case(case)
        complete.finish()
        self.assertEqual(complete.snapshot()['state'],'passed')
        with self.assertRaises(ValueError):evidence.validate({**first,'private':'private-caddy-sentinel'})

    def test_private_atomic_run_commit_refuses_invalid_present_record(self):
        run=evidence.Run();run.start('partition');run.fail('contract')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();root.chmod(0o700)
            self.assertIsNone(artifact.read_run(root))
            artifact.write_run(root,run.snapshot())
            self.assertEqual(artifact.read_run(root),run.snapshot())
            self.assertEqual([path.name for path in root.iterdir()],['caddy-run.json'])
            (root/'caddy-run.json').write_text(json.dumps({**run.snapshot(),'schema':True}))
            with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):artifact.read_run(root)

        phases=('partition_initial_acquire','partition_initial_state','partition_initial_after_cut',
                'partition_initial_boundary','partition_compare_acquire','partition_compare_state',
                'partition_compare_journal','partition_compare_after_cut')
        for phase in phases:
            with self.subTest(phase=phase),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();root.chmod(0o700)
                current=evidence.Run();current.start(phase);current.fail('budget')
                artifact.write_run(root,current.snapshot())
                self.assertEqual(artifact.read_run(root),current.snapshot())
                for invalid in ('partition_private-canary','partition_initial_other',42):
                    with self.assertRaises(ValueError):artifact.write_run(root,{**current.snapshot(),'phase':invalid})
                    self.assertEqual(artifact.read_run(root),current.snapshot())
                self.assertEqual(set(current.snapshot()),{'schema','scope','state','phase','reason','cases'})
                self.assertNotIn('private-canary',json.dumps(current.snapshot()))

                # Whole validation precedes public directory creation for new vocabulary too.
                import collection
                metadata=root/'metadata';metadata.mkdir(mode=0o700)
                public=root/'public'
                collection.collect(root,metadata,public)
                self.assertEqual(artifact.read_run(public),current.snapshot())
                for invalid in ({**current.snapshot(),'phase':'partition_private-canary'},
                                {**current.snapshot(),'private':'private-canary'}):
                    (root/'caddy-run.json').write_text(json.dumps(invalid))
                    destination=root/'refused'
                    with self.assertRaises(ValueError):collection.collect(root,metadata,destination)
                    self.assertFalse(destination.exists())
