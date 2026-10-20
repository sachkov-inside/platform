"""Closed full-raw oracle for one genuine SDK S3 cold read; never an API proof."""
import json
from decimal import Decimal
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-pilot'))
import source_status
from diagnostics import ResponseDecode, OracleRefusal, TraceGateRefusal, trace_refusal
from collector_privacy import TRACE_STORE_METRICS

# SDK 2.12 default explicit histogram aggregation, independent of observed output.
BOUNDS = ('0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf')
PRIVATE = ('sdk-storage-private', 'private-access-key', 'private-secret-key', 'private-provider-id', 'private-filename')
MAX_BYTES = 1_048_576
SCALARS = {'http.server.active_requests': 0, 'telemetry.trace.dropped': 0,
           'telemetry.trace.export.failures': 0, 'telemetry.metric.export.failures': 0,
           'telemetry.trace.sampling.ratio': 1,
           **{'inside.postgresql.pool.' + name: 0 for name in ('available', 'total', 'idle', 'waiting', 'registry_overflow')}}


def decode(raw):
    if type(raw) is not str or len(raw.encode('utf-8')) > MAX_BYTES:
        raise ValueError()
    try:
        value = source_status.decode_json(raw.encode('utf-8'))
    except (ValueError, UnicodeError, RecursionError):
        raise ResponseDecode() from None
    if any(marker in json.dumps(value, default=str) for marker in PRIVATE):
        raise ValueError()
    return value


def number(value):
    if type(value) is not str or re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?', value) is None:
        raise ValueError()
    result = float(value)
    if not math.isfinite(result):
        raise ValueError()
    return result


