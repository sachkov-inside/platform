"""Independent fixed email ingress/storage oracles; no collector execution claim."""
import unittest
import email_privacy

class EmailIngress(unittest.TestCase):
    def test_known_json_has_only_registered_nine_operations_and_four_smtp_outcomes(self):
        parts=email_privacy.trace_payloads('json',1_800_000_000_000_000_000)
        self.assertEqual([name for name,_ in parts],['logical','smtp','adversarial'])
        spans=parts[0][1]['resourceSpans'][0]['scopeSpans'][0]['spans']
        self.assertEqual(len(spans),18)
        self.assertEqual([s['kind'] for s in spans[:6]],[4,4,5,5,1,1])
        metrics=email_privacy.metric_payload('json',1_800_000_000_000_000_000)
        points=metrics['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['sum']['dataPoints']
        self.assertEqual(len(points),22)
        pairs=[tuple(a['value']['stringValue'] for a in p['attributes'][:2]) for p in points]
        self.assertEqual(pairs[:6],[('publishMaterial','completed'),('publishMaterial','failed'),('receiveMaterial','completed'),('receiveMaterial','failed'),('dispatchMaterial','completed'),('dispatchMaterial','failed')])
        self.assertEqual(pairs[-4:],[('smtpSend','sent'),('smtpSend','not_sent'),('smtpSend','failed'),('smtpSend','unknown')])

# Independent wire reader, with literal OTLP field numbers. Does not call the encoder.
def fields(raw):
    def varint(offset):
        value=0
        for shift in range(0,70,7):
            byte=raw[offset];offset+=1;value|=(byte&127)<<shift
            if byte<128:return value,offset
        raise AssertionError('invalid wire integer')
    result={};offset=0
    while offset<len(raw):
        tag,offset=varint(offset);wire=tag&7;number=tag>>3
        if wire==0:value,offset=varint(offset)
        elif wire in (1,5):
            size=8 if wire==1 else 4;value=raw[offset:offset+size];offset+=size
        elif wire==2:
            size,offset=varint(offset);value=raw[offset:offset+size];offset+=size
        else:raise AssertionError('unsupported wire type')
        if offset>len(raw):raise AssertionError('truncated wire')
        result.setdefault(number,[]).append(value)
    return result

class EmailProtobuf(unittest.TestCase):
    def test_independent_otlp_ids_flags_scope_metric_counts_and_bounds(self):
        import struct
        parts=email_privacy.trace_payloads('protobuf',1_800_000_000_000_000_000)
        self.assertEqual([len(fields(fields(fields(body)[1][0])[2][0]).get(2,[])) for _,body in parts],[18,4,8])
        for name,body in parts:
            self.assertLessEqual(len(body),65536)
            resource=fields(fields(body)[1][0]);scope=fields(resource[2][0]);span=fields(scope[2][0])
            self.assertEqual(span[1],[bytes.fromhex('d'*31+('a' if name=='adversarial' else '8'))])
            self.assertEqual(span[2],[bytes.fromhex('0000000000000013' if name=='smtp' else '0000000000000001')])
            self.assertEqual(struct.unpack('<I',span[16][0])[0],1)
            self.assertEqual(struct.unpack('<Q',span[7][0])[0],1_800_000_000_000_000_000)
            self.assertEqual(span[6],[3 if name=='smtp' else 1 if name=='adversarial' else 4])
            self.assertIn(email_privacy.SENTINEL.encode(),body)
            self.assertEqual(len(span[11]),1);self.assertNotIn(13,span)
        metric=email_privacy.metric_payload('protobuf',1_800_000_000_000_000_001,6)
        scope=fields(fields(fields(metric)[1][0])[2][0]);counter,hist=map(fields,scope[2])
        self.assertEqual(counter[1],[b'inside.email.operations']);self.assertEqual(hist[1],[b'inside.email.duration'])
        point=fields(fields(counter[7][0])[1][0]);bucket=fields(fields(hist[9][0])[1][0])
        self.assertEqual(struct.unpack('<q',point[6][0])[0],6)
        self.assertEqual(struct.unpack('<Q',bucket[4][0])[0],6)
        self.assertEqual(struct.unpack('<d',bucket[5][0])[0],1.5)
        self.assertEqual(struct.unpack('<QQ',bucket[6][0]),(6,0));self.assertEqual(struct.unpack('<d',bucket[7][0]),(1.0,))
        self.assertEqual(fields(counter[7][0])[2],[2]);self.assertEqual(fields(counter[7][0])[3],[1])

import copy
import json

# Independent worked normalized rows, not produced by the ingress encoder or validator.
KNOWN=(('publish','emailMaterial',4),('receive','emailMaterial',5),('dispatch','emailMaterial',1),
 ('publish','emailSubscription',4),('receive','emailSubscription',5),('dispatch','emailSubscription',1),
 ('publish','emailResult',4),('receive','emailResult',5),('project','emailResult',1))
PARENTS=('bbbbbbbbbbbbbbbb','0000000000000001','0000000000000001','0000000000000002',
 '0000000000000003','0000000000000004','0000000000000005','0000000000000006','0000000000000007',
 '0000000000000008','0000000000000009','000000000000000a','000000000000000b','000000000000000c',
 '000000000000000d','000000000000000e','000000000000000f','0000000000000010')
NOW=1_800_000_000_000_000_000

def storage_row(index,name,attrs,kind,status,parent,transport='json',adversarial=False):
    return {'_time':'2027-01-15T08:00:00Z','_msg':'-',
      '_stream_id':'0'*16+f'{index if adversarial else 1+int(index/3):032x}',
      '_stream':'{name='+json.dumps(name)+',resource_attr:service.name="platform-notifications-worker"}',
      'trace_id':'d'*31+({'json':'9','protobuf':'a'} if adversarial else {'json':'7','protobuf':'8'})[transport],
      'span_id':f'{index:016x}','parent_span_id':parent,'name':name,'kind':str(kind),'status_code':str(status),'flags':'1',
      'start_time_unix_nano':str(NOW),'end_time_unix_nano':str(NOW+1_000_000),'duration':'1000000',
      'scope_name':'inside-collector','resource_attr:service.name':'platform-notifications-worker',
      'resource_attr:deployment.environment.name':'isolated-pilot','resource_attr:service.version':('a' if transport=='json' else 'b')*40,
      **{'span_attr:'+k:v for k,v in attrs.items()}}

def known_rows(transport='json'):
    result=[]
    streams={}
    for i,(op,lane,kind) in enumerate(KNOWN):
        dest='inside.results.email.v1' if lane=='emailResult' else 'inside.notifications.email.v1'
        for failed in (False,True):
            index=2*i+1+int(failed);name=op+' '+dest
            attrs={'messaging.system':'rabbitmq','messaging.operation.name':op,'messaging.destination.name':dest,'email.lane':lane}
            if failed:attrs['error.type']='email_operation_failed'
            row=storage_row(index,name,attrs,kind,2 if failed else 0,PARENTS[index-1],transport)
            streams.setdefault(name,f'{len(streams)+1:032x}');row['_stream_id']='0'*16+streams[name];result.append(row)
    for i,out in enumerate(('sent','not_sent','failed','unknown')):
        row=storage_row(19+i,'smtp send',{'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':out},3,0 if out=='sent' else 2,'0000000000000005',transport)
        row['_stream_id']='0'*16+'a'*32;result.append(row)
    return result

def raw_rows(rows):return '\n'.join(json.dumps(row) for row in rows)

class EmailStoredTraces(unittest.TestCase):
    def test_whole_stored_native_rows_and_every_causal_edge(self):
        verdict=email_privacy.stored_traces(raw_rows(known_rows()),'json',NOW)
        self.assertEqual(verdict,{'transport':'json','partition':'known','stored_spans':22,'internal_edges_preserved':21,'incoming_anchor_preserved':1,'privacy':'passed'})
        self.assertIsNone(email_privacy.stored_traces(raw_rows(known_rows()[:1]),'json',NOW))

class EmailStoredNegatives(unittest.TestCase):
    def test_hostile_partial_full_rows_never_become_pending(self):
        variants=[]
        for key,value in (('trace_id','f'*32),('span_id','0000000000000000'),('parent_span_id','0000000000000002'),
          ('kind','3'),('status_code','2'),('flags','0'),('duration','1000001'),('start_time_unix_nano',str(NOW+1)),
          ('_time','2027-01-15T08:00:00.001Z'),('_stream_id','1'*48),('_stream','{name="private"}'),
          ('_msg','PRIVATE_BODY'),('status_message','private'),('scope_version','private'),('dropped_links_count','1'),
          ('resource_attr:service.version','c'*40),('resource_attr:user.email','private@example.test'),
          ('span_attr:messaging.message.id','11111111-2222-4333-8444-555555555555'),('link:link_span_id:0','b'*16),
          ('event:event_name:0','private'),('scope_attr:secret','private'),('unknown','safe-looking')):
            row=known_rows()[0];row[key]=value;variants.append(raw_rows([row]))
        variants += [raw_rows(known_rows()[:1]*2),raw_rows(known_rows())+'\n'+raw_rows(known_rows()[:1]),
          raw_rows(known_rows()[:1]).replace('"flags": "1"','"flags":"1","flags":"1"'),
          raw_rows(known_rows()[:1]).replace('"flags": "1"','"flags":true'),
          raw_rows(known_rows()[:1]).replace('"_msg": "-"','"_msg": "'+email_privacy.SENTINEL+'"'),
          raw_rows(known_rows()[:1])[:-1], 'x'*1_048_577]
        for raw in variants:
            with self.subTest(length=len(raw)):
                with self.assertRaisesRegex(RuntimeError,'^email full-storage contract failed; raw response withheld$'):
                    email_privacy.stored_traces(raw,'json',NOW)
    def test_deep_nested_untrusted_json_has_closed_refusal(self):
        with self.assertRaisesRegex(RuntimeError,'^email full-storage contract failed; raw response withheld$'):
            email_privacy.stored_traces('{"private":'+('['*1200)+'0'+(']'*1200)+'}','json',NOW)
    def test_adversarial_literals_include_exact_missing_lane_generic_snapshot(self):
        for transport in ('json','protobuf'):
            rows=adversarial_rows(transport)
            self.assertEqual(email_privacy.stored_traces(raw_rows(rows),transport,NOW,adversarial=True)['stored_spans'],8)
            for key in ('span_attr:messaging.message.id','span_attr:pgboss.job.retry_count','span_attr:messaging.batch.message_count'):
                bad=copy.deepcopy(rows[5]);bad[key]='private'
                with self.assertRaises(RuntimeError):email_privacy.stored_traces(raw_rows([bad]),transport,NOW,adversarial=True)
    def test_optional_zero_metadata_and_start_timestamp_for_both_ingresses(self):
        for transport in ('json','protobuf'):
            rows=known_rows(transport)
            for row in rows:
                row.update({'dropped_attributes_count':'0','dropped_events_count':'0','dropped_links_count':'0','scope_version':'','status_message':'','trace_state':''})
            self.assertEqual(email_privacy.stored_traces(raw_rows(rows),transport,NOW)['stored_spans'],22)

METRIC_PAIRS=(('publishMaterial','completed'),('publishMaterial','failed'),('receiveMaterial','completed'),('receiveMaterial','failed'),('dispatchMaterial','completed'),('dispatchMaterial','failed'),('publishSubscription','completed'),('publishSubscription','failed'),('receiveSubscription','completed'),('receiveSubscription','failed'),('dispatchSubscription','completed'),('dispatchSubscription','failed'),('publishResult','completed'),('publishResult','failed'),('receiveResult','completed'),('receiveResult','failed'),('projectResult','completed'),('projectResult','failed'),('smtpSend','sent'),('smtpSend','not_sent'),('smtpSend','failed'),('smtpSend','unknown'))
def metric_response(stages):
    rows=[]
    for transport,release in (('json','a'*40),('protobuf','b'*40)):
        for op,out in METRIC_PAIRS+((('_OTHER','_OTHER'),) if stages[transport] else ()):
            marker=stages[transport] if op=='_OTHER' else 1
            for name,le in (('inside.email.operations',None),('inside.email.duration_count',None),('inside.email.duration_sum',None),('inside.email.duration_bucket','1'),('inside.email.duration_bucket','+Inf')):
                labels={'__name__':name,'service.name':'platform-notifications-worker','deployment.environment.name':'isolated-pilot','service.version':release,'scope.name':'inside-collector','operation':op,'outcome':out}
                if le is not None:labels['le']=le
                rows.append({'metric':labels,'value':[1_800_000_000,str(marker*.25 if name.endswith('_sum') else marker)]})
    return (200,json.dumps({'status':'success','data':{'resultType':'vector','result':rows}}))

class EmailMetrics(unittest.TestCase):
    def test_baseline_and_sequential_collision_free_stages(self):
        stages={'json':0,'protobuf':0}
        self.assertEqual(email_privacy.stored_metrics(metric_response(stages),stages),{'stored_series':220,'metric_labelsets':44,'fallback_stages':stages,'privacy':'passed'})
        for transport in ('json','protobuf'):
            for n in range(1,7):
                stages[transport]=n
                verdict=email_privacy.stored_metrics(metric_response(stages),stages)
                self.assertEqual(verdict['stored_series'],225 if stages['protobuf']==0 else 230)
                self.assertEqual(verdict['fallback_stages'],stages)

class EmailMetricSafety(unittest.TestCase):
    def test_quantization_collisions_are_refused_without_future_dating(self):
        self.assertEqual(email_privacy.metric_timestamp(NOW+1_000_000,NOW),NOW+1_000_000)
        for value in (NOW,NOW+1,NOW+999_999,NOW-1):
            with self.assertRaisesRegex(RuntimeError,'^email metric timestamp precision contract failed$'):
                email_privacy.metric_timestamp(value,NOW)
    def test_full_vector_private_or_unknown_fields_fail_even_when_partial(self):
        stages={'json':6,'protobuf':6};base=json.loads(metric_response(stages)[1])
        variants=[]
        for key,value in (('__name__','inside.email.private'),('operation','dispatchResult'),('outcome','sent'),('user.email','private'),('scope.version','private'),('service.version','f'*40),('service.name','platform-api'),('le','+Inf')):
            row=copy.deepcopy(base['data']['result'][0]);row['metric'][key]=value;variants.append(row)
        for value in ('NaN','Infinity','-1','1e0','0','1.5'):
            row=copy.deepcopy(base['data']['result'][0]);row['value'][1]=value;variants.append(row)
        for key,value in (('private','secret'),('values',[])):
            row=copy.deepcopy(base['data']['result'][0]);row[key]=value;variants.append(row)
        for row in variants:
            payload={'status':'success','data':{'resultType':'vector','result':[row]}}
            with self.assertRaisesRegex(RuntimeError,'^email metric contract failed; raw response withheld$'):
                email_privacy.stored_metrics((200,json.dumps(payload)),stages)
        for text in (json.dumps(base).replace('"status": "success"','"status":"success","private":"secret"'),
          json.dumps(base).replace('"operation": "publishMaterial"','"operation":"publishMaterial","operation":"publishMaterial"',1),
          json.dumps(base).replace('"value": [1800000000,','"value": [true,',1),
          json.dumps(base).replace('"scope.name": "inside-collector"','"scope.name": "'+email_privacy.SENTINEL+'"',1),
          json.dumps(base)[:-1], 'x'*1_048_577):
            with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,text),stages)
    def test_duplicates_limits_stale_and_future_marker(self):
        stages={'json':6,'protobuf':6};base=json.loads(metric_response(stages)[1]);rows=base['data']['result']
        for altered in (rows+rows[:1],rows*5):
            body={**base,'data':{**base['data'],'result':altered}}
            with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,json.dumps(body)),stages)
        self.assertIsNone(email_privacy.stored_metrics(metric_response({'json':5,'protobuf':6}),stages))
        body=json.loads(metric_response(stages)[1]);point=next(r for r in body['data']['result'] if r['metric']['operation']=='_OTHER');point['value'][1]='7'
        with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,json.dumps(body)),stages)
        self.assertIsNone(email_privacy.stored_metrics((200,json.dumps({**base,'data':{**base['data'],'result':rows[:-1]}})),stages))
    def test_composition_uses_both_unchanged_owners_on_same_full_vector(self):
        from test_dependency_privacy import metric_rows
        import dependency_privacy
        stages={'json':6,'protobuf':6};body=json.loads(metric_response(stages)[1]);legacy=metric_rows();body['data']['result']+=legacy
        response=(200,json.dumps(body))
        verdict=email_privacy.stored_metric_corpus(response,stages)
        self.assertEqual(verdict['legacy'],dependency_privacy.stored_metrics(response));self.assertEqual(verdict['email']['stored_series'],230)
        legacy[-1]['metric']['private']='late-secret';body['data']['result']=json.loads(metric_response(stages)[1])['data']['result']+legacy
        with self.assertRaises(RuntimeError):email_privacy.stored_metric_corpus((200,json.dumps(body)),stages)

