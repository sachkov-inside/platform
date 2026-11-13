"""Public CLI proof: bind broker identity to the manifest's exact runtime archive."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('release-broker-image.py')
IMAGE = 'ghcr.io/sachkov-inside/rabbitmq@sha256:' + 'a' * 64


class BrokerArchiveTest(unittest.TestCase):
    def invoke(self, digest=None, member='compose.production.yaml', image=IMAGE, large_pax=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'runtime.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                for name in [member, 'bin/deploy-release', 'caddy/maintenance.caddy', 'caddy/platform.caddy']:
                    content = b'services: {}\n'
                    info = tarfile.TarInfo(name)
                    if large_pax:
                        info.pax_headers = {'comment': 'x' * (17 * 1024 * 1024)}
                    info.size = len(content)
                    output.addfile(info, io.BytesIO(content))
            docker = root / 'docker'
            docker.write_text('#!/bin/sh\nprintf \'%s\\n\' ' + "'" + json.dumps({'services': {'rabbitmq': {'image': image}}}) + "'\n")
            docker.chmod(0o755)
            digest = digest or 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
            return subprocess.run(['python3', str(SCRIPT), str(archive), digest],
                                  env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH']},
                                  capture_output=True, text=True, check=False)

    def test_exact_archive_returns_broker_identity(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), IMAGE)

    def test_hash_mismatch_is_rejected_before_parsing(self):
        result = self.invoke(digest='sha256:' + '0' * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('digest mismatch', result.stderr)

    def test_foreign_archive_member_is_rejected(self):
        result = self.invoke(member='../compose.production.yaml')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('archive members', result.stderr)

    def test_compressed_pax_header_bomb_is_bounded_before_tar_parsing(self):
        result = self.invoke(large_pax=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('expanded runtime archive exceeds', result.stderr)

    def test_floating_broker_image_is_rejected(self):
        result = self.invoke(image='rabbitmq:latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('immutable broker', result.stderr)


if __name__ == '__main__':
    unittest.main()
