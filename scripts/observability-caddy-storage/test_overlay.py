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
            output=Path(directory).resolve()/'private'
            overlay.prepare(output)
            plan=json.loads((output/'compose.json').read_text())
            auth=(output/'auth.json').stat()
            original=pilot.compose_plan(pilot.CONFIG,output,json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images'],credential_owner=(auth.st_uid,auth.st_gid))
            expected=copy.deepcopy(original)
            for role in ('alloy','gateway'):expected['services'][role]['user']=f'{auth.st_uid}:{auth.st_gid}'
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

    def test_private_overlay_content_drift_is_refused_before_container_use(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output)
            overlay.verify(output)
            (output/'Caddyfile').write_text('private-caddy-sentinel')
            with self.assertRaises(ValueError):overlay.verify(output)

    def test_changed_private_compose_authority_is_refused_before_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);overlay.verify(output)
            plan=json.loads((output/'compose.json').read_text())
            plan['services']['gateway']['privileged']=True
            (output/'compose.json').write_text(json.dumps(plan,indent=2)+'\n')
            with self.assertRaises(ValueError):overlay.verify(output)

    def test_private_readers_use_verified_file_owners_without_widening_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'private';overlay.prepare(output);plan=overlay.plan(output)
            for role,name in (('alloy','config.alloy'),('gateway','Caddyfile'),('vmauth','auth.json')):
                info=(output/name).stat()
                self.assertEqual(plan['services'][role].get('user'),f'{info.st_uid}:{info.st_gid}')
                self.assertEqual(info.st_mode&0o777,0o600)
                self.assertEqual(plan['services'][role]['cap_drop'],['ALL'])
            self.assertEqual(output.stat().st_mode&0o777,0o700)
            for role in ('metrics','logs','traces','grafana'):self.assertNotIn('user',plan['services'][role])
