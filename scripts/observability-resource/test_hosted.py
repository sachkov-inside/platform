"""Hosted evidence trust at its public filesystem/provider boundary, without Docker."""
import json
import hashlib
import subprocess
import sys
from contextlib import contextmanager
from builtins import setattr as _set_source_constant
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
import hosted
import binding
import os
from unittest.mock import patch


_SOURCE_ROOT = binding.ROOT
_SOURCE_SCRIPTS = binding.SCRIPTS


@contextmanager
def _synthetic_source_checkout():
    if any(name.startswith('GIT_') and (name != 'GIT_PAGER' or type(value) is not str or value != 'cat')
           for name, value in os.environ.items()):
        raise ValueError('synthetic_git_environment_refused')
    if binding.ROOT is not _SOURCE_ROOT or binding.SCRIPTS is not _SOURCE_SCRIPTS:
        raise ValueError('synthetic_source_constants_refused')
    owned = tempfile.TemporaryDirectory(prefix='resource-source-fixture-')
    try:
        private = Path(owned.name)
        checkout = private / 'checkout'
        checkout.mkdir(mode=0o700)
        hooks = private / 'hooks'
        template = private / 'template'
        hooks.mkdir(mode=0o700)
        template.mkdir(mode=0o700)
        files = {
            'apps/backend/Dockerfile': b'FROM scratch\n# Synthetic binding fixture, never built.\n',
            'scripts/observability-resource/source_fixture.py': b'SYNTHETIC_SOURCE_INPUT = 1\n',
            '.github/workflows/observability-resource.yml': b'name: synthetic-source-input\n',
        }
        for name, content in files.items():
            parent = checkout
            for part in Path(name).parts[:-1]:
                parent = parent / part
                if not parent.exists():
                    parent.mkdir(mode=0o700)
            with os.fdopen(os.open(checkout / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
                stream.write(content)
        environment = {'PATH': os.environ['PATH'], 'LC_ALL': 'C',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
            'GIT_AUTHOR_NAME': 'Resource source fixture', 'GIT_AUTHOR_EMAIL': 'resource-fixture@example.invalid',
            'GIT_COMMITTER_NAME': 'Resource source fixture', 'GIT_COMMITTER_EMAIL': 'resource-fixture@example.invalid',
            'GIT_AUTHOR_DATE': '2000-01-01T00:00:00+0000', 'GIT_COMMITTER_DATE': '2000-01-01T00:00:00+0000'}
        setup_exits = []
        result = subprocess.run(['git', 'init', '--quiet', '--object-format=sha1',
            '--initial-branch=resource-source-fixture', '--template=' + str(template), str(checkout)],
            env=environment, check=True, capture_output=True, timeout=5)
        setup_exits.append(result.returncode)
        for key, value in (('core.hooksPath', str(hooks)), ('core.fsmonitor', 'false'),
                ('core.attributesFile', '/dev/null'), ('commit.gpgsign', 'false'),
                ('user.name', 'Resource source fixture'), ('user.email', 'resource-fixture@example.invalid')):
            result = subprocess.run(['git', '-C', str(checkout), 'config', '--local', '--replace-all', key, value],
                env=environment, check=True, capture_output=True, timeout=5)
            setup_exits.append(result.returncode)
        result = subprocess.run(['git', '-C', str(checkout), 'add', '--', *files],
            env=environment, check=True, capture_output=True, timeout=5)
        setup_exits.append(result.returncode)
        result = subprocess.run(['git', '-C', str(checkout), '-c', 'commit.gpgsign=false', 'commit',
            '--quiet', '--no-gpg-sign', '-m', 'Synthetic Resource source fixture'],
            env=environment, check=True, capture_output=True, timeout=5)
        setup_exits.append(result.returncode)
        # Private Git internals are owned fixture data too, never a shared object store.
        for directory, directories, names in os.walk(checkout / '.git'):
            os.chmod(directory, 0o700)
            for name in names:
                os.chmod(Path(directory) / name, 0o600)
        result = subprocess.run(['git', '-C', str(checkout), 'ls-files', '-z'],
            env=environment, check=True, capture_output=True, timeout=5)
        setup_exits.append(result.returncode)
        listed = result.stdout.decode().split('\0')
        if set(listed) != {*files, ''}:
            raise ValueError('synthetic_source_names_refused')
        identities = []
        for expression in ('HEAD', 'HEAD^{tree}'):
            result = subprocess.run(['git', '-C', str(checkout), 'rev-parse', expression],
                env=environment, check=True, capture_output=True, timeout=5)
            setup_exits.append(result.returncode)
            value = result.stdout.decode().strip()
            if len(value) != 40 or any(character not in '0123456789abcdef' for character in value):
                raise ValueError('synthetic_source_identity_refused')
            identities.append(value)
        _set_source_constant(binding, 'ROOT', checkout)
        _set_source_constant(binding, 'SCRIPTS', checkout / 'scripts/observability-resource')
        actual = binding.source(*identities)
        expected = {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}
        if (binding.ROOT is not checkout or binding.SCRIPTS != checkout / 'scripts/observability-resource'
                or actual['inputs'] != expected or any((checkout / name).read_bytes() != content for name, content in files.items())):
            raise ValueError('synthetic_source_inputs_refused')
        binding.write(private / 'source-receipt.json', {'commit': identities[0], 'tree': identities[1],
            'inputs': actual['inputs'], 'setup_exits': setup_exits})
        yield checkout
    finally:
        primary, traceback = sys.exc_info()[1:]
        cleanup_error = None
        for operation in (lambda: _set_source_constant(binding, 'ROOT', _SOURCE_ROOT),
                          lambda: _set_source_constant(binding, 'SCRIPTS', _SOURCE_SCRIPTS), owned.cleanup):
            try:
                operation()
            except BaseException as error:
                if cleanup_error is None:
                    cleanup_error = error
        if primary is not None:
            BaseException.__traceback__.__set__(primary, traceback)
        elif cleanup_error is not None:
            raise cleanup_error


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
        with _synthetic_source_checkout() as checkout, tempfile.TemporaryDirectory() as directory:
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
                             {'source.json', 'admission.json', 'resource-proof.json', 'resource-hosted.json',hosted.disk_feedback.NAME})
            self.assertNotIn('sentinel', ''.join(path.read_text() for path in public.iterdir()))
            self.assertEqual(json.loads((public / 'resource-proof.json').read_text())['state'], 'partial')
            self.assertEqual(json.loads((public / 'source.json').read_text())['run_id'], '123')

            self.assertIs(binding.ROOT, checkout)
            self.assertEqual(binding.SCRIPTS, checkout / 'scripts/observability-resource')
            actual, _ = hosted.metadata_source(admitted)
            receipt = json.loads((checkout.parent / 'source-receipt.json').read_text())
            self.assertEqual(receipt['setup_exits'], [0] * 12)
            self.assertEqual((receipt['commit'], receipt['tree']), (actual['checkout_sha'], actual['checkout_tree']))
            self.assertEqual(receipt['inputs'], actual['inputs'])
            self.assertEqual(set(actual['inputs']), {'apps/backend/Dockerfile',
                'scripts/observability-resource/source_fixture.py', '.github/workflows/observability-resource.yml'})
            for expression, field in (('HEAD', 'checkout_sha'), ('HEAD^{tree}', 'checkout_tree')):
                self.assertEqual(hosted.runtime.ci.read_command(['git', '-C', str(checkout), 'rev-parse', expression]), actual[field])
            for name, digest in actual['inputs'].items():
                path = checkout / name
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
                self.assertFalse(path.is_symlink())
                self.assertEqual(path.stat().st_nlink, 1)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            dockerfile = checkout / 'apps/backend/Dockerfile'
            original = dockerfile.read_bytes()
            try:
                dockerfile.write_bytes(original + b'# Controlled private source mutation.\n')
                with self.assertRaisesRegex(ValueError, '^resource_source_inputs_changed$'):
                    hosted.collect(output, root / 'changed-public', metadata=admitted)
                self.assertFalse((root / 'changed-public').exists())
            finally:
                dockerfile.write_bytes(original)
            self.assertEqual(hosted.metadata_source(admitted)[0], actual)
        self.assertIs(binding.ROOT, _SOURCE_ROOT)
        self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
        self.assertFalse(checkout.parent.exists())

        # Faults affect only our registered TEMP cleanup, never a source/hash/Git oracle.
        actual_temp = tempfile.TemporaryDirectory
        for primary in (RuntimeError('controlled fixture primary'), KeyboardInterrupt(), SystemExit()):
            for secondary in (None, primary, OSError('controlled cleanup secondary')):
                owned_paths = []
                def temporary(*args, **kwargs):
                    owned = actual_temp(*args, **kwargs)
                    owned_paths.append(Path(owned.name))
                    cleanup = owned.cleanup
                    def close():
                        cleanup()
                        if secondary is not None:
                            raise secondary
                    owned.cleanup = close
                    return owned
                with patch.object(tempfile, 'TemporaryDirectory', side_effect=temporary):
                    try:
                        with _synthetic_source_checkout():
                            try:
                                raise primary
                            except BaseException:
                                traceback = sys.exc_info()[2]
                                raise
                    except BaseException as error:
                        self.assertIs(error, primary)
                        self.assertIs(BaseException.__traceback__.__get__(error), traceback)
                    else:
                        self.fail('synthetic fixture primary suppressed')
                self.assertIs(binding.ROOT, _SOURCE_ROOT)
                self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
                self.assertEqual(len(owned_paths), 1)
                self.assertTrue(all(not path.exists() for path in owned_paths))


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
        with _synthetic_source_checkout() as checkout, tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            with self.assertRaisesRegex(ValueError, 'resource_project_not_acquired'):
                hosted.collect(root / 'private', root / 'public', metadata=admitted)
            self.assertEqual(json.loads((root / 'public/resource-hosted.json').read_text())['state'], 'no_registered_project')
            self.assertFalse((root / 'public/resource-proof.json').exists())

            self.assertIs(binding.ROOT, checkout)
            workflow = checkout / '.github/workflows/observability-resource.yml'
            original = workflow.read_bytes()
            try:
                workflow.unlink()
                with self.assertRaises(FileNotFoundError):
                    hosted.collect(root / 'private', root / 'workflow-public', metadata=admitted)
                self.assertFalse((root / 'workflow-public').exists())
            finally:
                with os.fdopen(os.open(workflow, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
                    stream.write(original)
            scripts = binding.SCRIPTS
            try:
                _set_source_constant(binding, 'SCRIPTS', _SOURCE_SCRIPTS)
                with self.assertRaises(ValueError):
                    hosted.collect(root / 'private', root / 'inconsistent-public', metadata=admitted)
                self.assertFalse((root / 'inconsistent-public').exists())
            finally:
                _set_source_constant(binding, 'SCRIPTS', scripts)
            hosted.metadata_source(admitted)
        self.assertIs(binding.ROOT, _SOURCE_ROOT)
        self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
        self.assertFalse(checkout.parent.exists())

        setter = _set_source_constant
        actual_temp = tempfile.TemporaryDirectory
        for phase in ('install', 'restore'):
            owned_paths = []
            restored = []
            primary = RuntimeError('controlled source constant failure')
            def temporary(*args, **kwargs):
                owned = actual_temp(*args, **kwargs)
                owned_paths.append(Path(owned.name))
                return owned
            def setting(module, name, value):
                if phase == 'install' and name == 'SCRIPTS' and value is not _SOURCE_SCRIPTS:
                    raise primary
                setter(module, name, value)
                if value is _SOURCE_ROOT or value is _SOURCE_SCRIPTS:
                    restored.append(name)
                    if phase == 'restore' and name == 'ROOT':
                        raise primary
            with patch.object(tempfile, 'TemporaryDirectory', side_effect=temporary), \
                    patch(__name__ + '._set_source_constant', side_effect=setting):
                try:
                    with _synthetic_source_checkout():
                        pass
                except RuntimeError as error:
                    self.assertIs(error, primary)
                else:
                    self.fail('synthetic source constant failure suppressed')
            self.assertEqual(restored, ['ROOT', 'SCRIPTS'])
            self.assertIs(binding.ROOT, _SOURCE_ROOT)
            self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
            self.assertEqual(len(owned_paths), 1)
            self.assertTrue(all(not path.exists() for path in owned_paths))


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
        with _synthetic_source_checkout() as checkout, tempfile.TemporaryDirectory() as directory:
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


            path = admitted / 'source.json'
            original = path.read_text()
            value = json.loads(original)
            value['inputs'] = []
            try:
                binding.write(path, value)
                with self.assertRaisesRegex(ValueError, '^resource_source_inputs_changed$'):
                    hosted.collect(root / 'private', root / 'malformed-public', metadata=admitted)
                self.assertFalse((root / 'malformed-public').exists())
            finally:
                path.write_text(original)
            hosted.metadata_source(admitted)
        self.assertIs(binding.ROOT, _SOURCE_ROOT)
        self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
        self.assertFalse(checkout.parent.exists())

        # Test-owned environment controls, not an operational filtering/repair path.
        environment = dict(os.environ)
        for change in ({'GIT_PAGER': 'cat --controlled-invalid'}, {'GIT_RESOURCE_FIXTURE_REFUSED': 'controlled'}):
            with patch.dict(os.environ, change), \
                    patch.object(tempfile, 'TemporaryDirectory', side_effect=AssertionError('TEMP acquired before refusal')):
                with self.assertRaisesRegex(ValueError, '^synthetic_git_environment_refused$'):
                    with _synthetic_source_checkout():
                        self.fail('Git steering accepted')
            self.assertTrue(dict(os.environ) == environment, 'test-owned environment not restored')
        for pager in (None, 'cat'):
            with patch.dict(os.environ):
                if pager is None:
                    os.environ.pop('GIT_PAGER', None)
                else:
                    os.environ['GIT_PAGER'] = pager
                with _synthetic_source_checkout() as accepted:
                    self.assertIs(binding.ROOT, accepted)
                self.assertFalse(accepted.parent.exists())
            self.assertTrue(dict(os.environ) == environment, 'test-owned environment not restored')

        actual_run = subprocess.run
        actual_temp = tempfile.TemporaryDirectory
        owned_paths = []
        def temporary(*args, **kwargs):
            owned = actual_temp(*args, **kwargs)
            owned_paths.append(Path(owned.name))
            return owned
        def command(args, **options):
            if args[:2] == ['git', 'init']:
                # Real fixed failing Git command in this helper's own checkout, not a result double.
                return actual_run(['git', 'init', '--resource-fixture-invalid-option', args[-1]], **options)
            return actual_run(args, **options)
        with patch.object(tempfile, 'TemporaryDirectory', side_effect=temporary), \
                patch.object(subprocess, 'run', side_effect=command):
            with self.assertRaises(subprocess.CalledProcessError):
                with _synthetic_source_checkout():
                    self.fail('failed Git setup accepted')
        self.assertIs(binding.ROOT, _SOURCE_ROOT)
        self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
        self.assertEqual(len(owned_paths), 1)
        self.assertTrue(all(not path.exists() for path in owned_paths))

        owned_paths = []
        failure = OSError('controlled cleanup failure without primary')
        def failing_temporary(*args, **kwargs):
            owned = actual_temp(*args, **kwargs)
            owned_paths.append(Path(owned.name))
            cleanup = owned.cleanup
            def close():
                cleanup()
                raise failure
            owned.cleanup = close
            return owned
        with patch.object(tempfile, 'TemporaryDirectory', side_effect=failing_temporary):
            try:
                with _synthetic_source_checkout():
                    pass
            except OSError as error:
                self.assertIs(error, failure)
            else:
                self.fail('cleanup failure without primary suppressed')
        self.assertIs(binding.ROOT, _SOURCE_ROOT)
        self.assertIs(binding.SCRIPTS, _SOURCE_SCRIPTS)
        self.assertEqual(len(owned_paths), 1)
        self.assertTrue(all(not path.exists() for path in owned_paths))


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
        self.exercise_build()

    def test_controlled_external_failures_identify_build_pull_and_inspection_stages(self):
        for stage in ('backend_build', 'foundation_build', 'preload_alloy', 'backend_inspect'):
            with self.subTest(stage=stage):
                self.exercise_build(failure=stage)

    def exercise_build(self, *, failure=None):
        import socket
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            endpoint = root / 'engine.sock'
            executable = root / 'docker'
            log = root / 'commands.jsonl'
            fake = '''import json, os, pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as stream:
    stream.write(json.dumps(args)+'\\n')
if args[:1] == ['--host']:
    args = args[2:]
state_path = root / 'images-state.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {}
stage = None
if args[:1] == ['build']:
    stage = 'backend_build' if '--target' in args else 'foundation_build'
elif args[:1] == ['pull'] and 'grafana/alloy:' in args[1]:
    stage = 'preload_alloy'
elif args[:2] == ['image', 'inspect'] and args[2].endswith('-backend:v1'):
    stage = 'backend_inspect'
if stage is not None and os.environ.get('RESOURCE_TEST_FAIL_STAGE') == stage:
    print('private-output-sentinel', file=sys.stderr)
    sys.exit(23)
if args == ['context', 'show']:
    print('owned-fixture')
elif args == ['context', 'inspect', 'owned-fixture', '--format', '{{.Endpoints.docker.Host}}']:
    print('unix://' + str(root / 'engine.sock'))
elif args == ['--context', 'owned-fixture', 'info', '--format', '{{json .}}']:
    print(json.dumps({'ID': 'owned-fixture', 'DockerRootDir': str(root)}))
elif args[:2] == ['image', 'ls']:
    selected = state
    if '--filter' in args:
        expression = args[args.index('--filter')+1]
        if expression.startswith('reference='):
            selected = {key: row for key,row in state.items() if expression[10:] in row['RepoTags']}
        else:
            key,value = expression[6:].split('=',1)
            selected = {key_:row for key_,row in state.items() if row['Config']['Labels'].get(key)==value}
    print('\\n'.join(selected))
elif args[:2] == ['image', 'inspect']:
    if '--format' in args:
        print('sha256:' + ('b' if args[2].endswith('-backend:v1') else 'c')*64)
    else:
        print(json.dumps([state[args[2]]]))
elif args[:2] == ['image', 'rm']:
    state.pop(args[-1]);state_path.write_text(json.dumps(state))
elif args[:2] == ['container','ls']:
    pass
elif args[:1] == ['build']:
    image='sha256:'+('b' if '--target' in args else 'c')*64
    key,value=args[args.index('--label')+1].split('=',1)
    state[image]={'Id':image,'RepoTags':[args[args.index('--tag')+1]],'RepoDigests':[], 'Config':{'Labels':{key:value}}}
    state_path.write_text(json.dumps(state))
    pathlib.Path(args[args.index('--iidfile')+1]).write_text(image)
elif args[:1] not in (['build'], ['pull']):
    sys.exit(9)
'''
            executable.write_text('#!' + sys.executable + '\n' + fake)
            executable.chmod(0o700)
            read = hosted.runtime.ci.read_command
            raw = hosted.runtime.pilot._raw_command
            show = ('docker', 'context', 'show')
            inspect = ('docker', 'context', 'inspect', 'owned-fixture', '--format', '{{.Endpoints.docker.Host}}')
            info = ('docker', '--context', 'owned-fixture', 'info', '--format', '{{json .}}')
            replies = {show: 'owned-fixture\n', inspect: 'unix://' + str(endpoint) + '\n',
                info: json.dumps({'ID': 'owned-fixture', 'DockerRootDir': str(root)}) + '\n'}
            identity_calls = []
            fallback_calls = []
            def identity_transport(args, **options):
                if (type(args) is not list or not args or args[0] != 'docker'
                        or any(type(value) is not str for value in args)):
                    raise ValueError('fixture_identity_argv')
                key = tuple(args)
                identity_calls.append(key)
                if key in replies:
                    return replies[key]
                fallback_calls.append(key)
                return raw(args, **options)
            def git_boundary(args):
                # The Git cleanliness double isolates a working test checkout.
                if args[-2:] == ['status', '--porcelain']:
                    return ''
                return identity_transport(args) if args[:1] == ['docker'] else read(args)
            old_endpoint = hosted.runtime.pilot.FROZEN_DOCKER_ENDPOINT
            old_identity = hosted.runtime.pilot.FROZEN_DOCKER_IDENTITY
            try:
                with socket.socket(socket.AF_UNIX) as engine:
                    engine.bind(str(endpoint))
                    with patch.dict(os.environ, {'PATH': str(root)+os.pathsep+os.environ['PATH'],
                            'DOCKER_HOST': '', 'DOCKER_TLS_VERIFY': '', 'DOCKER_CERT_PATH': '',
                            'RESOURCE_TEST_FAIL_STAGE': failure or ''}), \
                            patch.object(hosted.runtime.ci, 'read_command', side_effect=git_boundary), \
                            patch.object(hosted.runtime.pilot, '_raw_command', side_effect=identity_transport), \
                            patch.object(hosted.runtime.pilot.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)):
                        if not failure:
                            identity = hosted.runtime.pilot.daemon.identify(identity_transport)
                            self.assertEqual(identity['daemon_id'], 'owned-fixture')
                            self.assertEqual(identity['socket_inode'], endpoint.stat().st_ino)
                            self.assertEqual(identity_calls, [show, inspect, info])
                            self.assertEqual(fallback_calls, [], 'readonly identity fixture spawned a process')
                            for args, expected in replies.items():
                                self.assertEqual(raw(list(args)), expected)
                            for invalid in (None, (), [], ['foreign', 'context', 'show'], ['docker', 1]):
                                with self.subTest(argv=invalid), self.assertRaises(ValueError):
                                    identity_transport(invalid)
                            import subprocess
                            unknown = [
                                ['docker', 'context', 'show', '--extra'],
                                ['docker', 'context', 'inspect', 'foreign', '--format', '{{.Endpoints.docker.Host}}'],
                                ['docker', '--context', 'foreign', 'info', '--format', '{{json .}}'],
                                ['docker', '--context', 'owned-fixture', '--format', '{{json .}}', 'info'],
                                ['docker', 'image', 'info'],
                            ]
                            for args in unknown:
                                with self.subTest(argv=args), self.assertRaises(subprocess.CalledProcessError):
                                    identity_transport(args, timeout=3)
                                self.assertEqual(fallback_calls[-1], tuple(args))
                            for reply in ('{', json.dumps({'ID': '', 'DockerRootDir': str(root)})):
                                def malformed(args):
                                    value = identity_transport(args)
                                    return reply if tuple(args) == info else value
                                with self.assertRaises((ValueError, RuntimeError)):
                                    hosted.runtime.pilot.daemon.identify(malformed)
                            def not_socket(args):
                                value = identity_transport(args)
                                return 'unix://' + str(executable) if tuple(args) == inspect else value
                            with self.assertRaisesRegex(RuntimeError, 'not a socket'):
                                hosted.runtime.pilot.daemon.identify(not_socket)
                            def foreign(args, **options):
                                value = identity_transport(args, **options)
                                return json.dumps({'ID': 'foreign', 'DockerRootDir': str(root)}) if tuple(args) == info else value
                            with patch.object(hosted.runtime.pilot, 'FROZEN_DOCKER_IDENTITY', identity), \
                                    patch.object(hosted.runtime.pilot, '_raw_command', side_effect=foreign):
                                with self.assertRaisesRegex(RuntimeError, 'Docker identity changed'):
                                    hosted.runtime.pilot.assert_docker_identity()
                            identity_calls.clear()
                            fallback_calls.clear()
                            log.write_text('')
                        if failure:
                            import subprocess
                            with self.assertRaises((RuntimeError, subprocess.CalledProcessError)):
                                hosted.prepare(admitted, root / 'images.json', consumer=str(root / 'private'))
                        else:
                            hosted.prepare(admitted, root / 'images.json', consumer=str(root / 'private'))
                if failure:
                    source = json.loads((admitted / 'source.json').read_text())['checkout_sha']
                    value = hosted.acquisition.read(admitted / hosted.acquisition.NAME, source)
                    expected_boundary = 'inspection' if failure == 'backend_inspect' else 'child_wait'
                    self.assertEqual((value['stage'], value['boundary'], value['outcome'], value['exit_code']),
                                     (failure, expected_boundary, 'command_exit', 23))
                    self.assertNotIn('private-output-sentinel', (admitted / hosted.acquisition.NAME).read_text())
                    self.assertFalse((root / 'images.json').exists())
                    self.assertEqual(json.loads(state_path.read_text()) if (state_path := root/'images-state.json').exists() else {}, {})
                    with self.assertRaisesRegex(ValueError, 'resource_project_not_acquired'):
                        hosted.collect(root / 'private', root / 'public', metadata=admitted)
                    self.assertEqual(hosted.acquisition.read(root / 'public' / hosted.acquisition.NAME, source)['stage'], failure)
                    self.assertFalse((root / 'public' / 'resource-proof.json').exists())
                    return
                value = json.loads((root / 'images.json').read_text())
                self.assertEqual(value['backend'], 'sha256:'+'b'*64)
                self.assertEqual(value['foundation'], 'sha256:'+'c'*64)
                source = json.loads((admitted / 'source.json').read_text())['checkout_sha']
                self.assertEqual(value['source'], source)
                commands = [json.loads(row) for row in log.read_text().splitlines()]
                commands = [args[2:] if args[:1] == ['--host'] else args for args in commands]
                readonly = [args for args in identity_calls if args in replies]
                self.assertTrue(readonly, 'actual preparation skipped identity validation')
                self.assertEqual(readonly, [show, inspect, info] * (len(readonly) // 3))
                self.assertEqual(fallback_calls, [args for args in identity_calls if args not in replies])
                self.assertFalse(any(tuple(['docker', *args]) in replies for args in commands))
                receipt = json.loads((hosted.preparation.directory(root/'images.json')/'receipt.json').read_text())
                builds = [args for args in commands if args[:1] == ['build']]
                self.assertEqual(builds, [
                    ['build', '--file', 'apps/backend/Dockerfile', '--target', 'backend-production',
                     '--build-arg', 'INSIDE_RELEASE_VERSION=v1', '--build-arg', 'INSIDE_SOURCE_SHA='+source,
                     '--label', hosted.preparation.LABEL+'='+receipt['token'],
                     '--iidfile', str(hosted.preparation.directory(root/'images.json')/'backend.iid'),
                     '--tag', 'inside-platform-production-smoke-cache-123-1-backend:v1', '.'],
                    ['build', '--file', 'infra/production/database/Dockerfile',
                     '--label', hosted.preparation.LABEL+'='+receipt['token'],
                     '--iidfile', str(hosted.preparation.directory(root/'images.json')/'foundation.iid'), '--tag',
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
