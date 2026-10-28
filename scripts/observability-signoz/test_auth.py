"""Owned loopback HTTP contract for pinned managed-viewer bootstrap and revoke."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading
import time
import unittest
from unittest.mock import patch

import control

ORG='00000000-0000-0000-0000-000000000001'
USER='00000000-0000-0000-0000-000000000002'
ROLE='00000000-0000-0000-0000-000000000003'
ACCOUNT='00000000-0000-0000-0000-000000000004'
KEY='00000000-0000-0000-0000-000000000005'


class AuthWire(unittest.TestCase):
    def exercise(self,wrong_identity):
        calls=[];revoked=[False]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def request(self):
                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))) if self.headers.get('Content-Length') else None
                calls.append((self.command,self.path))
                status=200;value=None;viewer=self.headers.get('SIGNOZ-API-KEY')=='fixture-viewer-key'
                if self.path=='/api/v1/register':value={'id':USER,'orgId':ORG}
                elif self.path=='/api/v2/sessions/email_password':value={'tokenType':'bearer','accessToken':'fixture-admin-key'}
                elif self.path=='/api/v1/roles':
                    if viewer:status=403
                    else:value=[{'id':ROLE,'orgId':ORG,'type':'managed','name':'signoz-viewer'}]
                elif self.path=='/api/v1/service_accounts':status=201;value={'id':ACCOUNT}
                elif self.path=='/api/v1/service_account_roles':
                    self.server.test.assertEqual(body,{'serviceAccountId':ACCOUNT,'roleId':ROLE});status=201;value={}
                elif self.path=='/api/v1/service_accounts/'+ACCOUNT+'/keys':status=201;value={'id':KEY,'key':'fixture-viewer-key'}
                elif self.path=='/api/v1/service_accounts/me':
                    if revoked[0]:status=401
                    else:value={'id':USER if wrong_identity else ACCOUNT,'orgId':ORG,'serviceAccountRoles':[{'roleId':ROLE}]}
                elif self.command=='DELETE' and self.path=='/api/v1/service_accounts/'+ACCOUNT+'/keys/'+KEY:
                    self.server.test.assertEqual(self.headers.get('Authorization'),'Bearer fixture-admin-key');status=204;revoked[0]=True
                elif self.path=='/api/v5/query_range':
                    self.server.test.assertTrue(viewer)
                    value={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':'span_count'}],'data':[[0]]}]}}
                else:status=404
                encoded=b'' if status==204 else json.dumps({'status':'success' if status<300 else 'error','data':value}).encode()
                self.send_response(status);self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
            do_GET=request
            do_POST=request
            do_DELETE=request
        server=HTTPServer(('127.0.0.1',0),Handler);server.test=self
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01));thread.start()
        try:
            with patch.object(control,'HOST','127.0.0.1'),patch.object(control,'PORT',server.server_port),patch.object(control,'DEADLINE',time.monotonic()+5),patch.object(control,'FUNCTIONAL_HOOK',None,create=True):
                if wrong_identity:
                    with self.assertRaises(control.ControlFailure):control.bootstrap()
                else:
                    result=control.bootstrap();self.assertEqual(result['viewer_identity'],1)
                    self.assertEqual(result['admin_read_denied'],1);self.assertEqual(result['revoke_denied'],1)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
        self.assertTrue(revoked[0])
        self.assertEqual(calls.count(('DELETE','/api/v1/service_accounts/'+ACCOUNT+'/keys/'+KEY)),1)

    def test_actual_HTTP_bootstrap_viewer_admin403_revoke204_then401(self):self.exercise(False)
    def test_wrong_service_account_identity_still_revokes_created_key(self):self.exercise(True)


if __name__=='__main__':unittest.main()
