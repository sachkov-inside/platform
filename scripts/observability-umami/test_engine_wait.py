"""Immutable owned-ID Engine wait contract; all daemon calls are bounded external fakes."""
import json
import subprocess
import unittest

import recovery
import recovery_runtime as runner

PROJECT = recovery.PROJECT_PREFIX + 'a' * 12
IDENTITY = 'b' * 64


class WaitBoundary:
    def __init__(self, *, running=False, code=0, output=None, drift=None, failure=None, compose_error='known'):
        self.running, self.code, self.output = running, code, output
        self.drift, self.failure, self.compose_error = drift, failure, compose_error
        self.waited = False
        self.calls = []
        self.service = 'backup'

    def execute(self, base, args, **kwargs):
        self.calls.append((base, args, kwargs))
        if args[0] in ('up', 'start'):
            self.service = args[-1]
            return ''
        if args[0] == 'ps':
            return ('c' * 64 if self.waited and self.drift == 'selection' else IDENTITY)
        if args[0] == 'inspect':
            return json.dumps({'id': 'c'*64 if self.waited and self.drift == 'id' else IDENTITY,
                'labels': {'com.docker.compose.project': 'foreign' if self.waited and self.drift == 'owner' else PROJECT,
                           'com.docker.compose.service': self.service},
                'state': {'status': 'running' if self.running else 'exited', 'running': self.running,
                          'pid': 42 if self.running else 0, 'exit_code': self.code}})
        if args[0] == 'wait' and base == ['docker']:
            if self.failure is not None:
                raise self.failure
            self.waited, self.running = True, False
            return str(self.code) + '\n' if self.output is None else self.output
        if args[0] == 'wait':
            if self.compose_error == 'known':
                raise runner.runtime.FixtureCommandFailed(
                    {'phase': 'compose_wait_probe', 'error': 'no_running_containers'}, returncode=1)
            if self.compose_error == 'unknown':
                raise runner.runtime.FixtureCommandFailed(returncode=1)
            raise subprocess.TimeoutExpired(['private-sentinel'], 10)
        raise AssertionError('unexpected external command')


class OwnedEngineWait(unittest.TestCase):
    def invoke(self, boundary, service='backup'):
        records = []
        runner._one_shot(['docker', 'compose'], PROJECT, service, boundary.execute,
                         record=lambda value: records.append(json.loads(json.dumps(value))))
        return records

    def test_already_exited_and_running_to_exit_both_wait_on_the_inspected_full_id(self):
        for running in (False, True):
            with self.subTest(running=running):
                boundary = WaitBoundary(running=running)
                records = self.invoke(boundary)
                waits = [(base, args, options) for base, args, options in boundary.calls if args[0] == 'wait']
                self.assertEqual(len(waits), 1)
                self.assertEqual(waits[0][0:2], (['docker'], ['wait', IDENTITY]))
                self.assertLessEqual(waits[0][2]['timeout'], 90)
                self.assertEqual(records[-1]['outcome'], 'passed')
                self.assertNotIn(IDENTITY, json.dumps(records))

    def test_failed_container_and_malformed_numeric_wait_data_cannot_pass(self):
        for options in ({'code': 7}, {'output': 'private-sentinel'}, {'output': '0\n0\n'},
                        {'output': '256\n'}, {'output': '00\n'}):
            with self.subTest(options=options), self.assertRaises((RuntimeError, ValueError)):
                self.invoke(WaitBoundary(**options))

    def test_id_replacement_and_ownership_drift_fail_after_wait(self):
        for drift in ('selection', 'id', 'owner'):
            boundary = WaitBoundary(drift=drift)
            with self.subTest(drift=drift), self.assertRaises(ValueError):
                self.invoke(boundary)
            self.assertTrue(boundary.waited)

    def test_engine_timeout_remains_fatal(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            self.invoke(WaitBoundary(failure=subprocess.TimeoutExpired(['private-sentinel'], 90)))

    def test_repo_init_comparison_is_closed_and_unknown_probe_errors_still_stop(self):
        boundary = WaitBoundary()
        records = self.invoke(boundary, 'repo-init')
        proof = records[-1]['compatibility']
        self.assertEqual(proof['compose'], {'outcome': 'no_running_containers', 'returncode': 1})
        self.assertEqual(proof['engine'], {'outcome': 'passed', 'returncode': 0, 'container_exit_code': 0})
        self.assertTrue(proof['same_owned_id_exited_zero'])
        self.assertNotIn(IDENTITY, json.dumps(records))
        for error in ('unknown', 'timeout'):
            with self.subTest(error=error), self.assertRaises((RuntimeError, subprocess.SubprocessError)):
                self.invoke(WaitBoundary(compose_error=error), 'repo-init')

    def test_comparison_rechecks_ownership_and_engine_result_without_treating_probe_failure_as_success(self):
        for failure in ('owner', 'numeric', 'timeout'):
            boundary = WaitBoundary()
            original = boundary.execute
            compared = False
            def execute(base, args, **kwargs):
                nonlocal compared
                if args[0] == 'wait' and base != ['docker']:
                    compared = True
                    if failure == 'owner':
                        boundary.drift = 'owner'
                if compared and args[0] == 'wait' and base == ['docker']:
                    if failure == 'numeric':
                        return 'private-sentinel'
                    if failure == 'timeout':
                        raise subprocess.TimeoutExpired(['private-sentinel'], 10)
                return original(base, args, **kwargs)
            records = []
            with self.subTest(failure=failure), self.assertRaises((ValueError, subprocess.TimeoutExpired)):
                runner._one_shot(['docker', 'compose'], PROJECT, 'repo-init', execute,
                    record=lambda value: records.append(json.loads(json.dumps(value))))
            self.assertEqual(records[-1]['step'], 'comparison')
            self.assertEqual(records[-1]['outcome'], 'failed')
            self.assertNotIn('compatibility', records[-1])
            self.assertNotIn('private-sentinel', json.dumps(records))

    def test_old_compose_error_classifier_accepts_only_exact_bounded_owned_empty_selection(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        transport = runner.runtime
        compose = ['docker', 'compose', '-p', PROJECT, '-f', '/private/compose.json']
        valid = 'no containers for project "' + PROJECT + '"\n'
        for stderr, accepted in ((valid, True), (valid+'private-sentinel', False),
                                 ('private-sentinel', False), (valid.replace(PROJECT, 'foreign'), False),
                                 (valid+' '*1024, False)):
            with self.subTest(accepted=accepted), patch.object(transport.pilot, 'assert_docker_identity'), \
                    patch.object(transport.subprocess, 'run', return_value=SimpleNamespace(
                        returncode=1, stdout='private-sentinel', stderr=stderr)):
                with self.assertRaises(transport.FixtureCommandFailed) as failed:
                    transport.invoke(compose, ['wait', 'repo-init'], fixture_phase='compose_wait_probe')
                self.assertEqual(failed.exception.diagnostic,
                    {'phase': 'compose_wait_probe', 'error': 'no_running_containers'} if accepted else None)
                self.assertNotIn('private-sentinel', str(failed.exception))
