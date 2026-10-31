"""Bounded, resumable maintenance of the isolated pinned Umami database.

SQL is fixed to the dedicated role/database. The owner supplies its already guarded
SQL transport; no DSN, Docker project, or credentials are accepted from a user.
"""
from datetime import datetime, timezone, timedelta
import json
import math
from pathlib import Path
import subprocess
import time

TABLES = ('event_data', 'revenue', 'website_event', 'session_data', 'session_link',
          'session_replay', 'session_replay_saved', 'heatmap_event', 'session')
BATCH_ROWS = 500
MAX_BATCHES = 20
DRAIN_SECONDS = 30
BATCH_SECONDS = 12
RESULT_BYTES = 16384
SQL = Path(__file__).with_suffix('.sql')


def utc_timestamp(value):
    if not isinstance(value, str) or len(value) != 27:
        raise ValueError('retention_timestamp')
    parsed = datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
    if parsed.strftime('%Y-%m-%dT%H:%M:%S.%fZ') != value:
        raise ValueError('retention_timestamp')
    return parsed


def batch_sql(cutoff=None):
    if cutoff is not None:
        utc_timestamp(cutoff)
    return SQL.read_text().replace('__CUTOFF__', cutoff or '')


def parse_batch(encoded, expected_cutoff=None):
    if not isinstance(encoded, str) or len(encoded.encode()) > RESULT_BYTES:
        raise ValueError('retention_result_size')
    rows = [json.loads(line) for line in encoded.splitlines() if line.strip()]
    if len(rows) != len(TABLES) + 2:
        raise ValueError('retention_result_shape')
    snapshot, lag = rows[0], rows[-1]
    if (not isinstance(snapshot, dict) or set(snapshot) != {'kind', 'at', 'cutoff', 'cutoff_age_seconds'}
            or snapshot['kind'] != 'snapshot' or not isinstance(lag, dict)
            or set(lag) != {'kind', 'remaining_expired_events', 'unknown_event_times', 'event_cleanup_lag_seconds'}
            or lag['kind'] != 'lag'):
        raise ValueError('retention_snapshot_shape')
    at, cutoff = utc_timestamp(snapshot['at']), utc_timestamp(snapshot['cutoff'])
    if cutoff + timedelta(days=365) > at or (expected_cutoff is not None and snapshot['cutoff'] != expected_cutoff):
        raise ValueError('retention_cutoff_changed')
    for value in (snapshot['cutoff_age_seconds'], lag['remaining_expired_events'],
                  lag['unknown_event_times'], lag['event_cleanup_lag_seconds']):
        if type(value) is not int or not 0 <= value <= 2**53 - 1:
            raise ValueError('retention_counter')
    if lag['unknown_event_times'] > lag['remaining_expired_events']:
        raise ValueError('retention_unknown_time_counter')
    deleted = {}
    for table, row in zip(TABLES, rows[1:-1]):
        if (not isinstance(row, dict) or set(row) != {'table', 'deleted'} or row['table'] != table
                or type(row['deleted']) is not int or not 0 <= row['deleted'] <= BATCH_ROWS):
            raise ValueError('retention_deleted_counter')
        deleted[table] = row['deleted']
    return snapshot, lag, deleted


def drain(execute, *, max_batches=MAX_BATCHES, max_seconds=DRAIN_SECONDS, cutoff_at=None, clock=time.monotonic):
    """Return closed partial/error evidence; only an empty snapshot pass completes.

    A complete pass covers the fixed DB-clock cutoff in its reported snapshot.
    It does not promise an empty future snapshot, immediate disk reclamation, or
    a storage quota. An interrupted batch is retried by predicates, never a cursor.
    """
    if (type(max_batches) is not int or not 1 <= max_batches <= MAX_BATCHES
            or isinstance(max_seconds, bool) or not isinstance(max_seconds, (int, float))
            or not math.isfinite(max_seconds) or not 0 < max_seconds <= DRAIN_SECONDS):
        raise ValueError('retention_budget')
    if cutoff_at is not None:
        utc_timestamp(cutoff_at)
    started = clock()
    report = {'schema': 1, 'horizon_days': 365, 'state': 'partial', 'reason': 'batch_budget',
              'deleted_counts_scope': 'acknowledged_batches', 'cutoff_at': cutoff_at, 'snapshot_at': None, 'cutoff_age_seconds': None, 'batches': 0,
              'deleted': dict.fromkeys(TABLES, 0), 'remaining_expired_events': None,
              'unknown_event_times': None, 'event_cleanup_lag_seconds': None}
    for _ in range(max_batches):
        remaining = max_seconds - (clock() - started)
        if remaining <= 0:
            report['reason'] = 'time_budget'
            break
        try:
            encoded = execute(batch_sql(report['cutoff_at']), timeout=min(BATCH_SECONDS, remaining))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            report.update(state='error', reason='batch_failed')
            break
        try:
            snapshot, lag, deleted = parse_batch(encoded, report['cutoff_at'])
        except (ValueError, TypeError, OverflowError):
            report.update(state='error', reason='invalid_result')
            break
        report.update(cutoff_at=snapshot['cutoff'], snapshot_at=snapshot['at'],
                      cutoff_age_seconds=snapshot['cutoff_age_seconds'], batches=report['batches'] + 1)
        for table in TABLES:
            report['deleted'][table] += deleted[table]
        report.update({key: value for key, value in lag.items() if key != 'kind'})
        if not any(deleted.values()):
            if lag['remaining_expired_events']:
                report.update(state='error', reason='stalled')
            else:
                report.update(state='complete', reason='empty_snapshot')
            break
    report['elapsed_seconds'] = round(max(0, clock() - started), 3)
    return report
