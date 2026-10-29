"""Source-neutral SDK facts and immutable native-wrapper compatibility."""
import copy
import ast
import json
from pathlib import Path
import hashlib
import types
import linecache
import unittest

from decimal import Decimal
from unittest.mock import patch

import oracle
import test_oracle
import sdk_semantics
from test_oracle import trace_fixture, raw_traces, vector


def span_facts():
    return [{
        'name': row['name'], 'trace_id': row['trace_id'], 'span_id': row['span_id'],
        'parent_span_id': row.get('parent_span_id', ''),
        'start': int(row['start_time_unix_nano']), 'end': int(row['end_time_unix_nano']),
        'duration': int(row['duration']), 'flags': int(row['flags']),
        'kind': int(row['kind']), 'status_code': int(row['status_code']),
        'resource': {key.removeprefix('resource_attr:'): value for key, value in row.items() if key.startswith('resource_attr:')},
        'scope': {'name': row['scope_name'], 'version': None, 'attributes': None},
        'attributes': {key.removeprefix('span_attr:'): value for key, value in row.items() if key.startswith('span_attr:')},
        'extras': {key: None for key in ('trace_state', 'status_message', 'dropped_attributes_count',
                                        'dropped_events_count', 'dropped_links_count', 'link_metadata')},
    } for row in trace_fixture()]


