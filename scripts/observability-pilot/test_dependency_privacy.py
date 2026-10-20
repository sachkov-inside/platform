"""Source admission contracts, not execution of the pinned collector."""
import json
import re
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import pilot
import privacy_config


class DependencyCatalog(unittest.TestCase):
    def test_fixed_sdk_dependency_catalog_has_no_request_or_status_metric_dimensions(self):
        policy = json.loads((privacy_config.CONFIG/'privacy-policy.json').read_text())
        self.assertEqual(policy['dependencies'], {
            'names':['kinescope','postgresql'], 'operations':['delete','find','initUpload','query','acquire','material-slug-lock'],
            'outcomes':['completed','failed'],
            'metrics':['inside.dependency.operations','inside.dependency.duration']})
        actual = privacy_config.render()
        metric_rule = re.search(r'metric = \[`not IsMatch\(name, ("(?:\\.|[^"\\])*")\)',actual)[1]
        for name in ('inside.dependency.operations','inside.dependency.duration'):
            self.assertIsNotNone(re.fullmatch(json.loads(metric_rule),name))
        for name in ('inside.dependency.private','inside.dependency.operations.private'):
            self.assertIsNone(re.fullmatch(json.loads(metric_rule),name))
        points = actual.split('context = "datapoint"',1)[1].split('log_statements',1)[0]
        dependency = [line for line in re.findall(r'`([^`]+)`',points)
                      if line.startswith('keep_keys(attributes, ["dependency"')]
        self.assertEqual(len(dependency),1)
        self.assertTrue(dependency[0].startswith('keep_keys(attributes, ["dependency", "operation", "outcome"])'))
        self.assertNotIn('http.response.status_code',dependency[0])
        self.assertNotIn('http.request.method',dependency[0])
        self.assertNotIn('inside[.]postgresql',dependency[0])
        pool=[line for line in re.findall(r'`([^`]+)`',points) if line.startswith('keep_keys(attributes, [])')]
        self.assertEqual(len(pool),1)
        expression=json.loads(re.search(r'IsMatch\(metric.name, ("(?:\\.|[^"\\])*")\)',pool[0])[1])
        for suffix in ('available','total','idle','waiting','registry_overflow'):
            self.assertIsNotNone(re.fullmatch(expression,'inside.postgresql.pool.'+suffix))
        span = actual.split('context = "span"',1)[1].split('metric_statements',1)[0]
        for key in ('dependency.name','dependency.operation','dependency.outcome'):
            self.assertIn('"'+key+'"',span)
        self.assertIn('Concat([attributes["dependency.name"], attributes["dependency.operation"]], " ")',span)

    def test_catalog_controller_refuses_ingest_when_actual_logging_is_unproved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',None), patch('pilot.request') as request:
            with self.assertRaisesRegex(RuntimeError,'dependency collector proof failed'):
                pilot.dependency_catalog_corpus('private-token',Path(directory),[])
            request.assert_not_called()
            self.assertEqual(json.loads((Path(directory)/'dependency-collector.json').read_text()),{'outcome':'failed','stage':'logging','cases':[]})

    def test_external_corpus_covers_registered_and_unknown_missing_nonstring_dimensions(self):
        import dependency_privacy
        from collector_privacy import SENTINEL
        bodies = dependency_privacy.payloads('json',1790000000000000000)
        spans = bodies['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        self.assertEqual(len(spans),15)
        self.assertEqual([span['kind'] for span in spans],[3]*10+[1]*2+[3]*3)
        self.assertEqual(len({span['spanId'] for span in spans}),15)
        pairs = []
        for span in spans[:6]:
            attrs = {attr['key']:attr['value'] for attr in span['attributes']}
            pairs.append((attrs['dependency.operation']['stringValue'],attrs['dependency.outcome']['stringValue']))
            self.assertEqual(attrs['dependency.name'],{'stringValue':'kinescope'})
            for key in ('url.full','provider.request_id','http.request.body','http.response.body',
                        'authorization','user.email','exception.message','exception.stacktrace'):
                self.assertEqual(attrs[key],{'stringValue':SENTINEL})
        self.assertEqual(pairs,[('delete','completed'),('delete','failed'),('find','completed'),
            ('find','failed'),('initUpload','completed'),('initUpload','failed')])
        metrics = bodies['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
        self.assertEqual([metric['name'] for metric in metrics],
            ['inside.dependency.operations','inside.dependency.duration','inside.dependency.private']+['inside.postgresql.pool.'+name for name in ('available','total','idle','waiting','registry_overflow')])
        self.assertEqual(len(metrics[0]['sum']['dataPoints']),15)
        self.assertEqual(len(metrics[1]['histogram']['dataPoints']),15)
        typed = {attr['key']:attr['value'] for attr in spans[13]['attributes']}
        self.assertEqual(typed['dependency.name'],{'boolValue':False})
        self.assertEqual(typed['dependency.outcome'],{'intValue':'42'})
        self.assertFalse(any(attr['key'].startswith('dependency.') for attr in spans[14]['attributes']))


def trace_rows(transport='json'):
    import dependency_privacy as fixture
    rows=[]
    for index,(operation,outcome) in enumerate((('delete','completed'),('delete','failed'),('find','completed'),
            ('find','failed'),('initUpload','completed'),('initUpload','failed'),('query','completed'),('query','failed'),('acquire','completed'),('acquire','failed'),('material-slug-lock','completed'),('material-slug-lock','failed'),('_OTHER','_OTHER'),('_OTHER','_OTHER'),(None,None))):
        row={'trace_id':fixture.TRACE_IDS[transport],'span_id':f'{index+1:016x}','parent_span_id':'b'*16,
            'resource_attr:service.name':'platform-api','resource_attr:deployment.environment.name':'isolated-pilot',
            'resource_attr:service.version':fixture.RELEASES[transport],'scope_name':'inside-collector',
            'kind':'1' if index in (10,11) else '3','status_code':'0' if index in (0,2,4,6,8,10) else '2',
            'name':('kinescope ' if index<6 else 'postgresql ')+operation if index<12 else '_OTHER _OTHER' if index<14 else 'operation',
            'span_attr:http.request.method':('DELETE','DELETE','GET','GET','POST','POST',*(['_OTHER']*9))[index]}
        if index<14:
            row.update({'span_attr:dependency.name':'kinescope' if index<6 else 'postgresql' if index<12 else '_OTHER',
                'span_attr:dependency.operation':operation,'span_attr:dependency.outcome':outcome})
        if index<6:
            row['span_attr:http.response.status_code']='200'
        rows.append(row)
    return rows


def metric_rows():
    rows=[]
    for release in ('a'*40,'b'*40):
        for dependency,operation,outcome in (('kinescope','delete','completed'),('kinescope','delete','failed'),
                ('kinescope','find','completed'),('kinescope','find','failed'),('kinescope','initUpload','completed'),
                ('kinescope','initUpload','failed'),('postgresql','query','completed'),('postgresql','query','failed'),('postgresql','acquire','completed'),('postgresql','acquire','failed'),('postgresql','material-slug-lock','completed'),('postgresql','material-slug-lock','failed'),('_OTHER','_OTHER','_OTHER')):
            for name,le,value in (('inside.dependency.operations',None,1),('inside.dependency.duration_count',None,1),
                    ('inside.dependency.duration_sum',None,.25),('inside.dependency.duration_bucket','1',1),
                    ('inside.dependency.duration_bucket','+Inf',1)):
                labels={'__name__':name,'service.name':'platform-api','deployment.environment.name':'isolated-pilot',
                    'service.version':release,'scope.name':'inside-collector','dependency':dependency,'operation':operation,'outcome':outcome}
                if le is not None:
                    labels['le']=le
                rows.append({'metric':labels,'value':[1790000000,str(value)]})
        for name,value in (('available',1),('total',2),('idle',1),('waiting',3),('registry_overflow',0)):
            rows.append({'metric':{'__name__':'inside.postgresql.pool.'+name,'service.name':'platform-api','deployment.environment.name':'isolated-pilot','service.version':release,'scope.name':'inside-collector'},'value':[1790000000,str(value)]})
    return rows


class DependencyRuntimeContract(unittest.TestCase):
    def test_literal_protobuf_tags_decode_to_known_trace_metric_and_adversarial_fields(self):
        import dependency_privacy as fixture
        from test_link_privacy import wire_fields
        wire=fixture.payloads('protobuf',1790000000000000000)
        self.assertLess(len(wire['traces']),32768)
        self.assertLess(len(wire['metrics']),32768)
        scope=wire_fields(wire_fields(wire_fields(wire['traces'])[1][0])[2][0])
        self.assertEqual(len(scope[2]),15)
        span=wire_fields(scope[2][0])
        self.assertEqual(span[1],[bytes.fromhex('d'*31+'4')])
        self.assertEqual(span[4],[bytes.fromhex('b'*16)])
        self.assertEqual(span[6],[3])
        self.assertIn(fixture.SENTINEL.encode(),span[11][0])
        typed={wire_fields(value)[1][0]:wire_fields(wire_fields(value)[2][0]) for value in wire_fields(scope[2][13])[9]}
        self.assertEqual(typed[b'dependency.name'],{2:[0]})
        self.assertEqual(typed[b'dependency.outcome'],{3:[42]})
        metrics=wire_fields(wire_fields(wire_fields(wire['metrics'])[1][0])[2][0])[2]
        self.assertEqual(len(metrics),8)
        self.assertEqual(wire_fields(metrics[0])[1],[b'inside.dependency.operations'])
        points=wire_fields(wire_fields(metrics[0])[7][0])[1]
        self.assertEqual(len(points),15)
        self.assertEqual(int.from_bytes(wire_fields(points[0])[6][0],'little'),1)
        histogram=wire_fields(wire_fields(wire_fields(metrics[1])[9][0])[1][0])
        self.assertEqual(int.from_bytes(histogram[4][0],'little'),1)
        self.assertEqual(histogram[6],[bytes.fromhex('01000000000000000000000000000000')])
        self.assertEqual(histogram[7],[bytes.fromhex('000000000000f03f')])

    def test_full_rows_and_metric_dimensions_are_checked_before_closed_projection(self):
        import dependency_privacy as fixture
        raw='\n'.join(json.dumps(row) for row in trace_rows())
        self.assertEqual(fixture.stored_traces(raw,'json')['stored_spans'],15)
        self.assertIsNone(fixture.stored_traces('','json'))
        for key,value in (('span_attr:authorization','private-value'),('resource_attr:user.email','private-value'),
                ('scope_attr:private','private-value'),('event:name:0','private-value'),('link:link_attr:private:0','private-value'),
                ('status_message','private-value'),('parent_span_id','c'*16),('span_attr:dependency.operation','other')):
            rows=trace_rows(); rows[0][key]=value
            with self.assertRaisesRegex(RuntimeError,'raw response withheld'):
                fixture.stored_traces('\n'.join(json.dumps(row) for row in rows),'json')
        response=lambda rows:(200,json.dumps({'status':'success','data':{'resultType':'vector','result':rows}}))
        self.assertEqual(fixture.stored_metrics(response(metric_rows())),{'stored_series':140,'metric_labelsets':26,'pool_series':10,'privacy':'passed'})
        self.assertIsNone(fixture.stored_metrics(response(metric_rows()[:-1])))
        for key,value in (('__name__','inside.dependency.private'),('url.full','private-value'),('operation','private-value'),
                          ('http.response.status_code','200'),('scope.version','private-value')):
            rows=metric_rows(); rows[0]['metric'][key]=value
            with self.assertRaisesRegex(RuntimeError,'raw response withheld'):
                fixture.stored_metrics(response(rows))
        for index in (6,10):
            rows=trace_rows(); rows[index]['span_attr:db.query.text']='private-sql-value'
            with self.assertRaisesRegex(RuntimeError,'raw response withheld'):
                fixture.stored_traces('\n'.join(json.dumps(row) for row in rows),'json')
        for key,value in (('dependency','postgresql'),('operation','query'),('http.request.method','GET'),('__name__','inside.postgresql.pool.private')):
            rows=metric_rows(); row=next(row for row in rows if row['metric']['__name__']=='inside.postgresql.pool.available')
            row['metric'][key]=value
            with self.assertRaisesRegex(RuntimeError,'raw response withheld'):
                fixture.stored_metrics(response(rows))
        for value in ('NaN','Infinity','-1','1.5'):

            rows=metric_rows(); rows[0]['value'][1]=value
            with self.assertRaises(RuntimeError):
                fixture.stored_metrics(response(rows))

    def test_public_controller_uses_only_two_registered_trace_ids_and_bounded_owned_full_reads(self):
        import dependency_privacy as fixture
        project='inside-observability-pilot-123456abcdef'
        compose=['docker','compose','-p',project,'-f','/owned/compose.json']
        identity={'platform':'linux','endpoint':'unix:///owned/docker.sock'}
        emitted=[]
        def http(path,*,token=None,body=None,method='GET',port=18427):
            if method=='POST':
                self.assertIn(path,('/v1/traces','/v1/metrics')); self.assertEqual(port,14318)
                emitted.append(type(body)); return 200,''
            return 200,json.dumps({'status':'success','data':{'resultType':'vector','result':metric_rows()}})
        def docker(args,*,timeout):
            self.assertGreater(timeout,0); self.assertLessEqual(timeout,pilot.QUERY_TIMEOUT_SECONDS)
            if args[1]=='compose': return 'c'*64
            if args[1]=='inspect':
                return 'owned|none' if '.HostConfig.LogConfig.Type' in args[3] else project+'|gateway|true'
            self.assertEqual(args[1],'exec'); self.assertIn('limit=16',args[-1]); self.assertNotIn('fields',args[-1])
            transport='json' if fixture.TRACE_IDS['json'] in args[-1] else 'protobuf'
            self.assertIn(fixture.TRACE_IDS[transport],args[-1])
            return '\n'.join(json.dumps(row) for row in trace_rows(transport))
        with tempfile.TemporaryDirectory() as directory, patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']), \
                patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity),patch('pilot.daemon.identify',return_value=identity), \
                patch('pilot.command',side_effect=docker),patch('pilot.request',side_effect=http):
            pilot.dependency_catalog_corpus('private-token',Path(directory),compose)
            proof=json.loads((Path(directory)/'dependency-collector.json').read_text())
            self.assertEqual(proof['outcome'],'passed'); self.assertEqual(proof['metrics']['stored_series'],140)
            self.assertEqual([case['transport'] for case in proof['cases']],['json','protobuf'])
            self.assertEqual(emitted,[dict,dict,bytes,bytes]); self.assertNotIn('private-token',json.dumps(proof))


if __name__ == '__main__':
    unittest.main()