ADVERSARIAL_EXPECTED=[
  {'messaging.system':'rabbitmq','messaging.destination.name':'inside.results.email.v1','messaging.operation.name':'_OTHER','email.lane':'emailResult'},
  {'messaging.system':'rabbitmq','messaging.destination.name':'inside.notifications.email.v1','messaging.operation.name':'_OTHER','email.lane':'emailMaterial'},
  {'messaging.system':'rabbitmq','messaging.destination.name':'_OTHER','messaging.operation.name':'publish','email.lane':'emailMaterial'},
  {'messaging.system':'rabbitmq','messaging.destination.name':'_OTHER','messaging.operation.name':'receive','email.lane':'emailSubscription'},
  {'messaging.system':'rabbitmq','messaging.destination.name':'_OTHER','messaging.operation.name':'publish','email.lane':'_OTHER'},
  {'messaging.system':'rabbitmq','messaging.destination.name':'_OTHER','messaging.operation.name':'publish','messaging.message.id':'11111111-2222-4333-8444-555555555555','pgboss.job.retry_count':'7','messaging.batch.message_count':'2'},
  {'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':'_OTHER'},
  {'dependency.name':'smtp','dependency.operation':'_OTHER','dependency.outcome':'unknown'}]

def adversarial_rows(transport):
    rows=[];streams={}
    for i,a in enumerate(ADVERSARIAL_EXPECTED):
        name=a['dependency.name']+' '+a['dependency.operation'] if i>=6 else a['messaging.operation.name']+' '+a['messaging.destination.name']
        row=storage_row(i+1,name,a,3 if i>=6 else 1,2,'b'*16,transport,True)
        streams.setdefault(name,f'{len(streams)+1:032x}');row['_stream_id']='0'*16+streams[name];rows.append(row)
    return rows

