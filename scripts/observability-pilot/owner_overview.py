"""Pure finite read plan and projection. No acquisition, clock or percentile engine."""
import datetime
from decimal import Decimal
import json
import math
import re
import urllib.parse
from pathlib import Path

import source_status
import source_status_query

CATALOGUE = source_status.decode_json((Path(__file__).resolve().parents[2] /
    'infra/observability/pilot/owner-overview.json').read_bytes())
REQUEST_KEYS = {'service', 'environment', 'before_sha', 'after_sha', 'before_start',
                'before_end', 'after_start', 'after_end', 'evaluated_at'}
IDS = tuple(cohort + '.' + kind for cohort in ('B', 'A') for kind in CATALOGUE['queries']) + (
    'freshness.values', 'freshness.timestamps')
MAX_RESPONSE_BYTES = 1_048_576
MAX_INPUT_BYTES = 10 * MAX_RESPONSE_BYTES
MAX_REPORT_BYTES = 131_072


def _refuse():
    raise ValueError('owner overview contract refused; values withheld')


def _utc(value, *, completion=False):
    pattern = r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    if completion:
        pattern += r'(?:\.[0-9]{1,6})?'
    if type(value) is not str or re.fullmatch(pattern + 'Z', value) is None:
        _refuse()
    try:
        instant = datetime.datetime.fromisoformat(value[:-1] + '+00:00')
        epoch = instant.timestamp()
        if not math.isfinite(epoch) or not 0 <= epoch <= source_status.MAX_SAFE_NUMBER:
            _refuse()
        return epoch
    except (ValueError, OverflowError, OSError):
        _refuse()


def _literal(value):
    return json.dumps(value, ensure_ascii=True)


def _selector(name, service, environment, release, extra=''):
    return ('{__name__=' + _literal(name) + ',service.name=' + _literal(service) +
            ',deployment.environment.name=' + _literal(environment) +
            ',service.version=' + _literal(release) +
            ',service.version=~"^[0-9a-f]{40}$",service.name=~' +
            _literal('^(' + '|'.join(CATALOGUE['services']) + ')$') +
            ',deployment.environment.name=~' + _literal('^(' + '|'.join(CATALOGUE['environments']) + ')$') + extra + '}')


def _fresh_parts(evaluated_at):
    paths = source_status_query.query_plan(evaluated_at)
    expressions = [urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)['query'][0]
                   for path in paths]
    return expressions


def _source_families():
    """The wire owner admits counter aliases, but never duplicate canonical identities."""
    families = [(job, ('up',)) for job in source_status.SOURCES.values()]
    families += [(source_status.SOURCES['collector'], (name, name + '_total'))
                 for name in sorted(source_status.COLLECTOR_COUNTERS)]
    families += [(source_status.SOURCES['collector'], (name,))
                 for name in sorted(source_status.COLLECTOR_GAUGES)]
    families += [(source_status.SOURCES['trace_store'], (name,))
                 for name in sorted(source_status.TRACE_COUNTERS)]
    return families


def _family_selector(job, aliases):
    return ('{__name__=~' + _literal('^(' + '|'.join(aliases) + ')$') +
            ',job=' + _literal(job) + ',instance="pilot"}')


def _family_guard(job, aliases, *, evaluated_at=None, duration=None):
    selector = _family_selector(job, aliases)
    samples = (f'increase({selector}[{duration}s])' if duration is not None
               else f'({selector} @ {evaluated_at})')
    # Dropping ONLY the spelling (__name__) preserves the entire remaining identity.
    # Both aliases of the same identity give count2 and refuse instead of masking a missing family.
    return f'(count({samples}) >= 1) and on() (max(count without(__name__)({samples})) == 1)'


def _fresh_mask(evaluated_at):
    values, stamps = _fresh_parts(evaluated_at)
    jobs = '|'.join(source_status.SOURCES.values())
    up = '{__name__="up",job=~"^(' + jobs + ')$",instance="pilot"}'
    age = CATALOGUE['quality_policy']['maximum_current_source_age_seconds']
    terms = [f'count({up} @ {evaluated_at}) == {len(source_status.SOURCES)}',
             f'min({up} @ {evaluated_at}) == 1',
             f'count(({values}) @ {evaluated_at}) == count(({stamps}) @ {evaluated_at})',
             f'min({evaluated_at} - (({stamps}) @ {evaluated_at})) >= 0',
             f'max({evaluated_at} - (({stamps}) @ {evaluated_at})) <= {age}']
    terms += [_family_guard(job, aliases, evaluated_at=evaluated_at)
              for job, aliases in _source_families()]
    return 'group(' + ' and on() '.join('(' + term + ')' for term in terms) + ')'


