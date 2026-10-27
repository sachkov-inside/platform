"""Owned Docker transport: stored Web evidence cannot pass after its visibility deadline."""
import unittest
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from unittest.mock import patch

import fullstack


class WebHttp(unittest.TestCase):
    def test_actual_witness_reads_only_the_fixed_metrics_alias_and_requires_complete_private_source(self):
        requests=[];mode=['complete']
        rows='inside_web_http_requests_total{route="/_health/live",method="GET",code="200",outcome="completed"} 1\ninside_web_http_requests_total{route="_unmatched",method="GET",code="404",outcome="completed"} 1\n'
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path.startswith('/_health/live?'):status,body=200,'ready'
                elif self.path.startswith('/missing-private-http-sentinel?'):status,body=404,'absent'
                elif self.path=='/metrics':
                    status=503 if mode[0]=='unavailable' else 200
                    body=rows if mode[0]!='missing' else rows.splitlines()[0]
                    if mode[0]=='private':body+='private-http-sentinel'
                else:raise AssertionError('unexpected fixture request')
                self.send_response(status);self.end_headers();self.wfile.write(body.encode())
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                loader=Path(directory)/'preload.mjs'
                loader.write_text("import fs from 'node:fs';import http from 'node:http';import {syncBuiltinESMExports} from 'node:module';\n"
                    +"const read=fs.readFileSync;fs.readFileSync=(p,...a)=>read(p==='/resource/full-profile.json'?"+json.dumps(str(fullstack.PROFILE))+":p,...a);\n"
                    +"const request=http.request;http.request=(o,cb)=>{if(!['web','inside-web-http'].includes(o.hostname))throw new Error('fixture target');return request({...o,hostname:'127.0.0.1',port:"+str(server.server_port)+"},cb);};syncBuiltinESMExports();")
                node=shutil.which('node');self.assertIsNotNone(node)
                def run(*args):
                    return subprocess.run([node,'--import',str(loader),str(fullstack.HERE/'client.mjs'),*args],capture_output=True,text=True,timeout=8)
                for current in ('complete','missing','private','unavailable'):
                    mode[0]=current;requests.clear()
                    result=run('web-http-witness')
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertEqual(json.loads(result.stdout),{'ok':current=='complete'})
                    self.assertEqual(len(requests),3)
                    self.assertEqual(requests[-1],'/metrics')
                for host,port,path in (('inside-web-http','9421','/metrics'),('inside-web-http','9420','/'),
                        ('inside-web-http.example','9420','/metrics'),('169.254.169.254','9420','/metrics')):
                    requests.clear();result=run('ready',host,port,path,'7'*40)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('private target only',result.stderr)
                    self.assertEqual(requests,[])
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_late_valid_stored_source_is_rejected_and_each_query_uses_remaining_time(self):
        now=[100];calls=[]
        def command(compose,args,*,timeout):
            calls.append((args[-1],timeout))
            if args[-1]=='web-http-witness':return '{"ok":true}'
            if len(calls)==2:now[0]=109;return '{"ok":false}'
            now[0]=111;return '{"ok":true}'
        with patch.object(fullstack.pilot,'command',return_value='7'*40),patch.object(fullstack,'invoke',side_effect=command), \
                patch.object(fullstack.time,'monotonic',side_effect=lambda:now[0]),patch.object(fullstack.pilot.time,'sleep'):
            with self.assertRaises(RuntimeError):fullstack.prove_web_http([])
        self.assertEqual(calls[-1][1],1)
