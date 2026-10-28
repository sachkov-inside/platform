import importlib.util
import pathlib
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=pathlib.Path(__file__).resolve().parent

class Admission(unittest.TestCase):
    def test_provider_execution_tree_and_full_input_binding_are_revalidated(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',HERE/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        environment={'GITHUB_REPOSITORY':'sachkov-inside/platform','GITHUB_EVENT_NAME':'pull_request',
            'GITHUB_SHA':'a'*40,'PILOT_PR_HEAD_SHA':'c'*40,'PILOT_PR_BASE_SHA':'d'*40,
            'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_ACTIONS':'true',
            'RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux','RUNNER_ARCH':'X64'}
        def git(args,**_kwargs):
            return SimpleNamespace(stdout='' if 'status' in args else ('b'*40 if args[-1]=='HEAD^{tree}' else 'a'*40))
        with patch.dict(runtime.os.environ,environment,clear=True),patch.object(runtime.subprocess,'run',side_effect=git),patch.object(runtime.source_binding,'inputs',return_value=()),patch.object(runtime.lifecycle,'digest',return_value='f'*64):
            bound=runtime.source();runtime.verify_source(bound)
            self.assertEqual(bound['commit'],'a'*40);self.assertEqual(bound['tree'],'b'*40)
            self.assertEqual(bound['inputs'],{'.github/workflows/observability-signoz.yml':'f'*64})
            with self.assertRaisesRegex(ValueError,'source_binding_changed'):runtime.verify_source(dict(bound,pr_head='e'*40))
            with patch.dict(runtime.os.environ,{'GITHUB_SHA':'e'*40}):
                with self.assertRaisesRegex(ValueError,'provider_source_changed'):runtime.source()
            with patch.dict(runtime.os.environ,{'RUNNER_ENVIRONMENT':'self-hosted'}):
                with self.assertRaisesRegex(ValueError,'hosted_linux_amd64_provider_required'):runtime.source()

    def test_plan_includes_all_helpers_and_MCP_inside_aggregate_budget(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',HERE/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        with tempfile.TemporaryDirectory() as tmp:
            lock=runtime.lifecycle.verify_packet()
            plan=runtime.lifecycle.make_plan(pathlib.Path(tmp),lock['images'],'signoz1566-'+'a'*12,'b'*32,1001,1001)
        self.assertEqual(len(plan['services']),10);self.assertIn('mcp',plan['services'])
        self.assertAlmostEqual(sum(s['cpus'] for s in plan['services'].values()),2)
        self.assertEqual(sum(int(s['mem_limit'][:-1]) for s in plan['services'].values()),4096)
        self.assertTrue(plan['networks']['backend']['internal'])
        for service in plan['services'].values():
            self.assertNotIn('ports',service);self.assertEqual(service['platform'],'linux/amd64')
            for mount in service.get('volumes',[]):
                self.assertNotIn('docker.sock',mount['target'])
                if mount['type']=='bind':self.assertTrue(mount['read_only'])

    def test_unbound_source_cannot_reach_native_engine_or_create_output(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',HERE/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        with tempfile.TemporaryDirectory() as tmp,patch.object(runtime,'require_native_host'),patch.object(runtime,'source',side_effect=ValueError('source_changed')),patch.object(runtime,'engine') as native:
            output=pathlib.Path(tmp)/'fresh'
            with self.assertRaisesRegex(ValueError,'source_changed'):runtime.run(output)
            native.assert_not_called();self.assertFalse(output.exists())

    def test_source_changes_refuse_recovery_before_any_native_command(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',HERE/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        with tempfile.TemporaryDirectory() as tmp,patch.object(runtime,'source',return_value={'commit':'current'}),patch.object(runtime,'engine') as native:
            output=pathlib.Path(tmp)
            runtime.lifecycle.private_json(output/'owner.json',{'project':'untrusted'})
            runtime.lifecycle.private_json(output/'source.json',{'commit':'old'})
            with self.assertRaisesRegex(ValueError,'source_binding_changed'):runtime.recover(output)
            native.assert_not_called()

    def test_foreign_host_is_refused_before_engine_or_resources(self):
        spec=importlib.util.spec_from_file_location('signoz_runtime',HERE/'runtime.py')
        runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        with patch.object(runtime.platform,'system',return_value='Darwin'),patch.object(runtime.platform,'machine',return_value='arm64'):
            with self.assertRaisesRegex(ValueError,'native_linux_amd64_required'):
                runtime.require_native_host()

if __name__=='__main__':unittest.main()
