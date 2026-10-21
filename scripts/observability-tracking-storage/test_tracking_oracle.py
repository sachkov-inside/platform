"""Full native storage response contracts, without Docker or application execution."""
import copy
import json
import unittest

import tracking_oracle as oracle

TRACE = 'a'*32
ROOT = '1'*16
DELIVERY = '2'*16
COMMON = {'service.name': 'platform-api', 'deployment.environment.name': 'test',
          'service.version': '_OTHER', 'scope.name': 'inside-collector'}


def vector():
    rows = []
    def add(name, value, labels):
        rows.append({'metric': {'__name__': name, **COMMON, **labels}, 'value': [1800000000, str(value)]})
    for prefix, counter, count, labels in (
        ('inside.tracking.duration', 'inside.tracking.operations', 1, {'operation':'deliver','outcome':'completed'}),
        ('inside.dependency.duration', 'inside.dependency.operations', 2, {'dependency':'telegram','operation':'communications.execute','outcome':'completed'}),
        ('inside.dependency.duration', 'inside.dependency.operations', 3, {'dependency':'postgresql','operation':'query','outcome':'completed'}),
        ('inside.dependency.duration', 'inside.dependency.operations', 2, {'dependency':'postgresql','operation':'acquire','outcome':'completed'}),
        ('http.server.request.duration', 'http.server.request.count', 1, {'http.request.method':'POST','http.route':'/communications/tracking/resolve','http.request.outcome':'completed','http.response.status_code':'200'})):
        add(counter, count, labels)
        add(prefix+'_count', count, labels)
        add(prefix+'_sum', '0.25', labels)
        for bound in ('0','5','10','25','50','75','100','250','500','750','1000','2500','5000','7500','10000','+Inf'):
            add(prefix+'_bucket', 0 if bound == '0' else count, {**labels,'le':bound})
    for name in ('http.server.active_requests','telemetry.trace.dropped','telemetry.trace.export.failures','telemetry.metric.export.failures',
                 'inside.postgresql.pool.total','inside.postgresql.pool.idle','inside.postgresql.pool.waiting','inside.postgresql.pool.registry_overflow'):
        add(name, 0, {})
    for name in ('telemetry.trace.sampling.ratio', 'inside.postgresql.pool.available'):
        add(name, 1, {})
    return {'status':'success','stats':{'seriesFetched':'105','executionTimeMsec':0},'data':{'resultType':'vector','result':rows}}


class MetricContracts(unittest.TestCase):
    def test_all_five_closed_owners_and_sdk_health_are_required(self):
        proof = oracle.metrics(json.dumps(vector()))
        self.assertEqual(proof['tracking_series'], 19)
        self.assertEqual(proof['sdk_series'], 105)
        self.assertEqual(proof['dependency_counts'], {'telegram:communications.execute':2, 'postgresql:query':3, 'postgresql:acquire':2})

    def test_missing_is_pending_but_later_hostile_owner_fails_first(self):
        body = vector()
        body['data']['result'].pop(0)
        self.assertIsNone(oracle.metrics(json.dumps(body)))
        body['data']['result'].append({'metric': {'__name__':'private_field'},'value':[1800000000,'1']})
        with self.assertRaisesRegex(RuntimeError, '^Tracking storage metric contract failed$'):
            oracle.metrics(json.dumps(body))

    def test_full_vector_rejects_duplicates_types_unknown_labels_and_bad_aggregation(self):
        for case in ('duplicate', 'scope_alias', 'private', 'unknown_operation', 'missing_outcome', 'wrong_version', 'bucket', 'sum', 'count', 'pool', 'native_stats'):
            with self.subTest(case=case):
                body = vector(); rows = body['data']['result']
                if case == 'duplicate': rows.append(copy.deepcopy(rows[0]))
                elif case == 'scope_alias':
                    row = copy.deepcopy(rows[0]); row['metric']['scope.version']='unknown'; rows.append(row)
                elif case == 'private': rows[-1]['metric']['token']='private_tracking_token'
                elif case == 'unknown_operation': rows[0]['metric']['operation']='tick'
                elif case == 'missing_outcome': del rows[0]['metric']['outcome']
                elif case == 'wrong_version': rows[0]['metric']['service.version']='a'*40
                elif case == 'bucket': rows[4]['metric']['le']='0.5'
                elif case == 'sum': rows[2]['value'][1]='61'
                elif case == 'count': rows[1]['value'][1]='2'
                elif case == 'pool': rows[-4]['value'][1]='161'
                else: body['stats']['seriesFetched']=1
                with self.assertRaisesRegex(RuntimeError, '^Tracking storage metric contract failed$'):
                    oracle.metrics(json.dumps(body))

    def test_multi_observation_histogram_cannot_hide_an_impossible_sum(self):
        body=vector()
        for row in body['data']['result']:
            labels=row['metric']
            if labels.get('dependency') == 'telegram' and labels.get('le') == '0': row['value'][1]='2'
        with self.assertRaisesRegex(RuntimeError,'^Tracking storage metric contract failed$'): oracle.metrics(json.dumps(body))

    def test_duplicate_json_key_is_never_projected(self):
        raw = json.dumps(vector()).replace('"operation": "deliver"', '"operation":"private_tracking_token","operation":"deliver"', 1)
        with self.assertRaises(RuntimeError): oracle.metrics(raw)


