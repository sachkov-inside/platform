"""The four-response process path validates both whole VM vectors before projection."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import mcp_snapshot
from test_observation import acquisition


class MCPObservation(unittest.TestCase):
    def test_real_owned_protocol_child_joins_values_and_timestamps_and_refuses_bad_final_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);values,stamps=acquisition()
            value_file=root/'values';stamp_file=root/'stamps'
            value_file.write_text(json.dumps(values));stamp_file.write_text(json.dumps(stamps))
            fixture=([sys.executable,'-B',str(Path(__file__).with_name('fixtures')/'mcp.py')],
                     {'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(root/'owner'),
                      'CADDY_TEST_BODY_FILE':str(value_file),'CADDY_TEST_TIMESTAMP_FILE':str(stamp_file)})
            report,private=mcp_snapshot.read_snapshot(Path('/unused-native-fixture'),'a'*32,evaluated_at=100,
                wall_clock=lambda:101,_fixture=fixture)
            self.assertEqual(report['state'],'observed')
            self.assertEqual(report['observation']['requests_total'],3)
            self.assertEqual(report['transport'],{'canonical':'unrun','mcp':'passed'})
            self.assertEqual(private['timestamps'],stamp_file.read_bytes())
            stamps['data']['result'][-1]['metric']['private']='private-caddy-sentinel'
            stamp_file.write_text(json.dumps(stamps))
            with self.assertRaises(ValueError):
                mcp_snapshot.read_snapshot(Path('/unused-native-fixture'),'a'*32,evaluated_at=100,
                    wall_clock=lambda:101,_fixture=fixture)
