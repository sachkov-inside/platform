"""Owned loopback HTTP contract for pinned managed-viewer bootstrap and revoke."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import runpy
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import control
import evidence
import lifecycle

ORG='00000000-0000-0000-0000-000000000001'
USER='00000000-0000-0000-0000-000000000002'
ROLE='00000000-0000-0000-0000-000000000003'
ACCOUNT='00000000-0000-0000-0000-000000000004'
KEY='00000000-0000-0000-0000-000000000005'


class AuthWire(unittest.TestCase):
    def exercise(self,wrong_identity,*,project_failure=False,revoke_status=204,failure_hook=None,observed_errors=None,expected_revoke_calls=1,responses=None,query_wire=None,observed_calls=None,empty_catalog_model=False,observed_queries=None):
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
                    if empty_catalog_model:
                        # MODEL of pinned da556aba key resolution with empty metadata,
                        # not a SigNoz execution or the warning class observed in CI.
                        expression=body['compositeQuery']['queries'][0]['spec']['filter']['expression']
                        self.server.test.assertIn(expression,("service.name = 'platform-fallback-control'","span.serviceName = 'platform-fallback-control'"))
                        self.server.test.assertEqual(self.headers.get('Authorization'),None)
                        if observed_queries is not None:observed_queries.append(body)
                        if expression=="service.name = 'platform-fallback-control'":
                            value['warning']={'message':'key `service.name` not found in metadata; querying the underlying data directly. If this is unexpected, check the key name for typos.'}
                else:status=404
                if responses and self.path in responses:value=responses[self.path]
                encoded=b'' if status==204 else json.dumps({'status':'success' if status<300 else 'error','data':value}).encode()
                if self.path=='/api/v5/query_range' and query_wire is not None:status,encoded=query_wire
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
        if observed_calls is not None:observed_calls.extend(calls)
        return failure

    def test_actual_HTTP_bootstrap_viewer_admin403_revoke204_then401(self):self.exercise(False)
    def test_wrong_service_account_identity_still_revokes_created_key(self):self.exercise(True)

    def test_empty_catalog_source_model_requires_pinned_builtin_span_service_field(self):
        # Source contract audited in the twelve-member native-sql-design packet:
        # da556abac1fd41590811b8e0dcbcbdea242dd285 telemetrytypes field context span;
        # traces const.go declares serviceName, storage.go oldToNew maps it to
        # String resource_string_service$$name / AlwaysPresent. resolve.go's own
        # span context Fallback returns the declared column before missing-key warnings.
        # Deprecated lookup itself emits no warning. Revalidate on any pin change.
        pin=next(row for row in lifecycle.verify_packet()['images'] if row['repository']=='docker.io/signoz/signoz')
        self.assertEqual((pin['reference'],pin['index_digest']),('signoz/signoz:v0.146.0','sha256:cd3ca6950df3b3681b4629c1b2cea4d3bcd5fece57445a3ec2a1a20466ab14ca'))
        calls=[];queries=[];now=1_790_000_000
        with patch.object(control.time,'time',return_value=now):
            try:self.exercise(False,empty_catalog_model=True,observed_calls=calls,observed_queries=queries)
            except control.ControlFailure as error:
                self.fail('empty-catalog source MODEL failed at '+control.failure_context(error)['stage'])
        self.assertEqual(queries,[{'schemaVersion':'v1','start':now*1000-60000,'end':now*1000,'requestType':'scalar',
            'compositeQuery':{'queries':[{'type':'builder_query','spec':{'name':'A','signal':'traces',
                'aggregations':[{'expression':'count()','alias':'span_count'}],
                'filter':{'expression':"span.serviceName = 'platform-fallback-control'"}}}]}}])
        self.assertEqual(calls,[('POST','/api/v1/register'),('POST','/api/v2/sessions/email_password'),
            ('GET','/api/v1/roles'),('POST','/api/v1/service_accounts'),('POST','/api/v1/service_account_roles'),
            ('POST','/api/v1/service_accounts/'+ACCOUNT+'/keys'),('GET','/api/v1/service_accounts/me'),
            ('POST','/api/v5/query_range'),('GET','/api/v1/roles'),
            ('DELETE','/api/v1/service_accounts/'+ACCOUNT+'/keys/'+KEY),('GET','/api/v1/service_accounts/me')])
        scalar={'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[[0]]}]}}
        for reply,stage in (({**scalar,'warning':{'message':'private-sentinel'}},'bootstrap_read_warning'),
            ({'type':'scalar','data':{'results':[]}},'bootstrap_read_results'),
            ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[[1]]}]}},'bootstrap_read_count_nonzero')):
            with self.subTest(stage=stage):
                queries=[];calls=[]
                failure=self.exercise(False,project_failure=True,empty_catalog_model=True,
                    responses={'/api/v5/query_range':reply},observed_calls=calls,observed_queries=queries)
                self.assertEqual(queries[0]['compositeQuery']['queries'][0]['spec']['filter']['expression'],"span.serviceName = 'platform-fallback-control'")
                self.assertEqual(calls.count(('POST','/api/v5/query_range')),1)
                self.assertEqual(failure,{'inside_failed':1,'stage':stage,'category':'ControlFailure','http_status':200,'transport':'query_v5'})
                self.assertNotIn('private-sentinel',json.dumps(failure))

    def test_HTTP200_fixed_read_reports_first_results_validation_before_revoke204(self):
        failure=self.exercise(False,project_failure=True,responses={'/api/v5/query_range':{'type':'scalar','data':{'results':[]}}})
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_read_results','category':'ControlFailure',
                                 'http_status':200,'transport':'query_v5'})

    def test_HTTP200_fixed_read_reports_envelope_validation_without_an_extra_query(self):
        calls=[]
        failure=self.exercise(False,project_failure=True,query_wire=(200,b'{"status":"error","data":"private-sentinel"}'),observed_calls=calls)
        self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_read_envelope','category':'ControlFailure',
                                 'http_status':200,'transport':'query_v5'})
        self.assertEqual(calls.count(('POST','/api/v5/query_range')),1)
        self.assertNotIn('private-sentinel',json.dumps(failure))

    def test_actual_fixed_read_predicate_groups_remain_failed_and_project_only_closed_fields(self):
        def scalar(count):
            return {'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[[count]]}]}}
        cases=[(None,'bootstrap_read_type'),({},'bootstrap_read_type'),
            ({**scalar(0),'warning':['private-sentinel']},'bootstrap_read_warning'),
            ({'type':'scalar','data':{'results':[]}},'bootstrap_read_results'),
            ({'type':'scalar','data':{'results':[{'queryName':'private-sentinel'}]}},'bootstrap_read_query'),
            ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[],'data':[[0]]}]}},'bootstrap_read_columns'),
            ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[]}]}},'bootstrap_read_rows'),
            *[(scalar(count),'bootstrap_read_number') for count in (None,True,'private-sentinel',float('nan'),float('inf'))],
            *[(scalar(count),'bootstrap_read_number_range') for count in (-1,-.5,.5)],
            (scalar(1),'bootstrap_read_count_nonzero'),(scalar(1.0),'bootstrap_read_count_nonzero')]
        for reply,stage in cases:
            with self.subTest(stage=stage,reply=repr(reply)),tempfile.TemporaryDirectory() as tmp:
                calls=[]
                failure=self.exercise(False,project_failure=True,responses={'/api/v5/query_range':reply},observed_calls=calls)
                self.assertEqual(failure,{'inside_failed':1,'stage':stage,'category':'ControlFailure','http_status':200,'transport':'query_v5'})
                self.assertEqual(calls.count(('POST','/api/v5/query_range')),1)
                root=Path(tmp);engine=root/'engine-1-12345678';engine.mkdir()
                lifecycle.private_json(engine/'inside-failure.json',failure)
                self.assertEqual(evidence.inside_failures(root),{'available':True,'samples':[{k:v for k,v in failure.items() if k!='inside_failed'}]})
                self.assertNotIn('private-sentinel',json.dumps(evidence.inside_failures(root)))

    def test_actual_fixed_read_transport_object_decode_and_envelope_guards(self):
        for status,payload,stage,category in (
            (503,b'{"status":"error","data":"private-sentinel"}','bootstrap_read_response','ControlFailure'),
            (200,b'x'*65537,'bootstrap_read_response','ControlFailure'),
            (200,b'["private-sentinel"]','bootstrap_read_object','ControlFailure'),
            (200,b'{private-sentinel','bootstrap_read_decode','JSONDecodeError'),
            (200,b'{"status":"success"}','bootstrap_read_envelope','ControlFailure')):
            with self.subTest(stage=stage,status=status):
                failure=self.exercise(False,project_failure=True,query_wire=(status,payload))
                self.assertEqual(failure,{'inside_failed':1,'stage':stage,'category':category,'http_status':status,'transport':'query_v5'})
                self.assertNotIn('private-sentinel',json.dumps(failure))

    def test_fixed_read_keeps_native_expression_exceptions_instead_of_inventing_ControlFailure(self):
        for reply,native_type in (
            ({'type':'scalar','data':None},AttributeError),
            ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[None]}]}},TypeError),
            ({'type':'scalar','data':{'results':[{'queryName':'A','columns':[{}],'data':[[10**400]]}]}},OverflowError)):
            with self.subTest(native=native_type.__name__):
                errors=[];failure=self.exercise(False,project_failure=True,responses={'/api/v5/query_range':reply},observed_errors=errors)
                self.assertIs(type(errors[0]),native_type)
                self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_fixed_read','category':'unavailable','http_status':200,'transport':'query_v5'})

    def test_validation_primary_object_traceback_and_stage_survive_both_revoke_outcomes(self):
        preserve=control.preserve_failure
        for status in (204,500):
            with self.subTest(revoke_status=status):
                before=[];errors=[]
                def snapshot(error):
                    before.append((error,error.__traceback__));preserve(error)
                with patch.object(control,'preserve_failure',side_effect=snapshot):
                    failure=self.exercise(False,project_failure=True,revoke_status=status,
                        responses={'/api/v5/query_range':{'type':'scalar','data':{'results':[]}}},observed_errors=errors)
                self.assertEqual(len(before),1);self.assertEqual(len(errors),1)
                self.assertIs(errors[0],before[0][0])
                self.assertTrue(any(frame is before[0][1] for frame in self.traceback_frames(errors[0].__traceback__)))
                self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_read_results','category':'ControlFailure','http_status':200,'transport':'query_v5'})

    def test_foreign_or_private_validation_tags_do_not_override_the_original_context(self):
        with self.assertRaises(control.ControlFailure) as original:
            control.scalar({'type':'scalar','warning':['private-sentinel']},bootstrap_read=True)
        tags=[None,[],{},'private-sentinel',(object(),'bootstrap_read_results'),
            original.exception._signoz_bootstrap_validation,
            (control._BOOTSTRAP_READ_AUTHORITY,'private-sentinel'),
            (control._BOOTSTRAP_READ_AUTHORITY,[]),(control._BOOTSTRAP_READ_AUTHORITY,{'private-sentinel':1})]
        for tag in tags:
            with self.subTest(tag_type=type(tag).__name__):
                error=RuntimeError('private-sentinel');error._signoz_bootstrap_validation=tag
                with patch.object(control,'FUNCTIONAL_STAGE','bootstrap_fixed_read',create=True),\
                     patch.object(control,'STEP','query_v5',create=True),patch.object(control,'LAST_HTTP_STATUS',200,create=True):
                    control.preserve_failure(error);failure=control.failure_context(error)
                self.assertEqual(failure,{'inside_failed':1,'stage':'bootstrap_fixed_read','category':'RuntimeError','http_status':200,'transport':'query_v5'})
                self.assertNotIn('private-sentinel',json.dumps(failure))
        for stage in ('private-sentinel',[],{}):
            error=RuntimeError('private-sentinel')
            error._signoz_bootstrap_validation=(control._BOOTSTRAP_READ_AUTHORITY,id(error),stage)
            with patch.object(control,'FUNCTIONAL_STAGE','bootstrap_fixed_read',create=True):
                self.assertEqual(control.failure_context(error)['stage'],'bootstrap_fixed_read')

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
               ('/api/v5/query_range',{'type':'scalar','data':{'results':[]}},'bootstrap_read_results','query_v5',200)]
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

    def test_trace_log_first_exception_is_identity_bound_and_survives_revoke(self):
        for revoke_status in (204,500):
            before=[];errors=[]
            def hook(_proxy,_key):
                control.FUNCTIONAL_STAGE='trace_log'
                try:
                    with control.trace_log_read(control.TRACE_LOG_READS[('logs','negative')]):
                        control.scalar({**{'type':'scalar'},'warning':'private-trace-canary'})
                except BaseException as error:
                    before.append((error,error.__traceback__));raise
            failure=self.exercise(False,project_failure=True,revoke_status=revoke_status,failure_hook=hook,observed_errors=errors)
            self.assertIs(errors[0],before[0][0]);self.assertIn(before[0][1],list(self.traceback_frames(errors[0].__traceback__)))
            self.assertEqual(failure,{'inside_failed':1,'stage':'logs_negative_scalar_warning','category':'ControlFailure',
                'http_status':200,'transport':'query_v5'})
            self.assertNotIn('private-trace-canary',json.dumps(failure))
            for attribute in ('_signoz_trace_log_validation','_signoz_first_failure'):
                foreign=RuntimeError('private-trace-canary');setattr(foreign,attribute,vars(errors[0])[attribute])
                with patch.object(control,'FUNCTIONAL_STAGE','finite_gateway',create=True):
                    control.preserve_failure(foreign)
                    self.assertEqual(control.failure_context(foreign)['stage'],'finite_gateway')

        # A secondary revoke may rethrow the very same object. Its traceback must
        # still describe the first read, rather than the cleanup notification.
        before=[];errors=[];actual_request=control.request
        def revoke_same(method,*args,**kwargs):
            if method=='DELETE':raise before[0][0]
            return actual_request(method,*args,**kwargs)
        with patch.object(control,'request',side_effect=revoke_same):
            failure=self.exercise(False,project_failure=True,revoke_status=500,failure_hook=hook,
                observed_errors=errors,expected_revoke_calls=0)
        self.assertIs(errors[0],before[0][0])
        self.assertIn(before[0][1],list(self.traceback_frames(errors[0].__traceback__)))
        self.assertNotIn('revoke_same',[frame.tb_frame.f_code.co_name for frame in self.traceback_frames(errors[0].__traceback__)])
        self.assertEqual(failure['stage'],'logs_negative_scalar_warning')

    def test_trace_log_stage_cannot_be_selected_by_foreign_strings_or_error_attributes(self):
        invalid=(None,[],{},True,1,'private-trace-canary','x'*10000,'traces_positive_scalar_warning')
        for operation in invalid:
            with self.subTest(operation_type=type(operation).__name__),patch.object(control,'FUNCTIONAL_STAGE','trace_log',create=True):
                with self.assertRaises(control.ControlFailure) as caught:
                    with control.trace_log_read(operation):control.scalar(None)
                self.assertEqual(control.failure_context(caught.exception)['stage'],'trace_log')
        for tag in invalid+((object(),0,'logs_negative_scalar_warning','query_v5',200),):
            error=RuntimeError('private-trace-canary');error._signoz_trace_log_validation=tag
            with patch.object(control,'FUNCTIONAL_STAGE','trace_log',create=True):
                self.assertEqual(control.failure_context(error)['stage'],'trace_log')
        for stage in ('private-trace-canary','x'*10000,[],{},None,True):
            error=RuntimeError('private-trace-canary')
            error._signoz_trace_log_validation=(control._TRACE_LOG_AUTHORITY,id(error),stage,'query_v5',200)
            with patch.object(control,'FUNCTIONAL_STAGE','trace_log',create=True):
                self.assertEqual(control.failure_context(error)['stage'],'trace_log')
        with patch.object(control,'FUNCTIONAL_STAGE','logs_negative_scalar_warning',create=True):
            self.assertEqual(control.failure_context(RuntimeError('private-trace-canary'))['stage'],'unavailable')

    @staticmethod
    def traceback_frames(frame):
        while frame is not None:
            yield frame;frame=frame.tb_next


class RequestBounds(unittest.TestCase):
    def call(self,status,payload,elapsed=0,deadline=100,*,bootstrap_read=False):
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
                return control.request('GET','/api/v1/service_accounts/me',bootstrap_read=bootstrap_read)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2);self.assertFalse(thread.is_alive())

    def test_original_status_body_elapsed_and_remaining_deadline_guards_remain(self):
        good=b'{"status":"success","data":{}}'
        self.assertEqual(self.call(200,good,elapsed=10),(200,{},10))
        for status,payload,elapsed,deadline in ((200,good,10.0001,100),(418,good,0,100),
                (200,b'x'*65537,0,100),(200,good,0,0)):
            with self.subTest(status=status,bytes=len(payload),elapsed=elapsed,deadline=deadline):
                with self.assertRaises(control.ControlFailure):self.call(status,payload,elapsed,deadline)

    def test_deadline_tag_is_opt_in_and_other_request_and_scalar_callers_keep_original_context(self):
        good=b'{"status":"success","data":{}}'
        with patch.object(control,'FUNCTIONAL_STAGE','bootstrap_fixed_read',create=True):
            for elapsed,deadline in ((10.0001,100),(0,0)):
                with self.subTest(elapsed=elapsed,deadline=deadline):
                    with self.assertRaises(control.ControlFailure) as tagged:self.call(200,good,elapsed,deadline,bootstrap_read=True)
                    self.assertEqual(control.failure_context(tagged.exception)['stage'],'bootstrap_read_deadline')
                    with self.assertRaises(control.ControlFailure) as original:self.call(200,good,elapsed,deadline)
                    self.assertEqual(control.failure_context(original.exception)['stage'],'bootstrap_fixed_read')
            with self.assertRaises(control.ControlFailure) as scalar:control.scalar({'type':'scalar','warning':['private-sentinel']})
            self.assertEqual(control.failure_context(scalar.exception)['stage'],'bootstrap_fixed_read')

            for elapsed,deadline,step in ((10.0001,100,'query_deadline'),(0,0,'query_admission')):
                with self.subTest(step=step),self.assertRaises(control.ControlFailure) as caught:
                    with control.trace_log_read(control.TRACE_LOG_READS[('logs','positive')]):
                        self.call(200,good,elapsed,deadline)
                self.assertEqual(control.failure_context(caught.exception)['stage'],'logs_positive_'+step)


if __name__=='__main__':unittest.main()