def _render(service, environment, release, duration, evaluated_at, other_release):
    tokens = {key: _selector(name, service, environment, release)
              for key, name in CATALOGUE['metrics'].items()}
    collection_names = sorted(name for name in source_status.COLLECTOR_COUNTERS
        if name.endswith('metric_points') and any(part in name for part in ('refused', 'send_failed', 'enqueue_failed')))
    collection_presence = ' and on() '.join('(' + _family_guard(source_status.SOURCES['collector'],
        (name, name + '_total'), duration=duration) + ')' for name in collection_names)
    collection_sum = ('sum(increase({job="' + source_status.SOURCES['collector'] +
        '",instance="pilot",__name__=~"^(' + '|'.join(collection_names) + ')(_total)?$"}[' +
        str(duration) + 's]))')
    tokens.update({
        'FIVE': _selector(CATALOGUE['metrics']['REQUEST'], service, environment, release,
                          ',http.response.status_code=~"^5[0-9][0-9]$",http.request.outcome="completed"'),
        'FOUR': _selector(CATALOGUE['metrics']['REQUEST'], service, environment, release,
                          ',http.response.status_code=~"^4[0-9][0-9]$",http.request.outcome="completed"'),
        'ABORTED': _selector(CATALOGUE['metrics']['REQUEST'], service, environment, release,
                             ',http.request.outcome="aborted"'),
        'W': str(duration) + 's', 'FRESH': _fresh_mask(evaluated_at),
        'COLLECTION': '(' + collection_sum + ') and on() (' + collection_presence + ')',
    })
    rendered = {}
    for kind, fields in CATALOGUE['queries'].items():
        rendered[kind] = {}
        for field, template in fields.items():
            expression = template
            for token in sorted(tokens, key=len, reverse=True):
                expression = expression.replace('$' + token, tokens[token])
            rendered[kind][field] = expression
    p = CATALOGUE['quality_policy']
    q = rendered['quality']
    samples = max(p['minimum_counter_samples'], duration // p['expected_export_period_seconds'] -
                  p['allowed_sample_deficit'])
    predicates = [f"({rendered['volume']['duration_observations_estimate']}) >= {p['minimum_duration_observations']}",
                  f"({rendered['volume']['requests_estimate']}) > 0",
                  f"({q['minimum_counter_samples']}) >= {samples}",
                  f"({q['minimum_histogram_samples']}) >= {samples}",
                  f"({q['counter_resets']}) == {p['maximum_resets']}",
                  f"({q['metric_export_failures_estimate']}) == {p['maximum_metric_export_failure_estimate']}",
                  f"({q['collection_failure_estimate']}) == 0", f"({q['current_sources_usable']})"]
    def admitted_release(value):
        return 'label_match(label_set(vector(1),"release",' + _literal(value) + '),"release","^[0-9a-f]{40}$")'
    predicates.append('count(' + admitted_release(release) + ' or ' + admitted_release(other_release) + ') == 2')
    mask = ' and on() '.join('(' + predicate + ')' for predicate in predicates)
    result = {}
    for kind, fields in rendered.items():
        terms = []
        for field, expression in fields.items():
            terms.append('label_set((' + expression + '),"field",' + _literal(field) + ')')
        result[kind] = ' or '.join(terms)
        if kind == 'speed':
            result[kind] = '(' + result[kind] + ') and on() (' + mask + ')'
    return result, mask


