"""Publication/recovery boundaries retain private keys and refuse a live worker."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('umami_hosted', Path(__file__).with_name('hosted.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)


class HostedBoundaries(unittest.TestCase):
    def test_only_explicit_curated_files_are_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output, metadata, public = root/'private', root/'metadata', root/'public'
            output.mkdir()
            metadata.mkdir()
            for name in ('reader.key', 'init.sql', 'compose.json', 'fixture-state.json', 'upstream-errors.log'):
                (output/name).write_text('{"secret":"sentinel-private-fixture"}')
            (output/'umami-proof.json').write_text('{"query":"passed"}')
            (metadata/'source.json').write_text('{"source":"fixture"}')
            hosted.ci.collect(output, metadata, public, artifacts=hosted.ARTIFACTS)
            self.assertEqual(sorted(path.name for path in public.iterdir()), ['source.json', 'umami-proof.json'])
            self.assertNotIn('sentinel-private', ''.join(path.read_text() for path in public.iterdir()))

    def test_live_worker_is_not_recovered_by_another_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output/'owner.json').write_text(json.dumps({'project':hosted.runtime.PROJECT_PREFIX+'0123456789ab','cwd':str(hosted.ROOT)}))
            (output/'worker.json').write_text(json.dumps({'pid':os.getpid(),'group':os.getpid()}))
            with self.assertRaisesRegex(ValueError, 'worker still exists'):
                hosted.ci.recover(output, project_prefix=hosted.runtime.PROJECT_PREFIX, services=hosted.runtime.SERVICES)

    def test_source_binding_includes_the_shared_supervisor_and_native_lock(self):
        names = {str(path.relative_to(hosted.ROOT)) for path in hosted.source_inputs()}
        self.assertTrue({'scripts/observability-pilot/daemon.py', 'scripts/observability-pilot/pilot.py',
                         'scripts/observability-pilot/storage_policy.py', 'infra/observability/umami/mcp/package-lock.json',
                         '.github/workflows/observability-umami.yml'} <= names)
        self.assertTrue(all(path.is_file() for path in hosted.source_inputs()))
