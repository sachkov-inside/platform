"""Synthetic fixture SQL/proof shared by schema-only PG and supervised Umami runs."""
import json
import subprocess
from pathlib import Path
import uuid
import retention

SCRIPTS = Path(__file__).resolve().parent
EXPECTED = {'expired_event_rows': 0, 'boundary_event_rows': 1, 'recent_event_rows': 1,
            'retained_old_session_rows': 1, 'old_or_null_session_rows': 0, 'fresh_orphan_session_rows': 1,
            'expired_property_rows': 0, 'expired_revenue_rows': 0, 'expired_session_property_rows': 0,
            'expired_identifier_rows': 0, 'recent_identifier_rows': 1, 'expired_replay_rows': 0,
            'orphan_saved_replay_rows': 0, 'expired_heatmap_rows': 0}


def seed_sql(site):
    if not isinstance(site, str) or str(uuid.UUID(site)) != site:
        raise ValueError('retention_fixture_site')
    return (SCRIPTS / 'retention-corpus.sql').read_text().replace('__SITE__', site)


def seed_result(encoded):
    raw = json.loads(encoded)
    if not isinstance(raw, dict) or set(raw) != {'cutoff', 'expired_event_rows'} or type(raw['expired_event_rows']) is not int or raw['expired_event_rows'] != 502:
        raise ValueError('retention_fixture_seed')
    retention.utc_timestamp(raw['cutoff'])
    return raw['cutoff']


def proof_sql():
    return (SCRIPTS / 'retention-proof.sql').read_text()


def proof_result(encoded):
    raw = json.loads(encoded)
    if (not isinstance(raw, dict) or set(raw) != set(EXPECTED)
            or any(type(raw[key]) is not int or raw[key] != expected for key, expected in EXPECTED.items())):
        raise ValueError('retention_fixture_proof')
    return {'boundary_and_recent_retained': True, 'orphan_properties_identifiers_cleaned': True,
            'referenced_old_session_retained': True, 'expired_events_physically_absent': True,
            'replay_heatmap_remnants_cleaned': True}


def query_result(raw):
    expected = {'history_window_denied': True, 'windowless_detail_denied': True,
                'recent_events_visible_before_cleanup': True}
    if not isinstance(raw, dict) or set(raw) != set(expected) or any(raw[key] is not True for key in expected):
        raise ValueError('retention_query_proof')
    return raw


def exercise(execute, read_query, site, record):
    """Use the existing supervisor's SQL/query transports, publishing closed evidence only."""
    evidence = {'scope': 'synthetic pinned Umami retention compatibility; not restore/resource/full acceptance',
                'state': 'running', 'stage': 'synthetic_seed', 'restore_pgbackrest': 'pending'}
    record(evidence)
    try:
        cutoff = seed_result(execute(seed_sql(site), timeout=retention.BATCH_SECONDS))
        evidence.update(cutoff_at=cutoff, expired_events_before_cleanup=502, stage='query_before_cleanup')
        record(evidence)
        evidence['query_boundary'] = query_result(json.loads(read_query()))
        evidence['stage'] = 'partial_drain'
        record(evidence)
        partial = retention.drain(execute, cutoff_at=cutoff, max_batches=1)
        evidence['partial_drain'] = partial
        record(evidence)
        if (partial['state'] != 'partial' or not partial['remaining_expired_events']
                or partial['event_cleanup_lag_seconds'] < 86400):
            evidence.update(state='failed', stage='partial_drain')
            record(evidence)
            raise RuntimeError('retention partial corpus failed')
        evidence['stage'] = 'complete_drain'
        complete = retention.drain(execute, cutoff_at=cutoff)
        evidence['drain'] = complete
        record(evidence)
        if complete['state'] != 'complete':
            evidence['state'] = 'failed'
            record(evidence)
            raise RuntimeError('retention drain incomplete')
        evidence['stage'] = 'post_cleanup_corpus'
        record(evidence)
        evidence['physical_cleanup'] = proof_result(execute(proof_sql(), timeout=retention.BATCH_SECONDS))
        evidence['stage'] = 'idempotent_retry'
        retry = retention.drain(execute, cutoff_at=cutoff)
        evidence['retry'] = retry
        if retry['state'] != 'complete' or any(retry['deleted'].values()):
            evidence['state'] = 'failed'
            record(evidence)
            raise RuntimeError('retention retry corpus failed')
        evidence.update(state='passed', stage='completed')
        record(evidence)
        return evidence
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        if evidence['state'] != 'failed':
            evidence['state'] = 'error'
        record(evidence)
        raise RuntimeError('synthetic retention phase failed') from None
