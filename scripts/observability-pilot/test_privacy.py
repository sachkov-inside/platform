"""Contracts bind the actual Alloy pipeline to a closed SDK operation catalogue."""
import json
import re
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

import pilot
import collector_privacy


class CollectorPrivacyContract(unittest.TestCase):
    def test_trace_exporter_removes_only_link_metadata_at_the_pinned_storage_boundary(self):
        import privacy_config
        actual = privacy_config.render()
        exporter = actual.split('otelcol.exporter.otlphttp "traces"', 1)[1].split('\n// Raw diagnostics', 1)[0]
        header = re.search(r'"VT-Ignore-Fields"\s*=\s*"([^"]+)"', exporter)
        self.assertIsNotNone(header)
        self.assertEqual(header[1].split(','), ['link:link_attr:*', 'link:link_trace_state:*'])
        # Worked pinned prefix-filter semantics; actual JSON/protobuf storage gate proves execution.
        prefixes = [value[:-1] for value in header[1].split(',')]
        for field in ('link:link_attr:user.email:0', 'link:link_attr:arbitrary.nested:812',
                      'link:link_attr::2', 'link:link_trace_state:0', 'link:link_trace_state:1001'):
            self.assertTrue(any(field.startswith(prefix) for prefix in prefixes))
        for field in ('trace_id', 'span_id', 'parent_span_id', 'link:link_trace_id:0',
                      'link:link_span_id:1001', 'link:link_flags:2', 'link:link_dropped_attributes_count:2'):
            self.assertFalse(any(field.startswith(prefix) for prefix in prefixes))
        self.assertEqual(actual.count('VT-Ignore-Fields'), 1)
        self.assertIn('include_metadata = false', actual)
        self.assertNotIn('headers_setter', actual)
        self.assertNotIn('from_context', actual)

    def test_raw_trace_store_errors_are_not_retained_while_other_storage_logging_is_unchanged(self):
        plan = pilot.compose_plan(Path('/source'), Path('/owned'),
                                  {name:'pinned' for name in pilot.SERVICES}, credential_owner=(1001,1002))
        self.assertEqual(plan['services']['traces']['logging'], {'driver':'none'})
        for service in ('metrics','logs'):
            self.assertEqual(plan['services'][service]['logging']['options']['max-size'], '5m')

    def test_trace_store_self_scrape_keeps_only_fixed_metrics_and_dimension_values(self):
        import privacy_config
        actual = privacy_config.render()
        scrape = actual.split('prometheus.scrape "trace_store_health"', 1)[1].split('prometheus.relabel', 1)[0]
        self.assertIn('"__address__" = "traces:10428"', scrape)
        self.assertIn('body_size_limit = "1MiB"', scrape)
        relabel = actual.split('prometheus.relabel "trace_store_health"', 1)[1]
        rules = dict(re.findall(r'source_labels = \["([^\"]+)"\]\n    regex = "([^"]+)"', relabel))
        for metric in ('up','vt_http_requests_total','vt_http_errors_total',
                       'vt_rows_ingested_total','vt_rows_dropped_total','vt_traceid_index_push_error_total'):
            self.assertIsNotNone(re.fullmatch(rules['__name__'], metric))
        for metric in ('go_info','private_metric','vt_http_errors_total_private'):
            self.assertIsNone(re.fullmatch(rules['__name__'], metric))
        external = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)', actual)[1]
        for metric in collector_privacy.TRACE_STORE_METRICS:
            self.assertIsNone(re.fullmatch(json.loads(external),metric))
        allowed = {'path':['','/insert/opentelemetry/v1/traces'], 'format':['','protobuf'],
            'type':['','opentelemetry_traces_otlphttp_protobuf'],
            'reason':['','debug','too_many_fields']}
        for label, values in allowed.items():
            for value in values:
                self.assertIsNotNone(re.fullmatch(rules[label], value))
            for value in ('private-sentinel', '/select/logsql/query?secret=sentinel', 'unknown'):
                self.assertIsNone(re.fullmatch(rules[label], value))
        keep = re.search(r'regex = "([^"]+)"\n    action = "labelkeep"', relabel)[1]
        for label in ('__name__','job','instance','path','format','type','reason'):
            self.assertIsNotNone(re.fullmatch(keep, label))
        for label in ('trace_id','error.message','query','url','account.id'):
            self.assertIsNone(re.fullmatch(keep, label))

    def test_trace_store_health_requires_real_fresh_samples_and_reports_lazy_counter_unknown(self):
        labels = {'job':'platform-trace-store','instance':'pilot'}
        def row(name, value, **extra):
            return {'metric':{'__name__':name, **labels, **extra}, 'value':[1790000000, str(value)]}
        rows = [row('up',1),
            row('vt_http_requests_total',65,path='/insert/opentelemetry/v1/traces',format='protobuf'),
            row('vt_http_errors_total',0,path='/insert/opentelemetry/v1/traces',format='protobuf'),
            row('vt_rows_ingested_total',362,type='opentelemetry_traces_otlphttp_protobuf'),
            row('vt_rows_dropped_total',0,reason='too_many_fields'), row('vt_rows_dropped_total',0,reason='debug')]
        def response(values):
            return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':values}})
        age = response([{'metric': labels, 'value':[1790000000,'2']}])
        proof = collector_privacy.trace_store_health(response(rows), age)
        self.assertEqual(proof['index_push_errors'], 'unknown')
        self.assertEqual(proof['ingest_attempts'],362)
        self.assertEqual(proof['rows_dropped_too_many_fields'],0)
        self.assertEqual(proof['scrape_age_seconds'],2)
        for damaged in (rows[:-1], rows+rows[:1], rows+[row('unexpected',1)],
                        rows+[row('vt_rows_dropped_total',0,reason='private-sentinel')]):
            self.assertIsNone(collector_privacy.trace_store_health(response(damaged),age))
        for value in ('NaN','Infinity','-1','11'):
            self.assertIsNone(collector_privacy.trace_store_health(response(rows),
                response([{'metric': labels, 'value':[1790000000,value]}])))
        for value in ('NaN','-1','0.5'):
            damaged = json.loads(json.dumps(rows))
            damaged[2]['value'][1] = value
            self.assertIsNone(collector_privacy.trace_store_health(response(damaged),age))
        for index in (0,1,3):
            damaged = json.loads(json.dumps(rows))
            damaged[index]['value'][1] = '0'
            self.assertIsNone(collector_privacy.trace_store_health(response(damaged),age))
        with_index = collector_privacy.trace_store_health(response(rows+[row('vt_traceid_index_push_error_total',1)]),age)
        self.assertEqual(with_index['index_push_errors'],1)

    def test_trace_store_error_or_loss_counter_fails_and_is_retained_as_closed_evidence(self):
        base = {'up':1, 'http_requests':65, 'ingest_attempts':362, 'http_errors':0,
                'rows_dropped_too_many_fields':0, 'rows_dropped_debug':0,
                'index_push_errors':'unknown', 'scrape_age_seconds':2}
        for field in ('http_errors','rows_dropped_too_many_fields','rows_dropped_debug','index_push_errors'):
            with tempfile.TemporaryDirectory() as directory, \
                 patch('pilot.await_fact',return_value={**base,field:1}):
                with self.assertRaisesRegex(RuntimeError, 'trace store reported'):
                    pilot.trace_store_surface('private-key',Path(directory))
                proof = json.loads((Path(directory)/'trace-store-health.json').read_text())
                self.assertEqual(proof['outcome'],'failed')
                self.assertEqual(proof['counters'][field],1)
                self.assertNotIn('private-key',json.dumps(proof))
        with tempfile.TemporaryDirectory() as directory, patch('pilot.await_fact',return_value=base):
            pilot.trace_store_surface('private-key',Path(directory))
            proof = json.loads((Path(directory)/'trace-store-health.json').read_text())
            self.assertEqual(proof['outcome'],'passed')
            self.assertEqual(proof['counters']['index_push_errors'],'unknown')

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

    def test_materials_route_admits_only_the_canonical_registered_template(self):
        import privacy_config
        route = '/integrations/telegram/v1/communications/materials'
        policy = json.loads((pilot.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy['routes'].count(route), 1)
        actual = privacy_config.render()
        # The rendered collector catalogue must keep its exact anchored allowlist.
        rule = privacy_config.enum_rule('http.route', policy['routes'])
        self.assertIn(privacy_config.only(rule, 'not ('+privacy_config.TELEGRAM_SERVICE+')'), actual)
        pattern = privacy_config.pattern(policy['routes'])
        self.assertIsNotNone(re.fullmatch(pattern, route))
        for rejected in (route + '/private', route + '?token=SECRET', route + 'suffix',
                         '/integrations/telegram/v1/communications/private-person@example.test'):
            self.assertNotIn(rejected, policy['routes'])
            self.assertIsNone(re.fullmatch(pattern, rejected))

    def test_collector_raw_diagnostics_are_not_retained_by_docker(self):
        plan = pilot.compose_plan(Path('/source'), Path('/owned'),
                                  {name:'pinned' for name in pilot.SERVICES}, credential_owner=(1001,1002))
        self.assertEqual(plan['services']['alloy']['logging'], {'driver':'none'})
        self.assertEqual(plan['services']['metrics']['logging']['options']['max-size'], '5m')
