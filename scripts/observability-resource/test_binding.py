"""Public collection is bounded and excludes every private source/runtime credential."""
import json
import math
from pathlib import Path
import tempfile
import unittest
import binding
import hosted
from test_hosted import metadata, _synthetic_source_checkout


class Artifacts(unittest.TestCase):
    def test_all_shared_and_new_executable_inputs_are_hash_bound(self):
        value=binding.source('a'*40,'b'*40)
        for name in ('apps/web/app/layout.tsx','apps/web/src/shared/config/runtime-config.server.ts',
                     'scripts/production-runtime-configuration.sh','scripts/observability-resource/client.mjs',
                     'scripts/observability-resource/runtime.py','scripts/observability-resource/sdk_diagnostics.py','infra/observability/resource/profile.json',
                     'scripts/observability-pilot/orbstack.py','scripts/observability-pilot/storage_policy.py'):
            self.assertRegex(value['inputs'][name],r'^[a-f0-9]{64}$')
        self.assertTrue(all(path.is_file() for path in binding.inputs()))

    def test_public_writer_rejects_nonfinite_and_oversize_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'proof.json'
            for value in ({'cpu':math.nan},{'cpu':math.inf},{'raw':'x'*binding.MAX_BYTES}):
                with self.assertRaises(ValueError):
                    binding.write(output,value)
                self.assertFalse(output.exists())

    @_synthetic_source_checkout()
    def test_collect_excludes_credentials_and_rejects_named_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'owned';output.mkdir()
            for name in ('compose.json','auth.json','datasources.json','api.env','token.json','engine-raw.json'):
                (output/name).write_text('{"private":"sentinel"}')
            binding.write(output/'resource-proof.json',{'schema':1,'acceptance':'pending'})
            binding.write(output/'startup-client.json',{'schema':1,'stage':'api_off_establish','state':'sampled','sample':{'label':'protected_account','outcome':'unexpected_response','status':401,'elapsed_ms':3}})
            binding.write(output/'resource-sdk-diagnostics.json',{'schema':1,'phases':[]})
            admitted=metadata(root)
            binding.write(output/'owner.json',{'cwd':str(binding.ROOT),'project':'inside-observability-resource-012345abcdef'})
            hosted.collect(output,root/'public',metadata=admitted)
            self.assertEqual(sorted(path.name for path in (root/'public').iterdir()),['admission.json','resource-disk-samples.json','resource-hosted.json','resource-proof.json','resource-sdk-diagnostics.json','source.json','startup-client.json'])
            self.assertNotIn('sentinel',(root/'public/resource-proof.json').read_text())
            (output/'resource-current.json').symlink_to(output/'token.json')
            with self.assertRaises(ValueError):
                hosted.collect(output,root/'rejected',metadata=admitted)


class D7Binding(unittest.TestCase):
    def test_new_workflow_and_bridge_are_in_the_exact_resource_and_runtime_closure(self):
        names={str(path.relative_to(binding.ROOT)) for path in binding.inputs()}
        for name in ('.github/workflows/observability-representative-d7.yml','scripts/observability-fullstack/representative_ci.py',
                'scripts/observability-fullstack/test_representative_ci.py'):
            self.assertTrue(name in names,name)

    @_synthetic_source_checkout()
    def test_changed_new_workflow_bytes_are_rejected_by_existing_metadata_admission(self):
        import subprocess
        workflow=binding.ROOT/'.github/workflows/observability-representative-d7.yml'
        workflow.write_text('name: source-bound-private-fixture\n')
        for argv in (['add','--',str(workflow.relative_to(binding.ROOT))],['commit','--quiet','--no-gpg-sign','-m','Private workflow source fixture']):
            subprocess.run(['git','-C',str(binding.ROOT),*argv],check=True,capture_output=True,timeout=5)
        with tempfile.TemporaryDirectory() as directory:
            admitted=metadata(Path(directory))
            source,_=hosted.metadata_source(admitted)
            self.assertEqual(source['inputs'][str(workflow.relative_to(binding.ROOT))],__import__('hashlib').sha256(workflow.read_bytes()).hexdigest())
            workflow.write_text('name: changed-private-fixture\n')
            with self.assertRaisesRegex(ValueError,'resource_source_inputs_changed'):hosted.metadata_source(admitted)
