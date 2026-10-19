"""Closed synthetic challenges and evidence checks, not an OTLP sanitizer or gateway."""
import json

SENTINEL = 'PRIVACY_SENTINEL_1566'
LINK_TRACE_ID = 'f'*32
LINK_SPAN_ID = 'f'*16


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
        elif signal == 'logs':
            original = scope['logRecords'][0]
            original['attributes'] = [attribute('error.message'), attribute('cookie')]
            scope['logRecords'].append({**original, 'body':{'stringValue':value}, 'eventName':value,
                                        'severityText':value})
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
                        raise RuntimeError('arbitrary OTLP link metadata is unsupported by this candidate')


def assert_clean(value):
    """Never print or save a raw response when the fixed synthetic marker survives."""
    text = value if isinstance(value, str) else json.dumps(value)
    if SENTINEL in text:
        raise RuntimeError('collector privacy sentinel persisted; raw response withheld')


def assert_link_preserved(value):
    text = value if isinstance(value, str) else json.dumps(value)
    if LINK_TRACE_ID not in text or LINK_SPAN_ID not in text:
        raise RuntimeError('collector lost the SDK-composed link correlation fixture')