def trace_rows():
    specs = [('POST /communications/tracking/resolve', ROOT, None, '2',
              {'http.request.method':'POST','http.route':'/communications/tracking/resolve','http.request.outcome':'completed','http.response.status_code':'200'}),
             ('tracking deliver', DELIVERY, ROOT, '1', {'tracking.operation':'deliver','tracking.outcome':'completed'}),
             ('telegram communications.execute', '3'*16, ROOT, '3', {'dependency.name':'telegram','dependency.operation':'communications.execute','dependency.outcome':'completed','http.request.method':'POST','http.response.status_code':'200'}),
             ('telegram communications.execute', '4'*16, DELIVERY, '3', {'dependency.name':'telegram','dependency.operation':'communications.execute','dependency.outcome':'completed','http.request.method':'POST','http.response.status_code':'200'})]
    for index, operation in enumerate(('query','query','query','acquire','acquire'),5):
        specs.append(('postgresql '+operation, str(index)*16, ROOT if index%2 else DELIVERY, '3',
                      {'dependency.name':'postgresql','dependency.operation':operation,'dependency.outcome':'completed'}))
    rows = []
    for name, identity, parent, kind, attrs in specs:
        row = {'name':name,'span_id':identity,'trace_id':TRACE,'kind':kind,'status_code':'0','flags':'769' if name == 'tracking deliver' else '257','_msg':'-',
               'resource_attr:service.name':'platform-api','resource_attr:deployment.environment.name':'test','resource_attr:service.version':'_OTHER',
               'scope_name':'inside-collector','start_time_unix_nano':'1800000000000000000','end_time_unix_nano':'1800000000001000000','duration':'1000000',
               '_time':'2027-01-15T08:00:00.000000000Z','_stream_id':'0'*48,
               '_stream':'{name='+json.dumps(name)+',resource_attr:service.name="platform-api"}',
               **{'span_attr:'+key:value for key,value in attrs.items()}}
        if parent is not None: row['parent_span_id']=parent
        rows.append(row)
    return rows


