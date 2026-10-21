"""Actual compiled TechnicalScope/W3C restoration and pinned serializers, without API/PG/storage."""
import json
import unittest

import producer_protocol
import tracking_oracle
from test_tracking_oracle import trace_rows, TRACE, ROOT, DELIVERY

NODE_CONTEXT_AND_SERIALIZERS = r'''
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const backend = createRequire(process.cwd() + '/apps/backend/package.json');
const exporter = createRequire(backend.resolve('@opentelemetry/exporter-trace-otlp-http'));
const { JsonTraceSerializer, ProtobufTraceSerializer } = exporter('@opentelemetry/otlp-transformer');
(async () => {
  const production = await import(pathToFileURL(process.cwd() + '/apps/backend/dist/infrastructure/observability/technical-telemetry.js').href);
  const spans = [];
  const sdk = production.createTechnicalTelemetry({
    enabled: true, service: 'platform-api', environment: 'test', release: 'test', sampleRatio: 1,
    exporters: {
      spans: { export(rows, done) { spans.push(...rows); done({code: 0}); }, async shutdown() {} },
      metrics: { export(_rows, done) { done({code: 0}); }, async shutdown() {}, async forceFlush() {} },
    },
  });
  try {
    let carrier;
    async function descendants() {
      await production.observeCommunicationsRequest(async status => { status(200); });
      for (const operation of ['query', 'acquire']) {
        const observed = production.beginPostgresObservation(operation);
        observed.run(() => undefined);
        observed.complete(false, () => undefined);
      }
    }
    const http = sdk.startHttp({method: 'POST', route: '/communications/tracking/resolve'});
    await http.run(async () => { carrier = production.captureNotificationTraceparent(); await descendants(); });
    http.finish(200, 1);
    assert.match(carrier, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    await sdk.runTrackingDelivery(carrier, async () => { await descendants(); });
    await sdk.flush();
    assert.deepEqual(sdk.diagnostics(), {droppedSpans: 0, failedTraceExports: 0, failedMetricExports: 0});
    assert.equal(spans.length, 8);
    const root = spans.find(span => span.kind === 1 && span.name === 'POST /communications/tracking/resolve');
    const delivery = spans.find(span => span.name === 'tracking deliver');
    assert.ok(root && delivery);
    assert.equal(delivery.parentSpanContext.spanId, root.spanContext().spanId);
    const rows = spans.map(span => {
      let role;
      if (span === root) role = 'root';
      else if (span === delivery) role = 'delivery';
      else {
        const parent = span.parentSpanContext.spanId === root.spanContext().spanId ? 'http' : 'delivery';
        assert.ok(parent === 'http' || span.parentSpanContext.spanId === delivery.spanContext().spanId);
        const operation = span.name === 'telegram communications.execute' ? 'provider' : span.name.split(' ')[1];
        assert.ok(['provider', 'query', 'acquire'].includes(operation));
        role = operation + '_' + parent;
      }
      const encoded = JSON.parse(Buffer.from(JsonTraceSerializer.serializeRequest([span])).toString('utf8'));
      const converted = encoded.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans));
      assert.equal(converted.length, 1);
      let providerHttp = null;
      if (span.name === 'telegram communications.execute') {
        const method = span.attributes['http.request.method'];
        const status = span.attributes['http.response.status_code'];
        assert.equal(method, 'POST');
        assert.equal(status, 200);
        providerHttp = {method, status};
      }
      return {role, name: span.name, json_flags: converted[0].flags, provider_http: providerHttp,
        parent_remote: span.parentSpanContext?.isRemote === true,
        self_remote: span.spanContext().isRemote === true,
        protobuf: Buffer.from(ProtobufTraceSerializer.serializeRequest([span])).toString('base64')};
    });
    process.stdout.write(JSON.stringify({schema: 1, rows}));
  } finally { await sdk.shutdown(); }
})().catch(() => { process.stderr.write('tracking flag context fixture failed\n'); process.exitCode = 1; });
'''


class ActualTrackingFlags(unittest.TestCase):
    def test_actual_restored_context_json_and_protobuf_flags_feed_the_complete_oracle(self):
        # The immutable SDK fixture supplies only its bounded test-only protobuf wire reader.
        from test_trace_flags import protobuf_flags
        value = producer_protocol.capture(argv=['node', '-e', NODE_CONTEXT_AND_SERIALIZERS], budget=8)
        if type(value) is not dict or set(value) != {'schema','rows'} or type(value['schema']) is not int or value['schema'] != 1 or type(value['rows']) is not list or len(value['rows']) != 8:
            self.fail('closed tracking serializer witness failed')
        expected = {'root':257,'delivery':769,'provider_http':257,'provider_delivery':257,
                    'query_http':257,'query_delivery':257,'acquire_http':257,'acquire_delivery':257}
        json_flags, proto_flags, parent_remote, self_remote, provider_http = {}, {}, {}, {}, {}
        for row in value['rows']:
            if (type(row) is not dict or set(row) != {'role','name','json_flags','parent_remote','self_remote','protobuf','provider_http'} or type(row['role']) is not str or row['role'] not in expected or row['role'] in json_flags
                    or type(row['name']) is not str or type(row['json_flags']) is not int or not 0 <= row['json_flags'] < 2**32
                    or type(row['parent_remote']) is not bool or type(row['self_remote']) is not bool
                    or type(row['protobuf']) is not str or len(row['protobuf']) > 65536):
                self.fail('closed tracking serializer row failed')
            role=row['role'];http=row['provider_http']
            if role in ('provider_http','provider_delivery'):
                if (type(http) is not dict or set(http)!={'method','status'} or type(http['method']) is not str
                        or http['method']!='POST' or type(http['status']) is not int or http['status']!=200):
                    self.fail('closed tracking provider HTTP witness failed')
                provider_http[role]=http
            elif http is not None:self.fail('closed tracking nonprovider HTTP witness failed')
            json_flags[role]=row['json_flags']
            encoded=protobuf_flags(row['protobuf'])
            if set(encoded) != {row['name']}: self.fail('closed tracking protobuf role failed')
            proto_flags[role]=encoded[row['name']]
            parent_remote[role]=row['parent_remote'];self_remote[role]=row['self_remote']
        self.assertEqual(json_flags,expected)
        self.assertEqual(proto_flags,expected)
        self.assertEqual(parent_remote,{role:role=='delivery' for role in expected})
        self.assertEqual(self_remote,{role:False for role in expected})
        for transport,flags in (('json',json_flags),('protobuf',proto_flags)):
            with self.subTest(transport=transport):
                rows=trace_rows()
                for row in rows:
                    if row['span_id'] == ROOT: role='root'
                    elif row['span_id'] == DELIVERY: role='delivery'
                    else:
                        parent='http' if row['parent_span_id'] == ROOT else 'delivery'
                        operation='provider' if row['name']=='telegram communications.execute' else row['name'].split(' ')[1]
                        role=operation+'_'+parent
                    row['flags']=str(flags[role])
                    if role in ('provider_http','provider_delivery'):
                        row['span_attr:http.request.method']=provider_http[role]['method']
                        row['span_attr:http.response.status_code']=str(provider_http[role]['status'])
                proof=tracking_oracle.traces('\n'.join(json.dumps(row) for row in rows),trace_id=TRACE,root_id=ROOT)
                self.assertIsNotNone(proof)
                self.assertEqual(proof['persisted_causality'],'passed')


if __name__=='__main__': unittest.main()
