"""Independent worked stored rows/vectors, without a sanitizer or native storage execution."""
import copy
import json
import unittest
import telegram_runtime_oracle as oracle

NOW = 1790000000000000000


def rows(transport='json'):
    # Literal expected protocol graph. No inputs are taken from canary or oracle definitions.
    specs = [('waitlist receipt','1','0','bbbbbbbbbbbbbbbb', {'telegram.operation':'receipt','telegram.outcome':'completed'},1),
             ('platform waitlist.confirm','3','0','0000000000000001', {'telegram.operation':'authorization','telegram.outcome':'accepted','http.response.status_code':'200'},2),
             ('waitlist attempt','1','0','0000000000000001', {'telegram.operation':'attempt','telegram.outcome':'completed'},3),
             ('telegram sendMessage','3','0','0000000000000003', {'telegram.operation':'sendMessage','telegram.outcome':'delivered'},4),
             ('POST /integrations/platform/v1/communications','2','0',None, {'http.request.method':'POST','http.route':'/integrations/platform/v1/communications','http.request.outcome':'completed','http.response.status_code':'200'},5),
             ('telegram _OTHER','1','2','0000000000000001', {'telegram.operation':'_OTHER','telegram.outcome':'_OTHER'},6),
             ('telegram _OTHER','1','2','0000000000000001', {'telegram.operation':'_OTHER','telegram.outcome':'_OTHER'},6),
             ('platform waitlist.confirm','3','2','0000000000000001', {'telegram.operation':'authorization','telegram.outcome':'unavailable'},2),
             ('telegram sendMessage','3','2','0000000000000003', {'telegram.operation':'sendMessage','telegram.outcome':'transport_unknown'},4),
             ('_OTHER _OTHER','2','2',None, {'http.request.method':'_OTHER','http.route':'_OTHER','http.request.outcome':'_OTHER'},7)]
    result = []
    for index,(name,kind,status,parent,attrs,stream) in enumerate(specs):
        suffix = ('83' if index == 4 else '85') if transport == 'json' else ('84' if index == 4 else '86')
        trace = 'f'*30+suffix if index in (4,9) else 'e'*30+('81' if transport == 'json' else '82')
        row = {'trace_id':trace,'span_id':f'{index+1:016x}','name':name,'kind':kind,'status_code':status,
               'resource_attr:service.name':'inside-telegram','resource_attr:deployment.environment.name':'isolated-pilot',
               'resource_attr:service.version':'0.1566.1' if transport == 'json' else '0.1566.2','scope_name':'inside-collector',
               'start_time_unix_nano':str(NOW),'end_time_unix_nano':str(NOW+1_000_000),'duration':'1000000',
               '_time':'2026-09-21T14:13:20Z','_stream_id':'0'*16+f'{stream:032x}',
               '_msg':'-','_stream':'{name='+json.dumps(name)+',resource_attr:service.name="inside-telegram"}',
               **{'span_attr:'+key:value for key,value in attrs.items()}}
        if parent is not None: row['parent_span_id'] = parent
        result.append(row)
    return result


def vector(transport='json'):
    points = []
    common = {'service.name':'inside-telegram','deployment.environment.name':'isolated-pilot','service.version':'0.1566.1' if transport == 'json' else '0.1566.2','scope.name':'inside-collector'}
    def add(name,labels,value): points.append({'metric':{'__name__':name,**common,**labels},'value':[1790000001,str(value)]})
    operations = [('receipt','completed'),('authorization','accepted'),('attempt','completed'),('sendMessage','delivered'),('_OTHER','_OTHER'),('_OTHER','completed'),('receipt','_OTHER')]
    http = [('POST','/integrations/platform/v1/communications','completed'),('_OTHER','_OTHER','_OTHER')]
    for prefix,counter,labels in ([('inside.telegram.duration','inside.telegram.operations',{'operation':op,'outcome':out}) for op,out in operations]+[('http.server.request.duration','http.server.request.count',{'http.request.method':method,'http.route':route,'http.request.outcome':outcome}) for method,route,outcome in http]):
        for name,value in [(counter,1),(prefix+'_count',1),(prefix+'_sum','0.25')]: add(name,labels,value)
        for bound in ('1','+Inf'): add(prefix+'_bucket',{**labels,'le':bound},1)
    for name,value in [('http.server.active_requests',0),('telemetry.trace.dropped',0),('telemetry.trace.export.failures',0),('telemetry.metric.export.failures',0),('telemetry.trace.sampling.ratio',1)]: add(name,{},value)
    return {'status':'success','stats':{'seriesFetched':'50','executionTimeMsec':0},'data':{'resultType':'vector','result':points}}


