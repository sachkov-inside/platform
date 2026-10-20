"""Closed resource acquisition evidence at owned process and public artifact boundaries."""
import json
from pathlib import Path
import tempfile
import unittest
import acquisition
import hosted
import sys


class Outcome(unittest.TestCase):
    def test_first_failure_survives_later_cleanup_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            recorder = acquisition.Recorder(Path(directory), 'a'*40)
            recorder.start('backend_build', 'child_wait')
            recorder.fail('command_exit', 7)
            recorder.cleanup_result(False)
            value = acquisition.read(Path(directory)/acquisition.NAME, 'a'*40)
            self.assertEqual(value['outcome'], 'command_exit')
            self.assertEqual(value['exit_code'], 7)
            self.assertEqual(value['cleanup'], 'failed')
            self.assertEqual(value['stage'], 'backend_build')


class ChildOutcomes(unittest.TestCase):
    def test_actual_nonzero_child_records_exit_at_child_wait(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorder = acquisition.Recorder(root, 'a'*40)
            with self.assertRaises(RuntimeError):
                hosted.command([sys.executable, '-c', 'raise SystemExit(7)'], 3,
                               recorder=recorder, stage='backend_build', kind='builds')
            value = acquisition.read(root/acquisition.NAME, 'a'*40)
            self.assertEqual((value['stage'], value['boundary'], value['outcome'], value['exit_code']),
                             ('backend_build', 'child_wait', 'command_exit', 7))
            self.assertEqual((value['builds_attempted'], value['builds_completed']), (1, 0))
            self.assertEqual(value['cleanup'], 'passed')


class DiagnosticDiscrimination(unittest.TestCase):
    def test_actual_child_deadline_and_identity_deadline_have_distinct_boundaries(self):
        import subprocess
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / 'child'; child.mkdir()
            recorder = acquisition.Recorder(child, 'a'*40)
            with self.assertRaises(subprocess.TimeoutExpired):
                hosted.command([sys.executable, '-c', 'import time; time.sleep(120)'], .05,
                    recorder=recorder, stage='backend_build', kind='builds')
            value = acquisition.read(child/acquisition.NAME, 'a'*40)
            self.assertEqual((value['outcome'], value['boundary']), ('command_deadline', 'child_wait'))
            identity = root / 'identity'; identity.mkdir()
            recorder = acquisition.Recorder(identity, 'a'*40)
            with patch.object(hosted.runtime.pilot, 'assert_docker_identity',
                    side_effect=subprocess.TimeoutExpired(['private-identity-sentinel'], .5)):
                with self.assertRaises(subprocess.TimeoutExpired):
                    hosted.command(['docker', 'private-argument-sentinel'], 600,
                        recorder=recorder, stage='backend_build', kind='builds')
            value = acquisition.read(identity/acquisition.NAME, 'a'*40)
            self.assertEqual((value['outcome'], value['boundary'], value['builds_attempted']),
                             ('command_deadline', 'identity_probe', 0))
            self.assertNotIn('private-', (identity/acquisition.NAME).read_text())

    def test_actual_child_exit_remains_original_when_os_cleanup_refuses(self):
        import os
        import subprocess
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorder = acquisition.Recorder(root, 'a'*40)
            with patch.object(os, 'killpg', side_effect=PermissionError('private-cleanup-sentinel')), \
                    patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'S\n', '')):
                with self.assertRaisesRegex(RuntimeError, '^resource_acquisition_failed$'):
                    hosted.command([sys.executable, '-c', 'raise SystemExit(7)'], 3,
                        recorder=recorder, stage='foundation_build', kind='builds')
            value = acquisition.read(root/acquisition.NAME, 'a'*40)
            self.assertEqual((value['outcome'], value['exit_code'], value['cleanup']),
                             ('command_exit', 7, 'failed'))
            self.assertNotIn('private-', (root/acquisition.NAME).read_text())

    def test_storage_observer_marks_the_owning_guard_stop_without_masking_it(self):
        import os
        import signal
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        pilot = hosted.runtime.pilot
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorder = acquisition.Recorder(root, 'a'*40)
            recorder.start('backend_build', 'child_wait')
            for observer in (None, recorder.storage_stop, Mock(side_effect=ValueError('private-observer-sentinel'))):
                handlers = {}
                thread = Mock()
                target = []
                def register_thread(**kwargs):
                    target.append(kwargs['target'])
                    return thread
                def register_signal(number, callback):
                    handlers[number] = callback
                with patch.object(pilot.threading, 'Thread', side_effect=register_thread), \
                        patch.object(pilot.shutil, 'disk_usage', side_effect=[SimpleNamespace(free=20*1024**3), SimpleNamespace(free=16*1024**3)]), \
                        patch.object(pilot.signal, 'signal', side_effect=register_signal), \
                        patch.object(pilot.os, 'kill') as send:
                    with pilot.disk_budget(root, **({} if observer is None else {'on_stop': observer})):
                        target[0]()
                        send.assert_called_once_with(os.getpid(), signal.SIGUSR1)
                        with self.assertRaisesRegex(RuntimeError, '^pilot disk budget exceeded; stopping owned resources$'):
                            handlers[signal.SIGUSR1](signal.SIGUSR1, None)
                    thread.join.assert_called_once_with(timeout=pilot.MONITOR_SHUTDOWN_SECONDS)
            value = acquisition.read(root/acquisition.NAME, 'a'*40)
            self.assertEqual(value['outcome'], 'storage_guard_stop')
            self.assertEqual((value['stage'], value['boundary']), ('backend_build', 'child_wait'))


