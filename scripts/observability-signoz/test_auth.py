"""Owned loopback HTTP contract for pinned managed-viewer bootstrap and revoke."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import runpy
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import control

ORG='00000000-0000-0000-0000-000000000001'
USER='00000000-0000-0000-0000-000000000002'
ROLE='00000000-0000-0000-0000-000000000003'
ACCOUNT='00000000-0000-0000-0000-000000000004'
KEY='00000000-0000-0000-0000-000000000005'


class AuthWire(unittest.TestCase):
    def exercise(self,wrong_identity,*,project_failure=False,revoke_status=204,failure_hook=None,observed_errors=None,expected_revoke_calls=1,responses=None):
        calls=[];revoked=[False]
        deadlines=[]
        failure=None
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def request(self):
                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))) if self.headers.get('Content-Length') else None
                calls.append((self.command,self.path))
                deadlines.append(control.DEADLINE)
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
                    self.server.test.assertEqual(self.headers.get('Authorization'),'Bearer fixture-admin-key');status=revoke_status;revoked[0]=status==204
                elif self.path=='/api/v5/query_range':
                    self.server.test.assertTrue(viewer)
                    value={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{'name':'span_count'}],'data':[[0]]}]}}
                else:status=404
                if responses and self.path in responses:value=responses[self.path]
                encoded=b'' if status==204 else json.dumps({'status':'success' if status<300 else 'error','data':value}).encode()
                self.send_response(status);self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
            do_GET=request
            do_POST=request
            do_DELETE=request
        server=HTTPServer(('127.0.0.1',0),Handler);server.test=self
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01));thread.start()
        try:
            deadline=time.monotonic()+5
            with patch.object(control,'HOST','127.0.0.1'),patch.object(control,'PORT',server.server_port),patch.object(control,'DEADLINE',deadline),patch.object(control,'FUNCTIONAL_HOOK',failure_hook,create=True),patch.object(control,'FUNCTIONAL_STAGE','bootstrap',create=True):
                if project_failure:
                    output=StringIO()
                    def run():
                        try:control.bootstrap()
                        except BaseException as error:
                            if observed_errors is not None:observed_errors.append(error)
                            raise
                    with redirect_stdout(output),patch.dict(sys.modules,{'functional_witness':SimpleNamespace(run=run)}),patch.object(sys,'argv',['inside.py','functional']):
                        with self.assertRaises(SystemExit) as stopped:
                            runpy.run_path(str(Path(__file__).with_name('inside.py')),run_name='__main__')
                    self.assertEqual(stopped.exception.code,1)
                    failure=json.loads(output.getvalue())
                elif wrong_identity:
                    with self.assertRaises(control.ControlFailure):control.bootstrap()
                elif failure_hook is not None:
                    with self.assertRaises(BaseException) as caught:control.bootstrap()
                    if observed_errors is not None:observed_errors.append(caught.exception)
                else:
                    result=control.bootstrap();self.assertEqual(result['viewer_identity'],1)
                    self.assertEqual(result['admin_read_denied'],1);self.assertEqual(result['revoke_denied'],1)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
        self.assertIs(revoked[0],revoke_status==204)
        self.assertEqual(calls.count(('DELETE','/api/v1/service_accounts/'+ACCOUNT+'/keys/'+KEY)),expected_revoke_calls)
        self.assertTrue(deadlines and all(value==deadline for value in deadlines))
        return failure

    def test_actual_HTTP_bootstrap_viewer_admin403_revoke204_then401(self):self.exercise(False)
    def test_wrong_service_account_identity_still_revokes_created_key(self):self.exercise(True)

    def test_actual_inside_failure_keeps_identity200_before_finally_revoke204(self):
        failure=self.exercise(True,project_failure=True)
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_identity','category':'ControlFailure',
                                 'http_status':200,'transport':'reader_identity'})

    def test_secondary_revoke_failure_preserves_original_exception_and_private_safe_context(self):
        primary=RuntimeError('private-key-body-must-not-escape');errors=[]
        def fail(_proxy,_key):raise primary
        failure=self.exercise(False,project_failure=True,revoke_status=500,failure_hook=fail,observed_errors=errors)
        self.assertEqual(errors,[primary])
        self.assertIs(errors[0],primary)
        self.assertTrue(any(frame.tb_frame.f_code.co_name=='fail' for frame in self.traceback_frames(primary.__traceback__)))
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_fixed_read','category':'RuntimeError',
                                 'http_status':200,'transport':'query_v5'})
        self.assertNotIn('private-key-body',json.dumps(failure))

    def test_revoke_failure_without_an_earlier_failure_stays_failed(self):
        for status in (200,500):
            with self.subTest(status=status):
                failure=self.exercise(False,project_failure=True,revoke_status=status,expected_revoke_calls=2)
                self.assertEqual(failure,{'inside_failed':1,'stage':'viewer_revoke','category':'ControlFailure',
                                         'http_status':status,'transport':'revoke'})

    def test_bootstrap_key_roles_and_fixed_read_requirements_have_finite_substages(self):
        cases=[('/api/v1/service_accounts/'+ACCOUNT+'/keys',{'id':KEY,'key':None},'bootstrap_key','service_account_setup',201),
               ('/api/v1/service_accounts/me',{'id':ACCOUNT,'orgId':ORG,'serviceAccountRoles':[]},'bootstrap_roles','reader_identity',200),
               ('/api/v5/query_range',{'type':'scalar','data':{'results':[]}},'bootstrap_fixed_read','query_v5',200)]
        for path,reply,stage,transport,status in cases:
            with self.subTest(stage=stage):
                failure=self.exercise(False,project_failure=True,responses={path:reply})
                self.assertEqual(failure,{'inside_failed':1,'stage':stage,'category':'ControlFailure',
                                         'http_status':status,'transport':transport})

    def test_unknown_primary_exception_is_sanitized_and_not_replaced_by_cleanup(self):
        class PrivateException(Exception):pass
        primary=PrivateException('private-key-payload');primary.raw={'header':'private-token'};errors=[]
        def fail(_proxy,_key):raise primary
        failure=self.exercise(False,project_failure=True,failure_hook=fail,observed_errors=errors)
        self.assertIs(errors[0],primary)
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_fixed_read','category':'unavailable',
                                 'http_status':200,'transport':'query_v5'})
        self.assertNotIn('private-',json.dumps(failure));self.assertNotIn('PrivateException',json.dumps(failure))

    def test_primary_interrupt_survives_secondary_cleanup_failure(self):
        primary=KeyboardInterrupt();errors=[]
        def interrupt(_proxy,_key):raise primary
        self.exercise(False,revoke_status=500,failure_hook=interrupt,observed_errors=errors)
        self.assertIs(errors[0],primary)

    def test_secondary_cleanup_interrupt_keeps_normal_interrupt_propagation(self):
        secondary=KeyboardInterrupt();armed=[False];errors=[];real_time=control.time
        def fail(_proxy,_key):
            armed[0]=True;raise RuntimeError('private-primary')
        def clock():
            if armed[0] and control.STEP=='revoke':raise secondary
            return real_time.monotonic()
        with patch.object(control,'time',SimpleNamespace(monotonic=clock,time=real_time.time)):
            self.exercise(False,revoke_status=500,failure_hook=fail,observed_errors=errors,expected_revoke_calls=0)
        self.assertIs(errors[0],secondary)

    def test_exception_snapshot_is_local_closed_and_ignores_arbitrary_private_attributes(self):
        error=ValueError('private-message');error.raw={'key':'private-header'};error.stage=['private-stage']
        with patch.object(control,'FUNCTIONAL_STAGE','bootstrap_key',create=True),patch.object(control,'STEP','service_account_setup',create=True),patch.object(control,'LAST_HTTP_STATUS',201,create=True):
            control.preserve_failure(error)
        with patch.object(control,'FUNCTIONAL_STAGE','viewer_revoke',create=True),patch.object(control,'STEP','revoke',create=True),patch.object(control,'LAST_HTTP_STATUS',204,create=True):
            control.preserve_failure(error)
            failure=control.failure_context(error)
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_key','category':'ValueError','http_status':201,'transport':'service_account_setup'})
        self.assertNotIn('private-',json.dumps(failure))
        for value in (None,[],{},True,1,'private-stage','x'*10000,float('nan'),float('inf')):
            with self.subTest(value_type=type(value).__name__),patch.object(control,'FUNCTIONAL_STAGE',value,create=True),patch.object(control,'STEP',value,create=True),patch.object(control,'LAST_HTTP_STATUS',value,create=True):
                row=control.failure_context(RuntimeError('private-body'))
                self.assertEqual(set(row),{'inside_failed','stage','category','http_status','transport'})
                self.assertEqual((row['stage'],row['transport']),('unavailable','unavailable'))
                self.assertIs(type(row['http_status']),int);self.assertNotEqual(row['http_status'],204)
                self.assertNotIn('private-',json.dumps(row,allow_nan=False))

    @staticmethod
    def traceback_frames(frame):
        while frame is not None:
            yield frame;frame=frame.tb_next


class RequestBounds(unittest.TestCase):
    def call(self,status,payload,elapsed=0,deadline=100):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def do_GET(self):
                self.send_response(status);self.send_header('Content-Length',str(len(payload)));self.end_headers()
                self.wfile.write(payload)
        server=HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01));thread.start()
        ticks=iter((0.,0.,elapsed))
        try:
            with patch.object(control,'HOST','127.0.0.1'),patch.object(control,'PORT',server.server_port),patch.object(control,'DEADLINE',deadline),patch.object(control,'time',SimpleNamespace(monotonic=lambda:next(ticks))):
                return control.request('GET','/api/v1/service_accounts/me')
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2);self.assertFalse(thread.is_alive())

    def test_original_status_body_elapsed_and_remaining_deadline_guards_remain(self):
        good=b'{"status":"success","data":{}}'
        self.assertEqual(self.call(200,good,elapsed=10),(200,{},10))
        for status,payload,elapsed,deadline in ((200,good,10.0001,100),(418,good,0,100),
                (200,b'x'*65537,0,100),(200,good,0,0)):
            with self.subTest(status=status,bytes=len(payload),elapsed=elapsed,deadline=deadline):
                with self.assertRaises(control.ControlFailure):self.call(status,payload,elapsed,deadline)


if __name__=='__main__':unittest.main()
