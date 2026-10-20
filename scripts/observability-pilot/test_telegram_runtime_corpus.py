"""Fixed protocol challenges; no collector simulation or native storage claim."""
import json
import unittest
from test_link_privacy import wire_fields
import telegram_runtime_privacy as corpus

NOW = 1790000000000000000

class TelegramRuntimeCorpus(unittest.TestCase):
    def test_json_challenges_private_cross_family_data_and_exact_sibling_lineage(self):
        payload = corpus.payloads('json', NOW)
        spans = payload['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        self.assertEqual(len(spans), 10)
        self.assertEqual([span.get('parentSpanId') for span in spans[:4]], ['bbbbbbbbbbbbbbbb','0000000000000001','0000000000000001','0000000000000003'])
        self.assertNotEqual(spans[4]['traceId'], spans[0]['traceId'])
        for span in spans:
            self.assertIn(corpus.SENTINEL, json.dumps(span))
            self.assertTrue(span['events'])
            self.assertTrue(span['links'])
        names = [metric['name'] for metric in payload['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics']]
        self.assertIn('inside.telegram.operations', names)
        self.assertIn('inside.dependency.operations', names)
        self.assertIn('inside.telegram.private', names)

    def test_independently_encoded_protobuf_keeps_literal_coordinates_and_unsafe_metadata(self):
        payload = corpus.payloads('protobuf', NOW)
        self.assertTrue(all(type(raw) is bytes and len(raw) < 65536 for raw in payload.values()))
        resource = wire_fields(wire_fields(payload['traces'])[1][0])
        scope = wire_fields(resource[2][0])
        spans = [wire_fields(span) for span in scope[2]]
        self.assertEqual(len(spans), 10)
        self.assertEqual(spans[0][1], [bytes.fromhex('eeeeeeeeeeeeeeeeeeeeeeeeeeeeee82')])
        self.assertEqual(spans[0][4], [bytes.fromhex('bbbbbbbbbbbbbbbb')])
        self.assertEqual(spans[1][4], [bytes.fromhex('0000000000000001')])
        self.assertEqual(spans[2][4], [bytes.fromhex('0000000000000001')])
        self.assertEqual(spans[3][4], [bytes.fromhex('0000000000000003')])
        self.assertNotIn(4, spans[4])
        self.assertNotEqual(spans[4][1], spans[0][1])
        for span in spans:
            self.assertIn(11, span)
            self.assertIn(13, span)
            self.assertIn(corpus.SENTINEL.encode(), b''.join(span[9]))
        metrics = wire_fields(wire_fields(wire_fields(payload['metrics'])[1][0])[2][0])[2]
        names = [wire_fields(metric)[1][0].decode() for metric in metrics]
        self.assertEqual(len(names), 11)
        self.assertEqual(names[:2], ['inside.telegram.operations','inside.telegram.duration'])
        self.assertIn('inside.dependency.operations', names)

    def test_only_named_transport_and_bounded_integer_source_clock_are_admitted(self):
        for transport,now_ns in [('other',NOW),('json',True),('protobuf',0),('protobuf',2**63)]:
            with self.assertRaises(ValueError): corpus.payloads(transport,now_ns)

if __name__ == '__main__': unittest.main()