class ClosedPublicProjection(unittest.TestCase):
    def test_padding_is_removed_and_only_verified_canonical_outcome_is_published(self):
        from test_hosted import metadata
        import binding
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            source = json.loads((admitted/'source.json').read_text())['checkout_sha']
            recorder = acquisition.Recorder(admitted, source)
            recorder.start('backend_build', 'child_wait')
            recorder.fail('command_exit', 7)
            path = admitted/acquisition.NAME
            text = path.read_text().replace('backend_build', 'back\\u0065nd_build')
            path.write_text(text+' '*(acquisition.MAX_BYTES-len(text.encode())))
            self.assertEqual(path.stat().st_size, 4096)
            output = root/'private'; output.mkdir()
            binding.write(output/'owner.json', {'cwd':str(binding.ROOT),'project':'inside-observability-resource-012345abcdef'})
            hosted.collect(output, root/'public', metadata=admitted)
            public = (root/'public'/acquisition.NAME).read_text()
            self.assertLess(len(public.encode()), 4096)
            self.assertNotIn('\\u0065', public)
            self.assertEqual(acquisition.read(root/'public'/acquisition.NAME, source)['outcome'], 'command_exit')
            self.assertFalse((root/'public'/'.resource-acquisition.new').exists())

    def test_private_duplicate_extra_nonfinite_and_oversize_records_are_refused_before_publication(self):
        from test_hosted import metadata
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            admitted = metadata(root)
            source = json.loads((admitted/'source.json').read_text())['checkout_sha']
            recorder = acquisition.Recorder(admitted, source)
            path = admitted/acquisition.NAME
            valid = path.read_text()
            value = json.loads(valid)
            invalid = [
                '{"outcome":"private-sentinel",'+valid[1:],
                '{"outco\\u006de":"private-sentinel",'+valid[1:],
                json.dumps({**value,'private':'private-sentinel'}),
                json.dumps({**value,'elapsed_ms':float('nan')}),
                valid+' '*(4097-len(valid.encode())),
                json.dumps({**value,'source':'b'*40}),
                json.dumps({**value,'exit_code':True}),
                json.dumps({**value,'pulls_attempted':8}),
                json.dumps({**value,'builds_completed':1})]
            for index, text in enumerate(invalid):
                with self.subTest(case=index):
                    path.write_text(text)
                    destination = root/('public-'+str(index))
                    with self.assertRaises(ValueError) as error:
                        hosted.collect(root/'private', destination, metadata=admitted)
                    self.assertNotIn('private-sentinel', str(error.exception))
                    self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main()