class EmailPilot(unittest.TestCase):
    def test_public_finite_runner_preserves_whole_raw_vector_stage_markers_and_fixed_queries(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        from test_dependency_privacy import metric_rows
        import pilot
        state={'json':0,'protobuf':0};metric_posts=[];trace_posts=[];reads=[]
        def http(path,*,token=None,body=None,method='GET',port=18427):
            if method=='POST':
                self.assertEqual(port,14318)
                if path=='/v1/traces':trace_posts.append(body)
                else:
                    self.assertEqual(path,'/v1/metrics');index=len(metric_posts)
                    transport='json' if index==0 or 2<=index<8 else 'protobuf'
                    stage=0 if index<2 else index-1 if index<8 else index-7
                    if isinstance(body,dict):
                        point=body['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['sum']['dataPoints'][0]
                        self.assertEqual(point['asInt'],str(stage or 1))
                    else:
                        group=fields(fields(fields(body)[1][0])[2][0]);metric=fields(group[2][0]);point=fields(fields(metric[7][0])[1][0])
                        self.assertEqual(int.from_bytes(point[6][0],'little',signed=True),stage or 1)
                    metric_posts.append((transport,stage));state[transport]=stage
                return 200,''
            self.assertIn('%7B__name__%3D~%22.%2B%22%7D',path)
            data=json.loads(metric_response(state)[1]);data['data']['result']+=metric_rows();return 200,json.dumps(data)
        def trace_read(compose,fixture):
            reads.append(fixture);transport='protobuf' if fixture.endswith('protobuf') else 'json'
            return raw_rows(adversarial_rows(transport) if 'adversarial' in fixture else known_rows(transport))
        clock=[NOW,NOW,NOW,NOW]+[NOW+i*1_000_000 for i in range(1,13)]
        with tempfile.TemporaryDirectory() as tmp,patch('pilot.verify_trace_store_logging'),patch('pilot.assert_docker_identity'),patch('pilot.request',side_effect=http),patch('pilot.fixture_trace_rows',side_effect=trace_read),patch('pilot.time.time_ns',side_effect=clock):
            pilot.email_catalog_corpus('PRIVATE_TOKEN',Path(tmp),[])
            proof=json.loads((Path(tmp)/'email-collector.json').read_text())
        self.assertEqual(proof['outcome'],'passed');self.assertEqual(proof['uploads'],20)
        self.assertEqual(len(trace_posts),6);self.assertEqual(len(metric_posts),14)
        self.assertEqual(reads,['email-known-json','email-adversarial-json','email-known-protobuf','email-adversarial-protobuf'])
        self.assertEqual(len(proof['metric_checkpoints']),13);self.assertEqual(proof['metric_checkpoints'][-1]['email']['stored_series'],230)
        self.assertNotIn('PRIVATE_TOKEN',json.dumps(proof));self.assertNotIn(email_privacy.SENTINEL,json.dumps(proof))

class EmailCorpusIntegrationGuards(unittest.TestCase):
    def test_all_actual_bodies_bounded_without_borrowing_legacy_payload_space(self):
        for transport in ('json','protobuf'):
            for _,body in email_privacy.trace_payloads(transport,NOW):
                self.assertLessEqual(len(body) if type(body) is bytes else len(json.dumps(body).encode()),65536 if transport=='protobuf' else 262144)
            for stage in range(7):
                body=email_privacy.metric_payload(transport,NOW,stage)
                self.assertLessEqual(len(body) if type(body) is bytes else len(json.dumps(body).encode()),65536 if transport=='protobuf' else 262144)
        self.assertEqual(email_privacy.PAIRS,METRIC_PAIRS)
    def test_owned_query_only_fixed_email_ids_and_one_extra_row(self):
        import pilot
        from unittest.mock import patch
        compose=['docker','compose','-p','inside-observability-pilot-123456abcdef','-f','/owned/compose.json']
        identity={'platform':'linux','endpoint':'unix:///owned/docker.sock'};queries=[]
        def command(args,*,timeout):
            self.assertGreater(timeout,0);self.assertLessEqual(timeout,10)
            if args[1]=='compose':return 'c'*64
            if args[1]=='inspect':return compose[3]+'|gateway|true'
            self.assertEqual(args[1],'exec');query=args[-1];queries.append(query)
            self.assertNotIn('fields ',query);self.assertNotIn('delete ',query);self.assertIn('head -c 1048577',query)
            return ''
        with patch.object(pilot,'FROZEN_DOCKER_ENDPOINT',identity['endpoint']),patch.object(pilot,'FROZEN_DOCKER_IDENTITY',identity),patch('pilot.daemon.identify',return_value=identity),patch('pilot.command',side_effect=command):
            for name in ('email-known-json','email-known-protobuf','email-adversarial-json','email-adversarial-protobuf'):pilot.fixture_trace_rows(compose,name)
            with self.assertRaises(pilot.LinkStorageOwnershipError):pilot.fixture_trace_rows(compose,'email-private-query')
        self.assertEqual(len(queries),4)
        for query,tail,limit in zip(queries,('7','8','9','a'),(23,23,9,9)):
            self.assertIn('d'*31+tail,query);self.assertIn('limit='+str(limit),query)
    def test_ingest_refusal_writes_only_closed_stage_no_private_error_or_further_posts(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import pilot
        for boundary in ('logging','upload'):
            def refused(*args,**kwargs):raise RuntimeError('PRIVATE_EMAIL_TOKEN_BODY_PROVIDER_REPLY')
            with tempfile.TemporaryDirectory() as tmp,patch('pilot.verify_trace_store_logging',side_effect=refused if boundary=='logging' else None),patch('pilot.assert_docker_identity'),patch('pilot.request',side_effect=refused) as http,patch('pilot.time.time_ns',return_value=NOW):
                with self.assertRaisesRegex(RuntimeError,'^email collector proof failed; raw diagnostics withheld$'):pilot.email_catalog_corpus('PRIVATE_TOKEN',Path(tmp),[])
                proof=json.loads((Path(tmp)/'email-collector.json').read_text())
                self.assertEqual(proof['outcome'],'failed');self.assertEqual(proof['uploads'],0)
                self.assertEqual(http.call_count,0 if boundary=='logging' else 1)
                self.assertNotIn('PRIVATE_',json.dumps(proof))

class EmailWireEquivalence(unittest.TestCase):
    def test_independent_decoder_compares_all_native_ids_attributes_parents_and_metric_points(self):
        import struct
        def attrs(wire_values):
            result=[]
            for raw in wire_values:
                attribute=fields(raw);value=fields(attribute[2][0]);self.assertEqual(set(attribute),{1,2});self.assertEqual(len(value),1)
                if 1 in value:decoded={'stringValue':value[1][0].decode()}
                elif 2 in value:decoded={'boolValue':bool(value[2][0])}
                else:decoded={'intValue':str(value[3][0])}
                result.append({'key':attribute[1][0].decode(),'value':decoded})
            return result
        required_private={'user.email','email','recipient','address','subject','email.subject','body','email.body','authorization','credentials','password','smtp.password','Message-ID','smtp.message_id','provider.reply','provider.request_id','operationId','attemptRef','deliveryRef','commandRevision','url.full','exception.message','exception.stacktrace','db.statement','db.query.text','db.query.parameters','db.connection_string'}
        json_parts=email_privacy.trace_payloads('json',NOW);pb_parts=email_privacy.trace_payloads('protobuf',NOW)
        for (partition,body),(_,wire) in zip(json_parts,pb_parts):
            group=body['resourceSpans'][0]['scopeSpans'][0];root=fields(fields(wire)[1][0]);wire_scope=fields(root[2][0]);wire_spans=wire_scope[2]
            self.assertEqual(len(wire_spans),len(group['spans']))
            resource=attrs(fields(root[1][0])[1]);self.assertEqual(resource[0]['value'],{'stringValue':'platform-notifications-worker'});self.assertEqual(resource[2]['value'],{'stringValue':'b'*40})
            self.assertEqual(attrs(fields(wire_scope[1][0])[3]),group['scope']['attributes'])
            for source,encoded in zip(group['spans'],wire_spans):
                span=fields(encoded)
                self.assertEqual(span[2],[bytes.fromhex(source['spanId'])]);self.assertEqual(span[4],[bytes.fromhex(source['parentSpanId'])])
                self.assertEqual(span[1],[bytes.fromhex('d'*31+('a' if partition=='adversarial' else '8'))])
                self.assertEqual(span[6],[source['kind']]);self.assertEqual(fields(span[15][0])[3],[source['status']['code']])
                self.assertEqual(attrs(span[9]),source['attributes']);self.assertTrue(required_private<={a['key'] for a in source['attributes']})
        for stage in range(7):
            source=email_privacy.metric_payload('json',NOW,stage)['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
            wire=email_privacy.metric_payload('protobuf',NOW,stage);metrics=fields(fields(fields(wire)[1][0])[2][0])[2]
            for index,metric in enumerate(metrics):
                data=fields(fields(metric)[7 if index==0 else 9][0]);self.assertEqual(data[2],[2])
                if index==0:self.assertEqual(data[3],[1])
                points=source[index]['sum' if index==0 else 'histogram']['dataPoints'];self.assertEqual(len(data[1]),22 if stage==0 else 1)
                for encoded,point in zip(data[1],points):
                    decoded=fields(encoded);self.assertEqual(attrs(decoded[7 if index==0 else 9]),point['attributes'])
                    self.assertEqual(struct.unpack('<Q',decoded[3][0])[0],NOW)
                    self.assertEqual(struct.unpack('<q' if index==0 else '<Q',decoded[6 if index==0 else 4][0])[0],stage or 1)

class EmailPartitionIdentity(unittest.TestCase):
    def test_all_existing_fixed_partitions_have_disjoint_literal_native_ids(self):
        import re
        import dependency_privacy
        import link_privacy
        import notification_privacy
        ids=list(email_privacy.TRACE_IDS.values())+list(email_privacy.ADVERSARIAL_IDS.values())+list(dependency_privacy.TRACE_IDS.values())+list(dependency_privacy.COMMUNICATIONS_TRACE_IDS.values())+list(link_privacy.TRACE_IDS.values())+list(notification_privacy.TRACE_IDS.values())
        self.assertTrue(all(re.fullmatch('[0-9a-f]{32}',v) for v in ids));self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual(set(email_privacy.TRACE_IDS.values())|set(email_privacy.ADVERSARIAL_IDS.values()),{'d'*31+'7','d'*31+'8','d'*31+'9','d'*31+'a'})
    def test_contradictory_stream_hash_identity_is_not_silently_projected(self):
        for same_name in (True,False):
            rows=known_rows()[:2] if same_name else [known_rows()[0],known_rows()[2]]
            rows[1]['_stream_id']='0'*16+'f'*32 if same_name else rows[0]['_stream_id']
            with self.assertRaises(RuntimeError):email_privacy.stored_traces(raw_rows(rows),'json',NOW)

class EmailAdversarialIngress(unittest.TestCase):
    def test_six_metric_challenges_are_literal_and_not_simultaneous_aliases(self):
        expected=[
          [{'key':'operation','value':{'stringValue':email_privacy.SENTINEL}},{'key':'outcome','value':{'stringValue':email_privacy.SENTINEL}}],[],
          [{'key':'operation','value':{'boolValue':True}},{'key':'outcome','value':{'intValue':'42'}}],
          [{'key':'operation','value':{'stringValue':'publishMaterial'}},{'key':'outcome','value':{'stringValue':'sent'}}],
          [{'key':'operation','value':{'stringValue':'smtpSend'}},{'key':'outcome','value':{'stringValue':'completed'}}],
          [{'key':'operation','value':{'stringValue':'dispatchResult'}},{'key':'outcome','value':{'stringValue':'completed'}}]]
        for stage,attrs in enumerate(expected,1):
            metrics=email_privacy.metric_payload('json',NOW,stage)['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
            for metric in metrics:
                points=metric['sum' if 'sum' in metric else 'histogram']['dataPoints'];self.assertEqual(len(points),1)
                self.assertEqual([a for a in points[0]['attributes'] if a['key'] in ('operation','outcome')],attrs)
    def test_escaped_late_sentinel_and_unknown_native_flags_cannot_be_pending(self):
        escaped=''.join('\\u%04x'%ord(c) for c in email_privacy.SENTINEL)
        row=known_rows()[0];row['status_message']=email_privacy.SENTINEL
        raw=raw_rows([row]).replace(email_privacy.SENTINEL,escaped)
        with self.assertRaises(RuntimeError):email_privacy.stored_traces(raw,'json',NOW)
        body=metric_response({'json':0,'protobuf':0})[1].replace('"inside-collector"','"'+escaped+'"',1)
        with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,body),{'json':0,'protobuf':0})
        for value in ('2','257','-1','4294967296'):
            row=known_rows()[0];row['flags']=value
            with self.assertRaises(RuntimeError):email_privacy.stored_traces(raw_rows([row]),'json',NOW)

class EmailPartialOrdering(unittest.TestCase):
    def test_late_hostile_partial_rows_never_hide_behind_pending(self):
        rows=known_rows()[:2];rows[1]['scope_attr:email']='ordinary@example.invalid'
        with self.assertRaises(RuntimeError):email_privacy.stored_traces(raw_rows(rows),'json',NOW)
        stages={'json':0,'protobuf':0};body=json.loads(metric_response(stages)[1]);rows=body['data']['result'][:2]
        rows[1]['metric']['recipient']='ordinary@example.invalid';body['data']['result']=rows
        with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,json.dumps(body)),stages)
    def test_only_native_fixed_scope_version_fallback_is_allowed(self):
        stages={'json':0,'protobuf':0};body=json.loads(metric_response(stages)[1])
        for row in body['data']['result']:row['metric']['scope.version']='unknown'
        self.assertEqual(email_privacy.stored_metrics((200,json.dumps(body)),stages)['stored_series'],220)
        body['data']['result'][0]['metric']['scope.schema_url']='unknown'
        with self.assertRaises(RuntimeError):email_privacy.stored_metrics((200,json.dumps(body)),stages)
