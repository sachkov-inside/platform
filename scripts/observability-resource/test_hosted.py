"""Hosted evidence trust at its public filesystem/provider boundary, without Docker."""
import json
from pathlib import Path
import tempfile
import unittest
import hosted
import binding
import os
from unittest.mock import patch


def metadata(root):
    directory = root / "metadata"
    directory.mkdir()
    read = hosted.runtime.ci.read_command
    sha = read(["git", "-C", str(binding.ROOT), "rev-parse", "HEAD"])
    tree = read(["git", "-C", str(binding.ROOT), "rev-parse", "HEAD^{tree}"])
    value = {"checkout_sha": sha, "checkout_tree": tree, "repository": hosted.REPOSITORY,
        "provider_execution_sha": sha, "provider_pr_head_sha": "a"*40, "provider_pr_base_sha": "b"*40,
        "run_id": "123", "run_attempt": "1", "event": "pull_request", "scope": hosted.SCOPE,
        "inputs": binding.source(sha, tree)["inputs"]}
    binding.write(directory / "source.json", value)
    binding.write(directory / "admission.json", {"storage_filesystem_path": "/var/lib/docker",
        **hosted.runtime.ci.check_disk(total=40*1024**3, free=20*1024**3)})
    return directory


class Hosted(unittest.TestCase):
    def test_collection_requires_actual_admission_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'private'
            output.mkdir()
            with self.assertRaises(ValueError):
                hosted.collect(output, root / 'public', metadata=root / 'missing')

class Routing(unittest.TestCase):
    def test_actual_build_and_evidence_inputs_cannot_escape_pr_routing(self):
        import fnmatch
        import binding
        workflow = binding.ROOT / '.github/workflows/observability-resource.yml'
        self.assertTrue(workflow.is_file(), 'resource proof has no hosted route')
        text = workflow.read_text()
        routes = [line.strip()[2:].strip('"\'') for line in text.split('permissions:')[0].split('    paths:')[1].splitlines()
                  if line.strip().startswith('- ')]
        for path in binding.inputs():
            name = str(path.relative_to(binding.ROOT))
            self.assertTrue(any(fnmatch.fnmatchcase(name, route) for route in routes), name)


class EvidenceTrust(unittest.TestCase):
    def test_collection_preserves_provider_binding_and_never_exports_private_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            output = root / 'private'
            output.mkdir()
            binding.write(output / 'owner.json', {'cwd': str(binding.ROOT), 'project': 'inside-observability-resource-012345abcdef'})
            binding.write(output / 'resource-proof.json', {'state': 'partial', 'acceptance': 'pending'})
            for name in ('api.env', 'token.json', 'compose.json', 'engine-raw.json'):
                (output / name).write_text('{"private":"sentinel"}')
            hosted.collect(output, root / 'public', metadata=admitted)
            public = root / 'public'
            self.assertEqual(set(path.name for path in public.iterdir()),
                             {'source.json', 'admission.json', 'resource-proof.json', 'resource-hosted.json'})
            self.assertNotIn('sentinel', ''.join(path.read_text() for path in public.iterdir()))
            self.assertEqual(json.loads((public / 'resource-proof.json').read_text())['state'], 'partial')
            self.assertEqual(json.loads((public / 'source.json').read_text())['run_id'], '123')

    def test_changed_source_metadata_is_refused_before_collection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            path = admitted / 'source.json'
            source = json.loads(path.read_text())
            source['inputs']['apps/backend/Dockerfile'] = '0'*64
            binding.write(path, source)
            with self.assertRaisesRegex(ValueError, 'resource_source_inputs_changed'):
                hosted.collect(root / 'private', root / 'public', metadata=admitted)
            self.assertFalse((root / 'public').exists())

    def test_missing_project_cannot_manufacture_a_measurement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            with self.assertRaisesRegex(ValueError, 'resource_project_not_acquired'):
                hosted.collect(root / 'private', root / 'public', metadata=admitted)
            self.assertEqual(json.loads((root / 'public/resource-hosted.json').read_text())['state'], 'no_registered_project')
            self.assertFalse((root / 'public/resource-proof.json').exists())

    def test_missing_provider_identity_is_refused_before_any_acquisition(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'provider_source_missing'):
                hosted.context()

    def test_manifest_rejects_wrong_source_extra_fields_and_same_images(self):
        valid = {'schema': 1, 'source': 'a'*40, 'owner': 'inside-platform-production-smoke-cache-123-1',
                 'backend': 'sha256:'+'b'*64, 'foundation': 'sha256:'+'c'*64}
        for invalid in ({**valid, 'source': 'd'*40}, {**valid, 'extra': 'raw'},
                        {**valid, 'foundation': valid['backend']}, {**valid, 'schema': True},
                        {**valid, 'owner': 'foreign'}):
            with self.assertRaises(ValueError):
                hosted.runtime.fixture.images(invalid, 'a'*40)


    def test_unknown_metadata_fields_never_reach_public_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            for name in ('source.json', 'admission.json'):
                path = admitted / name
                original = path.read_text()
                value = json.loads(original)
                value['private'] = 'sentinel'
                binding.write(path, value)
                with self.assertRaises(ValueError):
                    hosted.collect(root / 'private', root / 'public', metadata=admitted)
                self.assertFalse((root / 'public').exists())
                path.write_text(original)


