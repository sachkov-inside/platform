"""Whole owned Caddy vectors are checked before availability or numeric projection."""
import copy
import json
import unittest
import caddy_status


def acquisition(*,point=100,stamp=99):
    rows=[]
    def add(name,value,**labels):
        rows.append({'metric':{'__name__':name,'job':'platform-caddy','instance':'pilot',**labels},'value':[point,str(value)]})
    add('up',1)
    labels={'server':'srv0','handler':'subroute'}
    add('caddy_http_requests_total',3,**labels)
    add('caddy_http_request_errors_total',1,**labels)
    add('caddy_http_requests_in_flight',1,**labels)
    # Worked distributions: GET200 latencies0.1+0.3; GET502 latency0.02.
    for code,count,total,buckets in (('200',2,'0.4',[0,0,0,0,1,1,2,2,2,2,2,2]),('502',1,'0.02',[0,0,1,1,1,1,1,1,1,1,1,1])):
        group={**labels,'method':'GET','code':code}
        for le,value in zip(('0.005','0.01','0.025','0.05','0.1','0.25','0.5','1','2.5','5','10','+Inf'),buckets):
            add('caddy_http_request_duration_seconds_bucket',value,**group,le=le)
        add('caddy_http_request_duration_seconds_sum',total,**group)
        add('caddy_http_request_duration_seconds_count',count,**group)
    values={'status':'success','data':{'resultType':'vector','result':rows}}
    timestamps=copy.deepcopy(values)
    for row in timestamps['data']['result']:
        row['metric']['source_metric']=row['metric']['__name__'];row['value'][1]=str(stamp)
    return values,timestamps


class WholeObservation(unittest.TestCase):
    def test_wrong_final_row_is_malformed_for_complete_and_partial_visible_vectors(self):
        values,stamps=acquisition()
        for partial in (False,True):
            prefix=[values['data']['result'][0]] if partial else values['data']['result'][:-1]
            prefix_stamps=[stamps['data']['result'][0]] if partial else stamps['data']['result'][:-1]
            valid=copy.deepcopy(values);valid['data']['result']=copy.deepcopy(prefix)+[copy.deepcopy(values['data']['result'][-1])]
            valid_stamps=copy.deepcopy(stamps);valid_stamps['data']['result']=copy.deepcopy(prefix_stamps)+[copy.deepcopy(stamps['data']['result'][-1])]
            self.assertEqual(caddy_status.evaluate(json.dumps(valid).encode(),json.dumps(valid_stamps).encode(),evaluated_at=100,completed_at=101)['state'],
                             'incomplete' if partial else 'observed')
            for mutation in ('method','code','unknown_label','count_type','fractional_count','negative','timestamp_type','unknown_family'):
                bad=copy.deepcopy(valid);row=bad['data']['result'][-1]
                if mutation=='method':row['metric']['method']='UNDECLARED'
                elif mutation=='code':row['metric']['code']='099'
                elif mutation=='unknown_label':row['metric']['private']='private-caddy-sentinel'
                elif mutation=='count_type':row['value'][1]=1
                elif mutation=='fractional_count':row['value'][1]='1.5'
                elif mutation=='negative':row['value'][1]='-1'
                elif mutation=='timestamp_type':row['value'][0]=True
                else:row['metric']['__name__']='caddy_http_unrecognized'
                bad_stamps=copy.deepcopy(valid_stamps)
                bad_stamps['data']['result'][-1]['metric']={**row['metric'],'source_metric':row['metric']['__name__']}
                result=caddy_status.evaluate(json.dumps(bad).encode(),json.dumps(bad_stamps).encode(),evaluated_at=100,completed_at=101)
                with self.subTest(partial=partial,mutation=mutation):
                    self.assertEqual(result['state'],'malformed');self.assertIsNone(result['observation'])
                    self.assertNotIn('private',json.dumps(result))

    def test_known_partial_duration_count_cannot_exceed_known_total_before_missing_up(self):
        values,stamps=acquisition()
        values['data']['result']=[values['data']['result'][1],values['data']['result'][-1]]
        values['data']['result'][0]['value'][1]='0'
        stamps['data']['result']=[stamps['data']['result'][1],stamps['data']['result'][-1]]
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed');self.assertIsNone(result['observation'])

    def test_visible_error_counter_contradiction_precedes_missing_up(self):
        values,stamps=acquisition()
        keep=('caddy_http_requests_total','caddy_http_request_errors_total')
        values['data']['result']=[row for row in values['data']['result'] if row['metric']['__name__'] in keep]
        values['data']['result'][0]['value'][1]='0'
        stamps['data']['result']=[row for row in stamps['data']['result'] if row['metric']['__name__'] in keep]
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed')
        self.assertIsNone(result['observation'])

    def test_literal_distributions_and_private_final_row_do_not_become_partial_success(self):
        values,stamps=acquisition()
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'observed')
        self.assertEqual(result['observation']['requests_total'],3)
        self.assertEqual(result['observation']['duration'][0],{'method':'GET','code':200,'count':2,'sum_seconds':0.4,'buckets':[0,0,0,0,1,1,2,2,2,2,2,2]})
        for partial in (False,True):
            bad=copy.deepcopy(values)
            if partial:bad['data']['result']=bad['data']['result'][:1]
            bad['data']['result'].append({'metric':{'__name__':'up','job':'platform-caddy','instance':'pilot','private':'private-caddy-sentinel'},'value':[100,'1']})
            refused=caddy_status.evaluate(json.dumps(bad).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
            self.assertEqual(refused['state'],'malformed')
            self.assertIsNone(refused['observation'])
            self.assertNotIn('private',json.dumps(refused))

    def test_comparison_cannot_use_a_fresh_down_baseline_as_observed_traffic(self):
        values,stamps=acquisition()
        old,old_stamps=acquisition(point=95,stamp=94)
        old['data']['result'][0]['value'][1]='0'
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101,
            previous={'values':json.dumps(old).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':95,'completed_at':96})
        self.assertEqual(result['state'],'observed')
        self.assertEqual(result['comparison'],{'state':'incomplete','requests_delta':None,'errors_delta':None,'duration':[]})

    def test_visible_reset_survives_a_long_gap_but_never_produces_a_negative_delta(self):
        old,old_stamps=acquisition(point=80,stamp=79)
        values,stamps=acquisition()
        for row in old['data']['result']:
            if row['metric']['__name__'] not in ('up','caddy_http_requests_in_flight'):
                row['value'][1]=str(float(row['value'][1])*2)
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101,
            previous={'values':json.dumps(old).encode(),'timestamps':json.dumps(old_stamps).encode(),'evaluated_at':80,'completed_at':81})
        self.assertEqual(result['comparison'],{'state':'reset_observed','requests_delta':None,'errors_delta':None,'duration':[]})

    def test_visible_partial_histogram_contradiction_is_malformed_before_missing_availability(self):
        values,stamps=acquisition()
        rows=values['data']['result']
        values['data']['result']=[row for row in rows if row['metric'].get('le') in ('0.005','0.01') and row['metric'].get('code')=='200']
        values['data']['result'][0]['value'][1]='1'
        stamps['data']['result']=[row for row in stamps['data']['result'] if row['metric'].get('le') in ('0.005','0.01') and row['metric'].get('code')=='200']
        result=caddy_status.evaluate(json.dumps(values).encode(),json.dumps(stamps).encode(),evaluated_at=100,completed_at=101)
        self.assertEqual(result['state'],'malformed')
        self.assertIsNone(result['observation'])
