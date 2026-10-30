"""Closed representative plans use actual fixture constructors, never a native adapter run."""
import copy
from contextlib import nullcontext
from types import SimpleNamespace
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import fullstack
from test_cpu_control import assemble, pins, SOURCE


class CoreLayout(unittest.TestCase):
    def test_real_combined_constructor_preserves_application_and_accounts_for_every_resource(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();output,primary=assemble(root,'primary',control=False)
            before=copy.deepcopy(primary)
            layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
                source={'commit':SOURCE,'tree':'b'*40},images=pins(),
                project='inside-observability-representative-'+'1'*12,nonce='2'*32,uid=1001,gid=1001)
            combined=layout.plan
            self.assertEqual(primary,before)
            self.assertEqual(combined['services']['postgres']['image'],pins()['foundation'])
            self.assertEqual(combined['services']['mcp']['image'],pins()['backend'])
            self.assertIn('sig-postgres',combined['services']);self.assertIn('sig-mcp',combined['services'])
            self.assertEqual(len([role for role in combined['services'] if role.startswith('sig-')]),12)
            self.assertEqual(len(layout.manifest['sig_roles']),11)
            self.assertEqual(len([role for role in combined['volumes'] if role.startswith('sig-')]),7)
            self.assertEqual(layout.validate(combined),None)
            self.assertEqual(layout.manifest['supervisor'],{'count':1,'deadline_seconds':600,'cleanup_seconds':90})
            self.assertEqual(layout.manifest['sig_memory_bytes'],4480*1024**2)
            self.assertEqual(layout.manifest['memory_bytes'],16288*1024**2)
            self.assertEqual(layout.manifest['nano_cpus'],23_400_000_000)
            for role in set(primary['services'])-{'metrics','logs','traces','grafana','vmauth','gateway','horizon','volume-reader'}:
                observed=copy.deepcopy(combined['services'][role]);observed.pop('labels')
                expected=copy.deepcopy(primary['services'][role])
                if role=='alloy':expected['networks'].update({'sig-trace-edge':{},'sig-signal-ingest':{}})
                if role in ('alloy','host-agent'):
                    name='edge.alloy' if role=='alloy' else 'host.alloy';target='/etc/alloy/config.alloy' if role=='alloy' else '/etc/alloy/host.alloy'
                    expected['volumes'][0]=str(output/'representative-ingestion'/name)+':'+target+':ro'
                self.assertEqual(observed,expected,role)
            self.assertEqual(combined['services']['sig-mcp']['networks'],{'sig-backend':{'aliases':['mcp']}})
            self.assertNotIn('sig-backend',combined['services']['mcp']['networks'])
            self.assertEqual(combined['services']['sig-agent']['network_mode'],'none')
            self.assertEqual(set(layout.manifest['roles']),set(combined['services']))
            self.assertEqual(set(layout.manifest['volumes']),set(combined['volumes']))
            self.assertEqual(set(layout.manifest['networks']),set(combined['networks']))
            for kind in ('services','volumes','networks'):
                for value in combined[kind].values():
                    self.assertEqual(value['labels']['inside.monitoring.owner'],'monitoring-1566-representative')
                    self.assertEqual(value['labels']['inside.monitoring.nonce'],'2'*32)
                    self.assertEqual(value['labels']['com.docker.compose.project'],'inside-observability-representative-'+'1'*12)
            self.assertEqual(set(combined['volumes']),{'application-database','broker-data','caddy-data','caddy-config',
                'sig-ch-data','sig-keeper-data','sig-keeper-default-data','sig-pg-data','sig-histogram','sig-probe','sig-gateway'})
            reader=combined['services']['volume-reader']['volumes']
            self.assertEqual({mount.split(':')[0] for mount in reader[1:]},set(combined['volumes']))
            self.assertTrue(all(mount.endswith(':ro') for mount in reader))

    def build(self,primary,output,core='signoz-mcp512-v1',**overrides):
        binding={'run':output,'source':{'commit':SOURCE,'tree':'b'*40},'images':pins(),
            'project':'inside-observability-representative-'+'1'*12,'nonce':'2'*32,'uid':1001,'gid':1001}
        binding.update(overrides)
        return fullstack.assemble_core(primary,core,**binding)

    def test_primary_plan_is_exact_and_existing_functional_validator_is_not_weakened(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            self.assertEqual(set(primary['services']),set(fullstack.SERVICES))
            original=json.dumps(primary,sort_keys=True)
            self.assertEqual(self.build(primary,output,'primary-v1').plan,primary)
            self.assertEqual(json.dumps(primary,sort_keys=True),original)
            from core_layout import signoz_lifecycle
            lifecycle=signoz_lifecycle()
            canonical=lifecycle.make_plan(output/'signoz',lifecycle.verify_packet()['images'],
                'inside-observability-representative-'+'1'*12,'2'*32,1001,1001,profile_id=lifecycle.MCP512_PROFILE)
            lifecycle.plan_profile(canonical,lifecycle.MCP512_PROFILE)
            with self.assertRaises(lifecycle.Refusal):
                lifecycle.plan_profile(self.build(primary,output).plan,lifecycle.MCP512_PROFILE)
            for role in ('volume-init','histogram-init','migrator'):
                self.assertIn('sig-'+role,self.build(primary,output).manifest['roles'])

    def test_closed_layout_refuses_collisions_incomplete_init_foreign_resources_and_hidden_cost(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            layout=self.build(primary,output)
            def overwrite(plan):plan['services']['postgres']=plan['services']['sig-postgres']
            def overwrite_mcp(plan):plan['services']['mcp']=plan['services']['sig-mcp']
            def missing_init(plan):del plan['services']['sig-histogram-init']
            def foreign_role(plan):plan['services']['foreign']=copy.deepcopy(plan['services']['sig-agent'])
            def extra_network(plan):plan['networks']['foreign']={}
            def extra_volume(plan):plan['volumes']['foreign']={}
            def image(plan):plan['services']['sig-server']['image']='signoz/signoz:latest'
            def hidden_memory(plan):plan['services']['sig-server']['deploy']={'resources':{'limits':{'memory':'8g'}}}
            def budget(plan):plan['services']['sig-mcp']['mem_limit']='128m'
            def nonce(plan):plan['services']['sig-agent']['labels']['inside.monitoring.nonce']='3'*32
            def source(plan):plan['volumes']['sig-pg-data']['labels']['inside.monitoring.source']='f'*40
            def profile(plan):plan['networks']['sig-backend']['labels']['inside.monitoring.profile']='foreign'
            def foreign_mount(plan):plan['services']['sig-postgres']['volumes'][0]['source']='/foreign'
            def private_network(plan):plan['services']['postgres']['networks'].append('sig-backend')
            def alias(plan):plan['services']['sig-mcp']['networks']['sig-backend']['aliases'].append('postgres')
            for change in (overwrite,overwrite_mcp,missing_init,foreign_role,extra_network,extra_volume,image,hidden_memory,budget,nonce,source,profile,foreign_mount,private_network,alias):
                with self.subTest(change=change.__name__):
                    candidate=layout.plan;change(candidate)
                    with self.assertRaisesRegex(ValueError,'representative_layout_mismatch'):layout.validate(candidate)
            for field,value in (('root','/foreign'),('nonce','3'*32),('profile','foreign'),('source',{'commit':'c'*40,'tree':'b'*40}),('supervisor',{'count':2,'deadline_seconds':600,'cleanup_seconds':90})):
                with self.subTest(manifest=field):
                    manifest=layout.manifest;manifest[field]=value
                    with self.assertRaisesRegex(ValueError,'representative_manifest_mismatch'):layout.validate(layout.plan,manifest)
            self.assertEqual(layout.validate(layout.plan,layout.manifest),None)
            candidate=layout.plan;candidate['services'].clear()
            self.assertTrue(layout.plan['services'])
            self.assertNotIn('2'*32,repr(layout))

    def test_constructor_refuses_incomplete_or_foreign_baseline_and_wrong_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            for field,value in (('core','arbitrary'),('nonce','not-a-nonce'),('project','inside-platform'),
                ('run',Path('relative')),('source',{'commit':'c'*40,'tree':'b'*40}),('uid',True)):
                with self.subTest(field=field),self.assertRaises(ValueError):
                    if field=='core':self.build(primary,output,value)
                    else:self.build(primary,output,**{field:value})
            for change in ('missing_init','foreign_role','foreign_network','foreign_volume','mutable_image','hidden_memory','cpu','overwrite_postgres','overwrite_mcp'):
                candidate=copy.deepcopy(primary)
                if change=='missing_init':del candidate['services']['broker-config']
                elif change=='foreign_role':candidate['services']['sig-agent']={}
                elif change=='foreign_network':candidate['networks']['sig-backend']={}
                elif change=='foreign_volume':candidate['volumes']['sig-pg-data']={}
                elif change=='mutable_image':candidate['services']['postgres']['image']='postgres:latest'
                elif change=='hidden_memory':candidate['services']['mcp']['deploy']={}
                elif change=='cpu':candidate['services']['mcp']['cpus']=.5
                elif change=='overwrite_postgres':candidate['services']['postgres']=copy.deepcopy(candidate['services']['mcp'])
                elif change=='overwrite_mcp':candidate['services']['mcp']=copy.deepcopy(candidate['services']['postgres'])
                with self.subTest(change=change),self.assertRaises(ValueError):self.build(candidate,output)

    def test_sig_selection_refuses_before_any_runtime_or_preparation_and_primary_cli_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory).resolve()/'not-created';images=output.parent/'missing-images'
            with patch.object(fullstack.pilot,'command',side_effect=AssertionError('native acquisition')),                 patch.object(fullstack.preparation,'recover_stage',side_effect=AssertionError('stage acquisition')):
                with self.assertRaisesRegex(ValueError,'representative_signoz_runtime_unavailable'):
                    fullstack.inputs(output,images,core='signoz-mcp512-v1')
                with patch.object(sys,'argv',['fullstack.py','run','--output',str(output),'--images',str(images),'--core','signoz-mcp512-v1']):
                    with self.assertRaisesRegex(ValueError,'representative_signoz_runtime_unavailable'):fullstack.main()
            self.assertFalse(output.exists())
            calls=[]
            stage=SimpleNamespace(in_use=lambda:nullcontext(),require_consumer=lambda path:calls.append(('consumer',path)),pass_fds=lambda:())
            runs=[]
            def run(path,**options):
                prepare=options.pop('prepare_inputs');prepare(path);runs.append((path,options))
            with patch.object(fullstack.preparation,'recover_stage',return_value=stage),patch.object(fullstack.pilot,'run',side_effect=run),patch.object(fullstack,'inputs',side_effect=lambda *args:calls.append(('inputs',args))):
                for selection in ([],['--core','primary-v1']):
                    with patch.object(sys,'argv',['fullstack.py','run','--output',str(output),'--images',str(images),*selection]):fullstack.main()
            self.assertEqual(runs[0],runs[1]);self.assertEqual(calls[:2],calls[2:])
            self.assertEqual(runs[0][1]['services'],fullstack.SERVICES)

    def test_collector_ingress_joins_only_existing_edges_without_exposing_private_backends(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            self.assertEqual(primary['services']['alloy']['networks'],
                {'storage':{},'telemetry':{'aliases':['inside-telemetry']},'loopback':{}})
            self.assertEqual(primary['services']['host-agent']['networks'],['hostsource'])
            layout=self.build(primary,output);plan=layout.plan
            self.assertEqual(plan['services']['sig-collector']['networks'],
                {'sig-backend':{'aliases':['signoz-ingester']},
                 'hostsource':{'aliases':['inside-signoz-host-ingest']},
                 'sig-trace-forward':{'aliases':['inside-signoz-trace-ingest']},
                 'sig-signal-ingest':{'aliases':['inside-signoz-collector']}})
            for role in ('sig-postgres','sig-server','sig-mcp','sig-clickhouse','sig-keeper'):
                self.assertEqual(set(plan['services'][role]['networks']),{'sig-backend'})
                self.assertNotIn('ports',plan['services'][role])
            for role in ('alloy','host-agent'):
                observed=copy.deepcopy(plan['services'][role]);observed.pop('labels')
                expected=copy.deepcopy(primary['services'][role])
                if role=='alloy':expected['networks'].update({'sig-trace-edge':{},'sig-signal-ingest':{}})
                name='edge.alloy' if role=='alloy' else 'host.alloy';target='/etc/alloy/config.alloy' if role=='alloy' else '/etc/alloy/host.alloy'
                expected['volumes'][0]=str(output/'representative-ingestion'/name)+':'+target+':ro'
                self.assertEqual(observed,expected)
            for change in ('extra_collector_network','missing_alias','extra_alias','server_ingress','mcp_ingress','database_ingress','port'):
                candidate=layout.plan
                if change=='extra_collector_network':candidate['services']['sig-collector']['networks']['pilot']={}
                elif change=='missing_alias':candidate['services']['sig-collector']['networks']['sig-signal-ingest']={}
                elif change=='extra_alias':candidate['services']['sig-collector']['networks']['sig-signal-ingest']['aliases'].append('mcp')
                elif change=='server_ingress':candidate['services']['sig-server']['networks']['storage']={}
                elif change=='mcp_ingress':candidate['services']['sig-mcp']['networks']['storage']={}
                elif change=='database_ingress':candidate['services']['sig-postgres']['networks']['hostsource']={}
                elif change=='port':candidate['services']['sig-collector']['ports']=['4318:4318']
                with self.subTest(change=change),self.assertRaises(ValueError):layout.validate(candidate)
            for role,networks in (('alloy',{'pilot':{}}),('host-agent',['hostsource','storage'])):
                candidate=copy.deepcopy(primary);candidate['services'][role]['networks']=networks
                with self.subTest(retained=role),self.assertRaisesRegex(ValueError,'representative_retained_edge_networks'):
                    self.build(candidate,output)


if __name__=='__main__':unittest.main()
