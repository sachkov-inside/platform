"""SOURCE-MODEL: actual local HTTP bytes, never native SigNoz evidence."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch

import representative_reader as reader
import signoz_queries as queries
import test_signoz_queries as fixtures
from test_signoz_queries import response


@contextmanager
def upstream(responses):
    class Calls(list):pass
    requests=Calls()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,body):
            requests.append((self.path,body))
            status,raw=responses[len(requests)-1]
            self.send_response(status);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        def do_POST(self):self.reply(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        def do_GET(self):self.reply(None)
    server=HTTPServer(('127.0.0.1',0),Handler)
    requests.port=server.server_port
    thread=threading.Thread(target=server.serve_forever);thread.start()
    original=http.client.HTTPConnection
    def connection(host,port=None,**options):
        if host in ('mcp','signoz-signoz-0'):return original('127.0.0.1',server.server_port,**options)
        return original(host,port,**options)
    try:
        with patch.object(reader.http.client,'HTTPConnection',side_effect=connection):yield requests
    finally:server.shutdown();server.server_close();thread.join()


class Transport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.RepresentativeQueries.setUpClass.__func__(cls)
    def reads(self):return queries.RepresentativeReads(self.layout,4,1800000000000,1800000020000)
    def test_same_request_original_envelope_http_mcp_parity(self):
        reads=self.reads();request=reads.prepare('readiness_metrics',{})
        raw=response(('count',),[[1]])
        rpc=json.dumps({'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':raw.decode()}]}}).encode()
        with upstream([(200,raw),(200,rpc)]) as calls:
            native=reader.NativeReads('private-model-key',time.monotonic()+10)
            self.assertEqual(native.observe(reads,request),{'ok':True})
        self.assertEqual(calls,[('/api/v5/query_range',request.payload),('/mcp',{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'signoz_execute_builder_query','arguments':{'query':request.payload}}})])
        self.assertNotIn('private-model-key',repr(native))
    def test_mcp_never_wraps_stripped_data_or_trusts_notes_structured_content(self):
        raw=response(('count',),[[1]])
        base={'content':[{'type':'text','text':raw.decode()}]}
        variants=[{'content':[{'type':'text','text':json.dumps(json.loads(raw)['data'])}]},
            base|{'structuredContent':json.loads(raw)},base|{'isError':True},
            {'content':base['content']+[{'type':'text','text':'warning'}]},
            {'content':[{'type':'text','text':'{"status":"success","status":"success"}'}]}]
        for value in variants:
            with self.subTest(value=value):
                rpc=json.dumps({'jsonrpc':'2.0','id':3,'result':value}).encode()
                with upstream([(200,raw),(200,rpc)]),self.assertRaises(ValueError):
                    reads=self.reads();reader.NativeReads('model',time.monotonic()+10).observe(reads,reads.prepare('readiness_metrics',{}))
    def test_query_cannot_use_inventory_receive_capability(self):
        reads=self.reads();request=reads.prepare('readiness_metrics',{})
        for status,raw in [(503,b'{}'),(200,b' '*65537),(200,b'{"status":"error","data":{}}')]:
            with self.subTest(status=status,size=len(raw)),upstream([(status,raw)]),self.assertRaises(ValueError):
                reader.NativeReads('model',time.monotonic()+10).observe(reads,request)

    def test_initialize_notification_and_inventory_only_large_receive(self):
        initialized=json.dumps({'jsonrpc':'2.0','id':1,'result':{'protocolVersion':'2025-11-25'}}).encode()
        inventory=json.dumps({'jsonrpc':'2.0','id':2,'result':{'tools':[{'name':'signoz_execute_builder_query','description':'x'*70000}],'nextCursor':None}}).encode()
        with upstream([(200,b'{}'),(200,initialized),(202,b''),(200,inventory)]) as calls:
            self.assertEqual(reader.NativeReads('model',time.monotonic()+10).initialize(),{'initialized':True,'tools':1})
        self.assertEqual(calls[0],('/readyz',None))
        self.assertEqual(calls[2],('/mcp',{'jsonrpc':'2.0','method':'notifications/initialized'}))
        self.assertEqual(calls[3],('/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}))
    def test_first_transport_object_and_traceback_survive_secondary_close_error(self):
        first=RuntimeError('owned-first-boundary-error')
        class Fault:
            def request(self,*args):raise first
            def close(self):raise RuntimeError('secondary-close')
        with patch.object(reader.http.client,'HTTPConnection',return_value=Fault()),self.assertRaises(RuntimeError) as raised:
            reads=self.reads();reader.NativeReads('model',time.monotonic()+10).observe(reads,reads.prepare('readiness_metrics',{}))
        self.assertIs(raised.exception,first)


class Rendezvous(unittest.TestCase):
    def test_real_files_bind_birth_generation_and_refuse_replay(self):
        import os
        from pathlib import Path
        import tempfile
        import representative_scope as scopes
        with tempfile.TemporaryDirectory() as temporary:
            parent=Path(temporary).resolve();parent.chmod(0o700)
            birth={'start_ticks':'123','netns':'net:[1]','pidns':'pid:[2]'}
            with patch.object(scopes,'_process_receipt',return_value=birth):
                channel=reader._Rendezvous.create(parent/'session',{'nonce':'a'*32,'deadline_mono_ns':time.monotonic_ns()+10**9})
                client=reader._Rendezvous.attach(parent/'session',channel.binding)
                client.submit(1,'b'*64)
                self.assertEqual(channel.pending(),(1,'b'*64))
                with self.assertRaises(ValueError):client.submit(1,'b'*64)
                channel.acknowledge(1,'b'*64,{'reads':10})
                self.assertEqual(client.result(1,'b'*64),{'reads':10})
                client.finish()
                with self.assertRaises(ValueError):channel.accept(1,'b'*64)
                channel.close()
                self.assertFalse((parent/'session').exists())
    def test_replaced_file_and_changed_birth_refuse_before_result(self):
        from pathlib import Path
        import tempfile
        import representative_scope as scopes
        with tempfile.TemporaryDirectory() as temporary:
            parent=Path(temporary).resolve();parent.chmod(0o700)
            birth={'start_ticks':'123','netns':'net:[1]','pidns':'pid:[2]'}
            with patch.object(scopes,'_process_receipt',return_value=birth):
                channel=reader._Rendezvous.create(parent/'session',{'nonce':'a'*32,'deadline_mono_ns':time.monotonic_ns()+10**9})
                client=reader._Rendezvous.attach(parent/'session',channel.binding);client.submit(1,'b'*64)
                original=(parent/'session/request.json').read_bytes()
                (parent/'session/request.json').rename(parent/'session/foreign')
                (parent/'session/request.json').write_bytes(original);(parent/'session/request.json').chmod(0o600)
                with self.assertRaises(ValueError):client.finish()
                (parent/'session/request.json').unlink();(parent/'session/foreign').rename(parent/'session/request.json')
                with patch.object(scopes,'_process_receipt',return_value=birth|{'start_ticks':'124'}),self.assertRaises(ValueError):channel.pending()
                client.finish();channel.close()


class ResidentRequests(unittest.TestCase):
    def test_actual_resident_process_owns_scope_and_every_agent_request_queries_http_and_mcp(self):
        import os
        import signal
        import subprocess
        import sys
        from pathlib import Path
        import tempfile
        import representative_scope as scopes
        import representative_agent as agent
        import test_representative_owner as owner_fixtures
        from test_representative_scope import MODEL
        from test_signoz_queries import START,CUT
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve()
            prepared,native,owner,layout=owner_fixtures.NativeOwner().prepare(root);owner.create();owner.start('sig-disk')
            gateway=root/'gateway';gateway.mkdir(mode=0o700);path=gateway/'reader.sock'
            with patch.object(scopes,'_process_receipt',return_value=MODEL),patch.object(scopes.time,'time',return_value=CUT/1000):
                dispatch=scopes.mint(owner,4,START,CUT)
                document=json.loads((prepared/'signoz/private/representative-scope/current.json').read_bytes())
                raw=response(('count',),[[1]])
                rpc=json.dumps({'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':raw.decode()}]}}).encode()
                child=None;client=None;channel=None
                with upstream([(200,raw),(200,rpc),(200,raw),(200,rpc)]) as calls:
                    script=root/'model-resident.py'
                    script.write_text("import sys,time,http.client,json\nfrom pathlib import Path\n"
                        +"sys.path.insert(0,"+repr(str(prepared/'signoz/driver/scripts/observability-fullstack'))+")\n"
                        +"import representative_scope as scopes,representative_reader as reader\n"
                        +"scopes._PRIVATE=Path("+repr(str(prepared/'signoz/private/representative-scope'))+")\n"
                        +"scopes._process_receipt=lambda pid:"+repr(MODEL)+"\nscopes.time.time=lambda:"+repr(CUT/1000)+"\n"
                        +"reader._GATEWAY=Path("+repr(str(path))+")\n"
                        +"original=http.client.HTTPConnection\nhttp.client.HTTPConnection=lambda host,port,**options:original('127.0.0.1',"+str(calls.port)+",**options)\n"
                        +"end=time.monotonic()+2\nchannel=reader._Rendezvous.create(Path("+repr(str(root/'channel'))+"),{'nonce':"+repr(document['binding']['nonce'])+",'deadline_mono_ns':int(end*10**9)})\n"
                        +"session={'deadline_mono_ns':int(end*10**9),'binding':"+repr(document['binding'])+",'agent_key':'a'*64,'sdk':{}}\n"
                        +"reader._SESSION=Path("+repr(str(root/'model-session.json'))+")\nidentity=scopes._write(reader._SESSION,scopes._encoded(session))\n"
                        +"try:reader._serve_corpus(channel,reader.NativeReads('native-private-model',end),session,identity)\nexcept ValueError:sys.exit(25)\n")
                    child=subprocess.Popen([sys.executable,'-I','-B',str(script)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,start_new_session=True)
                    try:
                        until=time.monotonic()+1
                        while not path.exists() and time.monotonic()<until:threading.Event().wait(.01)
                        self.assertTrue(path.exists())
                        config={'agent_key':'a'*64,'socket_identity':agent.socket_identity(path)}
                        binding=json.loads((root/'channel/resident.json').read_bytes())
                        client=reader._Rendezvous.attach(root/'channel',binding);client.submit(document['generation'],dispatch.digest)
                        for operation in ('readiness_metrics','readiness_traces'):
                            self.assertEqual(agent.wire(config,time.monotonic()+1,path=path,body={'operation':operation,'parameters':{}}),
                                (200,{'state':'observed','observation':{'ok':True}}))
                        self.assertEqual(len(calls),4);self.assertNotEqual(calls[0][1],calls[2][1])
                        self.assertFalse((root/'channel/ack.json').exists())
                        client.finish()
                        self.assertEqual(child.wait(timeout=3),25,child.stderr.read().decode())
                    finally:
                        if child.poll() is None:os.killpg(child.pid,signal.SIGKILL)
                        child.wait(timeout=3);child.stderr.close()
                # Model-only /proc receipts above cannot establish native cleanup;
                # exact client files/socket were removed and TemporaryDirectory owns
                # the remaining resident receipt after this intentional deadline.
                dispatch.close()
            self.assertTrue(owner.cleanup_exact())


class CompleteCorpus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):fixtures.RepresentativeQueries.setUpClass.__func__(cls)
    def reads(self):return queries.RepresentativeReads(self.layout,4,1800000000000,1800000020000)
    def test_400_physical_neighbours_and_all_sdk_maps_fit_both_private_wires_losslessly(self):
        import test_representative_stored as native_fixtures
        import representative_stored as stored
        reads=self.reads();bundle=native_fixtures.complete_metric_corpus()
        # The transport fixture uses the same immutable owning source binding.
        for signal in ('traces','metrics'):
            for row in bundle[signal]:
                for field in ('resource','resources_string','resource_attrs'):
                    resource=row.get(field)
                    if isinstance(resource,dict) and resource.get('service.version')=='c'*40:resource['service.version']=reads.binding['source']['commit']
                if signal=='metrics':
                    labels={**row['attrs'],**row['scope_attrs'],**row['resource_attrs'],'__name__':row['metric_name']}
                    row['labels']=json.dumps(labels,sort_keys=True,separators=(',',':'))
        legacy=native_fixtures.scalar_wire(stored.METRIC_COLUMNS,bundle['metrics'])
        self.assertGreater(len(legacy),65536)
        wire=[];sizes=[]
        def exchange(columns,rows):
            raw=native_fixtures.scalar_wire(columns,rows)
            rpc=json.dumps({'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':raw.decode()}]}},separators=(',',':')).encode()
            sizes.append((len(raw),len(rpc)));self.assertLessEqual(len(raw),65536);self.assertLessEqual(len(rpc),65536)
            wire.extend([(200,raw),(200,rpc)])
        exchange(stored.TRACE_COLUMNS,bundle['traces']);exchange(stored.LOG_COLUMNS,bundle['logs'])
        for groups in native_fixtures.compact_metric_rows(bundle['metrics']).values():exchange((*native_fixtures.METADATA_FIELDS,'samples_json'),groups)
        exchange(stored.META_COLUMNS,bundle['metadata'])
        for case in ('zero','latest','future'):exchange(queries.SOURCE_COLUMNS,native_fixtures.probe_scalar_rows(case))
        value={'start_ms':1800000000000,'cut_ms':1800000020000,'binding':reads.binding}
        with upstream(wire):
            verdict=reader.NativeReads('SOURCE-MODEL-native-key',time.monotonic()+10).stored(reads,value,{'trace_id':'a'*32,'root_id':'b'*16})
        self.assertEqual(verdict['sdk_metric_semantics'],'passed')
        self.assertEqual(verdict['logical_series'],67)
        self.assertEqual(verdict['native_probe_cases'],['zero','latest_zero','future'])
        self.assertEqual(len(wire),20)
        print('SOURCE-MODEL compact489 HTTP/MCP bytes: '+json.dumps(sizes))

    def test_one_deadline_is_not_reset_between_fixed_metric_partitions(self):
        import representative_stored as stored
        import test_representative_stored as native_fixtures
        reads=self.reads()
        raw=[]
        for columns in (stored.TRACE_COLUMNS,stored.LOG_COLUMNS,stored.METRIC_GROUP_COLUMNS):
            body=native_fixtures.scalar_wire(columns,[])
            raw.extend([(200,body),(200,json.dumps({'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':body.decode()}]}}).encode())])
        value={'start_ms':1800000000000,'cut_ms':1800000020000,'binding':reads.binding}
        # Actual HTTP GET/POST serving remains real; only the owning monotonic
        # clock advances after the first partition's complete HTTP/MCP pair.
        with upstream(raw) as calls,patch.object(reader.time,'monotonic',side_effect=lambda:100.0 if len(calls)<6 else 111.0):
            native=reader.NativeReads('SOURCE-MODEL',110.0)
            with self.assertRaisesRegex(ValueError,'deadline'):
                native.stored(reads,value,{'trace_id':'a'*32,'root_id':'b'*16})
        self.assertEqual(len(calls),6)
        self.assertTrue(all(payload['start']==1800000000000 and payload['end']==1800000020000
            for _path,body in calls for payload in ([body] if _path!='/mcp' else [body['params']['arguments']['query']])))
    def test_total_physical_cap_across_all_four_parts_cannot_be_hidden_in_groups(self):
        import representative_stored as stored
        import test_representative_stored as native_fixtures
        reads=self.reads();rows=[]
        template=next(row for row in native_fixtures.complete_metric_corpus()['metrics'] if row['metric_name']=='pilot_requests')
        for index in range(1001):rows.append(dict(template,fingerprint=str(index%4),unix_milli=1800000001000+index))
        wire=[]
        def exchange(columns,data):
            body=native_fixtures.scalar_wire(columns,data)
            rpc=json.dumps({'jsonrpc':'2.0','id':3,'result':{'content':[{'type':'text','text':body.decode()}]}},separators=(',',':')).encode()
            self.assertLess(len(body),65536);self.assertLess(len(rpc),65536);wire.extend([(200,body),(200,rpc)])
        exchange(stored.TRACE_COLUMNS,[]);exchange(stored.LOG_COLUMNS,[])
        for groups in native_fixtures.compact_metric_rows(rows).values():exchange(stored.METRIC_GROUP_COLUMNS,groups)
        value={'start_ms':1800000000000,'cut_ms':1800000020000,'binding':reads.binding}
        with upstream(wire),self.assertRaisesRegex(ValueError,'physical_row_cap'):
            reader.NativeReads('SOURCE-MODEL',time.monotonic()+10).stored(reads,value,{'trace_id':'a'*32,'root_id':'b'*16})


class IsolatedDigestEntrypoint(unittest.TestCase):
    def test_isolated_digest_read_reaches_valid_ack_after_verified_mirror(self):
        import subprocess
        import sys
        from pathlib import Path
        code=r'''import importlib.util,json,tempfile,types
from pathlib import Path
p=Path(READER)
spec=importlib.util.spec_from_file_location('isolated_reader',p)
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
s=r._load_scopes()
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary).resolve();root.chmod(0o700)
 mirror=s._install_mirror(root)
 s._DRIVER=root
 digest='a'*64;nonce='b'*32
 value={'generation':1,'binding':{'nonce':nonce},'deadline_mono_ns':10**30,'mirror':{name:item[0] for name,item in mirror.items()}}
 request={'generation':1,'digest':digest,'nonce':nonce};ack=request|{'result':{'reads':10}}
 channel=types.SimpleNamespace(path=root,check=lambda:None,request=('request-id',request),binding={'session':{'nonce':nonce}},submit=lambda *args:None,finish=lambda:None)
 (root/'ack.json').write_text('source-model')
 channel.result=lambda *args:r._Rendezvous.result(channel,*args)
 r._Rendezvous.attach=lambda *args:channel
 s.load_current=lambda digest:object();s._consume=lambda scope:value;s._check_reader=lambda scope:None
 original=s._read
 def read(path,**kwargs):
  if path.name=='resident.json':return r.encoded({'session':{'nonce':nonce}}),'resident-id'
  if path.name=='request.json':return r.encoded(request),'request-id'
  if path.name=='ack.json':return r.encoded(ack),'ack-id'
  return original(path,**kwargs)
 s._read=read
 print(json.dumps(r.read_current(digest)))
'''.replace('READER',repr(str(Path(reader.__file__).resolve())))
        result=subprocess.run([sys.executable,'-I','-B','-c',code],capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'read_verified':True,'generation':1,'digest':'a'*64,'reads':10})
