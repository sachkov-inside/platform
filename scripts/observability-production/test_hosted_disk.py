"""Hosted preparation contracts. Filesystem/process doubles never delete a real SDK."""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import signal
import stat
import subprocess
from types import SimpleNamespace
from pathlib import Path
import unittest
from unittest import mock

import hosted_disk


class HostedDiskTests(unittest.TestCase):
    def test_missing_hosted_identity_rejects_without_starting_a_process(self):
        output = io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
                hosted_disk.subprocess, 'Popen') as process, contextlib.redirect_stdout(output):
            self.assertEqual(hosted_disk.main([]), 1)
        process.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {'outcome': 'guard_rejected'})


class HostedCommandTests(unittest.TestCase):
    def setUp(self):
        self.env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                    'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
                    'ANDROID_HOME': '/usr/local/lib/android/sdk',
                    'ANDROID_SDK_ROOT': '/usr/local/lib/android/sdk',
                    'GITHUB_WORKSPACE': '/home/runner/work/platform/platform',
                    'RUNNER_TEMP': '/home/runner/work/_temp'}
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.dict(os.environ, self.env, clear=True))
        self.stack.enter_context(mock.patch.object(hosted_disk.platform, 'system', return_value='Linux'))
        self.stack.enter_context(mock.patch.object(hosted_disk.platform, 'machine', return_value='x86_64'))
        self.stack.enter_context(mock.patch.object(hosted_disk.platform, 'freedesktop_os_release',
                                                  return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}))
        self.missing = set()
        self.links = set()
        self.devices = {}
        def lstat(path):
            if str(path) in self.missing:
                raise FileNotFoundError()
            return SimpleNamespace(st_mode=(stat.S_IFLNK if str(path) in self.links else stat.S_IFDIR) | 0o755,
                                   st_dev=self.devices.get(str(path), 1))
        self.stack.enter_context(mock.patch.object(Path, 'lstat', lstat))
        self.stack.enter_context(mock.patch.object(Path, 'resolve', lambda path, **_kw: path))
        self.mounts = self.stack.enter_context(mock.patch.object(
            Path, 'read_text', return_value='1 0 8:1 / / rw - ext4 /dev/root rw\n'))
        self.disk = self.stack.enter_context(mock.patch.object(hosted_disk.shutil, 'disk_usage',
            return_value=SimpleNamespace(free=17179869183)))
        self.process = self.stack.enter_context(mock.patch.object(hosted_disk.subprocess, 'Popen'))
        self.process.return_value.wait.return_value = 0
        self.handlers = {}
        def register(signum, handler):
            old = self.handlers.get(signum, signal.SIG_DFL)
            self.handlers[signum] = handler
            return old
        self.stack.enter_context(mock.patch.object(hosted_disk.signal, 'signal', side_effect=register))
        self.output = self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def test_sufficient_capacity_skips_android_inspection_and_process(self):
        self.disk.return_value.free = 91420139520
        with mock.patch.object(Path, 'lstat', autospec=True, side_effect=Path.lstat) as inspect, mock.patch.dict(
                os.environ, {'ANDROID_HOME': '/irrelevant', 'ANDROID_SDK_ROOT': '',
                             'GITHUB_WORKSPACE': '.', 'RUNNER_TEMP': '/usr/local/lib/android'}):
            self.assertEqual(hosted_disk.main([]), 0)
        self.assertEqual(json.loads(self.output.getvalue()), {
            'outcome': 'already_sufficient', 'free_before_bytes': 91420139520})
        self.assertEqual([str(call.args[0]) for call in inspect.call_args_list],
                         ['/var/lib/docker', '/var/lib', '/var', '/'])
        self.disk.assert_called_once_with('/var/lib/docker')
        self.mounts.assert_not_called()
        self.process.assert_not_called()

    def test_sufficient_capacity_needs_no_android_or_workspace_environment(self):
        self.disk.return_value.free = 17179869184
        core = {name: self.env[name] for name in (
            'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS')}
        with mock.patch.dict(os.environ, core, clear=True):
            self.assertEqual(hosted_disk.main([]), 0)
        self.assertEqual(json.loads(self.output.getvalue()), {
            'outcome': 'already_sufficient', 'free_before_bytes': 17179869184})
        self.mounts.assert_not_called()
        self.process.assert_not_called()

    def test_sufficient_capacity_still_requires_every_core_inventory_flag(self):
        self.disk.return_value.free = 91420139520
        for name in ('GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS'):
            for value in ('', 'self-hosted', 'ubuntu22'):
                with self.subTest(name=name, value=value), mock.patch.dict(os.environ, {name: value}):
                    self.assert_rejected()
                    self.output.seek(0)
                    self.output.truncate()
        self.disk.assert_not_called()
        self.mounts.assert_not_called()

    def test_sufficient_capacity_still_rejects_noncanonical_docker_storage(self):
        self.disk.return_value.free = 91420139520
        for path in ('/', '/var', '/var/lib', '/var/lib/docker'):
            with self.subTest(path=path):
                self.links.add(path)
                self.assert_rejected()
                self.links.clear()
                self.output.seek(0)
                self.output.truncate()
        self.disk.assert_not_called()
        self.mounts.assert_not_called()

    def test_measured_capacity_boundary_matches_owning_admission(self):
        import check as production_check
        for free, sufficient in ((13625421824, False), (17179869183, False),
                                 (17179869184, True), (17179869185, True)):
            with self.subTest(free=free):
                self.assertEqual(production_check.ci.check_disk(
                    total=107374182400, free=free)['ready'], sufficient)
                self.disk.return_value.free = free
                self.assertEqual(hosted_disk.main([]), 0)
                report = json.loads(self.output.getvalue())
                self.assertEqual(report['free_before_bytes'], free)
                if sufficient:
                    self.assertEqual(report, {'outcome': 'already_sufficient', 'free_before_bytes': free})
                    self.process.assert_not_called()
                    self.mounts.assert_not_called()
                    self.disk.assert_called_once_with('/var/lib/docker')
                else:
                    self.assertEqual(report, {
                        'outcome': 'prepared', 'free_before_bytes': free, 'free_after_bytes': free})
                    self.process.assert_called_once()
                    self.mounts.assert_called_once()
                self.output.seek(0)
                self.output.truncate()
                self.process.reset_mock()
                self.mounts.reset_mock()
                self.disk.reset_mock()

    def test_no_target_argument_is_accepted(self):
        self.disk.return_value.free = 17179869184
        self.assertEqual(hosted_disk.main(['/tmp/android']), 1)
        self.process.assert_not_called()

    def test_foreign_real_operating_system_is_rejected(self):
        self.disk.return_value.free = 17179869184
        with mock.patch.object(hosted_disk.platform, 'system', return_value='Darwin'):
            self.assertEqual(hosted_disk.main([]), 1)
        self.process.assert_not_called()

    def test_verified_sdk_runs_one_fixed_privileged_bounded_command(self):
        self.assertEqual(hosted_disk.main([]), 0)
        self.process.assert_called_once_with(
            ['/usr/bin/sudo', '-n', '/usr/bin/timeout', '--signal=TERM', '--kill-after=5s',
             '120s', '/usr/bin/rm', '-rf', '--one-file-system', '--', '/usr/local/lib/android'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True)
        self.process.return_value.wait.assert_called_once_with(timeout=135)
        self.assertEqual(json.loads(self.output.getvalue()), {
            'outcome': 'prepared', 'free_before_bytes': 17179869183, 'free_after_bytes': 17179869183})

    def assert_rejected(self):
        self.assertEqual(hosted_disk.main([]), 1)
        self.process.assert_not_called()
        self.assertEqual(json.loads(self.output.getvalue()), {'outcome': 'guard_rejected'})

    def test_every_hosted_inventory_flag_must_match_exactly(self):
        for name in ('GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_ARCH',
                     'ImageOS', 'ANDROID_HOME', 'ANDROID_SDK_ROOT'):
            for value in ('', 'self-hosted', '/usr/local/lib/android/sdk/../sdk'):
                with self.subTest(name=name, value=value), mock.patch.dict(os.environ, {name: value}):
                    self.output.seek(0)
                    self.output.truncate()
                    self.assert_rejected()

    def test_real_distribution_version_and_architecture_must_match(self):
        self.disk.return_value.free = 17179869184
        for release in ({'ID': 'debian', 'VERSION_ID': '24.04'},
                        {'ID': 'ubuntu', 'VERSION_ID': '22.04'}, {}):
            with self.subTest(release=release), mock.patch.object(
                    hosted_disk.platform, 'freedesktop_os_release', return_value=release):
                self.output.seek(0)
                self.output.truncate()
                self.assert_rejected()
        with mock.patch.object(hosted_disk.platform, 'machine', return_value='aarch64'):
            self.output.seek(0)
            self.output.truncate()
            self.assert_rejected()

    def test_symlink_in_target_or_any_parent_is_rejected(self):
        for path in ('/', '/usr', '/usr/local', '/usr/local/lib', '/usr/local/lib/android',
                     '/usr/local/lib/android/sdk', '/var', '/var/lib', '/var/lib/docker'):
            with self.subTest(path=path):
                self.links.add(path)
                self.assert_rejected()
                self.links.clear()
                self.output.seek(0)
                self.output.truncate()

    def test_noncanonical_target_is_rejected(self):
        with mock.patch.object(Path, 'resolve', return_value=Path('/other')):
            self.assert_rejected()

    def test_resolver_runtime_error_is_closed_before_starting_command(self):
        error = io.StringIO()
        with mock.patch.object(
                Path, 'resolve', side_effect=RuntimeError('secret-symlink-loop')) as resolve, \
                contextlib.redirect_stderr(error):
            self.assert_rejected()
        resolve.assert_called_once_with(strict=True)
        self.assertEqual(error.getvalue(), '')
        self.assertNotIn('secret-symlink-loop', self.output.getvalue())

    def test_guard_does_not_swallow_keyboard_interrupt_or_system_exit(self):
        for exception in (KeyboardInterrupt, SystemExit):
            with self.subTest(exception=exception.__name__), mock.patch.object(
                    Path, 'resolve', side_effect=exception), self.assertRaises(exception):
                hosted_disk.main([])
            self.process.assert_not_called()
            self.assertEqual(self.output.getvalue(), '')

    def test_different_docker_filesystem_is_rejected(self):
        self.devices['/var/lib/docker'] = 2
        self.assert_rejected()

    def test_protected_workspace_and_temp_must_be_absolute_canonical_directories_outside_sdk(self):
        for name in ('GITHUB_WORKSPACE', 'RUNNER_TEMP'):
            for value in ('', '.', '/', '/usr', '/usr/local/lib', '/usr/local/lib/android', '/usr/local/lib/android/sdk/build',
                          '/home/runner/../runner/work'):
                with self.subTest(name=name, value=value), mock.patch.dict(os.environ, {name: value}):
                    self.assert_rejected()
                    self.output.seek(0)
                    self.output.truncate()

    def test_mount_or_bind_ambiguity_rejects_before_start(self):
        base = '1 0 8:1 / / rw - ext4 /dev/root rw\n'
        for mounts in (
                '', 'broken\n', base.replace('8:1 / /', '8:1 /subtree /'),
                base + '2 1 8:2 / /usr rw - ext4 /dev/other rw\n',
                base + '2 1 8:2 / /usr/local/lib/android rw - ext4 /dev/other rw\n',
                base + '2 1 8:2 / /usr/local/lib/android/sdk/ndk rw - ext4 /dev/other rw\n',
                base + '2 1 8:1 /usr/local/lib/android /alias rw - ext4 /dev/root rw\n',
                base + '2 1 8:1 / /alias rw - ext4 /dev/root rw\n',
                base + '2 1 8:2 / /var/lib/docker rw - ext4 /dev/other rw\n',
                base + '2 1 8:2 / /usr/local/lib/and\\162oid rw - ext4 /dev/other rw\n'):
            with self.subTest(mounts=mounts):
                self.mounts.return_value = mounts
                self.assert_rejected()
                self.output.seek(0)
                self.output.truncate()

    def test_complete_absence_is_a_safe_noop_but_partial_structure_is_rejected(self):
        self.missing.update(('/usr/local/lib/android', '/usr/local/lib/android/sdk'))
        self.assertEqual(hosted_disk.main([]), 0)
        self.process.assert_not_called()
        self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'already_absent')
        for missing in ('/usr/local/lib/android', '/usr/local/lib/android/sdk'):
            with self.subTest(missing=missing):
                self.missing.clear()
                self.missing.add(missing)
                self.output.seek(0)
                self.output.truncate()
                self.assert_rejected()

    def test_failed_command_keeps_its_exit_without_fallback_or_raw_error(self):
        self.process.return_value.wait.return_value = 23
        self.assertEqual(hosted_disk.main([]), 23)
        self.process.assert_called_once()
        self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'command_failed')

    def test_missing_command_is_closed_and_does_not_expose_exception(self):
        self.process.side_effect = OSError('secret-command-error')
        self.assertEqual(hosted_disk.main([]), 1)
        self.process.assert_called_once()
        self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'command_failed')
        self.assertNotIn('secret', self.output.getvalue())

    def test_privileged_timeout_status_is_preserved(self):
        for status in (124, 137):
            with self.subTest(status=status):
                self.process.return_value.wait.return_value = status
                self.assertEqual(hosted_disk.main([]), status)
                self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'command_timeout')
                self.output.seek(0)
                self.output.truncate()
                self.process.reset_mock()

    def test_outer_timeout_has_only_one_bounded_reap_attempt(self):
        self.process.return_value.wait.side_effect = subprocess.TimeoutExpired('secret-argv', 135)
        self.assertEqual(hosted_disk.main([]), 124)
        self.process.assert_called_once()
        self.assertEqual(self.process.return_value.wait.call_args_list,
                         [mock.call(timeout=135), mock.call(timeout=5)])
        self.process.return_value.send_signal.assert_called_once_with(signal.SIGTERM)
        self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'command_timeout')
        self.assertNotIn('secret', self.output.getvalue())

    def test_interruption_forwards_to_sudo_waits_boundedly_and_restores_handlers(self):
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signum=signum):
                def interrupted_wait(**_kw):
                    self.handlers[signum](signum, None)
                    return 0
                self.process.return_value.wait.side_effect = interrupted_wait
                self.assertEqual(hosted_disk.main([]), 128 + signum)
                self.process.return_value.send_signal.assert_called_once_with(signal.SIGTERM)
                self.process.return_value.wait.assert_called_once_with(timeout=135)
                self.assertEqual(json.loads(self.output.getvalue())['outcome'], 'interrupted')
                self.assertTrue(all(value == signal.SIG_DFL for value in self.handlers.values()))
                self.output.seek(0)
                self.output.truncate()
                self.process.reset_mock()

    def test_after_measurement_failure_preserves_original_command_failure(self):
        self.disk.side_effect = [SimpleNamespace(free=13625421824), OSError('secret-disk-error')]
        self.process.return_value.wait.return_value = 23
        self.assertEqual(hosted_disk.main([]), 23)
        self.assertEqual(json.loads(self.output.getvalue()), {
            'outcome': 'command_failed', 'free_before_bytes': 13625421824})

    def test_protected_workspace_parent_symlink_is_rejected(self):
        self.links.add('/home/runner')
        self.assert_rejected()

    def test_unreadable_inventory_or_disk_fails_closed(self):
        for boundary in (self.mounts, self.disk):
            with self.subTest(boundary='mountinfo' if boundary is self.mounts else 'disk'):
                boundary.side_effect = OSError('secret-filesystem-error')
                self.assert_rejected()
                boundary.side_effect = None
                self.output.seek(0)
                self.output.truncate()

    def test_absence_remeasures_free_space_without_starting_command(self):
        self.missing.update(('/usr/local/lib/android', '/usr/local/lib/android/sdk'))
        self.disk.side_effect = [SimpleNamespace(free=13625421824), SimpleNamespace(free=13625421825)]
        self.assertEqual(hosted_disk.main([]), 0)
        self.process.assert_not_called()
        self.assertEqual(json.loads(self.output.getvalue()), {
            'outcome': 'already_absent', 'free_before_bytes': 13625421824, 'free_after_bytes': 13625421825})