class TraceContracts(unittest.TestCase):
    def parse(self, rows):
        return oracle.traces('\n'.join(json.dumps(row) for row in rows), trace_id=TRACE, root_id=ROOT)

    def test_original_server_delivery_and_both_provider_edges_remain_distinct(self):
        proof = self.parse(trace_rows())
        self.assertEqual(proof, {'stored_spans':9,'tracking_spans':1,'provider_spans':2,'postgresql_counts':{'query':3,'acquire':2},'privacy':'passed','persisted_causality':'passed'})

    def test_source_owned_provider_post_200_packet_passes_the_complete_oracle(self):
        # Factory emits POST and the owned provider returns 200 for both success operations.
        # These worked source values are not raw values recovered from the prior native marker.
        rows=trace_rows()
        for row in rows[2:4]:
            row['span_attr:http.request.method']='POST'
            row['span_attr:http.response.status_code']='200'
        self.assertEqual(self.parse(rows),{'stored_spans':9,'tracking_spans':1,'provider_spans':2,
            'postgresql_counts':{'query':3,'acquire':2},'privacy':'passed','persisted_causality':'passed'})

    def test_provider_http_fields_are_required_exact_and_cannot_move_to_another_role(self):
        cases=('missing_method','missing_status','missing_both','method_get','method_lower','method_other','method_empty',
            'status_created','status_failed','status_other','status_leading_zero','status_decimal','status_empty',
            'status_integer','status_boolean','status_null','method_nonstring','extra_private','extra_known',
            'missing_before_extra','extra_before_wrong_value','partial_missing','foreign_service','wrong_kind','wrong_outcome')
        for index in (2,3):
            for case in cases:
                with self.subTest(edge='http' if index==2 else 'delivery',case=case):
                    rows=trace_rows();row=rows[index];method='span_attr:http.request.method';status='span_attr:http.response.status_code'
                    if case in ('missing_method','missing_both','missing_before_extra','partial_missing'):row.pop(method)
                    if case in ('missing_status','missing_both'):row.pop(status)
                    if case.startswith('method_'):
                        row[method]={'method_get':'GET','method_lower':'post','method_other':'_OTHER','method_empty':'','method_nonstring':True}[case]
                    if case.startswith('status_'):
                        row[status]={'status_created':'201','status_failed':'500','status_other':'_OTHER','status_leading_zero':'0200',
                            'status_decimal':'200.0','status_empty':'','status_integer':200,'status_boolean':True,'status_null':None}[case]
                    if case in ('extra_private','missing_before_extra','extra_before_wrong_value'):row['private-key-canary']='private-value-canary'
                    if case=='extra_known':row['span_attr:http.route']='/communications/tracking/resolve'
                    if case=='extra_before_wrong_value':row[status]='500'
                    if case=='partial_missing':rows.remove(rows[1])
                    if case=='foreign_service':row['resource_attr:service.name']='inside-telegram'
                    if case=='wrong_kind':row['kind']='1'
                    if case=='wrong_outcome':row['span_attr:dependency.outcome']='failed'
                    with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$') as caught:self.parse(rows)
                    typed=case in ('status_integer','status_boolean','status_null','method_nonstring')
                    expected='missing_mandatory' if case in ('missing_method','missing_status','missing_both','missing_before_extra','partial_missing') else 'unexpected_key' if case in ('extra_private','extra_known','extra_before_wrong_value') else 'expected_value'
                    self.assertEqual(caught.exception.reason,'trace_gate_03' if typed else 'trace_gate_06')
                    self.assertEqual(caught.exception.detail,None if typed else expected)
                    self.assertEqual(caught.exception.args,('Tracking storage trace contract failed',))
                    self.assertNotIn('private',str(caught.exception))
        for index in (1,4,-1):
            with self.subTest(foreign_role=index):
                rows=trace_rows();rows[index]['span_attr:http.request.method']='POST';rows[index]['span_attr:http.response.status_code']='200'
                with self.assertRaises(RuntimeError) as caught:self.parse(rows)
                self.assertEqual(caught.exception.reason,'trace_gate_06');self.assertEqual(caught.exception.detail,'unexpected_key')

    def test_delayed_delivery_does_not_have_to_finish_within_original_http_request(self):
        rows=trace_rows()
        for row in rows:
            if row['span_id'] == DELIVERY or row.get('parent_span_id') == DELIVERY:
                row['start_time_unix_nano']='1800000005000000000'; row['end_time_unix_nano']='1800000005001000000'
                row['_time']='2027-01-15T08:00:05.000000000Z'
        self.assertIsNotNone(self.parse(rows))

    def test_incomplete_is_pending_but_poison_fails_before_projection(self):
        rows=trace_rows()[:-1]
        self.assertIsNotNone(self.parse(rows))  # PG counts reconcile later against the whole metric vector.
        rows=rows[:1]
        self.assertIsNone(self.parse(rows))
        rows.append({'name':'private_tracking_token'})
        with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$'): self.parse(rows)

    def test_all_raw_rows_reject_private_metadata_unknown_fields_duplicates_and_wrong_parent(self):
        for case in ('private','unknown','duplicate','wrong_parent','wrong_kind','wrong_outcome','rootless','provider_temporal','cycle','unknown_sql','type','foreign_trace'):
            with self.subTest(case=case):
                rows=trace_rows()
                if case=='private': rows[-1]['span_attr:token']='private_tracking_token'
                elif case=='unknown': rows[-1]['raw_row']='anything'
                elif case=='duplicate': rows.append(copy.deepcopy(rows[-1]))
                elif case=='wrong_parent': rows[3]['parent_span_id']=ROOT
                elif case=='wrong_kind': rows[1]['kind']='3'
                elif case=='wrong_outcome': rows[1]['span_attr:tracking.outcome']='failed'
                elif case=='rootless': del rows[1]['parent_span_id']
                elif case=='provider_temporal': rows[3]['end_time_unix_nano']='1800000000002000000'; rows[3]['duration']='2000000'
                elif case=='cycle': rows[-1]['parent_span_id']=rows[-1]['span_id']
                elif case=='unknown_sql': rows[-1]['span_attr:dependency.operation']='raw-query'
                elif case=='type': rows[-1]['kind']=3
                else: rows[-1]['trace_id']='b'*32
                with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$'): self.parse(rows)


