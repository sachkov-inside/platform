"""Pure facts for ONE SDK S3 read. No native-format or privacy acceptance.

The two closed interfaces accept only observations, never storage envelopes.
None means unavailable metadata, is retained in unknown_fields, and does not
prove absence. Adapters must validate complete native raw surfaces separately.
"""
import math
import re
from decimal import Decimal

BOUNDS = ('0', '5', '10', '25', '50', '75', '100', '250', '500', '750', '1000', '2500', '5000', '7500', '10000', '+Inf')
_RESOURCE = {'service.name': 'platform-api', 'deployment.environment.name': 'test'}
_SPAN_EXTRAS = {'trace_state': '', 'status_message': '', 'dropped_attributes_count': 0,
                'dropped_events_count': 0, 'dropped_links_count': 0, 'link_metadata': None}


def _fail(surface, reason):
    raise ValueError('SDK '+surface+' semantics failed: '+reason)


def _hex(value, length):
    return type(value) is str and re.fullmatch('[0-9a-f]{'+str(length)+'}', value) is not None


def _strings(value):
    return type(value) is dict and all(type(k) is str and type(v) is str for k, v in value.items())


def _context(resource, scope, release, versions):
    return (_strings(resource) and resource == {**_RESOURCE, 'service.version': release}
            and type(scope) is dict and set(scope) == {'name', 'version', 'attributes'}
            and type(scope['name']) is str and scope['name'] == 'inside-collector'
            and (scope['version'] is None or type(scope['version']) is str and scope['version'] in versions)
            and (scope['attributes'] is None or type(scope['attributes']) is dict and scope['attributes'] == {}))


def spans(facts, *, trace_id, root_id, release):
    """Check actual span facts, poison before pending, retaining unavailable extras.

    Times, duration, kind, status and original flags are exact integers. Extra
    metadata must be explicitly None or the admitted empty/zero observation.
    The fixed gate labels identify corresponding legacy semantic requirements;
    VM stream/message/timestamp provenance is exclusively the legacy wrapper's.
    """
    refuse = lambda gate: _fail('span', 'trace_gate_'+str(gate).zfill(2))
    if not _hex(trace_id, 32) or not _hex(root_id, 16) or not _hex(release, 40) or type(facts) is not list:
        refuse(1)
    if len(facts) > 3:
        refuse(2)
    names = {'GET /pilot': ('root', 2), 's3 getObject.read': ('read', 1), 's3 http.GET': ('http', 3)}
    fields = {'name', 'trace_id', 'span_id', 'parent_span_id', 'start', 'end', 'duration',
              'flags', 'kind', 'status_code', 'resource', 'scope', 'attributes', 'extras'}
    roles, identities, unknown = {}, set(), set()
    for row in facts:
        if type(row) is not dict or type(row.get('name')) is not str or row['name'] not in names:
            refuse(3)
        role, kind = names[row['name']]
        identity = row.get('span_id')
        if not _hex(identity, 16) or identity == '0'*16 or identity in identities or role in roles:
            refuse(4)
        identities.add(identity)
        attrs = ({'http.request.method': 'GET', 'http.route': '/pilot', 'http.request.outcome': 'completed',
                  'http.response.status_code': '200'} if role == 'root' else
                 {'dependency.name': 's3', 'dependency.operation': 'getObject.read' if role == 'read' else 'http.GET',
                  'dependency.outcome': 'completed',
                  **({'http.request.method': 'GET', 'http.response.status_code': '200'} if role == 'http' else {})})
        if (set(row) != fields or type(row['trace_id']) is not str or row['trace_id'] != trace_id
                or not _context(row['resource'], row['scope'], release, ('',))
                or not _strings(row['attributes']) or row['attributes'] != attrs
                or type(row['kind']) is not int or row['kind'] != kind
                or type(row['flags']) is not int or row['flags'] != 257
                or type(row['status_code']) is not int or row['status_code'] != 0
                or type(row['parent_span_id']) is not str
                or role == 'root' and row['parent_span_id'] != ''
                or type(row['extras']) is not dict or set(row['extras']) != set(_SPAN_EXTRAS)):
            refuse(5)
        for key, empty in _SPAN_EXTRAS.items():
            value = row['extras'][key]
            if value is None:
                unknown.add(key)
            elif empty is None or type(value) is not type(empty) or value != empty:
                refuse(5)
        for key in ('version', 'attributes'):
            if row['scope'][key] is None:
                unknown.add('scope.'+key)
        if any(type(row[k]) is not int or not 0 <= row[k] < 10**19 for k in ('start', 'end', 'duration')):
            refuse(6)
        start, end, duration = (row[k] for k in ('start', 'end', 'duration'))
        if not 0 < start <= end < 2**63 or duration != end-start or duration > 60_000_000_000:
            refuse(7)
        if role == 'root' and identity != root_id:
            refuse(8)
        if role == 'read' and row['parent_span_id'] != root_id:
            refuse(9)
        if role == 'http' and row['parent_span_id'] in (root_id, identity):
            refuse(10)
        roles[role] = row
    if 'http' in roles and 'read' in roles and roles['http']['parent_span_id'] != roles['read']['span_id']:
        refuse(11)
    for parent, child in (('root', 'read'), ('read', 'http')):
        if parent in roles and child in roles:
            p, c = roles[parent], roles[child]
            if not p['start'] <= c['start'] <= c['end'] <= p['end']:
                refuse(12)
    if len(roles) != 3:
        return None
    return {'sdk_span_semantics': 'passed', 'stored_spans': 3, 'unknown_fields': tuple(sorted(unknown))}


