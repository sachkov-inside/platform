"""Closed readiness progress through the actual bounded polling loop."""
import json
import subprocess
import unittest
from unittest.mock import patch

import recovery_runtime as runner


class Clock:
    def __init__(self):
        self.now = 0
    def monotonic(self):
        return self.now
    def sleep(self, seconds):
        self.now += seconds


class ReadinessProgress(unittest.TestCase):
    def run_readiness(self, scenario, *, progress=True):
        clock = Clock()
        records, calls = [], []
        def execute(base, args, **kwargs):
            calls.append(args)
            self.assertLessEqual(len(calls), 500)
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 12)
            if 'pg_isready' in args:
                if scenario == 'not_accepting':
                    raise runner.runtime.FixtureCommandFailed(returncode=2)
                if scenario == 'timeout':
                    raise subprocess.TimeoutExpired(['private-sentinel'], kwargs['timeout'])
                return ''
            if scenario == 'query_failed':
                raise runner.runtime.FixtureCommandFailed(returncode=17)
            if scenario == 'malformed':
                return 'private-sentinel'
            if scenario == 'invalid':
                return json.dumps({'recovery_ended': 'private-sentinel'})
            return json.dumps({'recovery_ended': scenario != 'recovering'})
        error = None
        with patch('time.monotonic', clock.monotonic), patch('time.sleep', clock.sleep):
            try:
                options = {'progress': records.append} if progress else {}
                runner._await_sql(['docker', 'compose'], 'recovered', execute=execute, **options)
            except (ValueError, RuntimeError, subprocess.SubprocessError) as caught:
                error = caught
        self.assertNotIn('private-sentinel', json.dumps(records))
        self.assertTrue(all(len(json.dumps(value).encode()) < 1024 for value in records))
        return records, calls, error, clock.now

    def test_connection_refusal_still_recovering_and_query_failure_remain_distinct_at_same_deadline(self):
        for scenario, condition, code, ended in (
                ('not_accepting', 'not_accepting', 2, None),
                ('recovering', 'recovering', 0, False),
                ('query_failed', 'query_failed', 0, None)):
            with self.subTest(scenario=scenario):
                records, calls, error, elapsed = self.run_readiness(scenario)
                self.assertIsInstance(error, RuntimeError)
                self.assertEqual(elapsed, runner.SQL_READY_SECONDS)
                self.assertEqual(records[-1], {'schema': 1, 'condition': condition,
                    'pg_isready_returncode': code, 'recovery_ended': ended, 'error': 'deadline_exceeded'})
                absent, original_calls, original_error, original_elapsed = self.run_readiness(scenario, progress=False)
                self.assertEqual((absent, original_calls, type(original_error), original_elapsed),
                    ([], calls, type(error), elapsed))

    def test_malformed_invalid_and_timeout_are_closed_without_changing_the_raised_failure(self):
        for scenario, category, condition, code in (
                ('malformed', 'invalid_json', 'invalid_response', 0),
                ('invalid', 'invalid_result', 'invalid_response', 0),
                ('timeout', 'timeout', 'timeout', None)):
            with self.subTest(scenario=scenario):
                records, calls, error, elapsed = self.run_readiness(scenario)
                self.assertIsInstance(error, subprocess.TimeoutExpired if scenario == 'timeout' else ValueError)
                self.assertEqual(elapsed, 0)
                self.assertEqual(records[-1], {'schema': 1, 'condition': condition,
                    'pg_isready_returncode': code, 'recovery_ended': None, 'error': category})
                absent, original_calls, original_error, original_elapsed = self.run_readiness(scenario, progress=False)
                self.assertEqual((absent, original_calls, type(original_error), original_elapsed),
                    ([], calls, type(error), elapsed))

    def test_ready_projection_and_default_no_callback_keep_existing_two_command_flow(self):
        records, calls, error, elapsed = self.run_readiness('ready')
        self.assertIsNone(error)
        self.assertEqual(elapsed, 0)
        self.assertEqual(records[-1], {'schema': 1, 'condition': 'ready', 'pg_isready_returncode': 0,
            'recovery_ended': True, 'error': None})
        absent, original_calls, original_error, _ = self.run_readiness('ready', progress=False)
        self.assertEqual(absent, [])
        self.assertIsNone(original_error)
        self.assertEqual(original_calls, calls)
