"""Publication/recovery boundaries retain private keys and refuse a live worker."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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
            (output/'umami-retention.json').write_text('{"state":"partial"}')
            (metadata/'source.json').write_text('{"source":"fixture"}')
            hosted.ci.collect(output, metadata, public, artifacts=hosted.ARTIFACTS)
            self.assertEqual(sorted(path.name for path in public.iterdir()), ['source.json', 'umami-proof.json', 'umami-retention.json'])
            self.assertNotIn('sentinel-private', ''.join(path.read_text() for path in public.iterdir()))

    def test_live_worker_is_not_recovered_by_another_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output/'owner.json').write_text(json.dumps({'project':hosted.runtime.PROJECT_PREFIX+'0123456789ab','cwd':str(hosted.ROOT), 'daemon': {'platform':'linux','context':'default',
                'endpoint':'unix:///fixture/docker.sock','daemon_id':'owned','storage':'/var/lib/docker',
                'socket_device':1,'socket_inode':2}}))
            (output/'worker.json').write_text(json.dumps({'pid':os.getpid(),'group':os.getpid()}))
            identity = json.loads((output/'owner.json').read_text())['daemon']
            with patch.object(hosted.ci.pilot.daemon, 'identify', return_value=identity), \
                    patch.multiple(hosted.ci.pilot, FROZEN_DOCKER_ENDPOINT=None, FROZEN_DOCKER_IDENTITY=None), \
                    self.assertRaisesRegex(ValueError, 'worker still exists'):
                hosted.ci.recover(output, project_prefix=hosted.runtime.PROJECT_PREFIX, services=hosted.runtime.SERVICES)

    def test_source_binding_includes_the_shared_supervisor_and_native_lock(self):
        names = {str(path.relative_to(hosted.ROOT)) for path in hosted.source_inputs()}
        self.assertTrue({'scripts/observability-pilot/daemon.py', 'scripts/observability-pilot/pilot.py',
                         'scripts/observability-pilot/storage_policy.py', 'scripts/observability-pilot/native_cpu.py',
                         'scripts/observability-pilot/collector_privacy.py', 'infra/observability/umami/mcp/package-lock.json',
                         'scripts/observability-umami/retention.sql', 'scripts/observability-umami/retention-corpus.sql',
                         'scripts/observability-umami/retention-proof.sql', 'infra/observability/umami/schema-fixture.sql',
                         'scripts/observability-umami-startup.pg.test.mjs', 'scripts/observability-umami-retention.pg.test.mjs',
                         '.github/workflows/observability-umami.yml'} <= names)
        self.assertTrue(all(path.is_file() for path in hosted.source_inputs()))

    def test_admission_and_curated_collection_bind_exact_eager_privacy_helper_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            metadata=root/'metadata'
            def command(args):
                if args[-1]=='HEAD':return 'a'*40
                if args[-1]=='HEAD^{tree}':return 'b'*40
                if args[-1]=='--porcelain':return ''
                return str(root)
            with patch.object(hosted.ci,'read_command',side_effect=command), \
                    patch.dict(os.environ,{'GITHUB_SHA':'a'*40}), \
                    patch.object(hosted.ci.shutil,'disk_usage',return_value=SimpleNamespace(total=200*1024**3,free=100*1024**3)), \
                    patch('sys.stdout',new=io.StringIO()):
                self.assertEqual(hosted.ci.admission(metadata,inputs=hosted.source_inputs()),0)
            private=root/'private';private.mkdir()
            public=root/'public'
            hosted.ci.collect(private,metadata,public,artifacts=hosted.ARTIFACTS)
            proof=json.loads((public/'source.json').read_text())
            for name in ('collector_privacy.py',):
                relative='scripts/observability-pilot/'+name
                self.assertEqual(proof['inputs'][relative],hashlib.sha256((hosted.ROOT/relative).read_bytes()).hexdigest())
