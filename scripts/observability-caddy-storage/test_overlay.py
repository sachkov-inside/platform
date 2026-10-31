"""Opt-in configuration cannot change default Core or widen runtime authority."""
import copy
import json
import re
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

            # Read the one actual generated rule, not a second copy of the policy.
            appended=(output/'config.alloy').read_text()[len(base_alloy.decode()):]
            blocks=[block.split('  }\n',1)[0] for block in appended.split('  rule {\n')[1:]]
            le_rules=[block.splitlines() for block in blocks if block.startswith('    source_labels = ["le"]\n')]
            self.assertEqual(len(le_rules),1)
            lines=le_rules[0]
            self.assertEqual(len(lines),3)
            self.assertEqual(lines[0],'    source_labels = ["le"]')
            self.assertEqual(lines[2],'    action = "keep"')
            self.assertTrue(lines[1].startswith('    regex = '))
            expression=json.loads(lines[1].removeprefix('    regex = '))
            self.assertTrue(expression.startswith('(|') and expression.endswith(')'))
            literals=expression[2:-1].split('|')
            # This finite escaped-literal grammar has identical full-match meaning in
            # Python and the pinned anchored RE2 policy. No general HCL/RE2 model.
            for literal in literals:
                self.assertIsNotNone(re.fullmatch(r'(?:[0-9]+(?:\\\.[0-9]+)?|\\\+Inf)',literal))

            import caddy_status
            from test_observation import acquisition
            values,stamps=acquisition()
            legacy=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),
                evaluated_at=100,completed_at=101,diagnose=True)
            self.assertEqual(legacy['state'],'observed')
            # Public exact-pinned PromParser/FormatOpenMetricsFloat contract:
            # grafana/prometheus@6ac45be9754c, not captured native query rows.
            canonical={'1':'1.0','5':'5.0','10':'10.0'}
            for vector in (values,stamps):
                for row in vector['data']['result']:
                    metric=row['metric']
                    if metric.get('le') in canonical:metric['le']=canonical[metric['le']]
                vector['data']['result']=[row for row in vector['data']['result']
                    if re.fullmatch(expression,row['metric'].get('le','')) is not None]
            observed=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),
                evaluated_at=100,completed_at=101,diagnose=True)
            self.assertEqual((observed['state'],observed['reason']),('observed','none'))
            self.assertEqual(observed,legacy)
            allowed={literal.replace(r'\.','.').replace(r'\+','+') for literal in literals}|{''}
            self.assertEqual(allowed,{'',*caddy_status.BUCKETS,*canonical.values()})
            for lexical in ('',*caddy_status.BUCKETS,*canonical.values()):
                self.assertIsNotNone(re.fullmatch(expression,lexical))
            for lexical in ('2.0','1.00','5.00','10.00','1e0','5e0','Inf','NaN','11',
                    'private-canary',' extra','1.0\n'):
                self.assertIsNone(re.fullmatch(expression,lexical))

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
