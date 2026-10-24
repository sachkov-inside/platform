"""Closed adversarial wire/storage contracts; no live Docker or provider calls."""
import json
import copy
import io
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import pilot
import unittest

import link_privacy


def stored_row():
    # Worked VictoriaTraces0.12 storage row, not a Jaeger projection.
    return {'trace_id': 'e'*31+'1', 'span_id': 'a'*16, 'parent_span_id': 'b'*16,
            'link:link_trace_id:0': '1'*32, 'link:link_span_id:0': '1'*16,
            'link:link_trace_id:1': '2'*32, 'link:link_span_id:1': '2'*16,
            'link:link_trace_id:2': '3'*32, 'link:link_span_id:2': '3'*16}


def wire_fields(raw):
    """Test-only wire reader, independent of the fixture encoder and JSON representation."""
    cursor = 0
    def integer():
        nonlocal cursor
        value = shift = 0
        while True:
            item = raw[cursor]
            cursor += 1
            value |= (item & 127) << shift
            if item < 128:
                return value
            shift += 7
    fields = {}
    while cursor < len(raw):
        tag = integer()
        kind = tag & 7
        if kind == 0:
            value = integer()
        else:
            length = integer() if kind == 2 else {1:8, 5:4}[kind]
            value = raw[cursor:cursor+length]
            cursor += length
        fields.setdefault(tag >> 3, []).append(value)
    return fields


