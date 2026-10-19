"""Contracts bind the actual Alloy pipeline to a closed SDK operation catalogue."""
import json
import re
from pathlib import Path
import unittest

import pilot
import collector_privacy


class CollectorPrivacyContract(unittest.TestCase):
    def test_generated_ottl_quoted_literals_are_decodable_before_component_start(self):
        import privacy_config
        for statement in re.findall(r'`([^`]+)`', privacy_config.render()):
            for quoted in re.findall(r'"(?:\\.|[^"\\])*"', statement):
                # These generated literals use JSON-compatible Go/OTTL string escapes.
                json.loads(quoted)

    def test_wire_release_and_span_operation_allowlists_keep_exact_literal_dots(self):
        import privacy_config
        actual = privacy_config.render()
        release = re.search(r'IsMatch\(attributes\["service.version"\], ("[^"\n]+")\)', actual)
        operation = re.search(r'IsMatch\(name, ("\^\(HTTP GET /pilot[^"\n]+")\)', actual)
        self.assertIsNotNone(release)
        self.assertIsNotNone(operation)
        release_pattern = json.loads(release[1])
        operation_pattern = json.loads(operation[1])
        for value in ('1.2.3', '0001.0020.9999', 'a'*40):
            self.assertIsNotNone(re.fullmatch(release_pattern, value))
        for value in ('1x2x3', '1.2', '1.2.3.4', '10000.2.3', 'A'*40, 'secret'):
            self.assertIsNone(re.fullmatch(release_pattern, value))
        for value in ('HTTP GET /pilot','queue.publish','worker.attempt','worker.retry','dependency.http'):
            self.assertIsNotNone(re.fullmatch(operation_pattern, value))
        for value in ('queueXpublish','worker/retry','dependency/http','HTTP GET /private'):
            self.assertIsNone(re.fullmatch(operation_pattern, value))

    def test_pinned_component_counter_ids_survive_closed_self_scrape(self):
        import privacy_config
        actual = privacy_config.render()
        rules = dict(re.findall(r'source_labels = \["(receiver|exporter)"\]\n    regex = "([^"]+)"', actual))
        # Alloy1.21 uses NewIDWithName(factory.Type(), opts.ID); receiver ID also measured live.
        fixed_ids = {
            'receiver': ['otlp/otelcol.receiver.otlp.pilot'],
            'exporter': ['otlp_http/otelcol.exporter.otlphttp.'+signal for signal in ('metrics','logs','traces')],
        }
        for label, values in fixed_ids.items():
            for value in values:
                with self.subTest(label=label, value=value):
                    self.assertIsNotNone(re.fullmatch(rules[label], value))
            rejected = ['private-sentinel', values[0]+'suffix', 'prefix'+values[0], values[0].replace('pilot', 'untrusted').replace('.metrics', '.untrusted')]
            if label == 'exporter':
                rejected.append('otlphttp/otelcol.exporter.otlphttp.metrics')
            for value in rejected:
                with self.subTest(label=label, rejected=value):
                    self.assertIsNone(re.fullmatch(rules[label], value))

    def test_queue_signal_dimension_cannot_collapse_or_publish_arbitrary_values(self):
        import privacy_config
        actual = privacy_config.render()
        keep = re.search(r'regex = "([^"]+)"\n    action = "labelkeep"', actual)[1]
        identities = set()
        for exporter in ('metrics','logs','traces'):
            for data_type in ('metrics','logs','traces'):
                labels = {'__name__':'otelcol_exporter_queue_size',
                    'job':'platform-collector','instance':'pilot',
                    'exporter':'otlp_http/otelcol.exporter.otlphttp.'+exporter,
                    'data_type':data_type}
                identities.add(tuple(sorted((key,value) for key,value in labels.items() if re.fullmatch(keep,key))))
        self.assertEqual(len(identities), 9)
        rule = re.search(r'source_labels = \["data_type"\]\n    regex = "([^"]+)"', actual)[1]
        for value in ('', 'traces','metrics','logs'):
            self.assertIsNotNone(re.fullmatch(rule,value))
        for value in ('profiles','private-sentinel','traces-suffix'):
            self.assertIsNone(re.fullmatch(rule,value))
        for key in ('url','account.id','error.message'):
            self.assertIsNone(re.fullmatch(keep,key))

    def test_health_proof_requires_exact_closed_metric_and_successful_numeric_sample(self):
        body = {'status':'success', 'data':{'resultType':'vector', 'result':[
            {'metric':{'__name__':'up', 'job':'platform-collector', 'instance':'pilot'}, 'value':[1790000000,'1']}]}}
        self.assertTrue(collector_privacy.healthy((200,json.dumps(body))))
        for candidate in ('{"error":"1"}', '{', json.dumps({'status':'success','data':{'result':[]}})):
            self.assertFalse(collector_privacy.healthy((200,candidate)))
        self.assertFalse(collector_privacy.healthy((500,json.dumps(body))))
        body['data']['result'][0]['value'][1] = '0'
        self.assertFalse(collector_privacy.healthy((200,json.dumps(body))))

    def test_acceptance_counter_cannot_treat_missing_unknown_or_nonfinite_as_success(self):
        body = {'status':'success', 'data':{'resultType':'vector','result':[{'metric':{},'value':[1,'300']}]}}
        self.assertTrue(collector_privacy.accepted_counter((200,json.dumps(body))))
        for value in ('0','NaN','Infinity','secret',None):
            body['data']['result'][0]['value'][1] = value
            self.assertFalse(collector_privacy.accepted_counter((200,json.dumps(body))))

    def test_corpus_challenges_real_surfaces_without_claiming_untrusted_links_are_sanitized(self):
        fixture = pilot.corpus(now_ns=1790000000000000000, sequence=0)
        self.assertIn(collector_privacy.SENTINEL, json.dumps(fixture))
        span = fixture['traces']['resourceSpans'][0]['scopeSpans'][0]['spans'][0]
        collector_privacy.require_supported_links(fixture)
        self.assertEqual(span['links'][0]['traceId'], collector_privacy.LINK_TRACE_ID)
        span['links'][0]['traceState'] = collector_privacy.SENTINEL
        with self.assertRaisesRegex(RuntimeError, 'unsupported'):
            collector_privacy.require_supported_links(fixture)

    def test_storage_and_mcp_response_checker_fails_without_printing_raw_secret(self):
        for response in ({'content':[collector_privacy.SENTINEL]}, collector_privacy.SENTINEL):
            with self.assertRaises(RuntimeError) as caught:
                collector_privacy.assert_clean(response)
            self.assertNotIn(collector_privacy.SENTINEL, str(caught.exception))
        collector_privacy.assert_clean({'safe':'pilot.known_failure'})

    def test_actual_receiver_has_no_exporter_bypass_and_generation_is_current(self):
        import privacy_config
        actual = (pilot.CONFIG/'config.alloy').read_text()
        self.assertEqual(actual, privacy_config.render())
        receiver = actual.split('otelcol.receiver.otlp "pilot"', 1)[1].split('\notelcol.processor.filter', 1)[0]
        self.assertNotIn('otelcol.exporter.', receiver)
        for signal in ('metrics', 'logs', 'traces'):
            self.assertIn(f'{signal} = [otelcol.processor.filter.catalog.input]', receiver)

    def test_route_catalogue_is_explicit_and_includes_registered_templates(self):
        import re
        policy = json.loads((pilot.CONFIG/'privacy-policy.json').read_text())
        paths = json.loads((pilot.ROOT/'apps/backend/openapi/platform-api.json').read_text())['paths']
        for route in paths:
            self.assertIn(route, policy['routes'])
            self.assertIn(re.sub(r'\{([^}]+)\}', r':\1', route), policy['routes'])
        self.assertNotIn('/members/private-person@example.test', policy['routes'])
        self.assertNotIn('/mcp?token=SECRET', policy['routes'])

    def test_collector_raw_diagnostics_are_not_retained_by_docker(self):
        plan = pilot.compose_plan(Path('/source'), Path('/owned'),
                                  {name:'pinned' for name in pilot.SERVICES}, credential_owner=(1001,1002))
        self.assertEqual(plan['services']['alloy']['logging'], {'driver':'none'})
        self.assertEqual(plan['services']['metrics']['logging']['options']['max-size'], '5m')
