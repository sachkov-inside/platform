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
    def test_closed_tool_unavailability_is_distinct_from_invalid_protocol_metadata(self):
        import caddy_mcp
        error={'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':'owned query transport failed'}],'isError':True}}
        with self.assertRaises(caddy_mcp.QueryUnavailable):caddy_mcp.decode_response(json.dumps(error).encode(),3)
        error['result']['private']='unknown'
        with self.assertRaises(ValueError) as refused:caddy_mcp.decode_response(json.dumps(error).encode(),3)
        self.assertNotIsInstance(refused.exception,caddy_mcp.QueryUnavailable)

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
        legacy={'protocolVersion':'2024-11-05','capabilities':{},'serverInfo':{'name':'fixture','version':'1'}}
        def initialize(result):
            return json.dumps({'jsonrpc':'2.0','id':1,'result':result}).encode()
        self.assertEqual(caddy_mcp.decode_response(initialize(legacy),1)['result'],legacy)
        fixture=Path(__file__).with_name('fixtures')/'mcp.py'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);report=root/'child.json';body=root/'body.json'
            vector,_=acquisition();body.write_text(json.dumps(vector))
            environment={'PATH':os.environ.get('PATH',''),'HOME':directory,'CADDY_TEST_REPORT':str(report),'CADDY_TEST_BODY_FILE':str(body)}
            discoveries=[]
            def decode(raw,expected_id):
                response=caddy_mcp.decode_response(raw,expected_id)
                if expected_id==2:discoveries.append(response)
                return response
            try:
                proof=pilot.stdio_probe(Path(sys.executable),environment,'query',{'time':'100'},'caddy_http_requests_total',
                    argv=[sys.executable,str(fixture)],decode_response=decode)
                self.assertEqual(proof['known_fixture'],'passed')
            finally:
                self.assertTrue(report.exists())
                pid=json.loads(report.read_text())['pid']
                with self.assertRaises(ProcessLookupError): os.kill(pid,0)

        # The pinned public producer sets this optional SDK string. Its contents
        # are ignored metadata, never instructions executed by the consumer.
        for text in ('Controlled public metadata.','', 'é'*512):
            result={**legacy,'instructions':text}
            self.assertEqual(caddy_mcp.decode_response(initialize(result),1)['result'],result)
        invalid=[{**legacy,'instructions':value} for value in (None,True,1,[],{})]
        invalid.extend(({**legacy,'instructions':'é'*512+'a'},
                        {**legacy,'instructions':'PRIVACY_SENTINEL_1566'},
                        {**legacy,'instructions':'private-caddy-sentinel'},
                        {**legacy,'instructions':'public','unknown':'public'},
                        {**legacy,'instructions':'public','protocolVersion':'2025-03-26'},
                        {**legacy,'instructions':'public','serverInfo':{'name':'fixture','version':'1','unknown':'public'}},
                        {**legacy,'instructions':'public','capabilities':{'unknown':{}}}))
        for result in invalid:
            with self.subTest(result_keys=sorted(result)),self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
                caddy_mcp.decode_response(initialize(result),1)
        duplicate=initialize({**legacy,'instructions':'public'}).replace(b'"instructions": "public"',b'"instructions":"public","instructi\\u006fns":"public"')
        with self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
            caddy_mcp.decode_response(duplicate,1)
        tool={'content':[{'type':'text','text':json.dumps(vector)}],'instructions':'public'}
        with self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
            caddy_mcp.decode_response(json.dumps({'jsonrpc':'2.0','id':3,'result':tool}).encode(),3)

        self.assertEqual(len(discoveries),1)
        catalog=discoveries[0]
        self.assertEqual(caddy_mcp.decode_response(json.dumps(catalog).encode(),2),catalog)
        tools={tool['name']:tool for tool in catalog['result']['tools']}
        self.assertEqual(list(tools),['active_queries','alerts','documentation','explain_query','label_values','labels',
            'metric_statistics','metrics','metrics_metadata','prettify_query','query','query_range','rules','series','top_queries','tsdb_status'])
        self.assertEqual({key:value['type'] for key,value in tools['top_queries']['inputSchema']['properties'].items()},
            {'topN':'number','maxLifetime':'string'})
        self.assertEqual(tools['top_queries']['inputSchema']['required'],['topN'])
        self.assertEqual({key:value['type'] for key,value in tools['tsdb_status']['inputSchema']['properties'].items()},
            {'topN':'number','focusLabel':'string','date':'string','match':'string','extraLabel':'string'})
        self.assertEqual(tools['tsdb_status']['inputSchema']['required'],[])
        query_only={'jsonrpc':'2.0','id':2,'result':{'tools':[tools['query']]}}
        self.assertEqual(caddy_mcp.decode_response(json.dumps(query_only).encode(),2),query_only)
        for name,original,invalid in (('top_queries','topN','TopN'),('top_queries','maxLifetime','maxLifetimE'),
                ('tsdb_status','focusLabel','FocusLabel'),('tsdb_status','extraLabel','extraLabeL')):
            changed=json.loads(json.dumps(catalog))
            schema=next(tool for tool in changed['result']['tools'] if tool['name']==name)['inputSchema']
            schema['properties'][invalid]=schema['properties'].pop(original)
            schema['required']=[invalid if key==original else key for key in schema['required']]
            with self.subTest(invalid_property=invalid),self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
                caddy_mcp.decode_response(json.dumps(changed).encode(),2)
        # Validate the whole catalog, including unrelated and final tool metadata.
        for name in ('active_queries','tsdb_status'):
            for poison in ('unknownCamel','oversize_name','wrong_type','unknown_schema','private','sentinel','oversize_metadata','tool_name'):
                changed=json.loads(json.dumps(catalog))
                tool=next(tool for tool in changed['result']['tools'] if tool['name']==name)
                if poison=='unknownCamel':tool['inputSchema']['properties']['unknownCamel']={'type':'string'}
                elif poison=='oversize_name':tool['inputSchema']['properties']['a'*65]={'type':'string'}
                elif poison=='wrong_type':tool['inputSchema']['properties']['poison']={'type':[]}
                elif poison=='unknown_schema':tool['inputSchema']['unknown']='public'
                elif poison=='private':tool['description']='private-caddy-sentinel'
                elif poison=='sentinel':tool['description']='PRIVACY_SENTINEL_1566'
                elif poison=='oversize_metadata':tool['description']='é'*512+'a'
                else:tool['name']='InvalidTool'
                with self.subTest(tool=name,poison=poison),self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
                    caddy_mcp.decode_response(json.dumps(changed).encode(),2)
        for poison in ('properties','required','readOnlyHint','destructiveHint','openWorldHint'):
            changed=json.loads(json.dumps(catalog))
            query=next(tool for tool in changed['result']['tools'] if tool['name']=='query')
            if poison=='properties':query['inputSchema']['properties']['extra']={'type':'string'}
            elif poison=='required':query['inputSchema']['required']=[]
            else:query['annotations'][poison]=not query['annotations'][poison]
            with self.subTest(query_contract=poison),self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
                caddy_mcp.decode_response(json.dumps(changed).encode(),2)
        duplicate=json.dumps(catalog).encode().replace(b'"maxLifetime":',b'"maxLifetime":{},"maxLifetim\\u0065":',1)
        with self.assertRaisesRegex(ValueError,'^closed Caddy MCP refusal$'):
            caddy_mcp.decode_response(duplicate,2)

    def test_embedded_valid_vm_numeric_timestamp_does_not_fail_privacy_scan_serialization(self):
        import caddy_mcp
        from test_observation import acquisition
        values,_=acquisition()
        for row in values['data']['result']:row['value'][0]=100.0
        raw=json.dumps(values)
        self.assertEqual(caddy_mcp.body({'content':[{'type':'text','text':raw}]}),raw.encode())
