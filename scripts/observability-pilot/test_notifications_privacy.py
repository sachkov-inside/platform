"""Notifications catalog and external wire proof contracts, separate from actual SDK execution."""
import json
import re
import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch

import pilot
import privacy_config


def trace_rows(transport="json"):
    rows = []
    for index,(operation,outcome) in enumerate((('publish','completed'),('publish','failed'),
            ('receive','completed'),('receive','failed'),('audience','completed'),('audience','failed'),('_OTHER','_OTHER'))):
        row = {'trace_id':'c'*31+('1' if transport=='json' else '2'),'span_id':f'{index+1:016x}','parent_span_id':'d'*16,
            'resource_attr:service.name':'platform-notifications-worker',
            'resource_attr:deployment.environment.name':'isolated-pilot','resource_attr:service.version':('a' if transport=='json' else 'b')*40,
            'scope_name':'inside-collector',
            'name':operation+' '+('inside.events.materials.v1' if index<6 else '_OTHER'),
            'kind':str([4,4,5,5,1,1,1][index]),'status_code':'0' if outcome=='completed' else '2',
            'span_attr:messaging.system':'rabbitmq','span_attr:messaging.destination.name':'inside.events.materials.v1' if index<6 else '_OTHER',
            'span_attr:messaging.operation.name':operation,
            'link:link_trace_id:0':'f'*32,'link:link_span_id:0':'f'*16}
        if outcome != 'completed':
            row['span_attr:error.type']='notification_operation_failed' if index<6 else '_OTHER'
        rows.append(row)
    return rows


def metric_rows():
    rows = []
    for release in ('a'*40,'b'*40):
        for operation,outcome in (('publish','completed'),('publish','failed'),('receive','completed'),
                                  ('receive','failed'),('audience','completed'),('audience','failed'),('_OTHER','_OTHER')):
            for name,le,value in (('inside.notification.operations',None,1),
                ('inside.notification.duration_count',None,1),('inside.notification.duration_sum',None,.25),
                ('inside.notification.duration_bucket','1',1),('inside.notification.duration_bucket','+Inf',1)):
                labels = {'__name__':name,'service.name':'platform-notifications-worker',
                    'deployment.environment.name':'isolated-pilot','service.version':release,
                    'scope.name':'inside-collector','scope.version':'unknown','operation':operation,'outcome':outcome}
                if le is not None: labels['le']=le
                rows.append({'metric':labels,'value':[1790000000,str(value)]})
    return rows


