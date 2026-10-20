"""Only complete closed Caddy evidence reaches the public directory."""
import json
from pathlib import Path
import tempfile
import unittest
import artifact
import caddy_status
from test_observation import acquisition


class ClosedArtifact(unittest.TestCase):
    def test_atomic_canonical_roundtrip_refuses_unknown_and_unproven_positive_records(self):
        values,stamps=acquisition()
        good=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();root.chmod(0o700)
            with self.assertRaises(ValueError):artifact.write(root,good)
            good['transport']={'canonical':'passed','mcp':'passed'}
            artifact.write(root,good)
            self.assertEqual(artifact.read(root),good)
            self.assertEqual(list(root.iterdir()),[root/artifact.NAME])
            poison={**good,'private':'private-caddy-sentinel'}
            (root/artifact.NAME).write_text(json.dumps(poison))
            with self.assertRaisesRegex(ValueError,'^closed Caddy artifact refused$'):artifact.read(root)
            self.assertNotIn('private',json.dumps(good))
