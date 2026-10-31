"""Actual constructor/config contracts; generated text is not native wire/storage proof."""
import json
import copy
import hashlib
import re
from unittest.mock import patch
import signoz_ingestion as generator
from pathlib import Path
import tempfile
import unittest
from test_cpu_control import assemble,pins,SOURCE
import fullstack


class Ingestion(unittest.TestCase):
    def test_actual_constructor_routes_private_signals_after_source_owned_privacy(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
                source={'commit':SOURCE,'tree':'b'*40},images=pins(),
                project='inside-observability-representative-'+'1'*12,nonce='2'*32,uid=1001,gid=1001)
            files=layout.files;self.assertEqual(set(files),{'edge.alloy','host.alloy'})
            edge=files['edge.alloy'];host=files['host.alloy'];plan=layout.plan
            self.assertIn('encoding = "json"',edge);self.assertIn('compression = "none"',edge)
            self.assertIn('http://inside-trace-sanitizer:4318',edge)
            self.assertIn('http://inside-signoz-collector:4318',edge)
            self.assertNotIn('VT-Ignore-Fields',edge);self.assertNotIn('http://traces:',edge)
            self.assertNotIn('prometheus.remote_write',edge+host)
            self.assertIn('otelcol.receiver.prometheus',host);self.assertIn('http://inside-signoz-host-ingest:4318',host)
            self.assertEqual(set(plan['services']['sig-trace-sanitizer']['networks']),{'sig-trace-edge','sig-trace-forward'})
            self.assertNotIn('storage',plan['services']['sig-collector']['networks'])
            for network,members in [('sig-trace-edge',{'alloy','sig-trace-sanitizer'}),
                ('sig-trace-forward',{'sig-trace-sanitizer','sig-collector'}),('sig-signal-ingest',{'alloy','sig-collector'})]:
                self.assertEqual({role for role,value in plan['services'].items() if network in value.get('networks',{})},members)
                self.assertTrue(plan['networks'][network]['internal'])
            self.assertNotIn('[a-z][a-z0-9-]{0,63}',host)
            self.assertEqual(layout.manifest['memory_bytes'],16288*1024**2)
            self.assertEqual(layout.manifest['nano_cpus'],23_400_000_000)
            self.assertTrue(layout.manifest['generated_files'])

    def test_generated_private_inputs_materialize_only_fresh_owned_fixed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
                source={'commit':SOURCE,'tree':'b'*40},images=pins(),
                project='inside-observability-representative-'+'1'*12,nonce='2'*32,uid=1001,gid=1001)
            path=layout.prepare_inputs()
            self.assertEqual(path,output/'representative-ingestion')
            self.assertEqual({file.name for file in path.iterdir()},{'edge.alloy','host.alloy'})
            self.assertEqual(path.stat().st_mode&0o777,0o700)
            for name,text in layout.files.items():
                self.assertEqual((path/name).read_text(),text);self.assertEqual((path/name).stat().st_mode&0o777,0o600)
            with self.assertRaises((ValueError,FileExistsError)):layout.prepare_inputs()

    def test_generated_relabels_preserve_source_privacy_and_exact_project_role_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            project='inside-observability-representative-'+'1'*12
            layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
                source={'commit':SOURCE,'tree':'b'*40},images=pins(),project=project,nonce='2'*32,uid=1001,gid=1001)
            edge=layout.files['edge.alloy'];host=layout.files['host.alloy']
            original=generator.privacy_config.render()
            for header in ('otelcol.receiver.otlp "pilot"','otelcol.processor.filter "catalog"',
                'otelcol.processor.transform "privacy"','otelcol.processor.transform "postgres_source"'):
                left,right=generator.component(original,header);before=original[left:right]
                left,right=generator.component(edge,header);self.assertEqual(edge[left:right],before)
            original=generator.privacy_config.render_stdout()
            for header in ('loki.relabel "stdout"','loki.source.syslog "stdout"'):
                left,right=generator.component(original,header);before=original[left:right]
                left,right=generator.component(edge,header);self.assertEqual(edge[left:right],before)
            left,right=generator.component(original,'loki.process "stdout"')
            expected=original[left:right].replace('loki.write.stdout.receiver','otelcol.receiver.loki.stdout.receiver')
            left,right=generator.component(edge,'loki.process "stdout"');self.assertEqual(edge[left:right],expected)
            left,right=generator.component(host,'prometheus.relabel "containers"')
            expression=json.loads(next(line.strip().split(' = ',1)[1] for line in host[left:right].splitlines() if 'regex = "up;;|container_' in line))
            for role in layout.plan['services']:
                self.assertIsNotNone(re.fullmatch(expression,'container_cpu_usage_seconds_total;'+role+';'+project))
            for role,owner in (('foreign',project),('sig-mcp',project+'-foreign'),('sig-mcp','inside-platform'),('metrics',project)):
                self.assertIsNone(re.fullmatch(expression,'container_cpu_usage_seconds_total;'+role+';'+owner))
            primary_host=(fullstack.ROOT/'infra/observability/production/host.alloy').read_text()
            for header in ('prometheus.scrape "host"','prometheus.scrape "containers"','prometheus.scrape "owner_cache"',
                'prometheus.relabel "host"','prometheus.relabel "owner_cache"'):
                left,right=generator.component(primary_host,header);expected=primary_host[left:right].replace('prometheus.remote_write.host.receiver','otelcol.receiver.prometheus.host.receiver')
                left,right=generator.component(host,header);self.assertEqual(host[left:right],expected)
            self.assertEqual(len(layout.plan['networks']),10)
            for name,text in layout.files.items():self.assertEqual(layout.manifest['generated_files'][name],hashlib.sha256(text.encode()).hexdigest())
            damaged=layout.manifest;damaged['generated_files']['edge.alloy']='f'*64
            with self.assertRaises(ValueError):layout.validate(layout.plan,damaged)

    def test_private_preparation_preserves_foreign_symlink_and_refuses_stale_source(self):
        with tempfile.TemporaryDirectory() as directory:
            output,primary=assemble(Path(directory).resolve(),'primary',control=False)
            layout=fullstack.assemble_core(primary,'signoz-mcp512-v1',run=output,
                source={'commit':SOURCE,'tree':'b'*40},images=pins(),
                project='inside-observability-representative-'+'1'*12,nonce='2'*32,uid=1001,gid=1001)
            foreign=output/'foreign';foreign.mkdir();(foreign/'keep').write_text('KEEP')
            target=output/'representative-ingestion';target.symlink_to(foreign)
            with self.assertRaises(FileExistsError):layout.prepare_inputs()
            self.assertEqual((foreign/'keep').read_text(),'KEEP');target.unlink()
            with patch.object(generator,'input_hashes',return_value={}):
                with self.assertRaises(ValueError):layout.prepare_inputs()
            self.assertFalse(target.exists())

    def test_source_model_keeps_actual_gauge_zero_clock_and_unknown_distinct_before_native_bridge(self):
        # Actual source producer + actual generated relabel expression only.
        # This does NOT claim OTLP conversion, stored label mapping or latest-query proof.
        from test_source_cache import pg,wire
        source=fullstack.source_cache
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();project='inside-observability-representative-'+'1'*12
            host=generator.host_config(('sig-collector','sig-trace-sanitizer'),project)
            left,right=generator.component(host,'prometheus.relabel "owner_cache"')
            expression=json.loads(next(line.strip().split(' = ',1)[1] for line in host[left:right].splitlines() if 'regex = "up;;;;' in line))
            first=source.sample(root,postgres_read=lambda _:pg(),caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=lambda:100)
            old=(root/'postgresql-source.prom').read_text()
            def unavailable(_):raise RuntimeError('SECRET_SENTINEL')
            second=source.sample(root,postgres_read=unavailable,caddy_read=lambda:wire()+b'process_start_time_seconds 10\n',caddy_server='srv0',clock=lambda:101)
            new=(root/'postgresql-source.prom').read_text()
            self.assertEqual(first['postgresql'],'observed');self.assertEqual(second['postgresql'],'unavailable')
            self.assertIn('inside_production_source_available{source="postgresql"} 1\n',old)
            self.assertIn('inside_production_source_available{source="postgresql"} 0\n',new)
            self.assertIn('inside_production_source_observed_at_seconds{source="postgresql"} 101\n',new)
            self.assertNotIn('inside_postgresql_server_',new);self.assertNotIn('SECRET_SENTINEL',new)
            for metric in ('inside_production_source_available','inside_production_source_observed_at_seconds'):
                self.assertIsNotNone(re.fullmatch(expression,metric+';;postgresql;;'))
                self.assertIsNone(re.fullmatch(expression,metric+';;private-user-email;;'))
        for clock in (lambda:float('nan'),lambda:float('inf')):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve()
                with self.assertRaises(ValueError):source.sample(root,postgres_read=lambda _:pg(),caddy_read=lambda:wire(),caddy_server='srv0',clock=clock)
                self.assertEqual(list(root.iterdir()),[])


if __name__=='__main__':unittest.main()