class NotificationCatalog(unittest.TestCase):
    def test_actual_registered_notifications_contract_is_admitted_without_reclassifying_queues(self):
        policy = json.loads((pilot.CONFIG/'privacy-policy.json').read_text())
        self.assertIn('platform-notifications-worker',policy['services'])
        self.assertEqual(policy['notifications'], {
            'system':'rabbitmq', 'destination':'inside.events.materials.v1',
            'operations':['publish','receive','audience'], 'outcomes':['completed','failed'],
            'metrics':['inside.notification.operations','inside.notification.duration'],
            'error':'notification_operation_failed'})
        self.assertEqual(policy['queues'], ['material-assets.cleanup','profile-avatars.cleanup',
            'videos.deletions','web-telemetry.retention','billing.payment-recovery',
            'billing.subscription-renewal','billing.subscription-notices','tribute.source-reconciliation',
            'community.entitlement-delivery','_OTHER'])
        self.assertEqual(len(policy['routes']),222)
        owner = (pilot.ROOT/'apps/backend/src/infrastructure/observability/technical-telemetry.ts').read_text()
        for value in ('rabbitmq','inside.events.materials.v1','notification_operation_failed',
                      'inside.notification.operations','inside.notification.duration'):
            self.assertIn('"'+value+'"',owner)
        self.assertIn('type NotificationOperation = "publish" | "receive" | "audience";',owner)
        self.assertIn('outcome: failed ? "failed" : "completed"',owner)
        actual = privacy_config.render()
        metric_rule = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)',actual)[1]
        for name in ('inside.notification.operations','inside.notification.duration'):
            self.assertIsNotNone(re.fullmatch(json.loads(metric_rule),name))
        for name in ('inside.notification.private','inside.notification.operations.private'):
            self.assertIsNone(re.fullmatch(json.loads(metric_rule),name))

    def test_new_datapoint_dimensions_are_scoped_and_have_a_single_missing_unknown_bucket(self):
        actual = privacy_config.render()
        point = actual.split('context = "datapoint"',1)[1].split('log_statements',1)[0]
        statements = re.findall(r'`([^`]+)`',point)
        keep = [line for line in statements if line.startswith('keep_keys')]
        self.assertEqual(len(keep),4)
        self.assertIn('not (IsMatch(metric.name,',keep[0])
        self.assertNotIn('"operation"',keep[0])
        self.assertIn('keep_keys(attributes, ["operation", "outcome"]) where (IsMatch(metric.name,',keep[1])
        for key in ('operation','outcome'):
            rules = [line for line in statements if line.startswith('set(attributes["'+key+'"]') and 'dependency' not in line and 'email' not in line]
            self.assertEqual(len(rules),2)
            self.assertTrue(all('IsMatch(metric.name,' in line for line in rules))
            self.assertTrue(any('not IsString' in line for line in rules))
        span = actual.split('context = "span"',1)[1].split('metric_statements',1)[0]
        self.assertIn('"rabbitmq"',span)
        self.assertIn('inside',span)
        self.assertIn('notification_operation_failed',span)
        notification_rules = [line for line in re.findall(r'`([^`]+)`',span)
                              if 'where (attributes["messaging.system"] == "rabbitmq" and not (' in line]
        self.assertEqual(len(notification_rules),2)
        for line in notification_rules:
            literal = re.search(r'not IsMatch\(attributes\["messaging\.[^\"]+"\], ("(?:\\.|[^"\\])*")\)',line)[1]
            regex = json.loads(literal)
            values = ('inside.events.materials.v1',) if 'destination.name' in line else ('publish','receive','audience')
            for value in values:
                self.assertIsNotNone(re.fullmatch(regex,value))
            for value in ('inside.notifications.email.v1','inside.notifications.telegram.v1','audience.private','private-sentinel'):
                self.assertIsNone(re.fullmatch(regex,value))

    def test_external_fixture_contains_six_registered_completions_and_adversarial_fallback(self):
        import notification_privacy as fixture
        bodies = fixture.payloads('json',1790000000000000000)
        spans = bodies['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        self.assertEqual(len(spans),7)
        self.assertEqual([span['kind'] for span in spans[:6]],[4,4,5,5,1,1])
        self.assertEqual([span['status']['code'] for span in spans[:6]],[0,2,0,2,0,2])
        self.assertIn(fixture.SENTINEL,json.dumps(bodies))
        for signal,wire in fixture.payloads('protobuf',1790000000000000000).items():
            self.assertIsInstance(wire,bytes)
            self.assertLess(len(wire),32768)
            self.assertIn(fixture.SENTINEL.encode(),wire)
        self.assertEqual(len(bodies['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics']),2)

    def test_independent_protobuf_trace_and_metric_schema_tags_decode_to_worked_values(self):
        import notification_privacy as fixture
        from test_link_privacy import wire_fields
        wire=fixture.payloads('protobuf',1790000000000000000)
        trace_scope=wire_fields(wire_fields(wire_fields(wire['traces'])[1][0])[2][0])
        self.assertEqual(len(trace_scope[2]),7)
        span=wire_fields(trace_scope[2][0])
        self.assertEqual(span[1],[bytes.fromhex('c'*31+'2')])
        self.assertEqual(span[5],[b'publish materials'])
        self.assertEqual(span[6],[4])
        metrics=wire_fields(wire_fields(wire_fields(wire['metrics'])[1][0])[2][0])[2]
        self.assertEqual(len(metrics),2)
        counter=wire_fields(metrics[0])
        self.assertEqual(counter[1],[b'inside.notification.operations'])
        points=wire_fields(counter[7][0])[1]
        self.assertEqual(len(points),9)
        self.assertEqual(int.from_bytes(wire_fields(points[0])[6][0],'little'),1)
        typed={wire_fields(value)[1][0]:wire_fields(wire_fields(value)[2][0]) for value in wire_fields(points[-1])[7]}
        self.assertEqual(typed[b'operation'],{2:[1]})
        self.assertEqual(typed[b'outcome'],{3:[42]})
        histogram=wire_fields(wire_fields(wire_fields(metrics[1])[9][0])[1][0])
        self.assertEqual(int.from_bytes(histogram[4][0],'little'),1)
        self.assertEqual(histogram[6],[bytes.fromhex('01000000000000000000000000000000')])
        self.assertEqual(histogram[7],[bytes.fromhex('000000000000f03f')])

    def test_full_storage_projection_requires_every_span_field_and_never_prints_secret(self):
        import notification_privacy as fixture
        rows = trace_rows()
        raw = '\n'.join(json.dumps(row) for row in rows)
        self.assertEqual(fixture.stored_traces(raw,'json')['stored_spans'],7)
        self.assertIsNone(fixture.stored_traces('', 'json'))
        for key,value in (('parent_span_id','e'*16),('name','operation'),
                          ('span_attr:messaging.operation.name','_OTHER'),('link:link_span_id:0','1'*16),
                          ('resource_attr:user.email','unregistered'),('scope_attr:private','unregistered'),
                          ('status_message','unregistered'),
                          ('span_attr:user.email',fixture.SENTINEL)):
            changed = json.loads(json.dumps(rows))
            changed[0][key]=value
            with self.assertRaises(RuntimeError) as caught:
                fixture.stored_traces('\n'.join(json.dumps(row) for row in changed),'json')
            self.assertNotIn(fixture.SENTINEL,str(caught.exception))

    def test_catalog_controller_refuses_all_ingest_if_actual_logging_is_unverified(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',None), patch('pilot.request') as request:
            with self.assertRaisesRegex(RuntimeError,'notification collector proof failed'):
                pilot.notification_catalog_corpus('private-token',Path(directory),[])
            request.assert_not_called()
            proof=json.loads((Path(directory)/'notification-collector.json').read_text())
            self.assertEqual(proof,{'outcome':'failed','stage':'logging','cases':[]})

    def test_public_controller_emits_both_wire_types_and_proves_full_storage_with_closed_artifact(self):
        project='inside-observability-pilot-123456abcdef'
        compose=['docker','compose','-p',project,'-f','/owned/compose.json']
        identity={'platform':'linux','endpoint':'unix:///owned/docker.sock'}
        emitted=[]
        def http(path,*,token=None,body=None,method='GET',port=18427):
            if method=='POST':
                self.assertIn(path,('/v1/traces','/v1/metrics'))
                self.assertEqual(port,14318)
                emitted.append(type(body))
                return 200,''
            return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':metric_rows()}})
        def docker(args,*,timeout):
            self.assertGreater(timeout,0)
            self.assertLessEqual(timeout,pilot.QUERY_TIMEOUT_SECONDS)
            if args[1]=='compose': return 'c'*64
            if args[1]=='inspect':
                return 'owned|none' if '.HostConfig.LogConfig.Type' in args[3] else project+'|gateway|true'
            self.assertEqual(args[1],'exec')
            self.assertIn('limit=8',args[-1])
            self.assertNotIn('fields',args[-1])
            transport='json' if 'c'*31+'1' in args[-1] else 'protobuf'
            return '\n'.join(json.dumps(row) for row in trace_rows(transport))
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']), \
             patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity), \
             patch('pilot.daemon.identify',return_value=identity), \
             patch('pilot.command',side_effect=docker), patch('pilot.request',side_effect=http):
            pilot.notification_catalog_corpus('private-token',Path(directory),compose)
            proof=json.loads((Path(directory)/'notification-collector.json').read_text())
            self.assertEqual(proof['outcome'],'passed')
            self.assertEqual([case['transport'] for case in proof['cases']],['json','protobuf'])
            self.assertEqual(proof['metrics']['stored_series'],70)
            self.assertEqual(emitted,[dict,dict,bytes,bytes])
            self.assertNotIn('private-token',json.dumps(proof))

    def test_native_mcp_requires_structured_known_trace_and_rejects_marker_only_or_error(self):
        import notification_privacy as fixture
        spans = []
        for index,(operation,_outcome) in enumerate((*fixture.CASES,('_OTHER','_OTHER'))):
            spans.append({'spanID':f'{index+1:016x}',
                'operationName':operation+' '+('inside.events.materials.v1' if index<6 else '_OTHER'),
                'references':[{'spanID':'d'*16},{'spanID':'f'*16}]})
        body = {'data':[{'traceID':'c'*31+'1','spans':spans,
                        'processes':{'p1':{'serviceName':'platform-notifications-worker'}}}]}
        response = {'content':[{'type':'text','text':json.dumps(body)}]}
        fixture.mcp_trace(response,'json')
        for failed in ({'content':[{'text':'c'*31+'1'}]}, {'isError':True,**response},
                       {'content':[{'text':json.dumps(body)+fixture.SENTINEL}]}):
            with self.assertRaises(RuntimeError) as caught:
                fixture.mcp_trace(failed,'json')
            self.assertNotIn(fixture.SENTINEL,str(caught.exception))

    def test_metrics_require_all_registered_and_fallback_labelsets_without_extra_dimensions(self):
        import notification_privacy as fixture
        rows = metric_rows()
        def response(values):
            return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':values}})
        self.assertEqual(fixture.stored_metrics(response(rows)),{'stored_series':70,'metric_labelsets':14,'privacy':'passed'})
        fixture.mcp_metrics({'content':[{'type':'text','text':response(rows)[1]}]})
        self.assertIsNone(fixture.stored_metrics(response(rows[:-1])))
        for key,value in (('account.id','private'),('operation',fixture.SENTINEL),('outcome','unknown'),
                          ('__name__','inside.notification.private'),('scope.version',fixture.SENTINEL)):
            changed=json.loads(json.dumps(rows))
            changed[0]['metric'][key]=value
            with self.assertRaises(RuntimeError) as caught:
                fixture.stored_metrics(response(changed))
            self.assertNotIn(fixture.SENTINEL,str(caught.exception))


if __name__ == '__main__':
    unittest.main()
