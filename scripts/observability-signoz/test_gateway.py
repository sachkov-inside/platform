import http.client
import importlib.util
import json
import pathlib
import socket
import tempfile
import unittest
import agent_probe

HERE=pathlib.Path(__file__).resolve().parent

class Gateway(unittest.TestCase):
    def test_actual_Unix_HTTP_has_only_finite_reads_and_unlinks_owned_socket(self):
        spec=importlib.util.spec_from_file_location('finite_gateway',HERE/'gateway.py')
        gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
        calls=[]
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);root.chmod(0o700);path=root/'reader.sock'
            def read(operation):calls.append(operation);return {'retained_metrics':400,'correlated_traces':1,'correlated_logs':1,'mcp_correlated_traces':1}[operation]
            with gateway.serve_unix('fixture-agent-key',read,path):
                self.assertEqual(path.stat().st_mode & 0o777,0o600)
                self.assertGreater(agent_probe.socket_identity(path)['inode'],0)
                path.chmod(0o640)
                with self.assertRaises(ValueError):agent_probe.socket_identity(path)
                path.chmod(0o600)
                for operation,expected in [('retained_metrics',400),('correlated_traces',1),('correlated_logs',1),('mcp_correlated_traces',1)]:
                    conn=http.client.HTTPConnection('owned-unix',timeout=2)
                    conn.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);conn.sock.settimeout(2);conn.sock.connect(str(path))
                    try:
                        conn.request('POST','/read',json.dumps({'operation':operation,'parameters':{}}),{'Authorization':'Bearer fixture-agent-key'})
                        response=conn.getresponse();self.assertEqual(response.status,200)
                        self.assertEqual(json.loads(response.read()),{'state':'observed','count':expected})
                    finally:conn.close()
                for method,url,body,key in [('POST','/private',{},'fixture-agent-key'),('DELETE','/api/v1/service_accounts/x',{},'fixture-agent-key'),
                    ('POST','/api/v5/query_range',{},'fixture-agent-key'),('POST','/read',{'operation':'retained_metrics','parameters':{}},'wrong')]:
                    conn=http.client.HTTPConnection('owned-unix',timeout=2)
                    conn.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);conn.sock.settimeout(2);conn.sock.connect(str(path))
                    try:
                        conn.request(method,url,None if body is None else json.dumps(body),{'Authorization':'Bearer '+key})
                        response=conn.getresponse();self.assertEqual(response.status,403);self.assertEqual(json.loads(response.read()),{'state':'denied'})
                    finally:conn.close()
            self.assertFalse(path.exists());self.assertEqual(len(calls),4)

    def test_replaced_Unix_socket_is_not_unlinked_as_owned(self):
        spec=importlib.util.spec_from_file_location('finite_gateway',HERE/'gateway.py')
        gateway=importlib.util.module_from_spec(spec);spec.loader.exec_module(gateway)
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);root.chmod(0o700);path=root/'reader.sock'
            with self.assertRaisesRegex(ValueError,'socket_identity_changed'):
                with gateway.serve_unix('fixture-agent-key',lambda _op:1,path):
                    path.unlink();path.write_text('foreign replacement')
            self.assertEqual(path.read_text(),'foreign replacement')

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
