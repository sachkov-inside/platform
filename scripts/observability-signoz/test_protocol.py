"""Pinned scalar and MCP response boundaries; no network/provider calls."""
import copy
import unittest
from unittest.mock import patch

import control
import functional_witness as witness


def scalar(count):
    return {'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':'count'}],'data':[[count]]}]}}


class ClosedProtocol(unittest.TestCase):
    def test_explicit_zero_is_valid_but_missing_bool_nonfinite_and_warnings_fail(self):
        self.assertEqual(control.scalar(scalar(0)),0)
        for value in (None,{},scalar(None),scalar(True),scalar(float('nan')),scalar(-1),scalar(.5),dict(scalar(1),warning=['partial'])):
            with self.subTest(value=repr(value)),self.assertRaises(control.ControlFailure):control.scalar(value)

    def test_400_actual_points_cannot_be_replaced_with_a_maximum_or_duplicate_indices(self):
        names=['raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples']
        value={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':n} for n in names],'data':[[400,400,1,400,0,0]]}]}}
        self.assertEqual(witness.retained_count(value),400)
        for row in ([400,1,400,400,0,0],[400,400,1,400,0,1],[None,400,1,400,0,0]):
            changed=copy.deepcopy(value);changed['data']['results'][0]['data']=[row]
            with self.assertRaises(control.ControlFailure):witness.retained_count(changed)
        empty=copy.deepcopy(value);empty['data']['results'][0]['data']=[[0,0,None,None,0,0]]
        self.assertEqual(witness.retained_count(empty),0)
        missing=copy.deepcopy(value);missing['data']['results'][0]['data']=[]
        with self.assertRaises(control.ControlFailure):witness.retained_count(missing)

    def test_native_MCP_result_must_match_RPC_id_and_actual_scalar_not_a_text_claim(self):
        payload=witness.scalar_query('traces',witness.TRACE_ID)
        result={'jsonrpc':'2.0','id':3,'result':{'structuredContent':{'status':'success','data':scalar(1)}}}
        with patch.object(witness,'wire',return_value=(200,result)):
            self.assertEqual(witness.mcp_count(payload,'fixture-key'),1)
        for changed in (dict(result,id=4),dict(result,result={'isError':True,'content':[{'text':'success'}]}),
                        dict(result,result={'structuredContent':{'status':'success','data':{}}})):
            with patch.object(witness,'wire',return_value=(200,changed)),self.assertRaises(control.ControlFailure):
                witness.mcp_count(payload,'fixture-key')

    def test_agent_cannot_supply_filter_or_foreign_correlation_identity(self):
        with self.assertRaises(control.ControlFailure):witness.scalar_query('traces',"x' OR 1=1")
        corpus=witness.corpus()
        spans=corpus['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']
        logs=corpus['logs']['resourceLogs'][0]['scopeLogs'][0]['logRecords']
        self.assertEqual((spans[0]['traceId'],spans[0]['spanId']),(logs[0]['traceId'],logs[0]['spanId']))
        points=corpus['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['gauge']['dataPoints']
        self.assertEqual(len(points),400)
        self.assertEqual({p['asInt'] for p in points},{str(i) for i in range(1,401)})


if __name__ == '__main__':unittest.main()
