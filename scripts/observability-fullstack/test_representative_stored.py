"""SOURCE-MODEL exact D1 shapes. Typed rows are not native receipts."""
import copy
import json
import unittest

import representative_stored as stored


class Stored(unittest.TestCase):
    def span(self):
        return {'name':'GET /pilot','trace_id':'a'*32,'span_id':'b'*16,'parent_span_id':'',
            'start_ns':'1800000000000000000','duration_nano':'1000','flags':257,'kind':2,'status_code':0,
            'resources_string':{'service.name':'platform-api','service.version':'c'*40,'deployment.environment.name':'test'},
            'resource':{'service.name':'platform-api','service.version':'c'*40,'deployment.environment.name':'test'},
            'scope':{'name':'inside-collector','version':'','attributes':{}},
            'attributes_string':{'http.request.method':'GET','http.route':'/pilot','http.request.outcome':'completed'},
            'attributes_number':{'http.response.status_code':200},'attributes_bool':{},
            'attributes':{'http.request.method':'GET','http.route':'/pilot','http.request.outcome':'completed','http.response.status_code':200},
            'attributes_promoted':{},'events':[],'links':'[]','trace_state':'','status_message':'','status_code_string':'Unset'}
    def test_native_facts_keep_actual_flags_times_and_unknown_drop_link_metadata(self):
        facts=stored.span_facts([self.span()],trace_id='a'*32,release='c'*40)
        self.assertEqual(facts[0]['start'],1800000000000000000)
        self.assertEqual(facts[0]['end'],1800000000000001000)
        self.assertEqual(facts[0]['flags'],257)
        self.assertIsNone(facts[0]['extras']['dropped_links_count'])
        self.assertIsNone(facts[0]['extras']['link_metadata'])
        self.assertFalse(any(k.startswith('_stream') or k in ('_time','_msg') for k in facts[0]))
    def test_every_raw_surface_is_scanned_before_projection(self):
        for name in ('resource','scope','attributes','attributes_promoted','events','links','trace_state','status_message',
                     'resources_string','attributes_string','attributes_number','attributes_bool','status_code_string'):
            row=self.span();row[name]={'nested':'PRIVACY_SENTINEL_1566'}
            with self.subTest(name=name),self.assertRaisesRegex(RuntimeError,'privacy'):stored.span_facts([row],trace_id='a'*32,release='c'*40)
        row=self.span();row['trace_id']='d'*32;row['events']=['{"name":"PRIVACY_SENTINEL_1566"}']
        with self.assertRaisesRegex(RuntimeError,'privacy'):stored.span_facts([row],trace_id='a'*32,release='c'*40)
    def test_nan_bool_non_decimal_overflow_unknown_columns_and_copy_collision_refuse(self):
        for key,value in [('flags',True),('duration_nano','1.0'),('duration_nano',str(2**63)),('start_ns',1800000000000000000),
                          ('unknown',0),('attributes_number',{'http.route':2})]:
            row=self.span();row[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):stored.span_facts([row],trace_id='a'*32,release='c'*40)
        row=self.span();row['resource']['service.version']='d'*40
        with self.assertRaises(ValueError):stored.span_facts([row],trace_id='a'*32,release='c'*40)
    def test_fixed_recipes_preserve_full_surfaces_and_limits(self):
        recipes=stored.recipes(1800000000000,1800000020000)
        self.assertEqual(set(recipes),{'traces','logs','metrics','metadata'})
        self.assertIn('toString(toUnixTimestamp64Nano(timestamp)) AS start_ns',recipes['traces'])
        self.assertIn('attributes_promoted',recipes['traces']);self.assertIn('body_promoted',recipes['logs'])
        self.assertIn('scope_attrs',recipes['metrics']);self.assertIn('attr_string_value',recipes['metadata'])
        self.assertTrue(all("result_overflow_mode='throw'" in query and 'LIMIT 1001' in query for query in recipes.values()))


class NativeProbeFacts(unittest.TestCase):
    def rows(self):
        rows=[]
        for case_index,case in enumerate(('zero','latest','future')):
            for source_index,source in enumerate(('postgresql','caddy')):
                for name_index,name in enumerate(('inside_production_source_available','inside_production_source_observed_at_seconds')):
                    values=[(1800000019000,0 if name.endswith('available') else 1800000019)]
                    if case=='latest':values.insert(0,(1800000018000,1 if name.endswith('available') else 1800000018))
                    if case=='future':values=[(1800000060000,1 if name.endswith('available') else 1800000060)]
                    for stamp,value in values:
                        rows.append({'env':'','temporality':'Unspecified','metric_name':name,'fingerprint':str(case_index*4+source_index*2+name_index+1),
                            'unix_milli':stamp,'value':value,'flags':0,'description':'','unit':'','type':'Gauge','is_monotonic':False,
                            'labels':'{}','attrs':{'source':source,'case':case,'__temporality__':'Unspecified'},
                            'scope_attrs':{'__scope.name__':'platform-task4b-native-probe','__scope.version__':'1','__scope.schema_url__':''},
                            'resource_attrs':{'service.name':'platform-task4b-native-probe','service.version':'c'*40,'service.instance.id':'representative-native-probe'}})
        return rows
    def test_separate_test_owned_native_samples_prove_zero_latest_and_future_without_current_health_alias(self):
        self.assertEqual(stored.native_probe_cases(self.rows(),release='c'*40,cut=1800000020000),['zero','latest_zero','future'])
    def test_missing_unknown_flags_future_fallback_and_mislabelled_health_refuse(self):
        rows=self.rows()
        for key,value in [('flags',True),('value',float('nan')),('resource_attrs',{'service.name':'platform-owner-cache','service.version':'c'*40})]:
            changed=copy.deepcopy(rows);changed[0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):stored.native_probe_cases(changed,release='c'*40,cut=1800000020000)
        with self.assertRaises(ValueError):stored.native_probe_cases(rows[1:],release='c'*40,cut=1800000020000)