class CanonicalDirectoryTests(unittest.TestCase):
    def test_real_symlink_loop_is_rejected_without_resolution_or_process(self):
        with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as directory:
            loop = Path(directory) / 'loop'
            loop.symlink_to(loop, target_is_directory=True)
            with mock.patch.object(hosted_disk.subprocess, 'Popen') as process, \
                    mock.patch.object(Path, 'resolve') as resolve:
                with self.assertRaises(ValueError):
                    hosted_disk.canonical_directory(loop)
            process.assert_not_called()
            resolve.assert_not_called()

    def test_real_temporary_directory_accepts_only_canonical_directory_and_parents(self):
        with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as directory:
            root = Path(directory)
            (root / 'directory').mkdir()
            (root / 'file').write_text('fixture')
            (root / 'alias').symlink_to(root / 'directory', target_is_directory=True)
            hosted_disk.canonical_directory(root / 'directory')
            for path in (root / 'file', root / 'alias', root / 'alias' / 'child'):
                with self.subTest(kind=path.name), self.assertRaises((ValueError, OSError)):
                    hosted_disk.canonical_directory(path)


class HostedWorkflowTests(unittest.TestCase):
    def test_fresh_hosted_preparation_precedes_original_admission_and_runtime(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/observability-production.yml').read_text()
        steps = re.split(r'^      - name: ', workflow, flags=re.MULTILINE)[1:]
        names = [step.splitlines()[0] for step in steps]
        scope = names.index('Select bounded monitoring scope')
        self.assertEqual(names[scope:scope + 4], [
            'Select bounded monitoring scope', 'Prepare preinstalled hosted Android SDK disk',
            'Bind source and disk admission', 'Run actual generated topology through existing supervisor'])
        self.assertIn('runs-on: ubuntu-24.04', workflow)
        self.assertNotRegex(workflow, r'(?m)^\s+container:')
        self.assertIn('permissions:\n  contents: read\n', workflow)
        self.assertNotIn('continue-on-error:', workflow)
        self.assertIn('timeout-minutes: 3', steps[scope + 1])
        self.assertIn('run: python3 scripts/observability-production/hosted_disk.py', steps[scope + 1])
        self.assertIn("unittest discover -s scripts/observability-production -p 'test_*.py'", workflow)

    def test_original_admission_retains_sixteen_gib_boundary_and_real_deficit_refusal(self):
        import check as production_check
        for free, expected in ((13625421824, False), (17179869183, False), (17179869184, True)):
            with self.subTest(free=free):
                self.assertEqual(production_check.ci.check_disk(total=107374182400, free=free)['ready'], expected)

    def test_existing_admission_source_closure_includes_both_new_files(self):
        import check as production_check
        names = ['scripts/observability-production/hosted_disk.py',
                 'scripts/observability-production/test_hosted_disk.py']
        with tempfile.TemporaryDirectory() as directory:
            metadata = Path(directory) / 'metadata'
            metadata.mkdir()
            (metadata / 'source.json').write_text('{}')
            with mock.patch.object(sys, 'argv', ['check.py', 'admission', '--output', directory,
                                                '--metadata', str(metadata)]), mock.patch.object(
                    production_check.ci, 'read_command', return_value='\n'.join(names)), mock.patch.object(
                    production_check.ci, 'admission', return_value=0) as admission:
                with self.assertRaises(SystemExit) as result:
                    production_check.main()
            self.assertEqual(result.exception.code, 0)
            self.assertEqual([str(path.relative_to(production_check.production.ROOT))
                              for path in admission.call_args.kwargs['inputs']], names)


if __name__ == '__main__':
    unittest.main()
