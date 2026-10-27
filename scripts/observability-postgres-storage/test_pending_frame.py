"""Real storage driver waits for an ACKed cohort, never accepts a stale earlier frame."""
from contextlib import nullcontext
from email.message import Message
import copy
import json
import unittest
from unittest.mock import patch
import urllib.parse
import oracle
import queries
import scenario
from test_oracle import NOW,EXPECTED,vectors,raw


def wire(value,evaluated):
    rows,stamps=vectors()
    mapping={'backends':'connected_backends','waiting_locks':'waiting_locks','deadlocks_since_reset':'deadlocks',
        'postmaster_start_time_microseconds':'postmaster_us','statistics_reset_time_microseconds':'stats_reset_us','sample_time_microseconds':'sample_us'}
    for row in rows:
        suffix=row['metric']['__name__'].rsplit('.',1)[1]
        row['value']=[evaluated,str(value[mapping[suffix]]) if suffix!='available' else '1']
    for row in stamps:row['value']=[evaluated,str(value['sample_us']/1000000)]
    return raw(rows),raw(stamps)


class PendingFrame(unittest.TestCase):
    def test_actual_driver_waits_for_exact_committed_previous_cohort_during_async_visibility(self):
        previous={**EXPECTED,'sample_us':NOW-12_000_000,'postmaster_us':NOW-30_000_000,'stats_reset_us':NOW-40_000_000}
        expected={**previous,'sample_us':NOW+250_000}
        elapsed=[0.0];requests=[];owners=[]
        class Response:
            status=200
            headers=Message()
            def __init__(self,body):self.body=body.encode()
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,cap):return self.body
        class Endpoint:
            def open(self,request,timeout):
                parameters=urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
                requests.append(parameters)
                selected=previous if len(requests)<=2 else expected
                values,stamps=wire(selected,int(parameters['time'][0]))
                return Response(stamps if 'source_metric' in parameters['query'][0] else values)
        driver=scenario.Scenario(None,[],'A'*32,oracle);driver.end=200
        driver.ledger.accept(previous);driver.verify_storage=owners.append
        def sleep(seconds):elapsed[0]+=seconds
        with patch.object(queries.time,'time',side_effect=lambda:NOW/1000000+.5+elapsed[0]), \
                patch.object(queries.time,'time_ns',side_effect=lambda:int((NOW/1000000+.5+elapsed[0])*1000000)*1000), \
                patch.object(queries.time,'monotonic',side_effect=lambda:100+elapsed[0]), \
                patch.object(queries.time,'sleep',side_effect=sleep), \
                patch.object(queries.source_status_query,'_deadline',return_value=nullcontext()), \
                patch.object(queries.urllib.request,'build_opener',return_value=Endpoint()):
            result=driver.stored(expected,_baseline='second')
        self.assertEqual(result['freshness'],'fresh');self.assertLessEqual(result['age_seconds'],10)
        self.assertEqual(len(requests),4);self.assertEqual(len(owners),6)
        self.assertLess(elapsed[0],10)
        self.assertEqual(driver.ledger.last,previous)

    def test_pending_never_relabels_stale_as_healthy_or_skips_an_uncommitted_or_changed_frame(self):
        previous={**EXPECTED,'sample_us':NOW-12_000_000,'postmaster_us':NOW-30_000_000,'stats_reset_us':NOW-40_000_000}
        expected={**previous,'sample_us':NOW}
        values,stamps=wire(previous,1790000000)
        options={'evaluated_at':1790000000,'completed_us':NOW,'previous':previous,'expected':expected}
        self.assertTrue(oracle.previous_committed_pending(values,stamps,**options))
        ordinary=oracle.evaluate(values,stamps,evaluated_at=1790000000,completed_us=NOW,expected=expected)
        self.assertEqual((ordinary['freshness'],ordinary['reason']),('stale','stale'))
        for change in ({'previous':None},{'previous':{**previous,'connected_backends':4}},
                {'previous':{**previous,'sample_us':previous['sample_us']-1}},{'expected':previous}):
            self.assertFalse(oracle.previous_committed_pending(values,stamps,**{**options,**change}))
        decoded=json.loads(values)
        for metric,value in (('available','0'),('backends','4'),('sample_time_microseconds',str(NOW-13_000_000))):
            changed=copy.deepcopy(decoded)
            next(row for row in changed['data']['result'] if row['metric']['__name__'].endswith('.'+metric))['value'][1]=value
            self.assertFalse(oracle.previous_committed_pending(json.dumps(changed),stamps,**options))
        poisoned=copy.deepcopy(decoded);poisoned['data']['result'][-1]['metric']['private']='foreign'
        self.assertFalse(oracle.previous_committed_pending(json.dumps(poisoned),stamps,**options))
        current_values,current_stamps=wire(expected,1790000020)
        self.assertFalse(oracle.previous_committed_pending(current_values,current_stamps,**{**options,'evaluated_at':1790000020,'completed_us':NOW+20_000_000}))

    def test_decode_and_previous_frame_check_cannot_borrow_a_new_query_deadline(self):
        driver=scenario.Scenario(None,[],'A'*32,oracle);driver.end=200
        clock=[100.0];budgets=[]
        def read(*args,budget):
            budgets.append(budget);clock[0]=111
            values,stamps=wire(EXPECTED,1790000000)
            return values,stamps,1790000000,NOW
        with patch.object(scenario.time,'monotonic',side_effect=lambda:clock[0]),patch.object(queries,'read',side_effect=read):
            with self.assertRaises(TimeoutError):driver.stored(EXPECTED,_baseline='first')
        self.assertEqual(budgets,[10]);self.assertIsNone(driver.ledger.last)
