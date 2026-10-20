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