class AcquisitionProcessOwnership(unittest.TestCase):
    def test_success_failure_and_timeout_close_the_actual_descendant_socket(self):
        import socket
        import threading
        import time
        import subprocess
        import sys
        fixture = '''import pathlib, subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(120)"], stdout=subprocess.PIPE, text=True)
port = child.stdout.readline().strip()
pathlib.Path(sys.argv[1]).write_text(port)
if sys.argv[2] == 'timeout':
    time.sleep(120)
else:
    sys.exit(int(sys.argv[2]))
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'owned.py'
            source.write_text(fixture)
            for mode in ('0', '7', 'timeout'):
                port_file = root / mode
                args = [sys.executable, str(source), str(port_file), mode]
                if mode == '0':
                    hosted.command(args, 5)
                else:
                    with self.assertRaises((RuntimeError, subprocess.TimeoutExpired)):
                        hosted.command(args, 1 if mode == 'timeout' else 5)
                port = int(port_file.read_text())
                deadline = time.monotonic() + 3
                while True:
                    try:
                        with socket.socket() as probe:
                            probe.bind(('127.0.0.1', port))
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise
                        # Poll the actual socket-release fact after process-group signals.
                        threading.Event().wait(.01)


class ExactSourceBuildBoundary(unittest.TestCase):
    def test_two_builds_and_seven_pulls_create_only_actual_inspected_image_ids(self):
        import socket
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            endpoint = root / 'engine.sock'
            executable = root / 'docker'
            log = root / 'commands.jsonl'
            fake = '''import json, pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as stream:
    stream.write(json.dumps(args)+'\\n')
if args[:1] == ['--host']:
    args = args[2:]
if args == ['context', 'show']:
    print('owned-fixture')
elif args[:2] == ['context', 'inspect']:
    print('unix://' + str(root / 'engine.sock'))
elif 'info' in args:
    print(json.dumps({'ID': 'owned-fixture', 'DockerRootDir': str(root)}))
elif args[:2] == ['image', 'inspect']:
    print('sha256:' + ('b' if args[2].endswith('-backend:v1') else 'c')*64)
elif args[:1] not in (['build'], ['pull']):
    sys.exit(9)
