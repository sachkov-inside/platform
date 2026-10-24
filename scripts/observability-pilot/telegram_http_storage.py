"""Closed full-row verdict for the fixed Telegram HTTP partition only."""
import datetime
import json
import re


def _timestamp_matches(value, now_ns):
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z', value)
    if not match:
        return False
    seconds = int(datetime.datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc).timestamp())
    return seconds*1_000_000_000+int((match[2] or '').ljust(9, '0')) == now_ns


def _stored_rows(rows, transport, now_ns):
    # Pinned VT v0.12 trace_fields.go/pb.go and logstorage stream_tags/tenant_id/u128.
    # Alloy's unchanged OTLP HTTP exporter forwards protobuf, whose storage timestamp is START.
    from dependency_privacy import TELEGRAM_HTTP, TELEGRAM_HTTP_TRACE_IDS, RELEASES
    if transport not in RELEASES or type(now_ns) is not int or now_ns <= 0:
        raise ValueError('unknown fixed source')
    if len(rows) > 8:
        raise ValueError('extra rows')
    optional = {'scope_version':'', 'trace_state':'', 'status_message':'', 'flags':'0',
                'dropped_attributes_count':'0', 'dropped_events_count':'0', 'dropped_links_count':'0'}
    seen, streams, names = set(), {}, {}
    for row in rows:
        if type(row) is not dict or not all(type(value) is str for value in row.values()):
            raise ValueError('invalid row')
        span = row.get('span_id')
        if type(span) is not str or re.fullmatch(r'[0-9a-f]{16}', span) is None:
            raise ValueError('invalid native span')
        index = int(span, 16)-1
        if index not in range(8) or span in seen:
            raise ValueError('unknown or duplicate native span')
        seen.add(span)
        dependency, operation, outcome = TELEGRAM_HTTP[index]
        name = 'telegram '+operation
        expected = {'trace_id':TELEGRAM_HTTP_TRACE_IDS[transport], 'span_id':span, 'parent_span_id':'b'*16,
                    'resource_attr:service.name':'platform-api', 'resource_attr:deployment.environment.name':'isolated-pilot',
                    'resource_attr:service.version':RELEASES[transport], 'scope_name':'inside-collector',
                    'name':name, 'kind':'3', 'status_code':'0' if outcome == 'completed' else '2',
                    'start_time_unix_nano':str(now_ns), 'end_time_unix_nano':str(now_ns+1_000_000), 'duration':'1000000',
                    'span_attr:dependency.name':dependency, 'span_attr:dependency.operation':operation,
                    'span_attr:dependency.outcome':outcome, 'span_attr:http.request.method':'POST',
                    '_msg':'-', '_stream':'{name='+json.dumps(name)+',resource_attr:service.name="platform-api"}'}
        if index < 6:
            expected['span_attr:http.response.status_code'] = '200'
        required = set(expected) | {'_time', '_stream_id'}
        if not required <= set(row) or set(row)-required-set(optional):
            raise ValueError('unknown or missing field')
        if any(row[key] != value for key, value in expected.items()) or any(row[key] != optional[key] for key in set(row)&set(optional)):
            raise ValueError('invalid fixed field')
        if not _timestamp_matches(row['_time'], now_ns) or re.fullmatch(r'0{16}[0-9a-f]{32}', row['_stream_id']) is None:
            raise ValueError('invalid native metadata')
        stream = row['_stream_id']
        if name in streams and streams[name] != stream or stream in names and names[stream] != name:
            raise ValueError('contradictory stream')
        streams[name], names[stream] = stream, name
    if len(seen) != 8:
        return None
    return {'transport':transport, 'stored_spans':8, 'registered_completions':8,
            'causality':'passed', 'fallback':'not_applicable', 'privacy':'passed'}


def stored_traces(raw, transport, now_ns):
    """Validate all fields of every observed row before partial/pending is permitted."""
    from dependency_privacy import _unique, SENTINEL
    try:
        if type(raw) is not str or len(raw.encode('utf-8',errors='strict')) > 1_048_576 or SENTINEL in raw:
            raise ValueError('oversize or unsafe response')
        rows = [json.loads(line,object_pairs_hook=_unique) for line in raw.splitlines() if line.strip()]
        if SENTINEL in json.dumps(rows):
            raise ValueError('unsafe decoded response')
        return _stored_rows(rows,transport,now_ns)
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        raise RuntimeError('Telegram HTTP full-storage contract failed; raw response withheld') from None
