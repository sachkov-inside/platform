"""Strict opt-in MCP parsing crosses the actual externally owned RPC reader."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import pilot


def unique(pairs):
    value={}
    for key,item in pairs:
        if key in value: raise ValueError('closed Caddy protocol refusal')
        value[key]=item
    return value


class OptInReader(unittest.TestCase):
    def test_duplicate_response_is_refused_before_tool_extraction_and_owned_child_is_reaped(self):
        fixture=Path(__file__).with_name('fixtures')/'mcp.py'
        with tempfile.TemporaryDirectory() as directory:
            report=Path(directory)/'child.json'
            environment={'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(report),'CADDY_TEST_BAD':'duplicate'}
            def decode(raw,expected_id):
                value=json.loads(raw,object_pairs_hook=unique)
                if value.get('id')!=expected_id: raise ValueError('closed Caddy protocol refusal')
                return value
            try:
                with self.assertRaisesRegex(ValueError,'closed Caddy protocol refusal'):
                    pilot.stdio_probe(Path(sys.executable),environment,'query',{},'caddy_http_requests_total',
                        argv=[sys.executable,str(fixture)],decode_response=decode)
            finally:
                if report.exists():
                    pid=json.loads(report.read_text())['pid']
                    with self.assertRaises(ProcessLookupError): os.kill(pid,0)

class StrictWire(unittest.TestCase):
    def test_designated_vm_text_can_exceed1024_but_full_envelope_never_accepts_private_or_duplicate_metadata(self):
        import caddy_mcp
        from test_observation import acquisition
        value,_=acquisition()
        result={'content':[{'type':'text','text':json.dumps(value)}]}
        raw=json.dumps({'jsonrpc':'2.0','id':3,'result':result}).encode()
        self.assertGreater(len(result['content'][0]['text']),1024)
        parsed=caddy_mcp.decode_response(raw,3)
        self.assertEqual(json.loads(caddy_mcp.body(parsed['result'])),value)
        cases=[raw.replace(b'"id": 3',b'"id":3,"i\\u0064":3'),
               json.dumps({'jsonrpc':'2.0','id':3,'result':{**result,'private':'private-caddy-sentinel'}}).encode(),
               json.dumps({'jsonrpc':'2.0','id':3,'result':{**result,'isError':True}}).encode(),
               json.dumps({'jsonrpc':'2.0','id':True,'result':result}).encode(),
               json.dumps({'jsonrpc':'2.0','id':3,'result':result,'error':{'message':'private-caddy-sentinel'}}).encode()]
        for body in cases:
            with self.subTest(raw_bytes=len(body)),self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
                caddy_mcp.decode_response(body,3)


    def test_actual_owned_rpc_uses_strict_initialization_discovery_and_complete_tool_body(self):
        import caddy_mcp
        from test_observation import acquisition
        fixture=Path(__file__).with_name('fixtures')/'mcp.py'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);report=root/'child.json';body=root/'body.json'
            vector,_=acquisition();body.write_text(json.dumps(vector))
            environment={'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(report),'CADDY_TEST_BODY_FILE':str(body)}
            try:
                proof=pilot.stdio_probe(Path(sys.executable),environment,'query',{'time':'100'},'caddy_http_requests_total',
                    argv=[sys.executable,str(fixture)],decode_response=caddy_mcp.decode_response)
                self.assertEqual(proof['known_fixture'],'passed')
            finally:
                self.assertTrue(report.exists())
                pid=json.loads(report.read_text())['pid']
                with self.assertRaises(ProcessLookupError): os.kill(pid,0)