class TelegramRuntimeStoredOracle(unittest.TestCase):
    def test_complete_json_and_protobuf_rows_keep_siblings_and_independent_server_roots(self):
        for transport in ('json','protobuf'):
            self.assertEqual(oracle.traces('\n'.join(json.dumps(row) for row in rows(transport)),transport,NOW), {'transport':transport,'stored_spans':10,'privacy':'passed','causality':'passed'})
            self.assertEqual(oracle.metrics(json.dumps(vector(transport)),transport), {'transport':transport,'metric_series':50,'privacy':'passed','aggregation':'passed'})

    def test_partial_rows_are_pending_only_after_every_observed_field_is_checked(self):
        self.assertIsNone(oracle.traces(json.dumps(rows()[0]),'json',NOW))
        changed = rows()[:1]; changed[0]['provider.response'] = 'non-sentinel-private'
        with self.assertRaises(RuntimeError): oracle.traces(json.dumps(changed[0]),'json',NOW)
        changed = vector(); changed['data']['result'].pop()
        self.assertIsNone(oracle.metrics(json.dumps(changed),'json'))
        changed['data']['result'].append({'metric':{'__name__':'private'},'value':[1790000001,'1']})
        with self.assertRaises(RuntimeError): oracle.metrics(json.dumps(changed),'json')

    def test_every_trace_metadata_family_and_lineage_is_closed_before_projection(self):
        for key,value in [('unknown_metadata','private'),('span_attr:chatId','private'),('scope_attr:token','private'),('resource_attr:accountRef','private'),('event:0:name','private'),('link:link_trace_id:0','a'*32),('status_message','private'),('trace_state','private'),('flags','1'),('dropped_attributes_count','1'),('_time','2026-09-21T14:13:20.001Z'),('_stream','private'),('parent_span_id','0000000000000002'),('trace_id','a'*32),('span_id','f'*16)]:
            with self.subTest(key=key):
                changed = rows(); changed[2][key]=value
                with self.assertRaisesRegex(RuntimeError,'^Telegram runtime stored trace contract failed$'): oracle.traces('\n'.join(json.dumps(row) for row in changed),'json',NOW)
        changed = rows(); changed.append(copy.deepcopy(changed[0]))
        with self.assertRaises(RuntimeError): oracle.traces('\n'.join(json.dumps(row) for row in changed),'json',NOW)
        raw = json.dumps(rows()[0]).replace('"kind": "1"','"kind":"private","kind":"1"')
        with self.assertRaises(RuntimeError): oracle.traces(raw,'json',NOW)

    def test_complete_metric_vector_rejects_unknown_duplicate_private_and_invalid_numeric_samples(self):
        for case in ('duplicate','scope_alias','label','status','family','timestamp','nan','count','bucket','sum','native_stats','top_level'):
            with self.subTest(case=case):
                body=vector(); points=body['data']['result']
                if case == 'duplicate': points.append(copy.deepcopy(points[0]))
                elif case == 'scope_alias':
                    row=copy.deepcopy(points[0]); row['metric']['scope.version']='unknown'; points.append(row)
                elif case == 'label': points[-1]['metric']['chatId']='private'
                elif case == 'status': points[35]['metric']['http.response.status_code']='200'
                elif case == 'family': points[0]['metric']['__name__']='inside.dependency.operations'
                elif case == 'timestamp': points[0]['value'][0]=False
                elif case == 'nan': points[0]['value'][1]='NaN'
                elif case == 'count': points[1]['value'][1]='2'
                elif case == 'bucket': points[3]['metric']['le']='0.5'
                elif case == 'sum': points[2]['value'][1]='0.5'
                elif case == 'native_stats': body['stats']['seriesFetched']=50
                else: body['private']='raw'
                with self.assertRaisesRegex(RuntimeError,'^Telegram runtime stored metric contract failed$'): oracle.metrics(json.dumps(body),'json')
        raw=json.dumps(vector()).replace('"operation": "receipt"','"operation":"private","operation":"receipt"',1)
        with self.assertRaises(RuntimeError): oracle.metrics(raw,'json')

if __name__ == '__main__': unittest.main()
