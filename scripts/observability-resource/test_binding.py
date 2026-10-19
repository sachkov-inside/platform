"""Public collection is bounded and excludes every private source/runtime credential."""
import json
import math
from pathlib import Path
import tempfile
import unittest
import binding
import hosted


class Artifacts(unittest.TestCase):
    def test_all_shared_and_new_executable_inputs_are_hash_bound(self):
        value=binding.source('a'*40,'b'*40)
        for name in ('scripts/production-runtime-configuration.sh','scripts/observability-resource/client.mjs',
                     'scripts/observability-resource/runtime.py','infra/observability/resource/profile.json',
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

    def test_collect_excludes_credentials_and_rejects_named_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'owned';output.mkdir()
            for name in ('compose.json','auth.json','datasources.json','api.env','token.json','engine-raw.json'):
                (output/name).write_text('{"private":"sentinel"}')
            binding.write(output/'resource-proof.json',{'schema':1,'acceptance':'pending'})
            binding.write(output/'startup-client.json',{'schema':1,'stage':'api_off_establish','state':'sampled','sample':{'label':'protected_account','outcome':'unexpected_response','status':401,'elapsed_ms':3}})
            hosted.collect(output,root/'public')
            self.assertEqual(sorted(path.name for path in (root/'public').iterdir()),['resource-proof.json','startup-client.json'])
            self.assertNotIn('sentinel',(root/'public/resource-proof.json').read_text())
            (output/'resource-current.json').symlink_to(output/'token.json')
            with self.assertRaises(ValueError):
                hosted.collect(output,root/'rejected')