class NativeSdkProjection(unittest.TestCase):
    """D1 typed SOURCE-MODEL, not real SDK/native-store evidence."""
    def bundle(self):
        base=Stored().span();start=1800000000001000000
        root=copy.deepcopy(base);root.update(start_ns=str(start),duration_nano='2000000')
        read=copy.deepcopy(base);read.update(name='s3 getObject.read',span_id='c'*16,parent_span_id='b'*16,kind=1,start_ns=str(start+100000),duration_nano='1500000')
        read['attributes_string']={'dependency.name':'s3','dependency.operation':'getObject.read','dependency.outcome':'completed'}
        read['attributes_number']={};read['attributes']=dict(read['attributes_string'])
        http=copy.deepcopy(base);http.update(name='s3 http.GET',span_id='d'*16,parent_span_id='c'*16,kind=3,start_ns=str(start+200000),duration_nano='1000000')
        http['attributes_string']={'dependency.name':'s3','dependency.operation':'http.GET','dependency.outcome':'completed','http.request.method':'GET'}
        http['attributes']=dict(http['attributes_string'],**http['attributes_number'])
        fixture=copy.deepcopy(base);fixture.update(trace_id='e'*32,span_id='e'*16,links=json.dumps([{'traceId':'f'*32,'spanId':'f'*16,'refType':'FOLLOWS_FROM'}]))
        fixture['resource']=fixture['resources_string']={'service.name':'_OTHER','service.version':'1566'*10}
        metric=[]
        def sample(name,value,attrs,kind,unit,temporality,monotonic):
            metric.append({'env':'','temporality':temporality,'metric_name':name,'fingerprint':str(len(metric)+1),'unix_milli':1800000019999,
                'value':value,'flags':0,'description':'','unit':unit,'type':kind,'is_monotonic':monotonic,'labels':'{}',
                'attrs':dict(attrs,__temporality__=temporality),
                'scope_attrs':{'__scope.name__':'inside-collector','__scope.version__':'','__scope.schema_url__':''},
                'resource_attrs':{'service.name':'platform-api','service.version':'c'*40,'deployment.environment.name':'test'}})
        gauges=('http.server.active_requests','telemetry.trace.sampling.ratio','inside.postgresql.pool.available',
            'inside.postgresql.pool.total','inside.postgresql.pool.idle','inside.postgresql.pool.waiting','inside.postgresql.pool.registry_overflow')
        for name in gauges:sample(name,1 if name=='telemetry.trace.sampling.ratio' else 0,{},'Gauge','','Unspecified',False)
        for name in ('telemetry.trace.dropped','telemetry.trace.export.failures','telemetry.metric.export.failures'):sample(name,0,{},'Sum','','Cumulative',True)
        bounds=('0','5','10','25','50','75','100','250','500','750','1000','2500','5000','7500','10000','+Inf')
        for operation in ('getObject.read','http.GET','test-owned-http-root'):
            if operation=='test-owned-http-root':
                attrs={'http.request.method':'GET','http.route':'/pilot','http.request.outcome':'completed','http.response.status_code':'200'}
                family='http.server.request.duration';counter='http.server.request.count'
            else:
                attrs={'dependency':'s3','operation':operation,'outcome':'completed'}
                family='inside.dependency.duration';counter='inside.dependency.operations'
            sample(counter,1,attrs,'Sum','','Cumulative',True)
            sample(family+'.count',1,attrs,'Sum','1','Cumulative',True)
            sample(family+'.sum',.2,attrs,'Sum','s','Cumulative',True)
            for bound in bounds:sample(family+'.bucket',0 if bound=='0' else 1,dict(attrs,le=bound),'Histogram','s','Cumulative',True)
            for suffix in ('min','max'):sample(family+'.'+suffix,.2,attrs,'Gauge','s','Unspecified',False)
        return {'traces':[root,read,http,fixture],'logs':[],'metrics':metric+NativeProbeFacts().rows(),'metadata':[]}
    def test_distinct_sig_semantic_verdict_preserves_unknown_surfaces(self):
        bundle=self.bundle();original=copy.deepcopy(bundle)
        value=stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        self.assertEqual(value['sdk_span_semantics'],'passed');self.assertEqual(value['sdk_metric_semantics'],'passed')
        self.assertEqual(value['stored_spans'],3);self.assertEqual(value['logical_series'],67)
        self.assertEqual(value['full_privacy'],'unknown');self.assertEqual(value['original_vm_oracle'],'not_applicable')
        self.assertIn('link.attributes',value['unknown_fields']);self.assertIn('metric.exemplars',value['unknown_fields'])
        self.assertEqual(value['native_probe_cases'],['zero','latest_zero','future'])
        self.assertEqual(bundle,original)
    def test_unchanged_semantic_gate_and_poison_before_pending(self):
        bundle=self.bundle();bundle['traces'][1]['parent_span_id']='e'*16
        with self.assertRaisesRegex(ValueError,'trace_gate_09'):
            stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        bundle=self.bundle();bundle['metrics'][0]['flags']=1
        with self.assertRaises(ValueError):stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        bundle=self.bundle();bundle['metadata']=[{'attr_string_value':'PRIVACY_SENTINEL_1566'}]
        with self.assertRaisesRegex(RuntimeError,'privacy'):
            stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
