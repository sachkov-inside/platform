"""Fixed unsafe-link corpus and memory-only full-storage verdicts, not a sanitizer."""
import json
import base64
import struct

SENTINEL = 'LINK_PRIVACY_SENTINEL_1566'
TRACE_IDS = {'json': 'e'*31+'1', 'protobuf': 'e'*31+'2'}
SPAN_ID = 'a'*16
PARENT_ID = 'b'*16
LINKS = tuple((str(index)*32, str(index)*16) for index in (1, 2, 3))
MAX_RESPONSE_BYTES = 1_048_576


def json_fixture(now_ns):
    """Small external OTLP JSON input, deliberately outside the SDK-safe-link precondition."""
    def attr(key, value):
        return {'key': key, 'value': value}
    attributes = [
        [attr('user.email', {'stringValue': SENTINEL}),
         attr('arbitrary.private', {'kvlistValue': {'values': [
             attr('nested', {'stringValue': SENTINEL})]}})],
        [attr('binary.secret', {'bytesValue': base64.b64encode(SENTINEL.encode()).decode()})],
        [attr('array.secret', {'arrayValue': {'values': [
            {'stringValue': SENTINEL}, {'boolValue': True}, {'intValue': '7'}, {'doubleValue': 1.25}]}})],
    ]
    links = [{'traceId': trace, 'spanId': span, 'traceState': 'private='+SENTINEL,
              'attributes': attrs} for (trace, span), attrs in zip(LINKS, attributes)]
    resource = [attr('service.name', {'stringValue': 'platform-pilot'}),
                attr('deployment.environment.name', {'stringValue': 'isolated-pilot'}),
                attr('service.version', {'stringValue': 'a'*40})]
    return {'resourceSpans': [{'resource': {'attributes': resource}, 'scopeSpans': [{
        'scope': {'name': 'platform-pilot'}, 'spans': [{
            'traceId': TRACE_IDS['json'], 'spanId': SPAN_ID, 'parentSpanId': PARENT_ID,
            'name': 'worker.attempt', 'kind': 1,
            'startTimeUnixNano': str(now_ns), 'endTimeUnixNano': str(now_ns+1_000_000),
            'attributes': [attr('http.route', {'stringValue': '/pilot'})], 'links': links}]}]}]}


def _varint(value):
    encoded = bytearray()
    while value > 127:
        encoded.append((value & 127) | 128)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def _message(number, value):
    return _varint(number*8+2)+_varint(len(value))+value


def _text(number, value):
    return _message(number, value.encode())


def _attribute(key, any_value):
    return _text(1, key)+_message(2, any_value)


def protobuf_fixture(now_ns):
    """Independent fixed wire encoding from opentelemetry-proto v1.5, not a general serializer.

    trace.proto Span fields1/2/4/5/6/7/8/9/13 and Link1/2/3/4;
    common.proto AnyValue string1/bool2/int3/double4/array5/kvlist6/bytes7.
    The pinned receiver is the actual decoder in the supervised runtime proof.
    """
    string = _text(1, SENTINEL)
    nested = _message(6, _message(1, _attribute('nested', string)))
    array = _message(5, b''.join(_message(1, value) for value in
                               (string, b'\x10\x01', b'\x18\x07', b'\x21'+struct.pack('<d', 1.25))))
    attributes = (
        _message(4, _attribute('user.email', string))+_message(4, _attribute('arbitrary.private', nested)),
        _message(4, _attribute('binary.secret', _message(7, SENTINEL.encode()))),
        _message(4, _attribute('array.secret', array)),
    )
    links = b''.join(_message(13,
        _message(1, bytes.fromhex(trace))+_message(2, bytes.fromhex(span))+
        _text(3, 'private='+SENTINEL)+attrs)
        for (trace, span), attrs in zip(LINKS, attributes))
    span = (_message(1, bytes.fromhex(TRACE_IDS['protobuf']))+
            _message(2, bytes.fromhex(SPAN_ID))+_message(4, bytes.fromhex(PARENT_ID))+
            _text(5, 'worker.attempt')+b'\x30\x01'+b'\x39'+struct.pack('<Q', now_ns)+
            b'\x41'+struct.pack('<Q', now_ns+1_000_000)+
            _message(9, _attribute('http.route', _text(1, '/pilot')))+links)
    resource = b''.join(_message(1, _attribute(key, _text(1, value))) for key, value in
        (('service.name', 'platform-pilot'), ('deployment.environment.name', 'isolated-pilot'),
         ('service.version', 'a'*40)))
    scope_spans = _message(1, _text(1, 'platform-pilot'))+_message(2, span)
    return _message(1, _message(1, resource)+_message(2, scope_spans))


def project(raw, transport):
    """Inspect every returned field before reducing to closed verdicts. Empty means pending."""
    trace_id = TRACE_IDS[transport]
    if not isinstance(raw, str) or len(raw.encode()) > MAX_RESPONSE_BYTES:
        raise RuntimeError('link storage response outside bounded schema')

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate field')
            result[key] = value
        return result

    try:
        rows = [json.loads(line, object_pairs_hook=unique_object)
                for line in raw.splitlines() if line.strip()]
        if not rows:
            return None
        if len(rows) != 1 or not isinstance(rows[0], dict):
            raise ValueError('unexpected row count')
        row = rows[0]
        if not all(isinstance(value, str) for value in row.values()):
            raise ValueError('non-string storage field')
        expected = {'trace_id': trace_id, 'span_id': SPAN_ID, 'parent_span_id': PARENT_ID}
        for index, (linked_trace, linked_span) in enumerate(LINKS):
            expected['link:link_trace_id:'+str(index)] = linked_trace
            expected['link:link_span_id:'+str(index)] = linked_span
        if any(row.get(key) != value for key, value in expected.items()):
            raise ValueError('lost correlation')
        actual_link_ids = {key for key in row if key.startswith(
            ('link:link_trace_id:', 'link:link_span_id:'))}
        if actual_link_ids != {key for key in expected if key.startswith('link:')}:
            raise ValueError('unexpected links')
    except (ValueError, TypeError):
        raise RuntimeError('link storage schema or complete correlation unproved') from None
    return {'transport': transport, 'stored_rows': 1, 'correlation': 'passed',
            'link_count': len(LINKS),
            'metadata_present': any(key.startswith(('link:link_attr:', 'link:link_trace_state:'))
                                    for key in row),
            'sentinel_present': SENTINEL in json.dumps(row, ensure_ascii=False)}
