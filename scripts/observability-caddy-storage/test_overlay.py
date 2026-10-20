"""Opt-in configuration cannot change default Core or widen runtime authority."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import pilot
import overlay


class OptInOverlay(unittest.TestCase):
    def test_private_overlay_keeps_core_authority_and_derives_current_sources(self):
        base_caddy=(pilot.CONFIG/'Caddyfile').read_bytes();base_alloy=(pilot.CONFIG/'config.alloy').read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'private'
            overlay.prepare(output)
            plan=json.loads((output/'compose.json').read_text())
            auth=(output/'auth.json').stat()
            original=pilot.compose_plan(pilot.CONFIG,output,json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images'],credential_owner=(auth.st_uid,auth.st_gid))
            expected=copy.deepcopy(original)
            expected['services']['gateway']['logging']={'driver':'none'}
            expected['services']['gateway']['volumes']=[f'{output}/Caddyfile:/etc/caddy/Caddyfile:ro']
            expected['services']['alloy']['volumes']=[f'{output}/config.alloy:/etc/alloy/config.alloy:ro']
            self.assertEqual(plan,expected)
            self.assertEqual((pilot.CONFIG/'Caddyfile').read_bytes(),base_caddy)
            self.assertEqual((pilot.CONFIG/'config.alloy').read_bytes(),base_alloy)
            self.assertTrue((output/'config.alloy').read_bytes().startswith(base_alloy))
            self.assertNotIn('9091',str(plan['services']['gateway']['ports']))
            self.assertEqual(plan['services']['gateway']['networks'],['pilot','ingress'])
            self.assertEqual(plan['services']['gateway']['logging'],{'driver':'none'})
