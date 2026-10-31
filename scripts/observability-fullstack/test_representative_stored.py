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
        self.assertEqual(set(recipes),{'traces','logs','metrics_0','metrics_1','metrics_2','metrics_3','metadata'})
        self.assertIn('toString(toUnixTimestamp64Nano(timestamp)) AS start_ns',recipes['traces'])
        self.assertIn('attributes_promoted',recipes['traces']);self.assertIn('body_promoted',recipes['logs'])
        self.assertIn('scope_attrs',recipes['metrics_0']);self.assertIn('attr_string_value',recipes['metadata'])
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
        for row in rows:row['labels']=json.dumps({**row['attrs'],**row['scope_attrs'],**row['resource_attrs'],'__name__':row['metric_name']},sort_keys=True,separators=(',',':'))
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
        bundle={'traces':[root,read,http,fixture],'logs':[],'metrics':metric+NativeProbeFacts().rows(),'metadata':[]}
        for row in bundle['metrics']:row['labels']=json.dumps({**row['attrs'],**row['scope_attrs'],**row['resource_attrs'],'__name__':row['metric_name']},sort_keys=True,separators=(',',':'))
        return bundle
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


def complete_metric_corpus():
    """All400 neighbours plus SDK/probes, with exact pinned exporter label copies."""
    bundle=NativeSdkProjection().bundle()
    exemplar={'env':'','temporality':'Unspecified','metric_name':'pilot_requests','fingerprint':'9000',
        'unix_milli':1800000001000,'value':1,'flags':0,'description':'','unit':'','type':'Gauge','is_monotonic':False,
        'labels':'','attrs':{'http.route':'/pilot','__temporality__':'Unspecified'},
        'scope_attrs':{'__scope.name__':'inside-collector','__scope.version__':'','__scope.schema_url__':''},
        'resource_attrs':{'service.name':'platform-pilot','service.version':'1566'*9+'0008'}}
    for index in range(400):
        row=copy.deepcopy(exemplar);row.update(unix_milli=1800000001000+index,value=index+1);bundle['metrics'].append(row)
    for row in bundle['metrics']:
        # Pinned fingerprint/label.go: later maps win; __name__ is always name.
        labels={**row['attrs'],**row['scope_attrs'],**row['resource_attrs'],'__name__':row['metric_name']}
        row['labels']=json.dumps(labels,sort_keys=True,separators=(',',':'))
    return bundle


def scalar_wire(columns,rows):
    return json.dumps({'status':'success','data':{'type':'scalar','data':{'results':[{
        'queryName':'A','columns':[{'name':name} for name in columns],
        'data':[[row[name] for name in columns] for row in rows]}]}}},separators=(',',':')).encode()


METADATA_FIELDS=('env','temporality','metric_name','fingerprint','description','unit','type','is_monotonic','labels','attrs','scope_attrs','resource_attrs')


def compact_metric_rows(rows):
    """Independent fixture encoding of every exact metadata copy and sample."""
    partitions={f'metrics_{index}':{} for index in range(4)}
    for row in rows:
        metadata={key:copy.deepcopy(row[key]) for key in METADATA_FIELDS}
        key=json.dumps(metadata,sort_keys=True,separators=(',',':'))
        partition=partitions['metrics_'+str(int(row['fingerprint'])%4)]
        if key not in partition:partition[key]=(metadata,[])
        partition[key][1].append([str(row['unix_milli']),row['value'],row['flags']])
    return {name:[metadata|{'samples_json':json.dumps(points,separators=(',',':'))} for metadata,points in groups.values()]
            for name,groups in partitions.items()}


def probe_scalar_rows(case):
    stamp=1800000060000 if case=='future' else 1800000019000
    return [{'source':source,'available':1 if case=='future' else 0,'observed_at_seconds':stamp/1000,
        'available_sample_ms':stamp,'observed_sample_ms':stamp,'available_series':1,'observed_series':1,
        'duplicate_samples':0,'flagged_samples':0,'bad_samples':0,'evaluation_ms':1800000020000} for source in ('postgresql','caddy')]