'''
            executable.write_text('#!' + sys.executable + '\n' + fake)
            executable.chmod(0o700)
            read = hosted.runtime.ci.read_command
            def git_boundary(args):
                # The Git cleanliness double isolates a working test checkout.
                return '' if args[-2:] == ['status', '--porcelain'] else read(args)
            old_endpoint = hosted.runtime.pilot.FROZEN_DOCKER_ENDPOINT
            old_identity = hosted.runtime.pilot.FROZEN_DOCKER_IDENTITY
            try:
                with socket.socket(socket.AF_UNIX) as engine:
                    engine.bind(str(endpoint))
                    with patch.dict(os.environ, {'PATH': str(root)+os.pathsep+os.environ['PATH'],
                            'DOCKER_HOST': '', 'DOCKER_TLS_VERIFY': '', 'DOCKER_CERT_PATH': ''}), \
                            patch.object(hosted.runtime.ci, 'read_command', side_effect=git_boundary):
                        hosted.prepare(admitted, root / 'images.json')
                value = json.loads((root / 'images.json').read_text())
                self.assertEqual(value['backend'], 'sha256:'+'b'*64)
                self.assertEqual(value['foundation'], 'sha256:'+'c'*64)
                source = json.loads((admitted / 'source.json').read_text())['checkout_sha']
                self.assertEqual(value['source'], source)
                commands = [json.loads(row) for row in log.read_text().splitlines()]
                commands = [args[2:] if args[:1] == ['--host'] else args for args in commands]
                builds = [args for args in commands if args[:1] == ['build']]
                self.assertEqual(builds, [
                    ['build', '--file', 'apps/backend/Dockerfile', '--target', 'backend-production',
                     '--build-arg', 'INSIDE_RELEASE_VERSION=v1', '--build-arg', 'INSIDE_SOURCE_SHA='+source,
                     '--tag', 'inside-platform-production-smoke-cache-123-1-backend:v1', '.'],
                    ['build', '--file', 'infra/production/database/Dockerfile', '--tag',
                     'inside-platform-production-smoke-cache-123-1-foundation:local', 'infra/production/database']])
                pulls = [args for args in commands if args[:1] == ['pull']]
                self.assertEqual(len(pulls), 7)
                self.assertEqual(len({args[1] for args in pulls}), 7)
                self.assertTrue(all('@sha256:' in args[1] for args in pulls))
                self.assertEqual((root / 'images.json').stat().st_mode & 0o777, 0o600)
            finally:
                hosted.runtime.pilot.FROZEN_DOCKER_ENDPOINT = old_endpoint
                hosted.runtime.pilot.FROZEN_DOCKER_IDENTITY = old_identity


class ProviderExecutionBoundary(unittest.TestCase):
    def test_wrong_provider_checkout_is_refused_before_docker_admission(self):
        read = hosted.runtime.ci.read_command
        def git_boundary(args):
            return '' if args[-2:] == ['status', '--porcelain'] else read(args)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'metadata'
            with patch.dict(os.environ, {'GITHUB_SHA': 'a'*40, 'PILOT_PR_HEAD_SHA': 'b'*40,
                    'PILOT_PR_BASE_SHA': 'c'*40, 'GITHUB_REPOSITORY': hosted.REPOSITORY,
                    'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}), \
                    patch.object(hosted.runtime.ci, 'read_command', side_effect=git_boundary):
                with self.assertRaisesRegex(ValueError, 'checkout SHA does not match provider execution SHA'):
                    hosted.admission(target)
            self.assertEqual(list(target.iterdir()), [])


class AcquisitionInterruption(unittest.TestCase):
    def test_sigterm_to_preparation_closes_the_owned_command_socket(self):
        self.exercise(fail_before_readiness=False)

    def test_readiness_read_failure_before_facts_still_closes_the_actual_child_socket(self):
        self.exercise(fail_before_readiness=True)

    def exercise(self, *, fail_before_readiness):
        import signal
        import socket
        import subprocess
        import sys
        import threading
        import time
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker = root / 'worker.py'
            record = root / 'ready.json'
            ownership = root / 'command.json'
            worker.write_text('''import json, os, pathlib, socket, sys, time
s = socket.socket()
s.bind(('127.0.0.1', 0))
s.listen()
p = pathlib.Path(sys.argv[1])
p.with_suffix('.new').write_text(json.dumps({'port': s.getsockname()[1], 'pid': os.getpid()}))
p.with_suffix('.new').replace(p)
time.sleep(120)
''')
            launch = '''import json, os, pathlib, signal, subprocess, sys
sys.path.insert(0, sys.argv[1])
import hosted
def interrupt(_signum, _frame):
    raise KeyboardInterrupt()
signal.signal(signal.SIGTERM, interrupt)
# The fixture registers the actual external process acquisition before readiness.
create = subprocess.Popen
def register(*args, **kwargs):
    child = create(*args, **kwargs)
    if kwargs.get('start_new_session') is not True:
        return child
    try:
        path = pathlib.Path(sys.argv[4])
        path.with_suffix('.new').write_text(json.dumps({'pid': child.pid, 'group': child.pid}))
        path.with_suffix('.new').replace(path)
    except BaseException:
        hosted.signal_group(child.pid, signal.SIGKILL)
        child.wait(timeout=3)
        raise
    return child
