"""Preparation-owned image lifetime at the Docker/filesystem boundary, no live daemon."""
import json
import fcntl
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import threading
import tempfile
import unittest
from unittest.mock import patch
import preparation

SOURCE = 'a' * 40
OWNER = 'inside-platform-production-smoke-cache-test'
DAEMON = {'platform': 'linux', 'endpoint': 'unix:///fixture/docker.sock', 'daemon_id': 'fixture'}
IMAGE = 'sha256:' + 'b' * 64


class Docker:
    def __init__(self):
        self.images = {}
        self.used = set()
        self.removed = []

    def __call__(self, args):
        if args[:2] == ['image', 'ls']:
            selected = self.images
            if '--filter' in args:
                expression = args[args.index('--filter') + 1]
                if expression.startswith('reference='):
                    selected = {key: row for key, row in selected.items() if expression[10:] in row['RepoTags']}
                else:
                    key, value = expression.removeprefix('label=').split('=', 1)
                    selected = {key_: row for key_, row in selected.items() if row['Config']['Labels'].get(key) == value}
            return '\n'.join(selected)
        if args[:2] == ['image', 'inspect']:
            return json.dumps([self.images[args[2]]])
        if args[:2] == ['container', 'ls']:
            return 'container' if args[-1].removeprefix('ancestor=') in self.used else ''
        if args[:2] == ['image', 'rm']:
            image = args[-1]
            self.removed.append(image)
            del self.images[image]
            return ''
        raise AssertionError(args)

    def build(self, stage, image=IMAGE, tags=None):
        self.images[image] = {'Id': image, 'RepoTags': tags if tags is not None else [OWNER + '-backend:v1'],
            'RepoDigests': [], 'Config': {'Labels': {preparation.LABEL: stage.receipt['token']}}}
        stage.iidfile('backend').write_text(image)