class LosslessMetricWire(unittest.TestCase):
    def decoded(self,rows):
        result=[]
        for signal,groups in compact_metric_rows(rows).items():
            raw=scalar_wire((*METADATA_FIELDS,'samples_json'),groups)
            result.extend(stored.raw_rows(raw,signal))
        return result
    def test_four_uint64_partitions_are_complete_disjoint_and_preserve_every_duplicate_and_copy(self):
        rows=complete_metric_corpus()['metrics']
        # Physical duplicates and distinct metadata copies are observations, not
        # transport dedup candidates. Canonical comparison retains multiplicity.
        rows.append(copy.deepcopy(rows[-1]))
        different=copy.deepcopy(rows[-1]);different['resource_attrs']['copy.marker']='distinct'
        different['labels']=json.dumps({**different['attrs'],**different['scope_attrs'],**different['resource_attrs'],'__name__':different['metric_name']},sort_keys=True,separators=(',',':'))
        rows.append(different)
        for index,fingerprint in enumerate(('0','1','2','3','4',str(2**64-1))):
            row=copy.deepcopy(rows[-1]);row.update(fingerprint=fingerprint,unix_milli=1800000000001+index);rows.append(row)
        actual=self.decoded(rows)
        key=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'))
        self.assertEqual(sorted(map(key,actual)),sorted(map(key,rows)))
        self.assertEqual(len(actual),497)
        self.assertEqual(sum(row['fingerprint']=='9000' for row in actual),402)
        wrong=compact_metric_rows(rows)['metrics_0']
        with self.assertRaises(ValueError):stored.raw_rows(scalar_wire((*METADATA_FIELDS,'samples_json'),wrong),'metrics_1')
        self.assertTrue(all(sum(int(row['fingerprint'])%4==part for part in range(4))==1 for row in rows))
    def test_unsorted_tuple_arrays_preserve_order_independent_http_mcp_multiplicity(self):
        rows=complete_metric_corpus()['metrics'];groups=compact_metric_rows(rows)
        for partition in groups.values():
            for group in partition:
                points=json.loads(group['samples_json']);group['samples_json']=json.dumps(list(reversed(points)),separators=(',',':'))
        actual=[]
        for signal,partition in groups.items():actual.extend(stored.raw_rows(scalar_wire((*METADATA_FIELDS,'samples_json'),partition),signal))
        key=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'))
        self.assertEqual(sorted(map(key,actual)),sorted(map(key,rows)))
    def test_missing_flags_bool_null_and_physical_row_cap_refuse_before_projection(self):
        rows=complete_metric_corpus()['metrics'];groups=compact_metric_rows(rows)['metrics_0']
        for point in (['1800000001000',1],['1800000001000',None,0],['1800000001000',1,False],[1800000001000,1,0]):
            bad=copy.deepcopy(groups);bad[0]['samples_json']=json.dumps([point])
            with self.subTest(point=point),self.assertRaises(ValueError):stored.raw_rows(scalar_wire((*METADATA_FIELDS,'samples_json'),bad),'metrics_0')
        pilot=next(row for row in rows if row['metric_name']=='pilot_requests')
        many=[dict(pilot,unix_milli=1800000001000+index) for index in range(1001)]
        with self.assertRaisesRegex(ValueError,'physical_row_cap'):self.decoded(many)
    def test_old_unselected_point_poison_is_checked_before_current_sdk_facts(self):
        original=NativeSdkProjection().bundle()
        current=next(row for row in original['metrics'] if row['metric_name']=='inside.dependency.operations')
        for field,value in (('value',.5),('flags',1),('unit','ms'),('type','Gauge'),('is_monotonic',False),('unix_milli',1800000020001),
                            ('attrs',dict(current['attrs'],secret='old')),('scope_attrs',dict(current['scope_attrs'],**{'__scope.name__':'wrong'})),
                            ('resource_attrs',dict(current['resource_attrs'],**{'service.version':'f'*40}))):
            bundle=copy.deepcopy(original);old=copy.deepcopy(current);old['unix_milli']-=1000;old[field]=value
            old['labels']=json.dumps({**old['attrs'],**old['scope_attrs'],**old['resource_attrs'],'__name__':old['metric_name']},sort_keys=True,separators=(',',':'))
            bundle['metrics'].append(old);bundle['metrics']=self.decoded(bundle['metrics'])
            with self.subTest(field=field),self.assertRaises(ValueError):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        bundle=copy.deepcopy(original);old=copy.deepcopy(current);old['unix_milli']-=1000
        old['labels']=old['labels'][:-1]+',"hidden":"old"}';bundle['metrics'].append(old)
        with self.assertRaisesRegex(ValueError,'label_copy'):
            stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
    def test_old_bucket_sum_and_extrema_poison_and_duplicate_samples_do_not_hide(self):
        for mode in ('bucket','extrema','duplicate','privacy'):
            bundle=NativeSdkProjection().bundle()
            if mode=='duplicate':bundle['metrics'].append(copy.deepcopy(bundle['metrics'][0]))
            elif mode=='privacy':
                old=copy.deepcopy(bundle['metrics'][0]);old['unix_milli']-=1000;old['scope_attrs']['old.raw']='PRIVACY_SENTINEL_1566';bundle['metrics'].append(old)
            else:
                family=[copy.deepcopy(row) for row in bundle['metrics'] if row['metric_name'].startswith('http.server.request.duration')]
                for row in family:row['unix_milli']-=1000
                poisoned=next(row for row in family if row['metric_name'].endswith('.bucket') and row['attrs']['le']=='5') if mode=='bucket' else next(row for row in family if row['metric_name'].endswith('.max'))
                poisoned['value']=0 if mode=='bucket' else .1;bundle['metrics'].extend(family)
            with self.subTest(mode=mode),self.assertRaises((ValueError,RuntimeError)):
                bundle['metrics']=self.decoded(bundle['metrics'])
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)

    def test_all_valid_historical_sdk_points_remain_checked_and_current_verdict_stays_equal(self):
        bundle=complete_metric_corpus();before=stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        old=[copy.deepcopy(row) for row in bundle['metrics'] if row['resource_attrs']['service.name']=='platform-api']
        for row in old:row['unix_milli']-=1000
        bundle['metrics'].extend(old);bundle['metrics']=self.decoded(bundle['metrics'])
        self.assertEqual(len(bundle['metrics']),562)
        after=stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
        self.assertEqual(after,before)