def _native_stats(stats):
    if type(stats) is not dict or set(stats) != {'seriesFetched', 'executionTimeMsec'}:
        raise ValueError()
    count, elapsed = stats['seriesFetched'], stats['executionTimeMsec']
    if (type(count) is not str or re.fullmatch(r'0|[1-9][0-9]{0,18}', count) is None or int(count) > 2**63-1
            or type(elapsed) is not int or not 0 <= elapsed <= (2**63-1)//1_000_000):
        raise ValueError()


def _self_scrape(labels):
    name, job = labels['__name__'], labels.get('job')
    if job == 'platform-trace-store':
        allowed = {'__name__', 'job', 'instance', 'path', 'format', 'type', 'reason'}
        enums = {'path': ('', '/insert/opentelemetry/v1/traces'), 'format': ('', 'protobuf'),
                 'type': ('', 'opentelemetry_traces_otlphttp_protobuf'), 'reason': ('', 'debug', 'too_many_fields')}
        valid = name in TRACE_STORE_METRICS
    elif job == 'platform-collector':
        allowed = {'__name__', 'job', 'instance', 'receiver', 'exporter', 'data_type'}
        enums = {'receiver': ('', 'otlp', 'otlp/pilot', 'otelcol.receiver.otlp.pilot', 'otlp/otelcol.receiver.otlp.pilot'),
                 'exporter': ('', 'otlphttp', 'otlphttp/metrics', 'otlphttp/logs', 'otlphttp/traces',
                              'otelcol.exporter.otlphttp.metrics', 'otelcol.exporter.otlphttp.logs', 'otelcol.exporter.otlphttp.traces',
                              'otlp_http/otelcol.exporter.otlphttp.metrics', 'otlp_http/otelcol.exporter.otlphttp.logs', 'otlp_http/otelcol.exporter.otlphttp.traces'),
                 'data_type': ('', 'traces', 'metrics', 'logs')}
        valid = name in {'up'} | source_status.COLLECTOR_COUNTERS | source_status.COLLECTOR_GAUGES | {n+'_total' for n in source_status.COLLECTOR_COUNTERS}
    else:
        raise ValueError()
    if (not valid or labels.get('instance') != 'pilot' or set(labels)-allowed
            or any(labels.get(key, '') not in values for key, values in enums.items())):
        raise ValueError()


def metrics(raw, *, release):
    try:
        if type(release) is not str or re.fullmatch(r'[0-9a-f]{40}', release) is None:
            raise ValueError()
        body = decode(raw)
        if type(body) is not dict or set(body) not in ({'status', 'data'}, {'status', 'data', 'stats'}) or body['status'] != 'success':
            raise ValueError()
        if 'stats' in body:
            _native_stats(body['stats'])
        data = body['data']
        if type(data) is not dict or set(data) != {'resultType', 'result'} or data['resultType'] != 'vector':
            raise ValueError()
        rows = data['result']
        if type(rows) is not list or len(rows) > 512:
            raise ValueError()
        seen, sdk, scrape = set(), {}, 0
        for row in rows:
            if type(row) is not dict or set(row) != {'metric', 'value'}:
                raise ValueError()
            labels, sample = row['metric'], row['value']
            if (type(labels) is not dict or not all(type(v) is str for v in labels.values()) or '__name__' not in labels
                    or type(sample) is not list or len(sample) != 2 or type(sample[0]) not in (int, float, Decimal)
                    or not math.isfinite(sample[0]) or sample[0] <= 0):
                raise ValueError()
            value = number(sample[1])
            identity = tuple(sorted(labels.items()))
            if identity in seen:
                raise ValueError()
            seen.add(identity)
            if 'job' in labels:
                _self_scrape(labels)
                scrape += 1
                continue
            common = {'service.name': 'platform-api', 'deployment.environment.name': 'test',
                      'service.version': release, 'scope.name': 'inside-collector'}
            if any(labels.get(k) != v for k, v in common.items()) or labels.get('scope.version', '') not in ('', 'unknown'):
                raise ValueError()
            name = labels['__name__']
            keys = {'__name__', *common, 'scope.version'}
            if name.startswith('inside.dependency.'):
                keys |= {'dependency', 'operation', 'outcome', 'le'}
                if labels.get('dependency') != 's3' or labels.get('operation') not in ('getObject.read', 'http.GET') or labels.get('outcome') != 'completed':
                    raise ValueError()
                owner = labels['operation']
                names = ('inside.dependency.operations', 'inside.dependency.duration_count', 'inside.dependency.duration_sum', 'inside.dependency.duration_bucket')
            elif name.startswith('http.server.request.'):
                keys |= {'http.request.method', 'http.route', 'http.request.outcome', 'http.response.status_code', 'le'}
                if any(labels.get(k) != v for k, v in {'http.request.method': 'GET', 'http.route': '/pilot', 'http.request.outcome': 'completed', 'http.response.status_code': '200'}.items()):
                    raise ValueError()
                owner = 'test-owned-http-root'
                names = ('http.server.request.count', 'http.server.request.duration_count', 'http.server.request.duration_sum', 'http.server.request.duration_bucket')
            elif name in SCALARS:
                owner, names = 'sdk-health', (name,)
                if value != SCALARS[name]:
                    raise ValueError()
            else:
                raise ValueError()
            if set(labels)-keys or name not in names:
                raise ValueError()
            bucket = labels.get('le')
            if (name.endswith('_bucket') and bucket not in BOUNDS or not name.endswith('_bucket') and bucket is not None):
                raise ValueError()
            if name.endswith('_sum'):
                if value > 60:
                    raise ValueError()
            elif owner != 'sdk-health' and not name.endswith('_bucket') and value != 1:
                raise ValueError()
            elif name.endswith('_bucket') and value not in (0, 1):
                raise ValueError()
            logical_key = (owner, name, bucket)
            if logical_key in sdk:
                raise ValueError()
            sdk[logical_key] = value
        expected = {(owner, prefix+suffix, bucket) for owner, prefix, counter in (
            ('getObject.read', 'inside.dependency.duration', 'inside.dependency.operations'),
            ('http.GET', 'inside.dependency.duration', 'inside.dependency.operations'),
            ('test-owned-http-root', 'http.server.request.duration', 'http.server.request.count'))
            for suffix, bucket in (('_count', None), ('_sum', None), *(('_bucket', b) for b in BOUNDS))}
        expected |= {(owner, counter, None) for owner, counter in (('getObject.read', 'inside.dependency.operations'), ('http.GET', 'inside.dependency.operations'), ('test-owned-http-root', 'http.server.request.count'))}
        expected |= {('sdk-health', name, None) for name in SCALARS}
        if set(sdk)-expected:
            raise ValueError()
        # Validate monotonic cumulative buckets for every present owner before pending.
        for owner, prefix in (('getObject.read', 'inside.dependency.duration'), ('http.GET', 'inside.dependency.duration'), ('test-owned-http-root', 'http.server.request.duration')):
            buckets = [sdk.get((owner, prefix+'_bucket', bound)) for bound in BOUNDS]
            present = [v for v in buckets if v is not None]
            if present != sorted(present) or buckets[-1] not in (None, 1):
                raise ValueError()
            total = sdk.get((owner, prefix+'_sum', None))
            if total is not None:
                for bound, value in zip(BOUNDS, buckets):
                    if value is not None and value != int(bound == '+Inf' or total <= float(bound)):
                        raise ValueError()
        if set(sdk) != expected:
            return None
        return {'s3_dependency_series': 38, 'other_sdk_series': 29, 'self_scrape_series': scrape,
                'full_vector_series': len(rows), 'privacy': 'passed', 'sdk_metrics': 'passed'}
    except (ValueError, TypeError, KeyError, UnicodeError, OverflowError, RecursionError) as error:
        raise OracleRefusal('SDK storage metric contract failed',
                            'response_decode' if isinstance(error, ResponseDecode) else 'oracle_refusal') from None


def traces(raw, *, trace_id, root_id, release):
    try:
        from telegram_http_storage import _timestamp_matches
        if (type(raw) is not str or len(raw.encode('utf-8')) > MAX_BYTES
                or re.fullmatch(r'[0-9a-f]{32}', trace_id) is None
                or re.fullmatch(r'[0-9a-f]{16}', root_id) is None
                or re.fullmatch(r'[0-9a-f]{40}', release) is None):
            raise TraceGateRefusal('sdk','trace_gate_01')
        try:
            rows = [decode(line) for line in raw.splitlines() if line.strip()]
        except ResponseDecode:raise
        except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError):
            raise TraceGateRefusal('sdk','trace_decode') from None
        if len(rows) > 3:
            raise TraceGateRefusal('sdk','trace_gate_02')
        names = {'GET /pilot': ('root', '2'), 's3 getObject.read': ('read', '1'), 's3 http.GET': ('http', '3')}
        roles, identities = {}, set()
        for row in rows:
            if type(row) is not dict or not all(type(v) is str for v in row.values()) or row.get('name') not in names:
                raise TraceGateRefusal('sdk','trace_gate_03')
            role, kind = names[row['name']]
            identity = row.get('span_id')
            if (identity is None or re.fullmatch(r'[0-9a-f]{16}', identity) is None or identity == '0'*16
                    or identity in identities or role in roles):
                raise TraceGateRefusal('sdk','trace_gate_04')
            identities.add(identity)
            attrs = ({'span_attr:http.request.method': 'GET', 'span_attr:http.route': '/pilot',
                      'span_attr:http.request.outcome': 'completed', 'span_attr:http.response.status_code': '200'}
                     if role == 'root' else {'span_attr:dependency.name': 's3',
                        'span_attr:dependency.operation': 'getObject.read' if role == 'read' else 'http.GET',
                        'span_attr:dependency.outcome': 'completed',
                        **({'span_attr:http.request.method': 'GET', 'span_attr:http.response.status_code': '200'} if role == 'http' else {})})
            expected = {'trace_id': trace_id, 'resource_attr:service.name': 'platform-api',
                        'resource_attr:deployment.environment.name': 'test', 'resource_attr:service.version': release,
                        'scope_name': 'inside-collector', 'kind': kind, 'status_code': '0', 'flags': '257', '_msg': '-',
                        '_stream': '{name='+json.dumps(row['name'])+',resource_attr:service.name="platform-api"}', **attrs}
            mandatory = {*expected, 'name', 'span_id', 'start_time_unix_nano', 'end_time_unix_nano', 'duration', '_time', '_stream_id'}
            if role != 'root':
                mandatory.add('parent_span_id')
            optional = {'scope_version': '', 'trace_state': '', 'status_message': '',
                        'dropped_attributes_count': '0', 'dropped_events_count': '0', 'dropped_links_count': '0'}
            if role == 'root':
                optional['parent_span_id'] = ''
            if (not mandatory <= set(row) or set(row)-mandatory-set(optional)
                    or any(row.get(k) != v for k, v in expected.items())
                    or any(row[k] != optional[k] for k in set(row)&set(optional))):
                raise TraceGateRefusal('sdk','trace_gate_05')
            for key in ('start_time_unix_nano', 'end_time_unix_nano', 'duration'):
                if re.fullmatch(r'[1-9][0-9]{0,18}|0', row[key]) is None:
                    raise TraceGateRefusal('sdk','trace_gate_06')
            start, end, duration = (int(row[k]) for k in ('start_time_unix_nano', 'end_time_unix_nano', 'duration'))
            if (not 0 < start <= end < 2**63 or duration != end-start or duration > 60_000_000_000
                    or not _timestamp_matches(row['_time'], start)
                    or re.fullmatch(r'0{16}[0-9a-f]{32}', row['_stream_id']) is None):
                raise TraceGateRefusal('sdk','trace_gate_07')
            if role == 'root' and identity != root_id:
                raise TraceGateRefusal('sdk','trace_gate_08')
            if role == 'read' and row['parent_span_id'] != root_id:
                raise TraceGateRefusal('sdk','trace_gate_09')
            if role == 'http' and row['parent_span_id'] in (root_id, identity):
                raise TraceGateRefusal('sdk','trace_gate_10')
            roles[role] = row
        # Validate known neighboring edges even while the third row is not visible yet.
        if 'http' in roles and 'read' in roles and roles['http']['parent_span_id'] != roles['read']['span_id']:
            raise TraceGateRefusal('sdk','trace_gate_11')
        for parent, child in (('root', 'read'), ('read', 'http')):
            if parent in roles and child in roles:
                p, c = roles[parent], roles[child]
                if not int(p['start_time_unix_nano']) <= int(c['start_time_unix_nano']) <= int(c['end_time_unix_nano']) <= int(p['end_time_unix_nano']):
                    raise TraceGateRefusal('sdk','trace_gate_12')
        if len(roles) != 3:
            return None
        return {'stored_spans': 3, 'test_owned_root': 'passed', 's3_read_http_causality': 'passed', 'privacy': 'passed'}
    except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError) as error:
        raise trace_refusal(error,scope='sdk') from None
