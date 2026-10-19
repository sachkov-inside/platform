"""Contracts bind the actual Alloy pipeline to a closed SDK operation catalogue."""
import json
from pathlib import Path
import unittest

import pilot
import collector_privacy


class CollectorPrivacyContract(unittest.TestCase):
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