_SCALARS = {'http.server.active_requests': 0, 'telemetry.trace.dropped': 0,
            'telemetry.trace.export.failures': 0, 'telemetry.metric.export.failures': 0,
            'telemetry.trace.sampling.ratio': 1,
            **{'inside.postgresql.pool.'+name: 0 for name in ('available', 'total', 'idle', 'waiting', 'registry_overflow')}}
_HISTOGRAMS = (('getObject.read', 'inside.dependency.duration', 'inside.dependency.operations'),
               ('http.GET', 'inside.dependency.duration', 'inside.dependency.operations'),
               ('test-owned-http-root', 'http.server.request.duration', 'http.server.request.count'))


def _finite(value):
    try:
        return type(value) in (int, float, Decimal) and math.isfinite(value)
    except (OverflowError, ValueError):
        return False


def metrics(facts, *, release):
    """Check 67 logical SDK series, independent of self-scrapes and native APIs.

    Each fact retains its actual native_name and measurement metadata. Only the
    two named duration families permit the documented .count/.sum/.bucket names.
    Native units/types describe those stored components, with no rescaling.
    None metadata is unavailable (e.g. Prometheus vectors), never a default.
    Raw min/max, exemplars and other privacy surfaces remain adapter obligations.
    """
    # A fixed message intentionally contains no raw value or private metadata.
    def fail():
        raise ValueError('SDK metric semantics failed')
    refuse = fail
    if not _hex(release, 40) or type(facts) is not list or len(facts) > 67:
        refuse()
    fields = {'name', 'native_name', 'value', 'timestamp', 'resource', 'scope', 'attributes',
              'kind', 'unit', 'temporality', 'monotonic', 'flags', 'exemplars'}
    sdk, unknown = {}, set()
    for row in facts:
        if type(row) is not dict or set(row) != fields:
            refuse()
        name, native, attrs, value = (row[k] for k in ('name', 'native_name', 'attributes', 'value'))
        if (type(name) is not str or type(native) is not str or not _strings(attrs)
                or not _context(row['resource'], row['scope'], release, ('', 'unknown'))
                or not _finite(value) or value < 0 or not _finite(row['timestamp']) or row['timestamp'] <= 0):
            refuse()
        if name.startswith('inside.dependency.'):
            owner = attrs.get('operation')
            common = {'dependency': 's3', 'operation': owner, 'outcome': 'completed'}
            if owner not in ('getObject.read', 'http.GET'):
                refuse()
            prefix, counter = 'inside.dependency.duration', 'inside.dependency.operations'
        elif name.startswith('http.server.request.'):
            owner, prefix, counter = 'test-owned-http-root', 'http.server.request.duration', 'http.server.request.count'
            common = {'http.request.method': 'GET', 'http.route': '/pilot', 'http.request.outcome': 'completed', 'http.response.status_code': '200'}
        elif name in _SCALARS:
            owner, common, prefix, counter = 'sdk-health', {}, '', name
        else:
            refuse()
        histogram = owner != 'sdk-health' and name in (prefix+'_count', prefix+'_sum', prefix+'_bucket')
        bucket = attrs.get('le')
        if (name not in (counter, prefix+'_count', prefix+'_sum', prefix+'_bucket')
                or attrs != {**common, **({'le': bucket} if name.endswith('_bucket') else {})}
                or name.endswith('_bucket') and bucket not in BOUNDS):
            refuse()
        dotted = prefix+'.'+name[len(prefix)+1:] if histogram else name
        if native not in (name, dotted):
            refuse()
        gauge = owner == 'sdk-health' and (name in ('http.server.active_requests', 'telemetry.trace.sampling.ratio') or name.startswith('inside.postgresql.pool.'))
        expected_kind = 'gauge' if gauge else 'histogram' if name.endswith('_bucket') else 'sum'
        expected_unit = '1' if histogram and native == dotted and name.endswith('_count') else 's' if histogram else ''
        metadata = {'kind': expected_kind, 'unit': expected_unit,
                    'temporality': 'unspecified' if gauge else 'cumulative', 'monotonic': not gauge, 'flags': 0}
        for key, expected in metadata.items():
            observed = row[key]
            if observed is None:
                unknown.add(key)
            elif type(observed) is not type(expected) or observed != expected:
                refuse()
        if row['exemplars'] is not None:
            refuse()
        unknown.add('exemplars')
        for key in ('version', 'attributes'):
            if row['scope'][key] is None:
                unknown.add('scope.'+key)
        if owner == 'sdk-health':
            if value != _SCALARS[name]:
                refuse()
        elif name.endswith('_sum'):
            if value > 60:
                refuse()
        elif name.endswith('_bucket'):
            if value not in (0, 1):
                refuse()
        elif value != 1:
            refuse()
        identity = owner, name, bucket
        if identity in sdk:
            refuse()
        sdk[identity] = value
    expected = {(owner, prefix+suffix, bucket) for owner, prefix, _ in _HISTOGRAMS
                for suffix, bucket in (('_count', None), ('_sum', None), *(('_bucket', b) for b in BOUNDS))}
    expected |= {(owner, counter, None) for owner, _, counter in _HISTOGRAMS}
    expected |= {('sdk-health', name, None) for name in _SCALARS}
    if set(sdk)-expected:
        refuse()
    for owner, prefix, _ in _HISTOGRAMS:
        buckets = [sdk.get((owner, prefix+'_bucket', bound)) for bound in BOUNDS]
        present = [v for v in buckets if v is not None]
        if present != sorted(present) or buckets[-1] not in (None, 1):
            refuse()
        total = sdk.get((owner, prefix+'_sum', None))
        if total is not None:
            for bound, value in zip(BOUNDS, buckets):
                if value is not None and value != int(bound == '+Inf' or total <= float(bound)):
                    refuse()
    if set(sdk) != expected:
        return None
    return {'sdk_metric_semantics': 'passed', 'logical_series': 67, 'unknown_fields': tuple(sorted(unknown))}