class DecodedPrivacy(unittest.TestCase):
    def test_escaped_markers_in_all_raw_copies_refuse_before_selection(self):
        escaped=''.join('\\u%04x'%ord(char) for char in stored._PRIVACY.SENTINEL)
        hidden='{"hidden":"'+escaped+'"}'
        cases=[('traces',field) for field in ('resources_string','resource','scope','attributes_string','attributes_number',
            'attributes_bool','attributes','attributes_promoted','events','links')]
        cases += [('logs',field) for field in ('body','body_v2','body_promoted','attributes_string','resources_string','resource','scope_string')]
        cases += [('metrics',field) for field in ('labels','attrs','scope_attrs','resource_attrs')]
        cases += [('metadata','attr_string_value')]
        for signal,field in cases:
            bundle=NativeSdkProjection().bundle()
            if signal=='traces':row=bundle[signal][-1]
            elif signal=='logs':row={key:None for key in stored.LOG_COLUMNS};bundle[signal].append(row)
            elif signal=='metadata':row={key:None for key in stored.META_COLUMNS};bundle[signal].append(row)
            else:
                row=copy.deepcopy(bundle[signal][-1]);row['unix_milli']-=1000;bundle[signal].append(row)
            row[field]=[hidden] if field=='events' else hidden
            with self.subTest(signal=signal,field=field):
                with self.assertRaisesRegex(RuntimeError,'privacy'):
                    stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)
                with self.assertRaisesRegex(RuntimeError,'privacy'):
                    if signal=='metrics':
                        for part,groups in compact_metric_rows(bundle[signal]).items():stored.raw_rows(scalar_wire(stored.METRIC_GROUP_COLUMNS,groups),part)
                    else:stored.raw_rows(scalar_wire({'traces':stored.TRACE_COLUMNS,'logs':stored.LOG_COLUMNS,'metadata':stored.META_COLUMNS}[signal],bundle[signal]),signal)

    def test_nested_encoded_json_keeps_duplicate_depth_and_byte_bounds(self):
        for payload in ('{"hidden":0,"hidden":1}', '['*17+'0'+']'*17, '{"x":"'+'a'*65536+'"}'):
            bundle=NativeSdkProjection().bundle();bundle['traces'][-1]['scope']=payload
            with self.subTest(payload_size=len(payload)),self.assertRaises(ValueError):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},release='c'*40,start=1800000000000,cut=1800000020000)