def plan(request):
    """Admit finite literals before generating any query; does not execute them."""
    if type(request) is not dict or set(request) != REQUEST_KEYS:
        _refuse()
    if request['service'] not in CATALOGUE['services'] or request['environment'] not in CATALOGUE['environments']:
        _refuse()
    for key in ('before_sha', 'after_sha'):
        if type(request[key]) is not str or re.fullmatch('[0-9a-f]{40}', request[key]) is None:
            _refuse()
    if request['before_sha'] == request['after_sha']:
        _refuse()
    times = {key: _utc(request[key]) for key in
             ('before_start', 'before_end', 'after_start', 'after_end', 'evaluated_at')}
    duration = int(times['before_end'] - times['before_start'])
    if not (60 <= duration <= 3600 and duration == times['after_end'] - times['after_start']
            and times['before_end'] <= times['after_start'] and times['after_end'] <= times['evaluated_at']):
        _refuse()
    queries = []
    for cohort, prefix in (('B', 'before'), ('A', 'after')):
        rendered, mask = _render(request['service'], request['environment'], request[prefix + '_sha'],
                                 duration, int(times['evaluated_at']),
                                 request['after_sha' if cohort == 'B' else 'before_sha'])
        for kind, expression in rendered.items():
            queries.append({'id': cohort + '.' + kind, 'tool': 'query', 'row_cap': 16,
                            'arguments': {'query': expression, 'time': request[prefix + '_end'],
                                          'timeout': '2s', 'nocache': True, 'trace': False}})
    for name, expression in zip(IDS[-2:], _fresh_parts(int(times['evaluated_at']))):
        queries.append({'id': name, 'tool': 'query', 'row_cap': 1000,
                        'arguments': {'query': expression, 'time': request['evaluated_at'],
                                      'timeout': '2s', 'nocache': True, 'trace': False}})
    return {'version': 1, 'request': dict(request), 'duration_seconds': duration, 'queries': queries}


def _body(response):
    if (type(response) is not dict or set(response) not in ({'content'}, {'content', 'isError'})
            or ('isError' in response and response['isError'] is not False)
            or type(response.get('content')) is not list or len(response['content']) != 1):
        _refuse()
    content = response['content'][0]
    if (type(content) is not dict or set(content) != {'type', 'text'} or content['type'] != 'text'
            or type(content['text']) is not str):
        _refuse()
    raw = content['text'].encode('utf-8')
    if len(raw) > MAX_RESPONSE_BYTES:
        _refuse()
    return raw


def _fields(raw, query):
    body = source_status.decode_json(raw)
    if (type(body) is not dict or set(body) not in ({'status', 'data'}, {'status', 'data', 'stats'})
            or body['status'] != 'success' or type(body['data']) is not dict
            or set(body['data']) != {'resultType', 'result'} or body['data']['resultType'] != 'vector'):
        _refuse()
    if 'stats' in body:
        # The original wire owner validates and discards VM's optional stats.
        source_status._native_query_stats(body['stats'])
    rows = body['data']['result']
    if type(rows) is not list or len(rows) > query['row_cap']:
        _refuse()
    kind = query['id'].split('.')[1]
    allowed = CATALOGUE['queries'][kind]
    fields = {}
    for row in rows:
        if (type(row) is not dict or set(row) != {'metric', 'value'} or type(row['metric']) is not dict
                or set(row['metric']) != {'field'} or row['metric']['field'] not in allowed
                or type(row['value']) is not list or len(row['value']) != 2):
            _refuse()
        name = row['metric']['field']
        timestamp, value = row['value']
        if (name in fields or type(timestamp) not in (int, float, Decimal) or
                timestamp != _utc(query['arguments']['time']) or type(value) is not str or len(value) > 32):
            _refuse()
        try:
            number = float(value)
        except (ValueError, OverflowError):
            _refuse()
        # Native undefined division/quantiles carry no numeric observation.
        if not math.isfinite(number):
            if kind != 'speed' or value not in ('NaN', '+Inf', '-Inf'):
                _refuse()
            fields[name] = None
        elif not 0 <= number <= source_status.MAX_SAFE_NUMBER:
            _refuse()
        else:
            fields[name] = number
    for field in ('minimum_counter_samples', 'minimum_histogram_samples', 'counter_resets'):
        if fields.get(field) is not None and not fields[field].is_integer():
            _refuse()
    for field in ('minimum_trace_sampling_ratio', 'current_sources_usable'):
        if fields.get(field) is not None and fields[field] > 1:
            _refuse()
    if fields.get('current_sources_usable') not in (None, 0, 1):
        _refuse()
    if fields.get('five_xx_share') is not None and fields['five_xx_share'] > 1:
        _refuse()
    quantiles = [fields.get(key) for key in ('p50_seconds', 'p95_seconds', 'p99_seconds')]
    observed_quantiles = [value for value in quantiles if value is not None]
    if observed_quantiles != sorted(observed_quantiles):
        _refuse()
    return fields


