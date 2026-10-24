"""Closed synthetic challenges and evidence checks, not an OTLP sanitizer or gateway."""
import json
import math
import copy

SENTINEL = 'PRIVACY_SENTINEL_1566'
LINK_TRACE_ID = 'f'*32
LINK_SPAN_ID = 'f'*16
TRACE_STORE_METRICS = ('up', 'vt_http_requests_total', 'vt_http_errors_total',
    'vt_rows_ingested_total', 'vt_rows_dropped_total', 'vt_traceid_index_push_error_total')
TRACE_STORE_MAX_SCRAPE_AGE_SECONDS = 10  # Two configured five-second scrape intervals.


def challenge(payload):
    """Exercise every accessible textual surface; safe SDK-composed links stay intact."""
    value = SENTINEL+' person@example.invalid /private?token='+SENTINEL
    def attribute(key):
        return {'key':key, 'value':{'stringValue':value}}
    for signal, resource_key, scope_key in (
            ('traces','resourceSpans','scopeSpans'), ('logs','resourceLogs','scopeLogs'),
            ('metrics','resourceMetrics','scopeMetrics')):
        group = payload[signal][resource_key][0]
        group['schemaUrl'] = 'https://invalid.example/'+SENTINEL
        group['resource']['attributes'] += [attribute('user.email'), attribute('url.full'),
                                             attribute('authorization'), attribute('cookie')]
        scope = group[scope_key][0]
        scope['schemaUrl'] = 'https://invalid.example/'+SENTINEL
        scope['scope'] = {'name':value,'version':value,'attributes':[attribute('scope.secret')]}
        if signal == 'traces':
            for span in scope['spans']:
                span['traceState'] = 'private='+SENTINEL
                span['status']['message'] = value
                span['attributes'] += [attribute('db.statement'), attribute('http.request.body'),
                                       attribute('exception.message')]
                span['events'] = [{'timeUnixNano':span['startTimeUnixNano'], 'name':value,
                                   'attributes':[attribute('exception.stacktrace')]}]
                span['links'] = [{'traceId':LINK_TRACE_ID, 'spanId':LINK_SPAN_ID}]
            # Keep all five correlation spans, then challenge arbitrary span naming separately.
            extra = copy.deepcopy(scope['spans'][-1])
            extra.update({'name':value, 'spanId':'0000000000000006', 'parentSpanId':'0000000000000005'})
            scope['spans'].append(extra)
        elif signal == 'logs':
            original = scope['logRecords'][0]
            original['attributes'] = [attribute('error.message'), attribute('cookie')]
            scope['logRecords'].append({**original, 'body':{'stringValue':value}, 'eventName':value,
                                        'severityText':value})
            scope['logRecords'].append({**original, 'body':{'kvlistValue':{'values':[attribute('nested.secret')]}}})
        else:
            metric = scope['metrics'][0]
            metric['description'] = value
            metric['unit'] = value
            point = metric['gauge']['dataPoints'][0]
            point['attributes'] += [attribute('request.path'), attribute('account.id')]
            point['exemplars'] = [{'timeUnixNano':point['timeUnixNano'], 'asInt':'1',
                                  'filteredAttributes':[attribute('user.email')]}]
            scope['metrics'].append({'name':SENTINEL, 'gauge':{'dataPoints':[point]}})
    require_supported_links(payload)
    return payload


def require_supported_links(payload):
    """Harness precondition only. The collector endpoint does NOT enforce this source contract."""
    for resource in payload['traces']['resourceSpans']:
        for scope in resource['scopeSpans']:
            for span in scope['spans']:
                for link in span.get('links', []):
                    if set(link)-{'traceId','spanId','flags'}:
                        raise RuntimeError('arbitrary OTLP link metadata is unsupported by the SDK-shaped harness')


def assert_clean(value):
    """Never print or save a raw response when the fixed synthetic marker survives."""
    text = value if isinstance(value, str) else json.dumps(value)
    if SENTINEL in text or 'person@example.invalid' in text:
        raise RuntimeError('collector privacy sentinel persisted; raw response withheld')


