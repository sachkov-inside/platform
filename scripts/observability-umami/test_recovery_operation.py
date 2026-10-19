"""Closed diagnostic contract at the actual one-shot Docker operation seam."""
import json
import subprocess
import unittest

import recovery
import recovery_runtime as runner

PROJECT = recovery.PROJECT_PREFIX + 'a' * 12
IDENTITY = 'b' * 64


class OperationDiagnostics(unittest.TestCase):
    def invoke(self, *, identity=IDENTITY, inspect=None, failed=None):
        if inspect is None:
            inspect = json.dumps({'labels': {'com.docker.compose.project': PROJECT,
                'com.docker.compose.service': 'repo-init'},
                'state': {'status': 'exited', 'running': False, 'pid': 0, 'exit_code': 0}})
        records = []
        calls = []
        def execute(base, args, **kwargs):
            calls.append(args[0])
            if failed is not None and args[0] == failed[0]:
                raise failed[1]
            if args[0] == 'ps':
                return identity
            if args[0] == 'inspect':
                return inspect
            return ''
        error = None
        try:
            runner._one_shot(['docker', 'compose'], PROJECT, 'repo-init', execute,
                             record=lambda value: records.append(json.loads(json.dumps(value))))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as caught:
            error = caught
        return records, calls, error

    def test_valid_full_identity_and_successful_container_exit_are_explicitly_passed(self):
        records, calls, error = self.invoke()
        self.assertIsNone(error)
        self.assertEqual(calls, ['up', 'wait', 'ps', 'inspect'])
        self.assertEqual(records[-1]['step'], 'exit')
        self.assertEqual(records[-1]['outcome'], 'passed')
        self.assertEqual(records[-1]['container_exit_code'], 0)
        self.assertNotIn(IDENTITY, json.dumps(records))

    def test_short_multiple_and_invalid_identity_shapes_stay_rejected_without_raw_values(self):
        for value, count in (('b'*12, 'one'), ('b'*12+'\n'+'c'*12, 'multiple'), ('private-sentinel', 'one')):
            with self.subTest(count=count):
                records, calls, error = self.invoke(identity=value)
                self.assertIsInstance(error, ValueError)
                self.assertEqual(records[-1]['step'], 'identity')
                self.assertEqual(records[-1]['error'], 'invalid_identity')
                self.assertEqual(records[-1]['identity']['count'], count)
                self.assertNotIn('inspect', calls)
                self.assertNotIn(value, json.dumps(records))

    def test_malformed_inspect_and_unknown_state_have_distinct_closed_failures(self):
        bad_state = json.dumps({'labels': {'com.docker.compose.project': PROJECT,
            'com.docker.compose.service': 'repo-init'},
            'state': {'status': 'private-sentinel', 'running': False, 'pid': 0, 'exit_code': 0}})
        for value, step, category in (('private-sentinel', 'inspect', 'invalid_inspect_json'),
                                      (bad_state, 'state', 'invalid_state')):
            with self.subTest(step=step):
                records, _, error = self.invoke(inspect=value)
                self.assertIsNotNone(error)
                self.assertEqual(records[-1]['step'], step)
                self.assertEqual(records[-1]['error'], category)
                self.assertNotIn('private-sentinel', json.dumps(records))

    def test_failed_up_wait_and_timeout_keep_only_closed_status_and_numeric_returncode(self):
        for command, error, category, code in (
                ('up', subprocess.CalledProcessError(7, ['private-sentinel'], output='private-sentinel', stderr='private-sentinel'), 'command_failed', 7),
                ('wait', subprocess.CalledProcessError(9, ['private-sentinel'], stderr='private-sentinel'), 'command_failed', 9),
                ('wait', subprocess.TimeoutExpired(['private-sentinel'], 90, output='private-sentinel'), 'timeout', None)):
            with self.subTest(command=command, category=category):
                records, _, caught = self.invoke(failed=(command, error))
                self.assertIs(caught, error)
                self.assertEqual(records[-1]['step'], command)
                self.assertEqual(records[-1]['outcome'], 'failed')
                self.assertEqual(records[-1]['error'], category)
                self.assertEqual(records[-1]['returncode'], code)
                self.assertNotIn('private-sentinel', json.dumps(records))
                self.assertLess(len(json.dumps(records[-1]).encode()), 1024)

    def test_real_command_adapter_retains_only_numeric_failure_code_for_operation_diagnostic(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        transport = runner.runtime
        with patch.object(transport.pilot, 'assert_docker_identity'), \
                patch.object(transport.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=17, stdout='private-sentinel', stderr='private-sentinel')):
            with self.assertRaises(transport.FixtureCommandFailed) as failed:
                transport.invoke(['docker'], ['fixed-operation'])
        self.assertEqual(failed.exception.returncode, 17)
        records, _, error = self.invoke(failed=('wait', failed.exception))
        self.assertIs(error, failed.exception)
        self.assertEqual(records[-1]['returncode'], 17)
        self.assertEqual(records[-1]['error'], 'command_failed')
        self.assertNotIn('private-sentinel', json.dumps(records))
        self.assertNotIn('private-sentinel', str(failed.exception))