hosted.subprocess.Popen = register
hosted.command([sys.executable, sys.argv[2], sys.argv[3]], 10)
'''
            process = subprocess.Popen([sys.executable, '-c', launch, str(binding.SCRIPTS), str(worker), str(record), str(ownership)],
                start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            facts = None
            registered = None
            observed = None
            def cleanup_launcher():
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
                finally:
                    # Acquisition registration is independent of readiness and its parser.
                    owned = registered
                    if owned is None and ownership.is_file():
                        owned = json.loads(ownership.read_text())
                    groups = [process.pid]
                    if owned is not None:
                        if (set(owned) != {'pid', 'group'} or type(owned['pid']) is not int
                                or owned['pid'] <= 0 or owned['pid'] != owned['group']):
                            raise ValueError('invalid_owned_fixture_group')
                        groups.append(owned['group'])
                    for group in groups:
                        hosted.signal_group(group, signal.SIGKILL)
                    process.wait(timeout=3)
            try:
                deadline = time.monotonic() + 5
                while not ownership.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        self.fail('owned command did not register acquisition')
                    threading.Event().wait(.01)
                registered = json.loads(ownership.read_text())
                self.assertEqual(registered['pid'], registered['group'])
                self.assertGreater(registered['group'], 0)
                while not record.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        self.fail('owned command did not acquire its socket')
                    threading.Event().wait(.01)
                # The external supervisor retains cleanup facts independently of readiness.
                observed = json.loads(record.read_text())
                self.assertEqual(observed['pid'], registered['pid'])
                try:
                    if fail_before_readiness:
                        record.write_text('invalid-readiness-json')
                        with self.assertRaises(json.JSONDecodeError):
                            facts = json.loads(record.read_text())
                        self.assertIsNone(facts)
                    else:
                        facts = json.loads(record.read_text())
                        process.terminate()
                        self.assertNotEqual(process.wait(timeout=5), 0)
                finally:
                    cleanup_launcher()
                deadline = time.monotonic() + 3
                while True:
                    try:
                        with socket.socket() as probe:
                            probe.bind(('127.0.0.1', observed['port']))
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise
                        threading.Event().wait(.01)
            finally:
                cleanup_launcher()


class GroupSignalBoundary(unittest.TestCase):
    def test_permission_refusal_is_tolerated_only_for_observed_zombies_or_absence(self):
        import signal
        import subprocess
        for states in ('Z\nZ+\n', ''):
            with patch.object(os, 'killpg', side_effect=PermissionError()), \
                    patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, states, '')):
                hosted.signal_group(12345, signal.SIGKILL)
        with patch.object(os, 'killpg', side_effect=PermissionError()), \
                patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'S\n', '')):
            with self.assertRaises(PermissionError):
                hosted.signal_group(12345, signal.SIGKILL)


class DuplicateMetadata(unittest.TestCase):
    def test_literal_and_escaped_overwritten_private_fields_are_refused_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            output = root / 'private'
            output.mkdir()
            binding.write(output / 'owner.json', {'cwd': str(binding.ROOT), 'project': 'inside-observability-resource-012345abcdef'})
            for index, (name, key) in enumerate((('source.json', 'scope'), ('source.json', 'sco\\u0070e'),
                                                ('admission.json', 'reason'), ('admission.json', 'rea\\u0073on'))):
                with self.subTest(document=name, key=key):
                    path = admitted / name
                    original = path.read_text()
                    path.write_text('{"' + key + '":"private-duplicate-sentinel",' + original.lstrip()[1:])
                    destination = root / ('public-' + str(index))
                    try:
                        with self.assertRaises(ValueError):
                            hosted.collect(output, destination, metadata=admitted)
                        self.assertFalse(destination.exists())
                        self.assertFalse(any('private-duplicate-sentinel' in file.read_text()
                            for file in root.glob('public-*/*') if file.is_file()))
                    finally:
                        path.write_text(original)


if __name__ == '__main__':
    unittest.main()