def _quality(values, duration):
    p = CATALOGUE['quality_policy']
    required = ('requests_estimate', 'duration_observations_estimate', 'minimum_counter_samples', 'minimum_histogram_samples',
                'counter_resets', 'metric_export_failures_estimate', 'collection_failure_estimate',
                'current_sources_usable')
    if any(values.get(key) is None for key in required):
        return 'missing_quality'
    samples = max(p['minimum_counter_samples'], duration // p['expected_export_period_seconds'] -
                  p['allowed_sample_deficit'])
    if values['requests_estimate'] <= 0:
        return 'missing_denominator'
    if values['duration_observations_estimate'] < p['minimum_duration_observations']:
        return 'low_volume'
    if min(values['minimum_counter_samples'], values['minimum_histogram_samples']) < samples:
        return 'sample_deficit'
    if values['counter_resets'] != p['maximum_resets']:
        return 'counter_reset'
    if (values['metric_export_failures_estimate'] != p['maximum_metric_export_failure_estimate']
            or values['collection_failure_estimate'] != 0):
        return 'collection_failure'
    if values['current_sources_usable'] != 1:
        return 'current_source_unknown'
    return None


def reduce(prepared, results):
    """Project native scalars with explicit caller completion; never read a clock."""
    if type(prepared) is not dict or set(prepared) != {'version', 'request', 'duration_seconds', 'queries'}:
        _refuse()
    trusted = plan(prepared['request'])
    if prepared != trusted:
        _refuse()
    request = trusted['request']
    report = {'version': 1, 'state': 'partial', 'request': request,
              'causality': 'not_established', 'query_evidence': [], 'missing_query_ids': list(IDS),
              'sources': {key: {'state': 'unknown', 'sample_age_seconds': None}
                          for key in source_status.SOURCES},
              'coverage': 'HTTP stored observations and two pilot collection sources only',
              'cohorts': {cohort: {'state': 'unknown', 'values': {field: None
                  for fields in CATALOGUE['queries'].values() for field in fields},
                  'reason': 'missing_quality', 'historical_gap_count': None,
                  'historical_coverage': 'partial', 'request_completeness': 'unknown'}
                  for cohort in ('B', 'A')},
              'links': {'overview': ('/d/platform-owner-overview?' + urllib.parse.urlencode({
                            'var-service': request['service'], 'var-environment': request['environment'],
                            'var-before_sha': request['before_sha'], 'var-after_sha': request['after_sha'],
                            'from': int(_utc(request['before_start']) * 1000),
                            'to': int(_utc(request['after_end']) * 1000)})
                            if trusted['duration_seconds'] == 3600 and request['before_end'] == request['after_start']
                            and request['after_end'] == request['evaluated_at'] else None),
                        'investigation': 'docs/runbooks/observability-investigation.md'}}
    accepted = {}
    try:
        # Decode an encoded bounded input to exclude foreign values and preserve strict JSON limits.
        if type(results) is bytes:
            raw = results
        elif type(results) is list:
            raw = json.dumps(results, allow_nan=False).encode('utf-8')
        else:
            _refuse()
        if len(raw) > MAX_INPUT_BYTES:
            _refuse()
        # Full input is ten separately bounded bodies, so do not apply the one-body byte cap here.
        if type(results) is bytes:
            if len(raw) > MAX_RESPONSE_BYTES:
                # Ten wrappers are parsed individually below; this decoder never handles raw metric rows.
                value = json.loads(raw, object_pairs_hook=source_status._object,
                                   parse_constant=source_status._reject)
            else:
                value = source_status.decode_json(raw)
        else:
            value = json.loads(raw, object_pairs_hook=source_status._object,
                               parse_constant=source_status._reject)
        if type(value) is not list or len(value) > 10:
            _refuse()
        previous = _utc(request['evaluated_at'])
        for index, entry in enumerate(value):
            if (type(entry) is not dict or set(entry) != {'id', 'state', 'response', 'completed_at'}
                    or entry['id'] != IDS[index] or entry['state'] not in ('received', 'unavailable', 'interrupted')
                    or (entry['state'] != 'received' and (index != len(value)-1 or entry['response'] is not None))):
                _refuse()
            state = entry['state']
            try:
                if state != 'received' and entry['completed_at'] is None:
                    report['query_evidence'].append({'id': entry['id'], 'state': state, 'completed_at': None})
                    break
                completed = _utc(entry['completed_at'], completion=True)
                if completed < previous:
                    _refuse()
                previous = completed
                if state != 'received':
                    report['query_evidence'].append({'id': entry['id'], 'state': state,
                                                     'completed_at': entry['completed_at']})
                    break
                body = _body(entry['response'])
                query = trusted['queries'][index]
                if index < 8:
                    fields = _fields(body, query)
                    report['cohorts'][entry['id'][0]]['values'].update(fields)
                accepted[entry['id']] = (body, completed)
                report['missing_query_ids'].remove(entry['id'])
                report['query_evidence'].append({'id': entry['id'], 'state': 'received',
                                                 'completed_at': entry['completed_at'],
                                                 'evaluated_at': query['arguments']['time']})
            except (ValueError, TypeError, OverflowError, UnicodeError, RecursionError):
                report['query_evidence'].append({'id': entry['id'], 'state': 'unknown', 'completed_at': None})
        if all(key in accepted for key in IDS[-2:]):
            fresh = source_status.evaluate(accepted[IDS[-2]][0], accepted[IDS[-1]][0],
                evaluated_at=int(_utc(request['evaluated_at'])),
                completed_at=max(accepted[key][1] for key in IDS[-2:]))
            report['sources'] = {key: {'state': ('stale' if item['state'] == 'fresh_up' and
                any(metric['state'] != 'observed' for metric in item.get('metrics', [])) else item['state']),
                'sample_age_seconds': item.get('sample_age_seconds'),
                'missing_families': bool(item.get('missing_metric_families'))}
                for key, item in fresh['sources'].items()}
    except (ValueError, TypeError, KeyError, OverflowError, UnicodeError, RecursionError):
        # A broken wrapper is not authority for later observations; prefix already admitted remains visible.
        report['envelope_state'] = 'unknown'
    fresh_up = all(item['state'] == 'fresh_up' and not item.get('missing_families', True)
                   for item in report['sources'].values())
    for cohort, item in report['cohorts'].items():
        reason = _quality(item['values'], trusted['duration_seconds'])
        speed = [item['values'][field] for field in CATALOGUE['queries']['speed']]
        if reason and any(value is not None for value in speed):
            reason = 'quality_gate_mismatch'
        if not fresh_up:
            reason = reason or 'current_source_unknown'
        if reason:
            for field in CATALOGUE['queries']['speed']:
                item['values'][field] = None
        item['reason'] = reason or 'historical_completeness_unknown'
        item['state'] = 'partial' if any(value is not None for value in item['values'].values()) else 'unknown'
    report['state'] = 'partial' if any(item['state'] == 'partial' for item in report['cohorts'].values()) else 'unknown'
    if len(json.dumps(report, allow_nan=False).encode()) > MAX_REPORT_BYTES:
        _refuse()
    return report


