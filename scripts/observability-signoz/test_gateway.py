import http.client
import importlib.util
import json
import pathlib
import unittest

HERE=pathlib.Path(__file__).resolve().parent

class Gateway(unittest.TestCase):
    def test_real_HTTP_positive_unknown_and_invalid_requests(self):
        spec=importlib.util.spec_from_file_location('finite_gateway',HERE/'gateway.py')
        gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
        calls=[]
        def read(operation):
            calls.append(operation)
            if operation=='correlated_logs':raise RuntimeError('private upstream failure')
            return 400
        with gateway.serve('private-agent-token',read) as address:
            for body,key,status,expected in [
                ('{"operation":"retained_metrics","parameters":{}}','private-agent-token',200,{'state':'observed','count':400}),
                ('{"operation":"correlated_logs","parameters":{}}','private-agent-token',503,{'state':'unavailable'}),
                ('{"operation":"raw_sql","operation":"retained_metrics","parameters":{}}','private-agent-token',503,{'state':'unavailable'}),
                ('{"operation":"retained_metrics","parameters":{}}','wrong',403,{'state':'denied'}),
                (' '*16385,'private-agent-token',403,{'state':'denied'})]:
                conn=http.client.HTTPConnection(*address,timeout=2)
                try:
                    conn.request('POST','/read',body,{'Authorization':'Bearer '+key,'Content-Type':'application/json'})
                    response=conn.getresponse();self.assertEqual(response.status,status)
                    self.assertEqual(json.loads(response.read()),expected)
                finally:conn.close()
        self.assertEqual(calls,['retained_metrics','correlated_logs'])

    def test_native_HTTP_rejects_bypass_without_upstream_read(self):
        spec=importlib.util.spec_from_file_location('finite_gateway',HERE/'gateway.py')
        gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
        calls=[]
        with gateway.serve('private-agent-token',lambda op:calls.append(op)) as address:
            for method,path,body in [('POST','/api/v5/query_range',{}),('POST','/v1/metrics',{}),('DELETE','/api/v1/service_accounts/x',None),('POST','/read',{'operation':'raw_sql','parameters':{}}),('POST','/read',{'operation':'retained_metrics','parameters':{'sql':'SELECT 1'}})]:
                conn=http.client.HTTPConnection(*address,timeout=2)
                try:
                    conn.request(method,path,json.dumps(body) if body is not None else None,{'Authorization':'Bearer private-agent-token','Content-Type':'application/json'})
                    response=conn.getresponse();self.assertEqual(response.status,403);response.read()
                finally:conn.close()
        self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