class SpanSemantics(unittest.TestCase):
    def test_actual_three_span_chain_returns_only_semantic_subset_and_unknowns(self):
        facts = span_facts()
        before = copy.deepcopy(facts)
        verdict = sdk_semantics.spans(facts, trace_id='a'*32, root_id='b'*16, release='c'*40)
        self.assertEqual(verdict['sdk_span_semantics'], 'passed')
        self.assertEqual(verdict['stored_spans'], 3)
        self.assertIn('link_metadata', verdict['unknown_fields'])
        self.assertNotIn('privacy', verdict)
        self.assertEqual(facts, before)
        facts[2]['flags'] = 1
        with self.assertRaisesRegex(ValueError, '^SDK span semantics failed: trace_gate_05$'):
            sdk_semantics.spans(facts, trace_id='a'*32, root_id='b'*16, release='c'*40)

    def test_partial_neighbors_and_every_core_predicate_are_checked_before_pending(self):
        args = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        self.assertIsNone(sdk_semantics.spans([], **args))
        self.assertIsNone(sdk_semantics.spans(span_facts()[1:], **args))
        cases = [(1, span_facts(), {'trace_id': 'invalid'}), (2, span_facts()*2, {})]
        mutations = [(3, 2, 'name', 'unregistered'), (4, 2, 'span_id', 'b'*16),
                     (5, 2, 'kind', 1), (5, 2, 'status_code', 2),
                     (5, 2, 'flags', True), (5, 2, 'flags', '257'),
                     (5, 2, 'trace_id', 'f'*32), (6, 2, 'start', '1800000000001000000'),
                     (6, 2, 'duration', True), (7, 2, 'duration', 2),
                     (8, 0, 'span_id', 'f'*16), (9, 1, 'parent_span_id', 'f'*16),
                     (10, 2, 'parent_span_id', 'b'*16), (11, 2, 'parent_span_id', 'f'*16)]
        for gate, index, field, value in mutations:
            facts = span_facts()
            facts[index][field] = value
            cases.append((gate, facts, {}))
        facts = span_facts()
        facts[2].update(end=1800000000002600000, duration=1600000)
        cases.append((12, facts, {}))
        for gate, facts, arguments in cases:
            with self.subTest(gate=gate), self.assertRaisesRegex(ValueError, 'trace_gate_'+str(gate).zfill(2)+'$'):
                sdk_semantics.spans(facts, **{**args, **arguments})
        for field, value in (('_stream_id', 'fabricated'), ('_time', 'fabricated'), ('_msg', '-'),
                             ('attributes', {'url.full': 'private-value'})):
            facts = span_facts()[1:]
            facts[-1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                sdk_semantics.spans(facts, **args)
        facts = span_facts()[1:]
        facts[-1]['parent_span_id'] = 'f'*16
        with self.assertRaisesRegex(ValueError, 'trace_gate_11$'):
            sdk_semantics.spans(facts, **args)

    def test_known_empty_metadata_is_checked_and_missing_metadata_never_means_zero(self):
        facts = span_facts()
        for row in facts:
            row['scope'].update(version='', attributes={})
            row['extras'].update(trace_state='', status_message='', dropped_attributes_count=0,
                                 dropped_events_count=0, dropped_links_count=0)
        args = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        self.assertEqual(sdk_semantics.spans(facts, **args)['unknown_fields'], ('link_metadata',))
        for key, value in (('dropped_links_count', False), ('dropped_attributes_count', 1),
                           ('trace_state', 'private'), ('status_message', 'private'), ('link_metadata', [])):
            poisoned = copy.deepcopy(facts)
            poisoned[-1]['extras'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                sdk_semantics.spans(poisoned, **args)
        for key, value in (('version', 'unknown'), ('attributes', {'url.full': 'private'})):
            poisoned = copy.deepcopy(facts)
            poisoned[-1]['scope'][key] = value
            with self.assertRaises(ValueError):
                sdk_semantics.spans(poisoned, **args)
        facts[-1]['resource']['service.version'] = 'f'*40
        with self.assertRaises(ValueError):
            sdk_semantics.spans(facts, **args)


def metric_facts():
    facts = []
    for row in vector()['data']['result']:
        labels = row['metric']
        name = labels['__name__']
        histogram = name.endswith(('_count', '_sum', '_bucket'))
        gauge = name in ('http.server.active_requests', 'telemetry.trace.sampling.ratio') or name.startswith('inside.postgresql.pool.')
        facts.append({
            'name': name, 'native_name': name.rsplit('_', 1)[0]+'.'+name.rsplit('_', 1)[1] if histogram else name, 'value': float(row['value'][1]), 'timestamp': row['value'][0],
            'resource': {key: labels[key] for key in ('service.name', 'deployment.environment.name', 'service.version')},
            'scope': {'name': 'inside-collector', 'version': None, 'attributes': None},
            'attributes': {key: value for key, value in labels.items() if key not in
                           ('__name__', 'service.name', 'deployment.environment.name', 'service.version', 'scope.name')},
            'kind': 'histogram' if name.endswith('_bucket') else 'gauge' if gauge else 'sum',
            'unit': '1' if name.endswith('_count') else 's' if histogram else '', 'temporality': 'unspecified' if gauge else 'cumulative',
            'monotonic': not gauge, 'flags': 0, 'exemplars': None,
        })
    return facts


class MetricSemantics(unittest.TestCase):
    def test_full_67_series_has_distinct_semantic_verdict_and_checks_metadata(self):
        facts = metric_facts()
        verdict = sdk_semantics.metrics(facts, release='a'*40)
        self.assertEqual(verdict['sdk_metric_semantics'], 'passed')
        self.assertEqual(verdict['logical_series'], 67)
        self.assertIn('exemplars', verdict['unknown_fields'])
        self.assertNotIn('privacy', verdict)
        facts[2]['unit'] = 'ms'
        with self.assertRaisesRegex(ValueError, '^SDK metric semantics failed$'):
            sdk_semantics.metrics(facts, release='a'*40)

    def test_missing_series_pending_only_after_every_observed_poison_is_rejected(self):
        self.assertIsNone(sdk_semantics.metrics([], release='a'*40))
        facts = metric_facts()[1:]
        self.assertIsNone(sdk_semantics.metrics(facts, release='a'*40))
        for key, value in (('kind', 'gauge'), ('temporality', 'delta'), ('flags', 1),
                           ('flags', False), ('unit', 'ms'), ('monotonic', False),
                           ('value', True), ('value', '1'), ('value', float('inf')),
                           ('value', float('nan')), ('value', Decimal('sNaN')),
                           ('value', Decimal('1e10000')), ('timestamp', False),
                           ('timestamp', float('nan')), ('exemplars', []),
                           ('native_name', 'inside.dependency.duration.min')):
            poisoned = copy.deepcopy(facts)
            poisoned[0][key] = value
            with self.subTest(key=key, value=repr(value)), self.assertRaisesRegex(ValueError, '^SDK metric semantics failed$'):
                sdk_semantics.metrics(poisoned, release='a'*40)
        for mutation in ('duplicate', 'scope_variant', 'missing_bound', 'extra_bound', 'fractional',
                         'inconsistent_sum', 'nonmonotonic', 'resource_collision', 'scope_collision',
                         'point_collision', 'unknown_name', 'extra_field', 'unknown_suffix'):
            poisoned = copy.deepcopy(facts)
            if mutation in ('duplicate', 'scope_variant'):
                second = copy.deepcopy(poisoned[0])
                if mutation == 'scope_variant': second['scope']['version'] = 'unknown'
                poisoned = [poisoned[0], second]
            elif mutation == 'missing_bound':
                del poisoned[2]['attributes']['le']
            elif mutation == 'extra_bound': poisoned[2]['attributes']['le'] = '0.001'
            elif mutation == 'fractional': poisoned[0]['value'] = 0.5
            elif mutation == 'inconsistent_sum': poisoned[1]['value'] = 5.25
            elif mutation == 'nonmonotonic': poisoned[4]['value'] = 0
            elif mutation == 'resource_collision': poisoned[-1]['resource']['scope.name'] = 'inside-collector'
            elif mutation == 'scope_collision': poisoned[-1]['scope']['attributes'] = {'service.name': 'platform-api'}
            elif mutation == 'point_collision': poisoned[-1]['attributes']['service.name'] = 'platform-api'
            elif mutation == 'unknown_name': poisoned[-1]['name'] = 'unknown'
            elif mutation == 'extra_field': poisoned[-1]['stats'] = {'seriesFetched': '67'}
            else: poisoned[0]['native_name'] = 'inside_dependency_duration_count'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                sdk_semantics.metrics(poisoned, release='a'*40)

    def test_exact_histogram_bounds_and_native_component_metadata_remain_observations(self):
        facts = metric_facts()
        self.assertEqual([row['attributes']['le'] for row in facts[3:19]],
                         ['0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf'])
        for row in facts:
            row['scope'].update(version='', attributes={})
        self.assertEqual(sdk_semantics.metrics(facts, release='a'*40)['unknown_fields'], ('exemplars',))
        # A vector has no unit/type/temporality/flags metadata. Absence stays visible.
        for row in facts:
            for key in ('kind', 'unit', 'temporality', 'monotonic', 'flags'):
                row[key] = None
        verdict = sdk_semantics.metrics(facts, release='a'*40)
        self.assertEqual(verdict['unknown_fields'], ('exemplars', 'flags', 'kind', 'monotonic', 'temporality', 'unit'))
        for value in (True, '0', 0.0):
            poisoned = copy.deepcopy(facts)
            poisoned[0]['flags'] = value
            with self.assertRaises(ValueError):
                sdk_semantics.metrics(poisoned, release='a'*40)


BASE = '7c5269204d87efaa804038115a374fea3bf3e857'
ORACLE_PATH = 'scripts/observability-sdk-storage/oracle.py'

# Frozen verbatim from BASE:ORACLE_PATH. Keep this readable fixture and its digest
# independent of the current oracle; checkout history is not a test input.
BASELINE_SHA256 = 'ee21334e6bb841e95e93d36463283a6ec7fca04f359ae804b1e16ef2b7a9df74'
BASELINE_SOURCE = r'''"""Closed full-raw oracle for one genuine SDK S3 cold read; never an API proof."""
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
'''


def baseline_oracle():
    root = Path(__file__).resolve().parents[2]
    source = BASELINE_SOURCE
    if hashlib.sha256(source.encode('utf-8')).hexdigest() != BASELINE_SHA256:
        raise ValueError('immutable SDK oracle baseline hash mismatch')
    module = types.ModuleType('immutable_sdk_oracle')
    module.__file__ = str(root/ORACLE_PATH)
    filename = '<immutable-sdk-oracle-'+BASE+'>'
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    exec(compile(source, filename, 'exec'), module.__dict__)
    return module, source


def observation(function, raw, arguments):
    try:
        return ('return', function(raw, **arguments))
    except BaseException as error:
        frames, tb = [], error.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_name != 'observation':
                frames.append((tb.tb_frame.f_code.co_name,
                               linecache.getline(tb.tb_frame.f_code.co_filename, tb.tb_lineno).strip()))
            tb = tb.tb_next
        return ('error', type(error), error.args, getattr(error, 'reason', None),
                error.__suppress_context__, type(error.__cause__), tuple(frames))


class LegacyCompatibility(unittest.TestCase):
    def test_all_original_function_statements_remain_except_terminal_calls(self):
        _, source = baseline_oracle()
        old = ast.parse(source)
        new = ast.parse(Path(oracle.__file__).read_text())
        old_functions = {node.name: node for node in old.body if isinstance(node, ast.FunctionDef)}
        new_functions = {node.name: node for node in new.body if isinstance(node, ast.FunctionDef)}
        for name, function in old_functions.items():
            current = copy.deepcopy(new_functions[name])
            if name in ('traces', 'metrics'):
                body = current.body[0].body
                additions = [i for i, node in enumerate(body) if isinstance(node, ast.Expr)
                             and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute)
                             and isinstance(node.value.func.value, ast.Name) and node.value.func.value.id == 'sdk_semantics']
                self.assertEqual(additions, [len(body)-2], 'shared check must occur immediately before original terminal success')
                del body[additions[0]]
            self.assertEqual(ast.dump(current, include_attributes=False), ast.dump(function, include_attributes=False))

    def test_original_unmodified_fixture_and_mutation_suite_passes_against_both_oracles(self):
        baseline, _ = baseline_oracle()
        for owner in (baseline, oracle):
            with self.subTest(owner=owner.__name__), patch.object(test_oracle, 'oracle', owner):
                result = unittest.TestResult()
                unittest.defaultTestLoader.loadTestsFromModule(test_oracle).run(result)
                self.assertEqual((result.errors, result.failures), ([], []))
                self.assertGreater(result.testsRun, 10)

    def test_success_pending_poison_and_all_twelve_gates_match_immutable_baseline(self):
        baseline, _ = baseline_oracle()
        arguments = {'trace_id': 'a'*32, 'root_id': 'b'*16, 'release': 'c'*40}
        cases = [(raw_traces(trace_fixture()), arguments), ('', arguments), ('{', arguments),
                 ('[]', arguments), ('{"name":"sdk-storage-private"}', arguments)]
        for rows in (trace_fixture()[:1], trace_fixture()[1:], trace_fixture()[::2]):
            cases.append((raw_traces(rows), arguments))
        mutations = ((0, 'span_id', 'f'*16), (1, 'parent_span_id', 'f'*16),
                     (2, 'parent_span_id', 'b'*16), (2, 'parent_span_id', 'f'*16),
                     (2, 'name', 'unknown'), (2, 'kind', 3), (2, 'span_id', 'b'*16),
                     (2, 'flags', '1'), (2, 'duration', '01'), (2, 'duration', '2'),
                     (2, 'end_time_unix_nano', '1800000000002600000'))
        for index, key, value in mutations:
            rows = trace_fixture()
            rows[index][key] = value
            if key == 'end_time_unix_nano':
                rows[index]['duration'] = '1600000'
            cases.append((raw_traces(rows), arguments))
        cases.extend([(raw_traces(trace_fixture()*2), arguments),
                      (raw_traces(trace_fixture()), {**arguments, 'trace_id': 'invalid'})])
        for optional in ({'scope_version': '', 'trace_state': '', 'status_message': '',
                          'dropped_attributes_count': '0', 'dropped_events_count': '0', 'dropped_links_count': '0'}, {}):
            rows = trace_fixture()
            for row in rows:
                row.update(optional)
            rows[0]['parent_span_id'] = ''
            cases.append((raw_traces(rows), arguments))
        for raw, kwargs in cases:
            with self.subTest(raw=raw[:30], arguments=kwargs):
                self.assertEqual(observation(oracle.traces, raw, kwargs), observation(baseline.traces, raw, kwargs))
        bodies = [vector(), {'status': 'success', 'data': {'resultType': 'vector', 'result': []}}]
        for scope in ('', 'unknown'):
            body = vector()
            for row in body['data']['result']:
                row['metric']['scope.version'] = scope
            bodies.append(body)
        for mutation in ('missing', 'duplicate', 'private', 'histogram', 'stats', 'self_scrape', 'late_poison'):
            body = vector()
            rows = body['data']['result']
            if mutation == 'missing': rows.pop(0)
            elif mutation == 'duplicate': rows.append(copy.deepcopy(rows[0]))
            elif mutation == 'private': rows[-1]['metric']['private'] = 'private-filename'
            elif mutation == 'histogram': rows[3]['value'][1] = '1'
            elif mutation == 'stats': body['stats']['seriesFetched'] = True
            elif mutation == 'self_scrape': rows.append({'metric': {'__name__': 'up', 'job': 'platform-collector', 'instance': 'pilot'}, 'value': [1800000000, '1']})
            else:
                rows.pop(0)
                rows[-1]['metric']['unknown'] = 'late-poison'
            bodies.append(body)
        for raw in [*(json.dumps(body) for body in bodies), '{', 'null']:
            with self.subTest(metric=raw[:30]):
                self.assertEqual(observation(oracle.metrics, raw, {'release': 'a'*40}),
                                 observation(baseline.metrics, raw, {'release': 'a'*40}))


if __name__ == '__main__':
    unittest.main()