class FullEnvelopeStringPrivacy(unittest.TestCase):
    def envelope(self):
        bundle=NativeSdkProjection().bundle()
        return bundle,json.loads(scalar_wire(stored.TRACE_COLUMNS,bundle['traces']))

    def verdict(self,bundle,envelope):
        bundle['traces']=stored.raw_rows(json.dumps(envelope,separators=(',',':')).encode(),'traces')
        return stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
            release='c'*40,start=1800000000000,cut=1800000020000)

    def test_descriptor_unit_escaped_marker_refuses_before_discard_and_full_verdict(self):
        escaped=''.join('\\u%04x'%ord(char) for char in stored._PRIVACY.SENTINEL)
        bundle,envelope=self.envelope()
        envelope['data']['data']['results'][0]['columns'][0]['meta']={'unit':'{"hidden":"'+escaped+'"}'}
        with self.subTest(boundary='raw_rows'),self.assertRaisesRegex(RuntimeError,'privacy'):
            stored.raw_rows(json.dumps(envelope,separators=(',',':')).encode(),'traces')
        with self.subTest(boundary='raw_rows_to_validate_bundle'),self.assertRaisesRegex(RuntimeError,'privacy'):
            self.verdict(bundle,envelope)

    def test_descriptor_and_untyped_wrapper_strings_and_keys_are_inspected(self):
        escaped=''.join('\\u%04x'%ord(char) for char in stored._PRIVACY.SENTINEL)
        hidden='{"hidden":"'+escaped+'"}'
        hidden_key='{"'+escaped+'":"clean"}'
        # Each admitted sibling is visited before descriptor removal. This is
        # generic inspection, not a claim about these optional fields' types.
        cases=[('descriptor',name,hidden) for name in ('queryName','aggregationIndex','columnType',
            'signal','fieldContext','fieldDataType','materialized')]
        cases += [('descriptor','meta',{'unit':value}) for value in (
            stored._PRIVACY.SENTINEL,hidden_key,json.dumps([json.dumps({'copy':hidden})]),
            '"'+escaped+'"')]
        cases += [('descriptor','meta',{hidden_key:'clean'}),
            ('descriptor','meta',{'unit':{json.dumps(hidden):['clean']}}),
            ('wrapper','meta',hidden),('wrapper','meta',{hidden_key:'clean'}),
            ('wrapper','meta',[{'copy':json.dumps(hidden)}])]
        for owner,name,value in cases:
            bundle,envelope=self.envelope()
            target=envelope['data'] if owner=='wrapper' else envelope['data']['data']['results'][0]['columns'][0]
            target[name]=value
            with self.subTest(owner=owner,name=name,value=value):
                with self.assertRaisesRegex(RuntimeError,'privacy'):
                    stored.raw_rows(json.dumps(envelope,separators=(',',':')).encode(),'traces')
                with self.assertRaisesRegex(RuntimeError,'privacy'):self.verdict(bundle,envelope)

    def test_clean_complete_json_and_benign_prefixes_preserve_original_envelope_strings(self):
        texts=('s','[INFO] native unit','{request} completed','"request" completed',
            '{"unit":"s"}','["s"]','"seconds"')
        for text in texts:
            bundle,envelope=self.envelope();original=copy.deepcopy(bundle['traces'])
            envelope['data']['data']['results'][0]['columns'][0].update(meta={'unit':text,text:'clean'},queryName=text)
            envelope['data']['meta']={text:[text]}
            with self.subTest(text=text):
                raw=json.dumps(envelope,separators=(',',':')).encode()
                self.assertEqual(stored.raw_rows(raw,'traces'),original)
                result=self.verdict(bundle,envelope)
                self.assertEqual(result['sdk_span_semantics'],'passed')
                self.assertEqual(result['sdk_metric_semantics'],'passed')
                self.assertEqual(result['full_privacy'],'unknown')

    def test_complete_optional_json_policy_failures_never_fall_back_to_text(self):
        cases=(' {"x":0,"\\u0078":1}', '['*17+'0'+']'*17, '['*8+'0'+']'*8,
            '{"x":NaN}','[Infinity]','{"x":1e400}',json.dumps('\ud800'))
        for payload in cases:
            for key in (False,True):
                bundle,envelope=self.envelope()
                envelope['data']['data']['results'][0]['columns'][0]['meta']=({payload:'clean'} if key else {'unit':payload})
                with self.subTest(payload=payload,key=key):
                    with self.assertRaises(ValueError):
                        stored.raw_rows(json.dumps(envelope,separators=(',',':')).encode(),'traces')
                    with self.assertRaises(ValueError):self.verdict(bundle,envelope)

    def test_string_expansion_depth_bytes_and_unicode_are_checked_at_complete_bundle(self):
        nested='clean'
        for _ in range(18):nested=json.dumps(nested)
        for payload in (nested,'['*13+'0'+']'*13,json.dumps('a'*65536),'\ud800','[1,2,3]'+(' '*65536)):
            bundle=NativeSdkProjection().bundle();bundle['metrics'][0]['description']=payload
            with self.subTest(size=len(payload)),self.assertRaises(ValueError):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                    release='c'*40,start=1800000000000,cut=1800000020000)

    def test_whole_bundle_shares_visit_and_character_budgets_across_two_copies(self):
        # Each copy fits alone, but together the complete input must refuse.
        # The character case crosses signal arrays as well as row boundaries.
        for kind,payload in (('visits','['+','.join(['0']*30000)+']'),('characters','a'*524288)):
            for index in (0,1):
                bundle=NativeSdkProjection().bundle()
                if kind=='visits':bundle['metrics'][index]['description']=payload
                elif index==0:bundle['traces'][-1]['status_message']=payload
                else:bundle['metadata']=[dict.fromkeys(stored.META_COLUMNS,'')|{'description':payload}]
                with self.subTest(kind=kind,single=index):
                    result=stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                        release='c'*40,start=1800000000000,cut=1800000020000)
                    self.assertEqual(result['sdk_metric_semantics'],'passed')
            bundle=NativeSdkProjection().bundle()
            if kind=='visits':
                for row in bundle['metrics'][:2]:row['description']=payload
            else:
                bundle['traces'][-1]['status_message']=payload
                bundle['metadata']=[dict.fromkeys(stored.META_COLUMNS,'')|{'description':payload}]
            with self.subTest(kind=kind,together=True),self.assertRaisesRegex(ValueError,'representative_stored_size'):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                    release='c'*40,start=1800000000000,cut=1800000020000)


