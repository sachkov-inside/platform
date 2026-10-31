"""Drainer boundary contracts; SQL semantics need a separate real PostgreSQL proof."""
import json
import hashlib
from pathlib import Path
import re
from unittest.mock import Mock
import unittest
import retention
import retention_fixture

TABLES = ('event_data', 'revenue', 'website_event', 'session_data', 'session_link',
          'session_replay', 'session_replay_saved', 'heatmap_event', 'session')


def batch(count, *, remaining=0):
    rows = [{'kind': 'snapshot', 'at': '2026-10-19T12:00:00.000000Z',
             'cutoff': '2025-10-19T12:00:00.000000Z', 'cutoff_age_seconds': 0}]
    rows += [{'table': table, 'deleted': count if table == 'website_event' else 0} for table in TABLES]
    rows += [{'kind': 'lag', 'remaining_expired_events': remaining,
              'event_cleanup_lag_seconds': 86400 if remaining else 0, 'unknown_event_times': 0}]
    return '\n'.join(json.dumps(row) for row in rows)


class Drain(unittest.TestCase):
    def test_full_batch_requires_another_snapshot_and_idempotent_zero_pass(self):
        responses = iter([batch(500, remaining=1), batch(1), batch(0)])
        report = retention.drain(lambda sql, timeout: next(responses))
        self.assertEqual(report['state'], 'complete')
        self.assertEqual(report['batches'], 3)
        self.assertEqual(report['deleted']['website_event'], 501)
        self.assertEqual(report['remaining_expired_events'], 0)
        retry = retention.drain(lambda sql, timeout: batch(0))
        self.assertEqual(retry['state'], 'complete')
        self.assertEqual(sum(retry['deleted'].values()), 0)

    def test_budget_exhaustion_is_partial_with_measured_lag(self):
        report = retention.drain(lambda sql, timeout: batch(500, remaining=501), max_batches=1)
        self.assertEqual((report['state'], report['reason']), ('partial', 'batch_budget'))
        self.assertEqual(report['remaining_expired_events'], 501)
        self.assertEqual(report['event_cleanup_lag_seconds'], 86400)

    def test_timeout_and_lost_response_do_not_claim_completion_or_complete_counts(self):
        execute = Mock(side_effect=[batch(500, remaining=1), RuntimeError('private-error-secret')])
        report = retention.drain(execute)
        self.assertEqual((report['state'], report['reason']), ('error', 'batch_failed'))
        self.assertEqual(report['deleted']['website_event'], 500)
        self.assertEqual(report['deleted_counts_scope'], 'acknowledged_batches')
        self.assertNotIn('secret', json.dumps(report))
        self.assertEqual(execute.call_count, 2)

    def test_no_progress_with_remaining_expired_events_is_error(self):
        report = retention.drain(lambda sql, timeout: batch(0, remaining=1))
        self.assertEqual((report['state'], report['reason']), ('error', 'stalled'))

    def test_wall_clock_budget_prevents_an_extra_batch(self):
        execute = Mock(return_value=batch(500, remaining=1))
        ticks = iter([0, 0, 30, 30])
        report = retention.drain(execute, clock=lambda: next(ticks))
        self.assertEqual((report['state'], report['reason']), ('partial', 'time_budget'))
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(execute.call_args.kwargs['timeout'], 12)

    def test_cutoff_cannot_change_between_committed_batches(self):
        changed = batch(0).replace('2025-10-19T12:00:00.000000Z', '2025-10-19T11:00:00.000000Z')
        responses = iter([batch(500, remaining=1), changed])
        report = retention.drain(lambda sql, timeout: next(responses))
        self.assertEqual((report['state'], report['reason']), ('error', 'invalid_result'))
        self.assertEqual(report['batches'], 1)

    def test_malformed_or_private_provider_fields_cannot_become_evidence(self):
        valid = [json.loads(line) for line in batch(0).splitlines()]
        invalid = ['not-json-private', batch(0) + ' ' * retention.RESULT_BYTES]
        for index, key, value in [(0, 'private', 'secret'), (0, 'cutoff', '../bad'),
                                  (1, 'deleted', True), (1, 'deleted', 501),
                                  (-1, 'remaining_expired_events', -1)]:
            rows = [dict(row) for row in valid]
            rows[index][key] = value
            invalid.append('\n'.join(json.dumps(row) for row in rows))
        for response in invalid:
            with self.subTest(response=response[:30]):
                report = retention.drain(lambda sql, timeout: response)
                self.assertEqual((report['state'], report['reason']), ('error', 'invalid_result'))
                self.assertNotIn('private', json.dumps(report))
                self.assertNotIn('secret', json.dumps(report))

    def test_invalid_budgets_and_cutoffs_fail_before_any_transport(self):
        execute = Mock(side_effect=AssertionError('must not acquire database'))
        for arguments in ({'max_batches': True}, {'max_batches': 21}, {'max_seconds': 31},
                          {'max_seconds': float('nan')}, {'max_seconds': False}, {'cutoff_at': "';DELETE"}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                retention.drain(execute, **arguments)
        execute.assert_not_called()

    def test_fixture_failure_is_recorded_as_error_without_private_output(self):
        evidence = []
        def execute(sql, *, timeout):
            raise RuntimeError('private-provider-response')
        with self.assertRaises(RuntimeError):
            retention_fixture.exercise(execute, lambda: '{}',
                '00000000-0000-4000-8000-000000001566', lambda raw: evidence.append(json.loads(json.dumps(raw))))
        self.assertEqual(evidence[-1]['state'], 'error')
        self.assertEqual(evidence[-1]['stage'], 'synthetic_seed')
        self.assertNotIn('private', json.dumps(evidence))

    def test_schema_only_fixture_is_exact_pinned_upstream_migrations(self):
        config = Path(__file__).resolve().parents[2] / 'infra/observability/umami'
        lock = json.loads((config / 'inputs.lock.json').read_text())
        expected = {row['path']: row['sha256'] for row in lock['sources'] if row['path'].startswith('prisma/migrations/')}
        encoded = (config / 'schema-fixture.sql').read_bytes()
        matches = list(re.finditer(br'-- Source: ([^\n]+)\n-- SHA256: ([a-f0-9]{64})\n-- Source-Bytes: ([0-9]+)\n', encoded))
        self.assertTrue(all(not line.strip() or line.startswith(b'--') for line in encoded[:matches[0].start()].splitlines()))
        actual = {}
        for index, match in enumerate(matches):
            path = match[1].decode('ascii')
            end = match.end() + int(match[3])
            raw = encoded[match.end():end]
            actual[path] = hashlib.sha256(raw).hexdigest()
            self.assertEqual(actual[path], match[2].decode('ascii'))
            next_at = matches[index + 1].start() if index + 1 < len(matches) else len(encoded)
            self.assertEqual(encoded[end:next_at], b'\n\n' if index + 1 < len(matches) else b'\n')
        self.assertEqual(actual, expected)
        self.assertEqual(len(matches), 26)

    def test_supervised_corpus_records_partial_complete_and_idempotent_proof(self):
        cutoff = '2025-10-19T12:00:00.000000Z'
        responses = iter([json.dumps({'cutoff': cutoff, 'expired_event_rows': 502}),
                          batch(500, remaining=2), batch(2), batch(0),
                          json.dumps(retention_fixture.EXPECTED), batch(0)])
        evidence = []
        query = {'history_window_denied': True, 'windowless_detail_denied': True,
                 'recent_events_visible_before_cleanup': True}
        result = retention_fixture.exercise(lambda sql, timeout: next(responses), lambda: json.dumps(query),
            '00000000-0000-4000-8000-000000001566', lambda raw: evidence.append(json.loads(json.dumps(raw))))
        self.assertEqual(result['state'], 'passed')
        self.assertEqual(result['partial_drain']['state'], 'partial')
        self.assertEqual(result['drain']['state'], 'complete')
        self.assertEqual(result['retry']['state'], 'complete')
        self.assertEqual(result['restore_pgbackrest'], 'pending')
        self.assertEqual(evidence[-1]['stage'], 'completed')