def assert_link_preserved(value):
    text = value if isinstance(value, str) else json.dumps(value)
    if LINK_TRACE_ID not in text or LINK_SPAN_ID not in text:
        raise RuntimeError('collector lost the SDK-composed link correlation fixture')


def healthy(response):
    """An exact current numeric sample, never a substring somewhere in an error payload."""
    if response[0] != 200:
        return False
    try:
        body = json.loads(response[1])
        rows = body['data']['result']
        return (body['status'] == 'success' and body['data']['resultType'] == 'vector'
                and isinstance(rows, list) and len(rows) == 1
                and rows[0]['metric'] == {'__name__':'up', 'job':'platform-collector', 'instance':'pilot'}
                and isinstance(rows[0]['value'], list) and len(rows[0]['value']) == 2
                and rows[0]['value'][1] == '1')
    except (ValueError, KeyError, TypeError, IndexError):
        return False


def accepted_counter(response):
    if response[0] != 200:
        return False
    try:
        body = json.loads(response[1])
        rows = body['data']['result']
        value = rows[0]['value'][1]
        return (body['status'] == 'success' and body['data']['resultType'] == 'vector'
                and isinstance(rows, list) and len(rows) == 1 and rows[0]['metric'] == {}
                and isinstance(value, str) and math.isfinite(float(value)) and float(value) >= 1)
    except (ValueError, KeyError, TypeError, IndexError):
        return False


def trace_store_health(response, freshness):
    """Closed pinned VT counters. Attempts are NOT persisted rows; lazy index errors stay unknown."""
    labels = {'job':'platform-trace-store','instance':'pilot'}
    path = '/insert/opentelemetry/v1/traces'
    catalog = {
        ('up', ()): 'up',
        ('vt_http_requests_total', (('format','protobuf'), ('path',path))): 'http_requests',
        ('vt_http_errors_total', (('format','protobuf'), ('path',path))): 'http_errors',
        ('vt_rows_ingested_total', (('type','opentelemetry_traces_otlphttp_protobuf'),)): 'ingest_attempts',
        ('vt_rows_dropped_total', (('reason','too_many_fields'),)): 'rows_dropped_too_many_fields',
        ('vt_rows_dropped_total', (('reason','debug'),)): 'rows_dropped_debug',
        ('vt_traceid_index_push_error_total', ()): 'index_push_errors',
    }
    def vector(value):
        if value[0] != 200:
            raise ValueError('unavailable')
        body = json.loads(value[1])
        if body['status'] != 'success' or body['data']['resultType'] != 'vector':
            raise ValueError('not a vector')
        rows = body['data']['result']
        if not isinstance(rows, list):
            raise ValueError('not rows')
        return rows
    def sample(row):
        point = row['value']
        if (not isinstance(point, list) or len(point) != 2 or
                type(point[0]) not in (int,float) or not math.isfinite(point[0]) or
                not isinstance(point[1], str)):
            raise ValueError('invalid sample')
        number = float(point[1])
        if not math.isfinite(number) or number < 0 or number > 2**53:
            raise ValueError('invalid numeric value')
        return number
    try:
        age_rows = vector(freshness)
        if len(age_rows) != 1:
            return None
        age_labels = age_rows[0]['metric']
        if age_labels not in (labels, {**labels,'__name__':'up'}):
            return None
        age = sample(age_rows[0])
        if age > TRACE_STORE_MAX_SCRAPE_AGE_SECONDS:
            return None
        counters = {}
        for row in vector(response):
            metric = row['metric']
            if not isinstance(metric, dict) or any(metric.get(key) != value for key,value in labels.items()):
                return None
            dimensions = tuple(sorted((key,value) for key,value in metric.items()
                                      if key not in ('__name__','job','instance')))
            key = catalog[(metric['__name__'], dimensions)]
            value = sample(row)
            if key in counters or not value.is_integer():
                return None
            counters[key] = int(value)
        required = set(catalog.values())-{'index_push_errors'}
        if (not required.issubset(counters) or counters['up'] != 1 or
                counters['http_requests'] < 1 or counters['ingest_attempts'] < 1):
            return None
        return {**counters, 'index_push_errors':counters.get('index_push_errors', 'unknown'),
                'scrape_age_seconds':age}
    except (ValueError, KeyError, TypeError, IndexError):
        return None