class LinkPrivacyContract(unittest.TestCase):
    def test_full_stored_row_preserves_every_link_and_detects_metadata_without_echo(self):
        row = stored_row()
        proof = link_privacy.project(json.dumps(row), 'json')
        self.assertEqual(proof, {'transport': 'json', 'stored_rows': 1,
            'correlation': 'passed', 'link_count': 3, 'metadata_present': False,
            'sentinel_present': False})
        row['link:link_attr:arbitrary.private:2'] = link_privacy.SENTINEL
        row['link:link_trace_state:0'] = 'private=other'
        proof = link_privacy.project(json.dumps(row), 'json')
        self.assertTrue(proof['metadata_present'])
        self.assertTrue(proof['sentinel_present'])
        self.assertNotIn(link_privacy.SENTINEL, json.dumps(proof))

    def test_incomplete_or_ambiguous_storage_cannot_be_a_privacy_pass(self):
        self.assertIsNone(link_privacy.project('', 'json'))
        row = stored_row()
        damaged = []
        for key in ('trace_id', 'span_id', 'parent_span_id', 'link:link_trace_id:1', 'link:link_span_id:2'):
            missing = copy.deepcopy(row)
            del missing[key]
            damaged.append(json.dumps(missing))
        damaged += ['{}', '{', '[]', json.dumps(row)+'\n'+json.dumps(row),
                    json.dumps({**row, 'link:link_trace_id:3': '4'*32}),
                    json.dumps({**row, 'trace_id': 'f'*32}),
                    json.dumps(row)[:-1]+',"trace_id":"'+row['trace_id']+'"}',
                    json.dumps({**row, 'unexpected': {'secret': link_privacy.SENTINEL}}),
                    'x'*(link_privacy.MAX_RESPONSE_BYTES+1)]
        for raw in damaged:
            with self.subTest(length=len(raw)):
                with self.assertRaises(RuntimeError) as caught:
                    link_privacy.project(raw, 'json')
                self.assertNotIn(link_privacy.SENTINEL, str(caught.exception))
                self.assertIsNone(caught.exception.__cause__)

    def test_independent_json_and_protobuf_fixtures_include_all_links_and_unsafe_metadata(self):
        fixture = link_privacy.json_fixture(1790000000000000000)
        span = fixture['resourceSpans'][0]['scopeSpans'][0]['spans'][0]
        self.assertEqual(span['traceId'], 'e'*31+'1')
        self.assertEqual(span['parentSpanId'], 'b'*16)
        self.assertEqual([(item['traceId'], item['spanId']) for item in span['links']],
                         [('1'*32,'1'*16), ('2'*32,'2'*16), ('3'*32,'3'*16)])
        self.assertTrue(all(item['traceState'] for item in span['links']))
        self.assertIn(link_privacy.SENTINEL, json.dumps(span['links']))
        wire = link_privacy.protobuf_fixture(1790000000000000000)
        self.assertIsInstance(wire, bytes)
        self.assertLess(len(wire), 8192)
        # Worked protobuf v1.5 Link field1/field2 wire literal, not JSON->protobuf conversion.
        for index in (1,2,3):
            expected = bytes.fromhex('0a10'+str(index)*32+'1208'+str(index)*16)
            self.assertIn(expected, wire)
        self.assertIn(bytes.fromhex('0a10'+'e'*31+'2'+'1208'+'a'*16), wire)
        self.assertIn(link_privacy.SENTINEL.encode(), wire)
        # JSON fixture changes cannot accidentally become the protobuf serializer's input.
        span['links'].clear()
        self.assertEqual(wire, link_privacy.protobuf_fixture(1790000000000000000))

    def test_protobuf_envelope_and_link_fields_decode_to_schema_worked_values(self):
        request = wire_fields(link_privacy.protobuf_fixture(1790000000000000000))
        resource_spans = wire_fields(request[1][0])
        scope_spans = wire_fields(resource_spans[2][0])
        span = wire_fields(scope_spans[2][0])
        self.assertEqual(span[1], [bytes.fromhex('e'*31+'2')])
        self.assertEqual(span[2], [bytes.fromhex('a'*16)])
        self.assertEqual(span[4], [bytes.fromhex('b'*16)])
        self.assertEqual(span[5], [b'worker.attempt'])
        self.assertEqual(int.from_bytes(span[7][0], 'little'), 1790000000000000000)
        self.assertEqual(int.from_bytes(span[8][0], 'little'), 1790000000001000000)
        links = [wire_fields(value) for value in span[13]]
        self.assertEqual(len(links), 3)
        for index, link in enumerate(links, 1):
            self.assertEqual(link[1], [bytes.fromhex(str(index)*32)])
            self.assertEqual(link[2], [bytes.fromhex(str(index)*16)])
            self.assertEqual(link[3], [('private='+link_privacy.SENTINEL).encode()])
            self.assertTrue(link[4])
        nested = wire_fields(wire_fields(links[0][4][1])[2][0])
        self.assertIn(6, nested)  # AnyValue.kvlist_value, not a stringified JSON object.
        binary = wire_fields(wire_fields(links[1][4][0])[2][0])
        self.assertEqual(binary[7], [link_privacy.SENTINEL.encode()])
        array = wire_fields(wire_fields(wire_fields(links[2][4][0])[2][0])[5][0])
        self.assertEqual([next(iter(wire_fields(value))) for value in array[1]], [1,2,3,4])

    def test_http_adapter_sends_binary_intact_and_keeps_json_transport(self):
        class Response(io.BytesIO):
            status = 200
        for body, mime, expected in ((b'\x0a\x00', 'application/x-protobuf', b'\x0a\x00'),
                                     ({'resourceSpans': []}, 'application/json', b'{"resourceSpans": []}')):
            with patch('pilot.urllib.request.urlopen', return_value=Response(b'{}')) as opened:
                self.assertEqual(pilot.request('/v1/traces', body=body, method='POST', port=14318), (200, '{}'))
                request = opened.call_args.args[0]
                self.assertEqual(request.data, expected)
                self.assertEqual(request.get_header('Content-type'), mime)

    def test_private_storage_adapter_is_read_only_exact_owner_and_fixed_known_trace(self):
        calls = []
        project = 'inside-observability-pilot-123456abcdef'
        container = 'c'*64
        def read(args, *, timeout):
            calls.append((args, timeout))
            if args[1:2] == ['compose']:
                return container+'\n'
            if args[1:2] == ['inspect']:
                return project+'|gateway|true\n'
            return json.dumps(stored_row())
        compose = ['docker','compose','-p',project,'-f','/owned/compose.json']
        with patch.object(pilot, 'FROZEN_DOCKER_ENDPOINT', 'unix:///frozen.sock'), \
             patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', {'frozen': True}), \
             patch('pilot.assert_docker_identity') as identity, patch('pilot.command', side_effect=read):
            raw = pilot.link_storage_row(compose, 'json')
            self.assertEqual(link_privacy.project(raw, 'json')['link_count'], 3)
            self.assertEqual(identity.call_count, 2)
        command = calls[-1][0]
        self.assertEqual(command[:5], ['docker', 'exec', container, 'sh', '-euc'])
        self.assertIn('trace_id%3A%3D%22'+'e'*31+'1', command[-1])
        self.assertIn('limit=2', command[-1])
        self.assertIn('timeout=2s', command[-1])
        self.assertNotIn('fields', command[-1])
        self.assertIn('head -c 1048577', command[-1])
        self.assertTrue(all(0 < timeout <= pilot.QUERY_TIMEOUT_SECONDS for _, timeout in calls))

    def test_storage_refusal_retains_closed_failed_boundary_without_raw_payload(self):
        project = 'inside-observability-pilot-123456abcdef'
        compose = ['docker','compose','-p',project,'-f','/owned/compose.json']
        # The public corpus must distinguish failed command/identity boundaries, not guess a cause.
        cases = [('identity_before', 'unproved'), ('locate', 'command_timeout'),
                 ('container_id', 'invalid_value'), ('inspect', 'command_failed'),
                 ('owner_match', 'invalid_value'), ('identity_after', 'unproved')]
        for boundary, reason in cases:
            def identity(**_kwargs):
                nonlocal checks
                checks += 1
                if checks > 0 and boundary == ('identity_before' if checks == 1 else 'identity_after'):
                    raise RuntimeError(link_privacy.SENTINEL)
            def read(args, **_kwargs):
                if args[1] == 'compose':
                    if boundary == 'locate':
                        raise subprocess.TimeoutExpired([link_privacy.SENTINEL], 1, output=link_privacy.SENTINEL)
                    return 'missing' if boundary == 'container_id' else 'c'*64
                if args[1] == 'inspect':
                    if boundary == 'inspect':
                        raise subprocess.CalledProcessError(1, [link_privacy.SENTINEL], stderr=link_privacy.SENTINEL)
                    return 'foreign' if boundary == 'owner_match' else project+'|gateway|true'
                self.fail('failed ownership must never reach exec')
            checks = 0
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory, \
                 patch.object(pilot, 'FROZEN_DOCKER_ENDPOINT', 'unix:///frozen.sock'), \
                 patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', {'frozen': True}), \
                 patch('pilot.verify_trace_store_logging'), patch('pilot.assert_docker_identity', side_effect=identity), \
                 patch('pilot.command', side_effect=read), patch('pilot.request', return_value=(200,'')) as post:
                # Count the separate ingest check as zero; exercise the real reader inside the corpus.
                checks = -1
                with self.assertRaises(RuntimeError):
                    pilot.link_privacy_corpus(Path(directory), compose)
                proof = json.loads((Path(directory)/'collector-link-privacy.json').read_text())
                self.assertEqual(proof['cases'][0]['storage_failure'], {'boundary':boundary,'reason':reason})
                self.assertEqual(proof['cases'][0]['stage'], 'ownership')
                self.assertEqual(proof['cases'][1]['stage'], 'not_attempted')
                self.assertEqual(post.call_count, 1)
                self.assertNotIn(link_privacy.SENTINEL, json.dumps(proof))

    def test_private_storage_adapter_refuses_foreign_or_changed_identity_without_raw_errors(self):
        project = 'inside-observability-pilot-123456abcdef'
        compose = ['docker','compose','-p',project,'-f','/owned/compose.json']
        for result in ('foreign|gateway|true', project+'|traces|true', project+'|gateway|false',
                       subprocess.CalledProcessError(1, ['docker'], stderr=link_privacy.SENTINEL)):
            def read(args, *, timeout):
                if args[1:2] == ['compose']:
                    return 'c'*64
                if isinstance(result, Exception):
                    raise result
                return result
            with patch.object(pilot, 'FROZEN_DOCKER_ENDPOINT', 'unix:///frozen.sock'), \
                 patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', {'frozen': True}), \
                 patch('pilot.assert_docker_identity'), patch('pilot.command', side_effect=read) as run:
                with self.assertRaises(RuntimeError) as caught:
                    pilot.link_storage_row(compose, 'json')
                self.assertNotIn(link_privacy.SENTINEL, str(caught.exception))
                self.assertTrue(all(call.args[0][1] != 'exec' for call in run.call_args_list))
        with patch('pilot.assert_docker_identity', side_effect=RuntimeError(link_privacy.SENTINEL)), \
             patch('pilot.command') as run:
            with self.assertRaises(RuntimeError) as caught:
                pilot.link_storage_row(compose, 'json')
            self.assertNotIn(link_privacy.SENTINEL, str(caught.exception))
            run.assert_not_called()

    def test_live_corpus_records_both_transports_and_exits_failed_on_persisted_metadata(self):
        def stored(_compose, transport):
            row = stored_row()
            row['trace_id'] = 'e'*31+('1' if transport == 'json' else '2')
            row['link:link_attr:private:0'] = link_privacy.SENTINEL
            return json.dumps(row)
        with tempfile.TemporaryDirectory() as directory, \
             patch('pilot.verify_trace_store_logging'), \
             patch('pilot.request', return_value=(200, '')) as post, \
             patch('pilot.link_storage_row', side_effect=stored) as read:
            with self.assertRaisesRegex(RuntimeError, 'link metadata privacy unproved'):
                pilot.link_privacy_corpus(Path(directory), ['owned-compose'])
            proof = json.loads((Path(directory)/'collector-link-privacy.json').read_text())
            self.assertEqual(post.call_count, 2)
            self.assertEqual(read.call_count, 2)
            self.assertEqual([case['transport'] for case in proof['cases']], ['json','protobuf'])
            self.assertTrue(all(case['metadata_present'] and case['sentinel_present']
                                and case['privacy'] == 'failed' for case in proof['cases']))
            self.assertNotIn(link_privacy.SENTINEL, json.dumps(proof))

    def test_live_corpus_pass_requires_both_complete_clean_storage_rows(self):
        def stored(_compose, transport):
            row = stored_row()
            row['trace_id'] = 'e'*31+('1' if transport == 'json' else '2')
            return json.dumps(row)
        with tempfile.TemporaryDirectory() as directory, \
             patch('pilot.verify_trace_store_logging'), \
             patch('pilot.request', return_value=(200, '')), \
             patch('pilot.link_storage_row', side_effect=stored):
            pilot.link_privacy_corpus(Path(directory), ['owned-compose'])
            proof = json.loads((Path(directory)/'collector-link-privacy.json').read_text())
            self.assertEqual([case['privacy'] for case in proof['cases']], ['passed','passed'])

    def test_ingest_or_storage_failure_is_unknown_and_does_not_skip_other_transport(self):
        for status in (400, 200):
            with tempfile.TemporaryDirectory() as directory, \
                 patch('pilot.verify_trace_store_logging'), \
                 patch('pilot.request', return_value=(status, link_privacy.SENTINEL)) as post, \
                 patch('pilot.link_storage_row', side_effect=RuntimeError(link_privacy.SENTINEL)):
                with self.assertRaises(RuntimeError) as caught:
                    pilot.link_privacy_corpus(Path(directory), ['owned-compose'])
                proof = json.loads((Path(directory)/'collector-link-privacy.json').read_text())
                self.assertEqual(post.call_count, 2)
                self.assertTrue(all(case['privacy'] == 'unknown' for case in proof['cases']))
                self.assertNotIn(link_privacy.SENTINEL, json.dumps(proof)+str(caught.exception))

    def test_identity_drift_stops_remaining_ingest_and_reads(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch('pilot.verify_trace_store_logging'), \
             patch('pilot.assert_docker_identity', side_effect=RuntimeError(link_privacy.SENTINEL)), \
             patch('pilot.request') as post, patch('pilot.link_storage_row') as read:
            with self.assertRaises(RuntimeError) as caught:
                pilot.link_privacy_corpus(Path(directory), ['owned-compose'])
            post.assert_not_called()
            read.assert_not_called()
            proof = json.loads((Path(directory)/'collector-link-privacy.json').read_text())
            self.assertEqual([case['stage'] for case in proof['cases']], ['ownership','not_attempted'])
            self.assertNotIn(link_privacy.SENTINEL, json.dumps(proof)+str(caught.exception))


if __name__ == '__main__':
    unittest.main()