class StoredTextContracts(unittest.TestCase):
    def test_ordinary_prefixed_text_survives_raw_rows_and_full_validation(self):
        for text in ('[INFO] request complete','{request} completed','"request" completed'):
            bundle=NativeSdkProjection().bundle()
            row={key:None for key in stored.LOG_COLUMNS}
            row.update(body=text,body_v2=json.dumps({'message':text}),body_promoted={},
                attributes_string={'message':text},scope_string={'message':text},
                scope_name=text,severity_text=text)
            bundle['logs']=[row]
            bundle['traces'][-1]['status_message']=text
            bundle['traces'][-1]['attributes_string']['message']=text
            bundle['metrics'][0]['description']=text
            bundle['metadata']=[dict.fromkeys(stored.META_COLUMNS,text)]
            with self.subTest(text=text):
                for signal,columns in (('logs',stored.LOG_COLUMNS),('traces',stored.TRACE_COLUMNS),('metadata',stored.META_COLUMNS)):
                    actual=stored.raw_rows(scalar_wire(columns,bundle[signal]),signal)
                    self.assertEqual(actual,bundle[signal]);bundle[signal]=actual
                result=stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                    release='c'*40,start=1800000000000,cut=1800000020000)
                self.assertEqual(result['sdk_span_semantics'],'passed')
                self.assertEqual(result['sdk_metric_semantics'],'passed')

    def test_explicit_json_columns_refuse_malformed_values_before_discard(self):
        fields={'traces':('resources_string','resource','scope','attributes_string','attributes_number',
            'attributes_bool','attributes','attributes_promoted','events','links'),
            'logs':('body_v2','body_promoted','attributes_string','attributes_number','attributes_bool',
                'resources_string','resource','scope_string'),
            'metrics':('labels','attrs','scope_attrs','resource_attrs')}
        for signal,names in fields.items():
            for name in names:
                bundle=NativeSdkProjection().bundle()
                if signal=='logs':bundle[signal]=[dict.fromkeys(stored.LOG_COLUMNS)]
                row=bundle[signal][-1]
                row[name]=['[INFO] malformed event'] if name=='events' else '[INFO] malformed JSON'
                with self.subTest(signal=signal,name=name):
                    with self.assertRaises(ValueError):
                        stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                            release='c'*40,start=1800000000000,cut=1800000020000)
                    with self.assertRaises(ValueError):
                        if signal=='metrics':
                            for part,groups in compact_metric_rows(bundle[signal]).items():
                                stored.raw_rows(scalar_wire(stored.METRIC_GROUP_COLUMNS,groups),part)
                        else:
                            columns=stored.TRACE_COLUMNS if signal=='traces' else stored.LOG_COLUMNS
                            stored.raw_rows(scalar_wire(columns,bundle[signal]),signal)

    def test_nested_valid_json_in_free_text_and_structured_copies_still_refuses_markers(self):
        escaped=''.join('\\u%04x'%ord(char) for char in stored._PRIVACY.SENTINEL)
        hidden='{"hidden":"'+escaped+'"}'
        fields={'traces':('name','status_message','trace_state','resources_string','resource','scope','attributes_string',
            'attributes_number','attributes_bool','attributes','attributes_promoted','events','links'),
            'logs':('body','body_v2','body_promoted','severity_text','scope_name','scope_version','attributes_string',
                'attributes_number','attributes_bool','resources_string','resource','scope_string'),
            'metrics':('description','unit','labels','attrs','scope_attrs','resource_attrs'),
            'metadata':('metric_name','description','attr_name','attr_string_value')}
        for signal,names in fields.items():
            for name in names:
                bundle=NativeSdkProjection().bundle()
                if signal=='logs':bundle[signal]=[dict.fromkeys(stored.LOG_COLUMNS)]
                elif signal=='metadata':bundle[signal]=[dict.fromkeys(stored.META_COLUMNS)]
                row=bundle[signal][-1]
                nested=json.dumps({'nested':json.dumps([hidden])})
                row[name]=[nested] if name=='events' else nested
                with self.subTest(signal=signal,name=name):
                    with self.assertRaisesRegex(RuntimeError,'privacy'):
                        stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                            release='c'*40,start=1800000000000,cut=1800000020000)
                    with self.assertRaisesRegex(RuntimeError,'privacy'):
                        if signal=='metrics':
                            for part,groups in compact_metric_rows(bundle[signal]).items():
                                stored.raw_rows(scalar_wire(stored.METRIC_GROUP_COLUMNS,groups),part)
                        else:
                            columns={'traces':stored.TRACE_COLUMNS,'logs':stored.LOG_COLUMNS,'metadata':stored.META_COLUMNS}[signal]
                            stored.raw_rows(scalar_wire(columns,bundle[signal]),signal)


    def test_decoded_key_nested_duplicate_depth_and_bytes_at_owning_boundaries(self):
        escaped=''.join('\\u%04x'%ord(char) for char in stored._PRIVACY.SENTINEL)
        cases=(('{"'+escaped+'":"clean"}',RuntimeError),
            (json.dumps('{"x":"'+escaped+'"}'),RuntimeError),
            ('{"x":0,"\\u0078":1}',ValueError),('['*17+'0'+']'*17,ValueError),
            (json.dumps('a'*65536),ValueError))
        for payload,error in cases:
            bundle=NativeSdkProjection().bundle();bundle['traces'][-1]['scope']=payload
            with self.subTest(size=len(payload),signal='traces'):
                with self.assertRaises(error):stored.raw_rows(scalar_wire(stored.TRACE_COLUMNS,bundle['traces']),'traces')
                with self.assertRaises(error):stored.span_facts(bundle['traces'],trace_id='a'*32,release='c'*40)
                with self.assertRaises(error):
                    stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                        release='c'*40,start=1800000000000,cut=1800000020000)
            bundle=NativeSdkProjection().bundle();bundle['metrics'][-1]['resource_attrs']=payload
            with self.subTest(size=len(payload),signal='metrics'):
                with self.assertRaises(error):
                    for part,groups in compact_metric_rows(bundle['metrics']).items():
                        stored.raw_rows(scalar_wire(stored.METRIC_GROUP_COLUMNS,groups),part)
                with self.assertRaises(error):stored.metric_facts(bundle['metrics'],release='c'*40,start=1800000000000,cut=1800000020000)
                with self.assertRaises(error):stored.native_probe_cases(bundle['metrics'],release='c'*40,cut=1800000020000)
                with self.assertRaises(error):
                    stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                        release='c'*40,start=1800000000000,cut=1800000020000)

    def test_foreign_objects_refuse_without_executing_hooks(self):
        hooks=[]
        class Hostile(dict):
            def items(self):hooks.append('items');raise AssertionError('hook')
            def __iter__(self):hooks.append('iter');raise AssertionError('hook')
            def __str__(self):hooks.append('str');raise AssertionError('hook')
        for value in (Hostile(secret='hidden'),object()):
            with self.assertRaises(ValueError):stored.scan(value)
            bundle=NativeSdkProjection().bundle();bundle['traces'][-1]['scope']=value
            with self.assertRaises(ValueError):stored.span_facts(bundle['traces'],trace_id='a'*32,release='c'*40)
            with self.assertRaises(ValueError):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                    release='c'*40,start=1800000000000,cut=1800000020000)
            bundle=NativeSdkProjection().bundle();bundle['metrics'][-1]['resource_attrs']=value
            with self.assertRaises(ValueError):stored.metric_facts(bundle['metrics'],release='c'*40,start=1800000000000,cut=1800000020000)
            with self.assertRaises(ValueError):stored.native_probe_cases(bundle['metrics'],release='c'*40,cut=1800000020000)
        self.assertEqual(hooks,[])

    def test_list_string_and_custom_objects_refuse_at_owning_boundaries_without_hooks(self):
        hooks=[]
        class HostileDict(dict):
            def items(self):hooks.append('items');raise AssertionError('hook')
            def __iter__(self):hooks.append('iter');raise AssertionError('hook')
            def __str__(self):hooks.append('str');raise AssertionError('hook')
        class HostileList(list):
            def __iter__(self):hooks.append('list.iter');raise AssertionError('hook')
        class HostileString(str):
            def encode(self,*args,**kwargs):hooks.append('encode');raise AssertionError('hook')
            def lstrip(self,*args,**kwargs):hooks.append('lstrip');raise AssertionError('hook')
            def __str__(self):hooks.append('string.str');raise AssertionError('hook')
        class HostileObject:
            def __str__(self):hooks.append('object.str');raise AssertionError('hook')
        for value in (HostileDict(secret='hidden'),HostileList(['hidden']),HostileString('hidden'),HostileObject(),object()):
            bundle=NativeSdkProjection().bundle();bundle['traces'][-1]['scope']=value
            with self.assertRaises(ValueError):stored.span_facts(bundle['traces'],trace_id='a'*32,release='c'*40)
            with self.assertRaises(ValueError):
                stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                    release='c'*40,start=1800000000000,cut=1800000020000)
            bundle=NativeSdkProjection().bundle();bundle['metrics'][-1]['resource_attrs']=value
            with self.assertRaises(ValueError):stored.metric_facts(bundle['metrics'],release='c'*40,start=1800000000000,cut=1800000020000)
            with self.assertRaises(ValueError):stored.native_probe_cases(bundle['metrics'],release='c'*40,cut=1800000020000)
        bundle=NativeSdkProjection().bundle();bundle['traces'][-1]['scope']={HostileString('key'):'clean'}
        with self.assertRaises(ValueError):stored.span_facts(bundle['traces'],trace_id='a'*32,release='c'*40)
        with self.assertRaises(ValueError):
            stored.validate_bundle(bundle,observed={'trace_id':'a'*32,'root_id':'b'*16},
                release='c'*40,start=1800000000000,cut=1800000020000)
        self.assertEqual(hooks,[])
