"""The Linux installer must reject an untrusted download without replacing a plugin."""
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[1] / 'infra/production/host/install-docker-compose.sh'


class ComposeInstallationTest(unittest.TestCase):
    @unittest.skipUnless(platform.system() == 'Linux', 'Linux-only installation boundary')
    def test_wrong_checksum_never_executes_or_replaces_the_existing_plugin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'
            tools.mkdir()
            curl = tools / 'curl'
            curl.write_text('''#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; output="$1"; fi
  shift
done
printf '#!/bin/sh\\ntouch "%s"\\n' "$INSIDE_COMPOSE_TEST_MARKER" > "$output"
''')
            curl.chmod(0o755)
            destination = root / 'plugins'
            destination.mkdir()
            previous = destination / 'docker-compose'
            previous.write_text('previous verified plugin\n')
            marker = root / 'untrusted-binary-executed'
            result = subprocess.run(['bash', str(INSTALLER), str(destination)], capture_output=True, text=True,
                                    env={**os.environ, 'PATH': str(tools) + os.pathsep + os.environ['PATH'],
                                         'INSIDE_COMPOSE_TEST_MARKER': str(marker)}, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(previous.read_text(), 'previous verified plugin\n')
            self.assertFalse(marker.exists())
            self.assertEqual(sorted(path.name for path in destination.iterdir()), ['docker-compose'])
            self.assertIn('checksum', result.stderr.lower())


if __name__ == '__main__':
    unittest.main()
