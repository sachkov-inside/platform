"""Exercise cleanup CLI against a disposable Docker command double, without real Docker."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('broker-upgrade-proof.py')
OWNER = 'a' * 32
PREFIX = 'inside-broker-proof-' + OWNER


class BrokerCleanupTest(unittest.TestCase):
    def invoke(self, *, journal_owner=OWNER, journal_daemon='test-daemon', journal_name=None,
               returned_name=None, daemon_failure=False, remote=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            endpoint = 'unix://' + str(root / 'docker.sock')
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(root / 'docker.sock'))
                state = root / 'state'
                state.mkdir()
                name = journal_name or PREFIX + '-source'
                (state / 'resources.json').write_text(json.dumps(dict(owner=journal_owner,
                    resources=[['volume', name]], endpoint=endpoint, daemon=journal_daemon)))
                log = root / 'calls.jsonl'
                docker = root / 'docker'
                docker.write_text('''#!/usr/bin/env python3
import json, sys
from pathlib import Path
args=sys.argv[3:]
with Path(''' + repr(str(log)) + ''').open('a') as output: output.write(json.dumps(args)+'\\n')
if args[0]=='info':
    ''' + ('sys.exit(1)' if daemon_failure else "print('\"test-daemon\"')") + '''
elif args[:2]==['volume','ls']: print(''' + repr(returned_name or name) + ''')
''')
                docker.chmod(0o755)
                result = subprocess.run(['python3', str(SCRIPT), '--cleanup-only', '--state-directory', str(state)],
                    capture_output=True, text=True, check=False,
                    env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                         'DOCKER_HOST': 'ssh://production' if remote else endpoint})
                calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
                return result, calls

    def test_removes_only_journaled_and_labelled_owned_resources(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(['volume', 'rm', PREFIX + '-source'], calls)
        self.assertTrue(all('label=inside.broker-upgrade-proof=' + OWNER in call for call in calls if 'ls' in call or 'ps' in call))

    def test_refuses_foreign_name_before_removing_any_resource(self):
        result, calls = self.invoke(journal_name='inside-platform_broker-data')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('rm' in call for call in calls))

    def test_refuses_changed_daemon(self):
        result, calls = self.invoke(journal_daemon='another-daemon')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('rm' in call for call in calls))

    def test_refuses_unexpected_labelled_resource(self):
        result, calls = self.invoke(returned_name=PREFIX + '-not-journaled')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('rm' in call for call in calls))

    def test_daemon_query_failure_is_not_empty_success(self):
        result, calls = self.invoke(daemon_failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('rm' in call for call in calls))

    def test_refuses_remote_endpoint_before_contacting_docker(self):
        result, calls = self.invoke(remote=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
