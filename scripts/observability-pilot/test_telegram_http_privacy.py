"""Finite Telegram HTTP corpus, not pinned collector execution."""
import json
import unittest
import dependency_privacy as fixture
from test_link_privacy import wire_fields


class TelegramHttpPartition(unittest.TestCase):
    def test_fixed_pairs_and_independent_protobuf_fields_remain_bounded(self):
        expected=[(op,out) for op in ('link.register','link.confirm','contacts.read','signin.bindAccount') for out in ('completed','failed')]
        body=fixture.telegram_http_payloads('json',1790000000000000000)
        spans=body['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        pairs=[]
        for span in spans:
            attrs={attr['key']:attr['value'] for attr in span['attributes']}
            pairs.append((attrs['dependency.operation']['stringValue'],attrs['dependency.outcome']['stringValue']))
            for private in ('accountRef','returnCorrelation','linkTransactionRef','telegramIdentityRef','tokenDigest','subjectRef','contacts'):
                self.assertIn(private,attrs)
        self.assertEqual(pairs,expected)
        wire=fixture.telegram_http_payloads('protobuf',1790000000000000000)
        for value in wire.values(): self.assertLess(len(value),65536)
        scope=wire_fields(wire_fields(wire_fields(wire['traces'])[1][0])[2][0])
        self.assertEqual(len(scope[2]),8)
        self.assertEqual({wire_fields(span)[1][0] for span in scope[2]}, {bytes.fromhex('e'*30+'72')})
        decoded=[]
        for span in scope[2]:
            fields=wire_fields(span)
            self.assertEqual(fields[4],[bytes.fromhex('b'*16)])
            attrs={wire_fields(value)[1][0].decode():wire_fields(wire_fields(value)[2][0]) for value in fields[9]}
            decoded.append((attrs['dependency.operation'][1][0].decode(),attrs['dependency.outcome'][1][0].decode()))
            self.assertEqual(attrs['tokenDigest'][1],[fixture.SENTINEL.encode()])
        self.assertEqual(decoded,expected)
        metrics=wire_fields(wire_fields(wire_fields(wire['metrics'])[1][0])[2][0])[2]
        self.assertEqual(len(metrics),2)
        points=wire_fields(wire_fields(metrics[0])[7][0])[1]
        self.assertEqual(len(points),8)
        decoded=[]
        for point in points:
            fields=wire_fields(point)
            self.assertEqual(int.from_bytes(fields[6][0],'little'),1)
            attrs={wire_fields(value)[1][0].decode():wire_fields(wire_fields(value)[2][0]) for value in fields[7]}
            decoded.append((attrs['operation'][1][0].decode(),attrs['outcome'][1][0].decode()))
        self.assertEqual(decoded,expected)

    def test_full_rows_reject_missing_unknown_and_private_fields(self):
        for transport in ('json','protobuf'):
            rows=[]
            for index,(operation,outcome) in enumerate((op,out) for op in ('link.register','link.confirm','contacts.read','signin.bindAccount') for out in ('completed','failed')):
                row={'trace_id':fixture.TELEGRAM_HTTP_TRACE_IDS[transport],'span_id':f'{index+1:016x}','parent_span_id':'b'*16,
                     'resource_attr:service.name':'platform-api','resource_attr:deployment.environment.name':'isolated-pilot',
                     'resource_attr:service.version':fixture.RELEASES[transport],'scope_name':'inside-collector','name':'telegram '+operation,
                     'kind':'3','status_code':'0' if outcome=='completed' else '2','span_attr:http.request.method':'POST',
                     'span_attr:dependency.name':'telegram','span_attr:dependency.operation':operation,'span_attr:dependency.outcome':outcome,
                     'start_time_unix_nano':'1790000000000000000','end_time_unix_nano':'1790000000001000000','duration':'1000000',
                     '_msg':'-','_stream':'{name='+json.dumps('telegram '+operation)+',resource_attr:service.name="platform-api"}',
                     '_time':'2026-09-21T14:13:20Z','_stream_id':'0'*16+f'{index//2+1:032x}'}
                if index<6:row['span_attr:http.response.status_code']='200'
                rows.append(row)
            raw=lambda value:'\n'.join(json.dumps(row) for row in value)
            self.assertEqual(fixture.stored_traces(raw(rows),transport,telegram_http=True,now_ns=1790000000000000000)['stored_spans'],8)
            self.assertIsNone(fixture.stored_traces(raw(rows[:-1]),transport,telegram_http=True,now_ns=1790000000000000000))
            for key,value in (('span_attr:tokenDigest','private'),('span_attr:dependency.operation','other'),('trace_id','f'*32),('event:private','hidden'),('unknown_metadata','private'),('flags','1'),('_stream','private'),('_time','2026-09-21T14:13:20.001Z'),('dropped_attributes_count','1'),('_stream_id','1'*48),('span_id','f'*16)):
                changed=[dict(row) for row in rows];changed[0][key]=value
                with self.assertRaises(RuntimeError):fixture.stored_traces(raw(changed),transport,telegram_http=True,now_ns=1790000000000000000)
                with self.assertRaises(RuntimeError):fixture.stored_traces(raw(changed[:1]),transport,telegram_http=True,now_ns=1790000000000000000)
            with self.assertRaises(RuntimeError):fixture.stored_traces(raw(rows+rows[:1]),transport,telegram_http=True,now_ns=1790000000000000000)

            with self.assertRaises(RuntimeError):fixture.stored_traces(raw(rows[:1]*2),transport,telegram_http=True,now_ns=1790000000000000000)
            late=[dict(row) for row in rows];late[-1]['raw_provider_error']='non-sentinel-secret'
            with self.assertRaises(RuntimeError):fixture.stored_traces(raw(late),transport,telegram_http=True,now_ns=1790000000000000000)
