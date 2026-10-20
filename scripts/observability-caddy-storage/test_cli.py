"""Native entry points refuse unsupported hosts before acquiring private state or Docker."""
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch
import caddy_storage


class NativeHostBoundary(unittest.TestCase):
    def test_typed_cleanup_does_not_accept_float_resource_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve();output.chmod(0o700)
            (output/'owner.json').write_text('{}')
            cleanup={'diagnostics':'passed','down':'passed','residue':'passed',
                     'source_freshness':{'outcome':'passed','containers':7,'volumes':4,'networks':2.0}}
            (output/'cleanup.json').write_text(json.dumps(cleanup))
            with self.assertRaises(RuntimeError):caddy_storage.verify_cleanup(output)

    def test_mac_run_refuses_before_output_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'not-acquired'
            with patch('sys.platform','darwin'),self.assertRaises(RuntimeError):
                caddy_storage.main(['run','--output',str(output)])
            self.assertFalse(output.exists())
