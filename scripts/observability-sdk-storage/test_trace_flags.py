"""Pinned native serializers feed the closed full-row SDK trace oracle, without I/O."""
import base64
import unittest
import oracle
import sdk_storage
from test_oracle import trace_fixture, raw_traces

NODE_SERIALIZERS = r'''
const { createRequire } = require('node:module');
const backend = createRequire(process.cwd() + '/apps/backend/package.json');
const exporter = createRequire(backend.resolve('@opentelemetry/exporter-trace-otlp-http'));
const { JsonTraceSerializer, ProtobufTraceSerializer } = exporter('@opentelemetry/otlp-transformer');
const { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = backend('@opentelemetry/sdk-trace-base');
const { ROOT_CONTEXT, trace, SpanKind } = backend('@opentelemetry/api');
(async () => {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] });
  try {
    const tracer = provider.getTracer('owned-serializer-proof');
    const root = tracer.startSpan('root', { kind: SpanKind.SERVER }, ROOT_CONTEXT);
    const read = tracer.startSpan('read', {}, trace.setSpan(ROOT_CONTEXT, root));
    const http = tracer.startSpan('http', { kind: SpanKind.CLIENT }, trace.setSpan(ROOT_CONTEXT, read));
    http.end(); read.end(); root.end();
    await provider.forceFlush();
    const local = memory.getFinishedSpans().slice();
    const remoteContext = trace.setSpanContext(ROOT_CONTEXT, { ...read.spanContext(), isRemote: true });
    const remote = tracer.startSpan('remote', { kind: SpanKind.CLIENT }, remoteContext);
    remote.end();
    await provider.forceFlush();
    const remoteSpan = memory.getFinishedSpans().filter(span => span.name === 'remote');
    function encode(spans) {
      const bytes = JsonTraceSerializer.serializeRequest(spans);
      const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const json_flags = Object.fromEntries(value.resourceSpans.flatMap(resource =>
        resource.scopeSpans.flatMap(scope => scope.spans.map(span => [span.name, span.flags]))));
      return { json_flags, protobuf: Buffer.from(ProtobufTraceSerializer.serializeRequest(spans)).toString('base64') };
    }
    const output = JSON.stringify({ local: encode(local), remote: encode(remoteSpan) });
    if (Buffer.byteLength(output) > 65536) throw new Error('serializer fixture cap');
    process.stdout.write(output);
  } finally { await provider.shutdown(); }
})().catch(() => { process.stderr.write('native serializer fixture failed\n'); process.exitCode = 1; });
'''


def protobuf_fields(raw):
    """Bounded wire reader for this test's actual encoder bytes, not a storage decoder."""
    if len(raw) > 65536:
        raise ValueError('serializer fixture cap')
    cursor = 0
    def varint():
        nonlocal cursor
        value = 0
        for shift in range(0, 70, 7):
            if cursor >= len(raw):
                raise ValueError('serializer fixture wire')
            byte = raw[cursor]
            cursor += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError('serializer fixture varint')
    fields = []
    while cursor < len(raw):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if not number or len(fields) >= 512:
            raise ValueError('serializer fixture fields')
        if wire == 0:
            value = varint()
        else:
            length = varint() if wire == 2 else 8 if wire == 1 else 4 if wire == 5 else -1
            if length < 0 or cursor+length > len(raw):
                raise ValueError('serializer fixture length')
            value = raw[cursor:cursor+length]
            cursor += length
        fields.append((number, wire, value))
    return fields


def protobuf_flags(encoded):
    resources = [value for number, wire, value in protobuf_fields(base64.b64decode(encoded, validate=True))
                 if (number, wire) == (1, 2)]
    scopes = [value for resource in resources for number, wire, value in protobuf_fields(resource)
              if (number, wire) == (2, 2)]
    spans = [value for scope in scopes for number, wire, value in protobuf_fields(scope)
             if (number, wire) == (2, 2)]
    result = {}
    for span in spans:
        fields = protobuf_fields(span)
        names = [value.decode('utf-8') for number, wire, value in fields if (number, wire) == (5, 2)]
        flags = [int.from_bytes(value, 'little') for number, wire, value in fields if (number, wire) == (16, 5)]
        if len(names) != 1 or len(flags) != 1 or names[0] in result:
            raise ValueError('serializer fixture span')
        result[names[0]] = flags[0]
    return result


class NativeTraceFlags(unittest.TestCase):
    def test_actual_json_and_protobuf_local_flags_feed_full_storage_oracle(self):
        # Reuse the existing bounded/reaped Node owner and strict private JSON boundary.
        encoded = sdk_storage.emitter(argv=['node', '-e', NODE_SERIALIZERS], budget=8)
        local = {'root': 257, 'read': 257, 'http': 257}
        remote = {'remote': 769}
        self.assertEqual(encoded['local']['json_flags'], local)
        self.assertEqual(encoded['remote']['json_flags'], remote)
        self.assertEqual(protobuf_flags(encoded['local']['protobuf']), local)
        self.assertEqual(protobuf_flags(encoded['remote']['protobuf']), remote)
        names = {'GET /pilot': 'root', 's3 getObject.read': 'read', 's3 http.GET': 'http'}
        for transport in ('json', 'protobuf'):
            flags = encoded['local']['json_flags'] if transport == 'json' else protobuf_flags(encoded['local']['protobuf'])
            rows = trace_fixture()
            for row in rows:
                row['flags'] = str(flags[names[row['name']]])
            self.assertEqual(oracle.traces(raw_traces(rows), trace_id='a'*32, root_id='b'*16, release='c'*40)['stored_spans'], 3)
            for index in range(3):
                for invalid in (None, '0', '1', '256', '513', str(remote['remote']), '1025', '0257', '257.0', 257):
                    with self.subTest(transport=transport, role=index, flags=invalid):
                        poisoned = [dict(row) for row in rows]
                        if invalid is None:
                            poisoned[index].pop('flags')
                        else:
                            poisoned[index]['flags'] = invalid
                        with self.assertRaisesRegex(RuntimeError, '^SDK storage trace contract failed$'):
                            oracle.traces(raw_traces(poisoned), trace_id='a'*32, root_id='b'*16, release='c'*40)
