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
            inspect = json.dumps({'id': IDENTITY, 'labels': {'com.docker.compose.project': PROJECT,
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
            return '0\n' if base == ['docker'] and args[0] == 'wait' else ''
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
        self.assertEqual(calls[:4], ['up', 'ps', 'inspect', 'wait'])
        self.assertEqual(calls.count('wait'), 3)
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
        bad_state = json.dumps({'id': IDENTITY, 'labels': {'com.docker.compose.project': PROJECT,
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


class EncryptedBackupDiagnostics(unittest.TestCase):
    def observe(self, error, operation='check'):
        def original_failure():
            raise error
        try:
            with runner._encrypted_backup_operation(operation):
                original_failure()
        except BaseException as caught:
            self.assertIs(caught, error)
            tail = caught.__traceback__
            while tail.tb_next is not None:
                tail = tail.tb_next
            self.assertEqual(tail.tb_frame.f_code.co_name, 'original_failure')
            return runner._current_backup_failure(caught)
        self.fail('original exception did not propagate')

    def test_actual_command_adapter_failure_projects_only_its_numeric_code(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        transport = runner.runtime
        with patch.object(transport.pilot, 'assert_docker_identity'), \
                patch.object(transport.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=17, stdout='private-sentinel', stderr='private-sentinel')):
            with self.assertRaises(transport.FixtureCommandFailed) as failed:
                transport.invoke(['docker'], ['fixed-operation'], payload='private-sentinel')
        error = failed.exception
        self.assertEqual(self.observe(error, 'stanza_create'), {'available': True,
            'operation': 'stanza_create', 'category': 'command_failed', 'returncode': 17})
        self.assertNotIn('private-sentinel', str(error))

    def test_actual_command_adapter_timeout_retains_original_error_without_command_output(self):
        from unittest.mock import patch
        transport = runner.runtime
        error = subprocess.TimeoutExpired(['private-sentinel'], 90,
            output='private-sentinel', stderr='private-sentinel')
        with patch.object(transport.pilot, 'assert_docker_identity'), \
                patch.object(transport.subprocess, 'run', side_effect=error):
            with self.assertRaises(subprocess.TimeoutExpired) as failed:
                transport.invoke(['docker'], ['fixed-operation'], payload='private-sentinel', timeout=90)
        self.assertIs(failed.exception, error)
        self.assertEqual(self.observe(error, 'info'), {'available': True,
            'operation': 'info', 'category': 'timeout', 'returncode': None})

    def test_timeout_json_proof_io_and_runtime_errors_keep_finite_categories_and_original_traceback(self):
        cases = [(subprocess.TimeoutExpired(['private-sentinel'], 90, output='private-sentinel'), 'timeout'),
            (TimeoutError('private-sentinel'), 'timeout'),
            (json.JSONDecodeError('private-sentinel', 'private-sentinel', 0), 'invalid_json'),
            (ValueError('private-sentinel'), 'proof_mismatch'),
            (OSError('private-sentinel'), 'io_failure'),
            (RuntimeError('private-sentinel'), 'runtime_failure')]
        for error, category in cases:
            with self.subTest(category=category):
                projected = self.observe(error, 'selected_info')
                self.assertEqual(projected, {'available': True, 'operation': 'selected_info',
                    'category': category, 'returncode': None})
                self.assertNotIn('private-sentinel', json.dumps(projected))

    def test_codes_are_frozen_without_properties_bool_coercion_or_error_text(self):
        class ForeignGetters(RuntimeError):
            @property
            def returncode(self):
                raise AssertionError('private-sentinel getter was evaluated')
            @property
            def __dict__(self):
                raise AssertionError('private-sentinel dictionary getter was evaluated')
        projected = self.observe(ForeignGetters('private-sentinel'))
        self.assertEqual(projected, {'available': True, 'operation': 'check',
            'category': 'runtime_failure', 'returncode': None})
        for code in (None, True, False, -129, 256, 1.5, 'private-sentinel', [], -128, 0, 255):
            with self.subTest(code=repr(code)):
                error = subprocess.CalledProcessError(code, ['private-sentinel'],
                    output='private-sentinel', stderr='private-sentinel')
                projected = self.observe(error)
                expected = code if type(code) is int and -128 <= code <= 255 else None
                self.assertEqual(projected, {'available': True, 'operation': 'check',
                    'category': 'command_failed', 'returncode': expected})
                error.returncode = 99
                self.assertEqual(runner._current_backup_failure(error), projected)
                projected['operation'] = 'private-sentinel'
                self.assertEqual(runner._current_backup_failure(error)['operation'], 'check')

    def test_copied_foreign_missing_malformed_or_unrecognized_context_is_unavailable(self):
        import copy
        unavailable = {'available': False, 'operation': None, 'category': None, 'returncode': None}
        original = RuntimeError('private-sentinel')
        self.observe(original)
        copied = copy.copy(original)
        foreign = RuntimeError('private-sentinel')
        foreign.__dict__.update(original.__dict__)
        for error in (copied, foreign, RuntimeError('private-sentinel'), KeyError('private-sentinel'), None, {}, object()):
            self.assertEqual(runner._current_backup_failure(error), unavailable)
        tag = original.__dict__['_umami_backup_failure']
        for malformed in (None, [], {}, (), tag[:4], (*tag, 0),
                (object(), *tag[1:]), (tag[0], True, *tag[2:]),
                (*tag[:2], ['private-sentinel'], *tag[3:]),
                (*tag[:2], 'private-sentinel', *tag[3:]),
                (*tag[:3], ['private-sentinel'], tag[4]),
                (*tag[:3], 'private-sentinel', tag[4]), (*tag[:4], True), (*tag[:4], 256)):
            original.__dict__['_umami_backup_failure'] = malformed
            self.assertEqual(runner._current_backup_failure(original), unavailable)
        self.assertEqual(self.observe(RuntimeError('private-sentinel'), 'private-sentinel'), unavailable)
        self.assertEqual(self.observe(KeyError('private-sentinel')), unavailable)

    def test_tagging_failure_and_interrupts_do_not_replace_or_expand_original_errors(self):
        from unittest.mock import patch
        class UnavailableFields:
            def __get__(self, error):
                raise OSError('private-sentinel')
        unavailable = {'available': False, 'operation': None, 'category': None, 'returncode': None}
        with patch.object(runner, '_EXCEPTION_FIELDS', UnavailableFields()):
            self.assertEqual(self.observe(RuntimeError('private-sentinel')), unavailable)
        interrupt = KeyboardInterrupt('private-sentinel')
        self.assertEqual(self.observe(interrupt), unavailable)
        self.assertEqual(interrupt.__dict__, {})
