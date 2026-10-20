"""Bounded interpretation of genuine pilot scrapes, never delivery/loss accounting."""
import json
import math
from decimal import Decimal, InvalidOperation

from collector_privacy import TRACE_STORE_MAX_SCRAPE_AGE_SECONDS

SOURCES = {'collector': 'platform-collector', 'trace_store': 'platform-trace-store'}
MAX_SCRAPE_AGE_SECONDS = TRACE_STORE_MAX_SCRAPE_AGE_SECONDS
MAX_BODY_BYTES = 1_048_576
MAX_ROWS = 1000
MAX_OUTPUT_BYTES = 131_072
MAX_SAFE_NUMBER = 2**53 - 1
NOT_COVERED = ['host', 'containers', 'rabbitmq', 'logto', 'caddy', 'backups']


class InvalidResponse(ValueError):
    """No untrusted diagnostic content escapes this boundary."""


def _reject(*_):
    raise InvalidResponse()


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def decode_json(raw):
    """Strict bounded JSON shared with the credential boundary; callers validate schema."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BODY_BYTES:
        _reject()
    try:
        result = json.loads(raw.decode('utf-8'), object_pairs_hook=_object,
                            parse_constant=_reject, parse_float=Decimal)
        def bounded(value, depth=0):
            if depth > 16:
                _reject()
            if isinstance(value, dict):
                for key, item in value.items():
                    if len(key) > 128:
                        _reject()
                    bounded(item, depth + 1)
            elif isinstance(value, list):
                if len(value) > MAX_ROWS:
                    _reject()
                for item in value:
                    bounded(item, depth + 1)
            elif isinstance(value, str) and len(value) > 1024:
                _reject()
        bounded(result)
        return result
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise InvalidResponse() from None


def _clock(value):
    if (type(value) not in (int, float, Decimal)
            or (isinstance(value, Decimal) and not value.is_finite())
            or not 0 <= value <= MAX_SAFE_NUMBER or not math.isfinite(value)):
        _reject()
    return float(value)


def _numeric(value):
    if not isinstance(value, str) or not value or len(value) > 32:
        _reject()
    try:
        number = Decimal(value)
    except InvalidOperation:
        _reject()
    if not number.is_finite() or not 0 <= number <= MAX_SAFE_NUMBER:
        _reject()
    return number


RECEIVERS = {'', 'otlp', 'otlp/pilot', 'otelcol.receiver.otlp.pilot', 'otlp/otelcol.receiver.otlp.pilot'}
EXPORTERS = {'', 'otlphttp'} | {prefix + signal for signal in ('metrics', 'logs', 'traces')
    for prefix in ('otlphttp/', 'otelcol.exporter.otlphttp.', 'otlp_http/otelcol.exporter.otlphttp.')}
COLLECTOR_COUNTERS = {f'otelcol_receiver_{operation}_{signal}'
    for operation in ('accepted', 'refused') for signal in ('spans', 'metric_points', 'log_records')}
COLLECTOR_COUNTERS |= {f'otelcol_exporter_{operation}_{signal}'
    for operation in ('sent', 'send_failed', 'enqueue_failed') for signal in ('spans', 'metric_points', 'log_records')}
COLLECTOR_GAUGES = {'otelcol_exporter_queue_size', 'otelcol_exporter_queue_capacity'}
TRACE_COUNTERS = {
    'vt_http_requests_total': [{'format': 'protobuf', 'path': '/insert/opentelemetry/v1/traces'}],
    'vt_http_errors_total': [{'format': 'protobuf', 'path': '/insert/opentelemetry/v1/traces'}],
    'vt_rows_ingested_total': [{'type': 'opentelemetry_traces_otlphttp_protobuf'}],
    'vt_rows_dropped_total': [{'reason': 'debug'}, {'reason': 'too_many_fields'}],
    'vt_traceid_index_push_error_total': [{}],
}


def _metric_kind(metric):
    name = metric['__name__']
    dimensions = {key: value for key, value in metric.items() if key not in ('__name__', 'job', 'instance')}
    if name == 'up':
        if dimensions:
            _reject()
        return 'up'
    if metric['job'] == SOURCES['trace_store']:
        if name not in TRACE_COUNTERS or dimensions not in TRACE_COUNTERS[name]:
            _reject()
        return 'counter'
    base = name.removesuffix('_total')
    if name not in COLLECTOR_GAUGES and base not in COLLECTOR_COUNTERS:
        _reject()
    allowed = {'receiver': RECEIVERS, 'exporter': EXPORTERS, 'data_type': {'', 'traces', 'metrics', 'logs'}}
    if any(key not in allowed or value not in allowed[key] for key, value in dimensions.items()):
        _reject()
    return 'gauge' if name in COLLECTOR_GAUGES else 'counter'


def _identity(metric, timestamp):
    if not isinstance(metric, dict) or any(not isinstance(value, str) for value in metric.values()):
        _reject()
    metric = metric.copy()
    if timestamp:
        name = metric.pop('source_metric', None)
        if not isinstance(name, str) or metric.pop('__name__', name) != name:
            _reject()
        metric['__name__'] = name
    if (not {'__name__', 'job', 'instance'}.issubset(metric)
            or metric['job'] not in SOURCES.values() or metric['instance'] != 'pilot'):
        _reject()
    _metric_kind(metric)
    return tuple(sorted(metric.items()))


def _vector(raw, evaluated_at, timestamp=False):
    body = decode_json(raw)
    if (not isinstance(body, dict) or set(body) != {'status', 'data'} or body['status'] != 'success'
            or not isinstance(body['data'], dict) or set(body['data']) != {'resultType', 'result'}
            or body['data']['resultType'] != 'vector' or not isinstance(body['data']['result'], list)):
        _reject()
    result = {}
    aliases = set()
    for row in body['data']['result']:
        if not isinstance(row, dict) or set(row) != {'metric', 'value'}:
            _reject()
        key = _identity(row['metric'], timestamp)
        point = row['value']
        if (not isinstance(point, list) or len(point) != 2 or _clock(point[0]) != evaluated_at
                or key in result):
            _reject()
        value = _numeric(point[1])
        if timestamp and value > evaluated_at:
            _reject()
        kind = _metric_kind(dict(key))
        if not timestamp and ((kind == 'up' and value not in (0, 1))
                              or (kind == 'counter' and value != value.to_integral_value())):
            _reject()
        alias = tuple((label, item.removesuffix('_total') if label == '__name__' else item)
                      for label, item in key)
        if alias in aliases:
            _reject()
        aliases.add(alias)
        result[key] = (float(value) if timestamp or kind == 'gauge' else int(value))
    return result


def malformed():
    return _failure('malformed', 'invalid_response')


def unavailable(reason):
    if reason not in {'timeout', 'http_error', 'transport_error', 'interrupted', 'credentials'}:
        _reject()
    return _failure('query_unavailable', reason)


def _failure(state, reason):
    return {'version': 1, 'query': {'state': state, 'reason': reason},
            'sources': {key: {'state': state, 'sample_age_seconds': None} for key in SOURCES},
            'not_covered': NOT_COVERED.copy()}


def _acquisition(values, timestamps, evaluated_at, completed_at):
    evaluated_at, completed_at = _clock(evaluated_at), _clock(completed_at)
    if completed_at < evaluated_at:
        _reject()
    rows = _vector(values, evaluated_at)
    stamps = _vector(timestamps, evaluated_at, True)
    if rows.keys() != stamps.keys():
        _reject()
    return rows, stamps


def _comparison(key, value, stamp, previous_rows, previous_stamps):
    kind = _metric_kind(dict(key))
    result = {'state': 'unknown' if kind == 'counter' else 'not_counter', 'delta': None, 'incomplete': True}
    if kind != 'counter' or key not in previous_rows:
        return result
    old_stamp, old = previous_stamps[key], previous_rows[key]
    if stamp < old_stamp:
        return result
    if stamp == old_stamp:
        if value != old:
            _reject()
        return {**result, 'state': 'unchanged'}
    incomplete = stamp - old_stamp > MAX_SCRAPE_AGE_SECONDS
    if value < old:
        return {'state': 'reset_observed', 'delta': None, 'incomplete': True}
    return {'state': 'progress' if value > old else 'unchanged', 'delta': value - old,
            'incomplete': incomplete}


def evaluate(values, timestamps, *, evaluated_at, completed_at, previous=None):
    """Interpret matching acquisitions. Prior data cannot make current health fresh.

    previous, when supplied, is one acquisition with these same four arguments.
    It is validated afresh rather than trusting a caller-created report.
    """
    try:
        rows, stamps = _acquisition(values, timestamps, evaluated_at, completed_at)
        previous_rows, previous_stamps = {}, {}
        if previous is not None:
            if (not isinstance(previous, dict)
                    or set(previous) != {'values', 'timestamps', 'evaluated_at', 'completed_at'}
                    or _clock(previous['completed_at']) > evaluated_at):
                _reject()
            previous_rows, previous_stamps = _acquisition(**previous)
        for identity in rows.keys() & previous_rows.keys():
            if stamps[identity] == previous_stamps[identity] and rows[identity] != previous_rows[identity]:
                _reject()
        sources = {}
        for source, job in SOURCES.items():
            key = tuple(sorted({'__name__': 'up', 'job': job, 'instance': 'pilot'}.items()))
            stamp = stamps.get(key)
            age = None if stamp is None else completed_at - stamp
            state = ('missing' if stamp is None else 'stale' if age > MAX_SCRAPE_AGE_SECONDS
                     else 'fresh_up' if rows[key] == 1 else 'fresh_down')
            successes = [points[key] for samples, points in ((rows, stamps), (previous_rows, previous_stamps))
                         if samples.get(key) == 1]
            metrics = []
            for identity in sorted(rows, key=lambda item: (dict(item)['__name__'] != 'up', item)):
                value = rows[identity]
                if dict(identity)['job'] != job:
                    continue
                metric_stamp = stamps[identity]
                metric_age = completed_at - metric_stamp
                metrics.append({'metric': dict(identity), 'value': value, 'measured_at': metric_stamp,
                                'sample_age_seconds': metric_age,
                                'state': 'stale' if metric_age > MAX_SCRAPE_AGE_SECONDS else 'observed',
                                'comparison': _comparison(identity, value, metric_stamp, previous_rows, previous_stamps)})
            expected_names = ({'up'} | COLLECTOR_COUNTERS | COLLECTOR_GAUGES if source == 'collector'
                              else {'up'} | set(TRACE_COUNTERS))
            present_names = {item['metric']['__name__'].removesuffix('_total')
                             if source == 'collector' else item['metric']['__name__'] for item in metrics}
            missing = [{'metric_name': name, 'state': 'missing', 'value': None}
                       for name in sorted(expected_names - present_names)]
            sources[source] = {'state': state, 'sample_age_seconds': age, 'measured_at': stamp,
                               'last_successful_observation': max(successes) if successes else None,
                               'last_success_age_seconds': completed_at - max(successes) if successes else None,
                               'metrics': metrics, 'missing_metric_families': missing}
        result = {'version': 1, 'query': {'state': 'observed', 'evaluated_at': evaluated_at,
                                         'completed_at': completed_at},
                  'sources': sources, 'not_covered': NOT_COVERED.copy()}
        if len(json.dumps(result).encode()) > MAX_OUTPUT_BYTES:
            _reject()
        return result
    except (InvalidResponse, TypeError, KeyError):
        return malformed()