class SqlParentRoles(unittest.TestCase):
    def test_visible_provider_or_sql_cannot_parent_sql_even_when_main_roles_are_pending(self):
        for parent in ('provider','sql'):
            for visibility in ('complete','missing_delivery','missing_http','missing_neighboring_provider'):
                with self.subTest(parent=parent,visibility=visibility):
                    rows=trace_rows()
                    rows[-1]['parent_span_id']=rows[3 if parent=='provider' else 4]['span_id']
                    if visibility=='missing_delivery': rows.remove(rows[1])
                    elif visibility=='missing_http': rows.remove(rows[0])
                    elif visibility=='missing_neighboring_provider': rows.remove(rows[2])
                    raw='\n'.join(json.dumps(row) for row in rows)
                    with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$'):
                        oracle.traces(raw,trace_id=TRACE,root_id=ROOT)


class RoleFlags(unittest.TestCase):
    def test_valid_role_flags_remain_pending_when_another_main_role_is_not_visible(self):
        for index in (0,1,2,3):
            with self.subTest(missing=index):
                rows=trace_rows();rows.pop(index)
                self.assertIsNone(oracle.traces('\n'.join(json.dumps(r) for r in rows),trace_id=TRACE,root_id=ROOT))

    def test_missing_legacy_swapped_unsampled_unknown_bits_and_noncanonical_flags_refuse_before_pending(self):
        for role,index in (('root',0),('delivery',1),('provider',3),('sql',-1)):
            expected='769' if role=='delivery' else '257'
            for value in ('__missing__',None,'1','0','256','512','513','768','1025','1793','0257','0769','257.0','769.0',' 257','+257','0x101','0x301','-1','4294967295',257,769,257.0,True,False,'257' if expected=='769' else '769'):
                for visibility in ('complete','partial'):
                    with self.subTest(role=role,value=value,visibility=visibility):
                        rows=trace_rows();row=rows[index]
                        if value == '__missing__': del row['flags']
                        else: row['flags']=value
                        if visibility=='partial':
                            # Keep the poisoned row visible while another required main role is missing.
                            rows.remove(rows[1] if role!='delivery' else rows[0])
                        with self.assertRaisesRegex(RuntimeError,'^Tracking storage trace contract failed$'):
                            oracle.traces('\n'.join(json.dumps(r) for r in rows),trace_id=TRACE,root_id=ROOT)


if __name__ == '__main__': unittest.main()