def dashboard():
    """Provision vendor panels from the SAME finite native catalogue and quality mask.

    Percent encoding is literal containment, not authorization or input/cost admission.
    Complete pinned Grafana transport and MetricsQL execution are separate native gates.
    """
    service, environment, before, after = 'OVSERVICE', 'OVENV', 'c' * 40, 'd' * 40
    epoch = 1234567890
    replacements = {service: '${service:percentencode}', environment: '${environment:percentencode}',
                    before: '${before_sha:percentencode}', after: '${after_sha:percentencode}'}
    common = '((${__to}) / 1000)'

    def target_expression(expression, offset=0):
        # Fixed quotes surround every variable. No interpolation into operators or regexes.
        for literal, variable in replacements.items():
            expression = expression.replace(_literal(literal), '"' + variable + '"')
        expression = expression.replace(str(epoch), common)
        return '(' + expression + ') @ (' + common + (' - 3600' if offset else '') + ')'

    panels = [{'id': 1, 'type': 'text', 'title': 'Coverage and interpretation',
        'gridPos': {'x': 0, 'y': 0, 'w': 24, 'h': 5}, 'options': {'mode': 'markdown', 'content':
        'HTTP stored observations for API/MCP; collector and trace-store freshness only. '
        'Current sources are AS OF dashboard end E, not panel delivery. '
        'Before: E−2h..E−1h; after: E−1h..E. Full SHA values must differ. '
        'Historical gaps and exact request completeness: unknown. NoData is not healthy. '
        'Native grammar/cost, transport/time semantics and visual acceptance remain pending. '
        '[Investigation evidence](https://github.com/sachkov-inside/platform/issues/1566) | '
        '[Watchdog/queues/business](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/production-monitoring.md) | '
        '[Caddy](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/observability-caddy-pilot.md) | '
        '[PostgreSQL](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/observability-pilot.md) | '
        '[Analytics](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/observability-umami-pilot.md)'}}]
    index = 2
    for cohort, release, other, offset in (('B', before, after, 3600), ('A', after, before, 0)):
        rendered, _mask = _render(service, environment, release, 3600, epoch, other)
        for panel in CATALOGUE['panels']:
            panels.append({'id': index, 'type': 'table', 'title': cohort + ': ' + panel['title'],
                'description': 'Stored observations are estimates. Native quality mask suppresses unreliable speed/share; no causal claim.',
                'gridPos': {'x': 0 if cohort == 'B' else 12, 'y': 5 + (index-2) % 4 * 7, 'w': 12, 'h': 7},
                'datasource': {'type': 'prometheus', 'uid': 'pilot-metrics'},
                'targets': [{'refId': 'A', 'expr': target_expression(rendered[panel['kind']], offset),
                             'instant': True, 'range': False, 'format': 'table'}],
                'fieldConfig': {'defaults': {'noValue': 'NoData (unknown/partial)'}, 'overrides': []}})
            index += 1
    for name, expression in zip(('values', 'timestamps'), _fresh_parts(epoch)):
        panels.append({'id': index, 'type': 'table', 'title': 'Collection ' + name + ' as of E',
            'gridPos': {'x': 0, 'y': 33 + (index-10)*7, 'w': 24, 'h': 7},
            'datasource': {'type': 'prometheus', 'uid': 'pilot-metrics'},
            'transformations': [{'id': 'filterFieldsByName', 'options': {'include': {'names': ['Time', 'Value', 'job', '__name__', 'source_metric']}}}],
            'targets': [{'refId': 'A', 'expr': target_expression(expression), 'instant': True,
                         'range': False, 'format': 'table'}],
            'fieldConfig': {'defaults': {'noValue': 'NoData (unknown)'}, 'overrides': []}})
        index += 1
    panels.append({'id': index, 'type': 'text', 'title': 'Historical gap count: NoData',
        'gridPos': {'x': 0, 'y': 47, 'w': 24, 'h': 3}, 'options': {'mode': 'markdown',
        'content': 'No source proves exact gap length/count or full request completeness. Historical coverage: partial.'}})
    variables = []
    for name, values in (('service', CATALOGUE['services']), ('environment', CATALOGUE['environments'])):
        variables.append({'name': name, 'type': 'custom', 'query': ','.join(values),
                          'multi': False, 'includeAll': False,
                          'current': {'text': values[0], 'value': values[0]}})
    for name in ('before_sha', 'after_sha'):
        variables.append({'name': name, 'label': name + ' (full lowercase SHA)', 'type': 'textbox',
                          'multi': False, 'includeAll': False, 'query': '', 'current': {'text': '', 'value': ''}})
    return {'provider': {'apiVersion': 1, 'providers': [{'name': 'Owner overview', 'orgId': 1,
                'folder': 'Platform', 'type': 'file', 'disableDeletion': True, 'editable': False,
                'options': {'path': '/etc/grafana/owner-overview'}}]},
            'dashboard': {'id': None, 'uid': 'platform-owner-overview', 'title': 'Platform limited owner overview',
                'description': 'Temporary semantic Grafana overview for #1566 under #1565. Native query/time/escaping and visual acceptance remain required in #1566.',
                'schemaVersion': 39, 'version': 1, 'editable': False, 'refresh': '', 'timezone': 'utc',
                'time': {'from': 'now-2h', 'to': 'now'}, 'templating': {'list': variables}, 'panels': panels}}