class Lifetime(unittest.TestCase):
    def test_recovery_waits_for_active_preparation_and_observes_its_final_build_results(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            entered = threading.Event()
            result = []
            thread = None
            try:
                with preparation.acquire(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                        docker=docker, identify=lambda: DAEMON) as stage:
                    docker.build(stage)
                    recovery = preparation.open_stage(Path(directory) / 'images.json', docker=docker, identify=lambda: DAEMON)
                    def release():
                        entered.set()
                        result.append(recovery.release('runtime', cleanup_ok=True))
                    thread = threading.Thread(target=release)
                    thread.start()
                    self.assertTrue(entered.wait(timeout=5))
                    with (stage.path / 'use.lock').open('rb') as lock:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    foundation = 'sha256:' + 'c' * 64
                    docker.images[foundation] = {'Id': foundation, 'RepoTags': [OWNER + '-foundation:local'],
                        'RepoDigests': [], 'Config': {'Labels': {preparation.LABEL: stage.receipt['token']}}}
                    stage.iidfile('foundation').write_text(foundation)
            finally:
                if thread is not None:
                    thread.join(timeout=10)
                    self.assertFalse(thread.is_alive())
            self.assertEqual(set(result[0]['retired']), {IMAGE, foundation})

    def test_missing_build_result_retains_unknown_tag_until_its_own_result_can_be_recovered(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            stage = preparation.begin(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            stage.iidfile('backend').unlink()
            self.assertEqual(stage.release('runtime', cleanup_ok=True)['protected'], [IMAGE])
            self.assertIn(IMAGE, docker.images)
            stage.iidfile('backend').write_text(IMAGE)
            self.assertEqual(stage.release('runtime', cleanup_ok=True)['retired'], [IMAGE])

    def test_inherited_label_never_makes_a_later_foreign_descendant_owned(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            stage = preparation.begin(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            stage.capture()
            foreign = 'sha256:' + '1' * 64
            docker.images[foreign] = {'Id': foreign, 'RepoTags': [], 'RepoDigests': [],
                'Config': {'Labels': {preparation.LABEL: stage.receipt['token']}}}
            self.assertEqual(stage.release('runtime', cleanup_ok=True)['retired'], [IMAGE])
            self.assertIn(foreign, docker.images)

    def test_named_next_consumer_keeps_images_until_its_final_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = Docker()
            stage = preparation.begin(root / 'images.json', SOURCE, OWNER, DAEMON, str(root / 'first'),
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            stage.capture()
            stage.retain(str(root / 'next'), 'admitted TLS-corrected experiment')
            first = stage.release(str(root / 'first'), cleanup_ok=True)
            self.assertEqual(first['state'], 'retained')
            self.assertIn(IMAGE, docker.images)
            stage = preparation.open_stage(root / 'images.json', docker=docker, identify=lambda: DAEMON)
            result = stage.release(str(root / 'next'), cleanup_ok=True)
            self.assertEqual(result['retired'], [IMAGE])
            self.assertNotIn(IMAGE, docker.images)
            self.assertEqual(stage.release(str(root / 'next'), cleanup_ok=True)['retired'], [])
            self.assertEqual(docker.removed, [IMAGE])

    def test_partial_failure_and_interruption_retire_only_images_created_by_the_stage(self):
        for error in (RuntimeError('failed build'), subprocess.TimeoutExpired('build', 1), KeyboardInterrupt()):
            with self.subTest(outcome=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                docker = Docker()
                with self.assertRaises(type(error)) as caught:
                    with preparation.acquire(root / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                            docker=docker, identify=lambda: DAEMON) as stage:
                        docker.build(stage)
                        raise error
                self.assertIs(caught.exception, error)
                self.assertNotIn(IMAGE, docker.images)
                receipt = preparation.open_stage(root / 'images.json', docker=docker, identify=lambda: DAEMON)
                self.assertEqual(receipt.receipt['source'], SOURCE)

    def test_preexisting_shared_current_and_foreign_images_survive_final_release(self):
        for protection in ('preexisting', 'foreign-label', 'foreign-tag', 'digest', 'current-container'):
            with self.subTest(protection=protection), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                docker = Docker()
                if protection == 'preexisting':
                    docker.images[IMAGE] = {'Config': {'Labels': {}}, 'RepoTags': ['foreign:old']}
                stage = preparation.begin(root / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                    docker=docker, identify=lambda: DAEMON)
                docker.build(stage)
                stage.capture()
                row = docker.images[IMAGE]
                if protection == 'foreign-label':
                    row['Config']['Labels'][preparation.LABEL] = 'foreign'
                elif protection == 'foreign-tag':
                    row['RepoTags'].append('inside-platform-current:stand')
                elif protection == 'digest':
                    row['RepoDigests'] = ['registry.test/recovery@' + IMAGE]
                elif protection == 'current-container':
                    docker.used.add(IMAGE)
                result = stage.release('runtime', cleanup_ok=True)
                self.assertEqual(result['protected'], [IMAGE])
                self.assertEqual(docker.removed, [])
                self.assertIn(IMAGE, docker.images)

    def test_failed_runtime_recovery_retains_inputs_until_explicit_successful_release(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            stage = preparation.begin(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            self.assertEqual(stage.release('runtime', cleanup_ok=False)['reason'], 'recovery_required')
            stage.require_consumer('runtime')
            self.assertEqual(stage.release('runtime', cleanup_ok=True)['retired'], [IMAGE])

    def test_existing_owner_tag_is_refused_before_any_build(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            docker.images[IMAGE] = {'RepoTags': [OWNER + '-backend:v1']}
            with self.assertRaisesRegex(ValueError, 'preparation_tag_already_exists'):
                preparation.begin(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                    docker=docker, identify=lambda: DAEMON)

    def test_changed_daemon_and_symlink_receipt_refuse_without_removing_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = Docker()
            stage = preparation.begin(root / 'images.json', SOURCE, OWNER, DAEMON, 'runtime',
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            stage.capture()
            changed = preparation.open_stage(root / 'images.json', docker=docker, identify=lambda: {'daemon_id': 'foreign'})
            with self.assertRaisesRegex(ValueError, 'preparation_daemon_changed'):
                changed.release('runtime', cleanup_ok=True)
            receipt = stage.path / 'receipt.json'
            receipt.rename(root / 'foreign.json')
            receipt.symlink_to(root / 'foreign.json')
            with self.assertRaises(OSError):
                preparation.open_stage(root / 'images.json', docker=docker, identify=lambda: DAEMON)
            self.assertIn(IMAGE, docker.images)
            self.assertEqual(docker.removed, [])

    def test_forged_release_record_cannot_silently_release_a_named_next_consumer(self):
        with tempfile.TemporaryDirectory() as directory:
            docker = Docker()
            stage = preparation.begin(Path(directory) / 'images.json', SOURCE, OWNER, DAEMON, 'first',
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            stage.retain('next', 'admitted next experiment')
            release = stage.path / ('release-' + preparation.consumer_key('next') + '.json')
            release.write_text('{"consumer":"foreign"}')
            release.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'preparation_consumer_receipt'):
                stage.release('first', cleanup_ok=True)
            self.assertIn(IMAGE, docker.images)

    def test_real_owned_process_retires_after_success_failure_term_and_explicit_kill_recovery(self):
        script = '''import json, signal, sys
from pathlib import Path
from test_preparation import Docker, SOURCE, OWNER, DAEMON
import preparation
root=Path(sys.argv[1]);mode=sys.argv[2]
class PersistentDocker(Docker):
    def save(self): (root/'docker-state.json').write_text(json.dumps(self.images))
    def __call__(self,args):
        result=super().__call__(args);self.save();return result
    def build(self,stage): super().build(stage);self.save()
docker=PersistentDocker()
signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
try:
    with preparation.acquire(root/'images.json',SOURCE,OWNER,DAEMON,'runtime',docker=docker,identify=lambda:DAEMON) as stage:
        docker.build(stage);stage.capture()
        if mode=='failure':raise RuntimeError('fixture failure')
        if mode in ('interrupt','kill'):
            print('owned-image-acquired',flush=True);signal.pause()
    stage.release('runtime',cleanup_ok=True)
except KeyboardInterrupt:sys.exit(42)
except RuntimeError:sys.exit(7)
'''
        for mode, expected in (('success', 0), ('failure', 7), ('interrupt', 42), ('kill', -signal.SIGKILL)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                process = subprocess.Popen([sys.executable, '-B', '-c', script, directory, mode],
                    cwd=Path(__file__).parent, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                try:
                    if mode in ('interrupt', 'kill'):
                        with selectors.DefaultSelector() as selector:
                            selector.register(process.stdout, selectors.EVENT_READ)
                            self.assertTrue(selector.select(timeout=10), 'owned acquisition barrier timed out')
                        self.assertEqual(process.stdout.readline().strip(), b'owned-image-acquired')
                        os.killpg(process.pid, signal.SIGTERM if mode == 'interrupt' else signal.SIGKILL)
                    stdout, stderr = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, expected, (stdout, stderr))
                    state = json.loads((Path(directory) / 'docker-state.json').read_text())
                    if mode == 'kill':
                        self.assertIn(IMAGE, state)
                        docker = Docker()
                        docker.images = state
                        stage = preparation.open_stage(Path(directory) / 'images.json', docker=docker, identify=lambda: DAEMON)
                        self.assertEqual(stage.release('runtime', cleanup_ok=True)['retired'], [IMAGE])
                        state = docker.images
                    self.assertEqual(state, {})
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                    process.stdout.close()
                    process.stderr.close()

    def test_runtime_cleanup_proof_controls_release_and_legacy_inputs_remain_read_only(self):
        import runtime
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'runtime'
            output.mkdir()
            images = root / 'images.json'
            docker = Docker()
            self.assertIsNone(runtime.release_preparation(output, images))
            stage = preparation.begin(images, SOURCE, OWNER, DAEMON, str(output),
                docker=docker, identify=lambda: DAEMON)
            docker.build(stage)
            with patch.object(runtime.pilot.daemon, 'identify', return_value=DAEMON), \
                    patch.object(runtime.pilot.platform, 'system', return_value='Linux'), \
                    patch.object(runtime.pilot, 'assert_docker_identity'), \
                    patch.object(runtime.pilot, 'command', side_effect=lambda args, **_: docker(args[1:])), \
                    patch.multiple(runtime.pilot, FROZEN_DOCKER_ENDPOINT=None, FROZEN_DOCKER_IDENTITY=None):
                (output / 'cleanup.json').write_text('{"down":"failed","residue":"failed"}')
                self.assertEqual(runtime.release_preparation(output, images)['reason'], 'recovery_required')
                self.assertIn(IMAGE, docker.images)
                (output / 'cleanup.json').write_text('{"down":"passed","residue":"passed"}')
                self.assertEqual(runtime.release_preparation(output, images)['retired'], [IMAGE])
