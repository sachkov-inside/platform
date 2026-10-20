"""Invalid present Caddy evidence is refused before public destination acquisition."""
import json
from pathlib import Path
import tempfile
import unittest
import artifact
import caddy_status
import evidence
import collection
from test_observation import acquisition


class CuratedCollection(unittest.TestCase):
    def test_failed_admission_without_an_acquired_project_keeps_only_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();metadata=root/'metadata';metadata.mkdir(mode=0o700)
            (metadata/'admission.json').write_text('{"ready":false}')
            collection.collect(root/'never-acquired',metadata,root/'public')
            self.assertEqual(sorted(path.name for path in (root/'public').iterdir()),['admission.json'])

    def test_complete_evidence_is_reserialized_and_invalid_present_never_acquires_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output=root/'private';output.mkdir(mode=0o700)
            metadata=root/'metadata';metadata.mkdir(mode=0o700)
            values,stamps=acquisition()
            good=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
            good['transport']={'canonical':'passed','mcp':'passed'}
            artifact.write(output,good)
            destination=root/'public'
            with self.assertRaises(ValueError):collection.collect(output,metadata,destination)
            self.assertFalse(destination.exists())
            run=evidence.Run()
            for case in evidence.CASES:run.pass_case(case)
            run.finish();artifact.write_run(output,run.snapshot())
            (output/'private-secret').write_text('private-caddy-sentinel')
            collection.collect(output,metadata,destination)
            self.assertEqual(sorted(path.name for path in destination.iterdir()),['caddy-observation.json','caddy-run.json'])
            self.assertEqual(artifact.read(destination),good)
            (output/'caddy-run.json').write_text(json.dumps({**run.snapshot(),'private':'private-caddy-sentinel'}))
            with self.assertRaises(ValueError):collection.collect(output,metadata,root/'refused')
            self.assertFalse((root/'refused').exists())
