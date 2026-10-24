"""Source-owned short experiment, deliberately not an accepted production workload."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / 'infra/observability/resource/profile.json'
PROJECT_PREFIX = 'inside-observability-resource-'
LABELS = ('public_index', 'protected_account')
PATHS = ('/library/site-index', '/accounts/current')


def validate(value):
    fields = {'schema', 'profile', 'status', 'comparison', 'pairs', 'warmup_seconds', 'measurement_seconds',
              'requests_per_second', 'concurrency', 'request_timeout_ms', 'sample_interval_seconds',
              'account_count', 'material_count', 'sample_ratio', 'operations'}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError('profile_fields')
    constants = {'schema': 1, 'profile': 'short-sdk-pair-v1', 'status': 'proposed-synthetic-not-accepted-production-load',
                 'comparison': 'sdk-only-collector-present-both', 'pairs': [['off', 'on'], ['on', 'off']],
                 'warmup_seconds': 2, 'measurement_seconds': 10, 'requests_per_second': 10, 'concurrency': 1,
                 'request_timeout_ms': 1200, 'sample_interval_seconds': 1, 'account_count': 1, 'material_count': 0, 'sample_ratio': 1}
    if any(type(value[key]) is not type(expected) or value[key] != expected for key, expected in constants.items()):
        raise ValueError('profile_contract')
    expected = [{'label': label, 'method': 'GET', 'path': path, 'expected_status': 200} for label, path in zip(LABELS, PATHS)]
    if value['operations'] != expected:
        raise ValueError('profile_operations')
    return value


def load():
    return validate(json.loads(PROFILE.read_text()))
