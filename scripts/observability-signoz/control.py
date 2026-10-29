#!/usr/bin/env python3
"""Fixed fixture bootstrap, managed viewer identity, read and revoke protocol."""
from contextlib import contextmanager
from contextvars import ContextVar
import http.client
import json
import math
import secrets
import sys
import time
import uuid

HOST = 'signoz-signoz-0'
PORT = 8080
OWNER = 'monitoring-1566-signoz-functional'
MAX_BODY = 65536
DEADLINE = None
BOOTSTRAP_READ_STAGES = frozenset(('bootstrap_read_response','bootstrap_read_deadline','bootstrap_read_decode',
    'bootstrap_read_object','bootstrap_read_envelope','bootstrap_read_type','bootstrap_read_warning',
    'bootstrap_read_results','bootstrap_read_query','bootstrap_read_columns','bootstrap_read_rows',
    'bootstrap_read_number','bootstrap_read_number_range','bootstrap_read_count_nonzero'))
MCP_READ_STAGES = frozenset(('mcp_wire_admission','mcp_wire_request','mcp_wire_headers','mcp_wire_read',
    'mcp_wire_status','mcp_wire_size','mcp_inventory_size','mcp_wire_deadline','mcp_wire_decode','mcp_wire_close',
    'mcp_rpc_object','mcp_rpc_version','mcp_rpc_id','mcp_rpc_error','mcp_rpc_result','mcp_rpc_is_error',
    'mcp_initialize_version','mcp_inventory_cursor','mcp_inventory_tools','mcp_inventory_count','mcp_inventory_query_tool'))
TRACE_LOG_STEPS = frozenset(('read','query_admission','query_request','query_headers','query_read',
    'query_response','query_deadline','query_decode','query_object','query_envelope','query_close',
    'scalar_type','scalar_warning','scalar_results','scalar_query','scalar_columns','scalar_rows',
    'scalar_number','scalar_number_range','count_zero','count_one','count_many',
    'wait_unknown','wait_zero','wait_one','wait_many'))
TRACE_LOG_READS = {(signal,polarity):object() for signal in ('traces','logs') for polarity in ('positive','negative')}
TRACE_LOG_STAGES = frozenset(signal+'_'+polarity+'_'+step for signal,polarity in TRACE_LOG_READS for step in TRACE_LOG_STEPS)
_TRACE_LOG_CONTEXT = ContextVar('trace_log_read',default=None)
_TRACE_LOG_AUTHORITY = object()
FAILURE_STAGES = frozenset(('entry','bootstrap','bootstrap_key','bootstrap_identity','bootstrap_roles','bootstrap_fixed_read',
    'mcp_ready','mcp_initialize','mcp_inventory','ingest','retained_metrics','trace_log','mcp_read','finite_gateway',
    'viewer_admin_denial','viewer_revoke','viewer_revoked_denial')) | BOOTSTRAP_READ_STAGES | MCP_READ_STAGES | TRACE_LOG_STAGES
FAILURE_TRANSPORTS = frozenset(('none','mcp_http','query_v5','register','session','roles','reader_identity','revoke','service_account_setup'))
FAILURE_CATEGORIES = frozenset(('ControlFailure','RuntimeError','TimeoutError','ConnectionRefusedError','ConnectionResetError',
    'RemoteDisconnected','JSONDecodeError','OSError','BrokenPipeError','ValueError'))
_FAILURE_AUTHORITY = object()
_BOOTSTRAP_READ_AUTHORITY = object()
_MCP_READ_AUTHORITY = object()

class ControlFailure(Exception):
    pass

def _closed_name(value, allowed):
    return value if type(value) is str and len(value)<=48 and value in allowed else 'unavailable'

def _current_failure(error):
    status=globals().get('LAST_HTTP_STATUS',0)
    stage=globals().get('FUNCTIONAL_STAGE','entry')
    trace=vars(error).get('_signoz_trace_log_validation')
    if (type(trace) is tuple and len(trace)==5 and trace[0] is _TRACE_LOG_AUTHORITY
            and type(trace[1]) is int and trace[1]==id(error)
            and _closed_name(trace[2],TRACE_LOG_STAGES)!='unavailable'
            and type(trace[4]) is int and 0<=trace[4]<=599):
        return (trace[2],_closed_name(trace[3],FAILURE_TRANSPORTS),trace[4],_closed_name(type(error).__name__,FAILURE_CATEGORIES))
    mcp=vars(error).get('_signoz_mcp_validation')
    if (type(mcp) is tuple and len(mcp)==5 and mcp[0] is _MCP_READ_AUTHORITY
            and type(mcp[1]) is int and mcp[1]==id(error)
            and _closed_name(mcp[2],MCP_READ_STAGES)!='unavailable'
            and type(mcp[4]) is int and 0<=mcp[4]<=599):
        return (mcp[2],_closed_name(mcp[3],FAILURE_TRANSPORTS),mcp[4],_closed_name(type(error).__name__,FAILURE_CATEGORIES))
    tagged=vars(error).get('_signoz_bootstrap_validation')
    if (type(tagged) is tuple and len(tagged)==3 and tagged[0] is _BOOTSTRAP_READ_AUTHORITY
            and type(tagged[1]) is int and tagged[1]==id(error)
            and _closed_name(tagged[2],BOOTSTRAP_READ_STAGES)!='unavailable'):stage=tagged[2]
    return (_closed_name(stage,FAILURE_STAGES - TRACE_LOG_STAGES),
            _closed_name(globals().get('STEP','none'),FAILURE_TRANSPORTS),
            status if type(status) is int and 0<=status<=599 else 0,
            _closed_name(type(error).__name__,FAILURE_CATEGORIES))

def preserve_failure(error):
    # Per-exception authority, never a global first-error latch. Local negatives stay local.
    fields=vars(error);saved=fields.get('_signoz_first_failure')
    if type(saved) is tuple and len(saved)==3 and saved[0] is _FAILURE_AUTHORITY and type(saved[1]) is int and saved[1]==id(error):return
    fields['_signoz_first_failure']=(_FAILURE_AUTHORITY,id(error),_current_failure(error))

def failure_context(error):
    saved=vars(error).get('_signoz_first_failure')
    if type(saved) is tuple and len(saved)==3 and saved[0] is _FAILURE_AUTHORITY and type(saved[1]) is int and saved[1]==id(error):
        row=saved[2]
        if not (type(row) is tuple and len(row)==4 and type(row[2]) is int and 0<=row[2]<=599):
            row=('unavailable','unavailable',0,'unavailable')
    else:row=_current_failure(error)
    return {'inside_failed':1,'stage':_closed_name(row[0],FAILURE_STAGES),
        'category':_closed_name(row[3],FAILURE_CATEGORIES),'http_status':row[2],
        'transport':_closed_name(row[1],FAILURE_TRANSPORTS)}

def _tag_bootstrap_failure(error,stage):
    if _closed_name(stage,BOOTSTRAP_READ_STAGES)!='unavailable':
        vars(error)['_signoz_bootstrap_validation']=(_BOOTSTRAP_READ_AUTHORITY,id(error),stage)

def _tag_mcp_failure(error,stage):
    if _closed_name(stage,MCP_READ_STAGES)=='unavailable':return
    saved=vars(error).get('_signoz_mcp_validation')
    if (type(saved) is tuple and len(saved)==5 and saved[0] is _MCP_READ_AUTHORITY
            and type(saved[1]) is int and saved[1]==id(error)
            and _closed_name(saved[2],MCP_READ_STAGES)!='unavailable'):return
    status=globals().get('LAST_HTTP_STATUS',0)
    vars(error)['_signoz_mcp_validation']=(_MCP_READ_AUTHORITY,id(error),stage,
        _closed_name(globals().get('STEP','none'),FAILURE_TRANSPORTS),
        status if type(status) is int and 0<=status<=599 else 0)


def _trace_log_checkpoint(step):
    context=_TRACE_LOG_CONTEXT.get()
    if context is not None and type(step) is str and step in TRACE_LOG_STEPS:context[1]=step


def _tag_trace_log_failure(error):
    context=_TRACE_LOG_CONTEXT.get()
    if context is None:return
    saved=vars(error).get('_signoz_trace_log_validation')
    if (type(saved) is tuple and len(saved)==5 and saved[0] is _TRACE_LOG_AUTHORITY
            and type(saved[1]) is int and saved[1]==id(error)
            and _closed_name(saved[2],TRACE_LOG_STAGES)!='unavailable'):return
    status=globals().get('LAST_HTTP_STATUS',0)
    vars(error)['_signoz_trace_log_validation']=(_TRACE_LOG_AUTHORITY,id(error),context[0]+'_'+context[1],
        _closed_name(globals().get('STEP','none'),FAILURE_TRANSPORTS),
        status if type(status) is int and 0<=status<=599 else 0)


@contextmanager
def trace_log_read(operation):
    # Identity capability comes only from the four fixed source call sites. Payload
    # fields and arbitrary caller strings cannot choose a diagnostic stage.
    name=next((signal+'_'+polarity for (signal,polarity),token in TRACE_LOG_READS.items() if operation is token),None)
    token=_TRACE_LOG_CONTEXT.set(None if name is None else [name,'read','unknown'])
    try:yield
    except BaseException as error:
        _tag_trace_log_failure(error)
        raise
    finally:_TRACE_LOG_CONTEXT.reset(token)


def trace_log_count(count):
    context=_TRACE_LOG_CONTEXT.get()
    if context is not None:
        context[2]='zero' if count==0 else 'one' if count==1 else 'many'
        _trace_log_checkpoint('count_'+context[2])
    return count


def trace_log_wait():
    context=_TRACE_LOG_CONTEXT.get()
    if context is not None:_trace_log_checkpoint('wait_'+context[2])


def require(ok,*,bootstrap_stage=None,mcp_stage=None,read_stage=None):
    if not ok:
        error=ControlFailure()
        _tag_bootstrap_failure(error,bootstrap_stage)
        _tag_mcp_failure(error,mcp_stage)
        _trace_log_checkpoint(read_stage)
        _tag_trace_log_failure(error)
        raise error

def uid(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    return value

def remaining(*,bootstrap_read=False):
    value = DEADLINE - time.monotonic()
    require(value > 0,bootstrap_stage='bootstrap_read_deadline' if bootstrap_read else None)
    return min(10, value)

def request(method, path, body=None, auth=None, accepted=(200,),*,bootstrap_read=False):
    # Only internal call sites supply this path/body. No URL or raw query CLI exists.
    global STEP, LAST_HTTP_STATUS
    LAST_HTTP_STATUS=0
    STEP = 'query_v5' if path=='/api/v5/query_range' else 'register' if path=='/api/v1/register' else 'session' if path=='/api/v2/sessions/email_password' else 'roles' if path=='/api/v1/roles' else 'reader_identity' if path=='/api/v1/service_accounts/me' else 'revoke' if method=='DELETE' else 'service_account_setup'
    conn=None;primary=None
    _trace_log_checkpoint('query_admission')
    try:
        conn = http.client.HTTPConnection(HOST, PORT, timeout=remaining(bootstrap_read=bootstrap_read))
        headers = {'Accept': 'application/json', 'Connection': 'close'}
        if auth:
            headers.update(auth)
        raw = None
        if body is not None:
            raw = json.dumps(body, separators=(',', ':')).encode()
            headers['Content-Type'] = 'application/json'
        started = time.monotonic()
        _trace_log_checkpoint('query_request')
        conn.request(method, path, raw, headers)
        _trace_log_checkpoint('query_headers')
        response = conn.getresponse()
        LAST_HTTP_STATUS=response.status
        _trace_log_checkpoint('query_read')
        payload = response.read(MAX_BODY + 1)
        require(len(payload) <= MAX_BODY and response.status in accepted,bootstrap_stage='bootstrap_read_response' if bootstrap_read else None,read_stage='query_response')
        elapsed = time.monotonic() - started
        require(elapsed <= 10,bootstrap_stage='bootstrap_read_deadline' if bootstrap_read else None,read_stage='query_deadline')
        if response.status == 204:
            require(not payload)
            return response.status, None, elapsed
        _trace_log_checkpoint('query_decode')
        try:value = json.loads(payload)
        except Exception as error:
            if bootstrap_read:_tag_bootstrap_failure(error,'bootstrap_read_decode')
            raise
        require(isinstance(value, dict),bootstrap_stage='bootstrap_read_object' if bootstrap_read else None,read_stage='query_object')
        if response.status == 200 or response.status == 201:
            require(value.get('status') == 'success' and 'data' in value,bootstrap_stage='bootstrap_read_envelope' if bootstrap_read else None,read_stage='query_envelope')
        return response.status, value.get('data'), elapsed
    except BaseException as error:
        primary=error;original_traceback=sys.exc_info()[2]
        _tag_trace_log_failure(error)
        raise
    finally:
        if conn is not None:
            try:conn.close()
            except Exception as error:
                if primary is None:
                    _trace_log_checkpoint('query_close');_tag_trace_log_failure(error)
                    raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,original_traceback)

def scalar(value,*,bootstrap_read=False):
    _trace_log_checkpoint('scalar_type')
    require(isinstance(value, dict) and value.get('type') == 'scalar',bootstrap_stage='bootstrap_read_type' if bootstrap_read else None,read_stage='scalar_type')
    _trace_log_checkpoint('scalar_warning')
    require(not value.get('warning'),bootstrap_stage='bootstrap_read_warning' if bootstrap_read else None,read_stage='scalar_warning')
    _trace_log_checkpoint('scalar_results')
    results = value.get('data', {}).get('results')
    require(isinstance(results, list) and len(results) == 1,bootstrap_stage='bootstrap_read_results' if bootstrap_read else None,read_stage='scalar_results')
    result = results[0]
    _trace_log_checkpoint('scalar_query')
    require(isinstance(result, dict) and result.get('queryName') == 'A',bootstrap_stage='bootstrap_read_query' if bootstrap_read else None,read_stage='scalar_query')
    columns, rows = result.get('columns'), result.get('data')
    _trace_log_checkpoint('scalar_columns')
    require(isinstance(columns, list) and len(columns) == 1,bootstrap_stage='bootstrap_read_columns' if bootstrap_read else None,read_stage='scalar_columns')
    _trace_log_checkpoint('scalar_rows')
    require(isinstance(rows, list) and len(rows) == 1 and len(rows[0]) == 1,bootstrap_stage='bootstrap_read_rows' if bootstrap_read else None,read_stage='scalar_rows')
    count = rows[0][0]
    _trace_log_checkpoint('scalar_number')
    require(type(count) in (int, float) and math.isfinite(count),bootstrap_stage='bootstrap_read_number' if bootstrap_read else None,read_stage='scalar_number')
    _trace_log_checkpoint('scalar_number_range')
    require(count >= 0 and count.is_integer() if type(count) is float else count >= 0,bootstrap_stage='bootstrap_read_number_range' if bootstrap_read else None,read_stage='scalar_number_range')
    return int(count)

class FixedRead:
    """Fixed bootstrap read; the separate finite gateway owns the client interface."""
    def __init__(self, key):
        self._auth = {'SIGNOZ-API-KEY': key}

    def call(self, name, parameters):
        require(name == 'empty_fixture_span_count' and parameters == {})
        now = int(time.time() * 1000)
        # Literal service identity, one minute, count only. Not user-supplied SQL/filter.
        query = {'schemaVersion': 'v1', 'start': now - 60000, 'end': now,
                 'requestType': 'scalar', 'compositeQuery': {'queries': [
                     {'type': 'builder_query', 'spec': {
                         'name': 'A', 'signal': 'traces',
                         'aggregations': [{'expression': 'count()', 'alias': 'span_count'}],
                         'filter': {'expression': "span.serviceName = 'platform-fallback-control'"}}}]}}
        _, value, elapsed = request('POST', '/api/v5/query_range', query, self._auth,bootstrap_read=True)
        return scalar(value,bootstrap_read=True), elapsed

def bootstrap():
    global FUNCTIONAL_STAGE
    FUNCTIONAL_STAGE='bootstrap'
    # Generated only inside the admitted isolated fixture.
    password = 'Aa9!' + secrets.token_urlsafe(32)
    email = 'control@signoz-fixture.invalid'
    _, user, _ = request('POST', '/api/v1/register', {
        'name': 'Isolated control', 'email': email, 'password': password,
        'orgDisplayName': 'Isolated monitoring control', 'orgName': OWNER})
    require(isinstance(user, dict))
    org = uid(user.get('orgId'))
    uid(user.get('id'))
    _, token, _ = request('POST', '/api/v2/sessions/email_password', {
        'email': email, 'password': password, 'orgId': org})
    require(isinstance(token, dict) and token.get('tokenType') == 'bearer')
    require(isinstance(token.get('accessToken'), str) and token['accessToken'])
    admin = {'Authorization': 'Bearer ' + token['accessToken']}
    _, roles, _ = request('GET', '/api/v1/roles', auth=admin)
    require(isinstance(roles, list))
    viewers = [r for r in roles if isinstance(r, dict) and r.get('name') == 'signoz-viewer'
               and r.get('type') == 'managed' and r.get('orgId') == org]
    require(len(viewers) == 1)
    viewer = uid(viewers[0].get('id'))
    _, account, _ = request('POST', '/api/v1/service_accounts', {'name': OWNER}, admin, (201,))
    account_id = uid(account.get('id'))
    key_id = None
    primary = None
    try:
        request('POST', '/api/v1/service_account_roles',
                {'serviceAccountId': account_id, 'roleId': viewer}, admin, (201,))
        FUNCTIONAL_STAGE='bootstrap_key'
        _, key, _ = request('POST', '/api/v1/service_accounts/' + account_id + '/keys',
                          {'name': 'bounded-control', 'expiresAt': int(time.time()) + 900},
                          admin, (201,))
        key_id = uid(key.get('id'))
        require(isinstance(key.get('key'), str) and key['key'])
        reader = {'SIGNOZ-API-KEY': key['key']}
        FUNCTIONAL_STAGE='bootstrap_identity'
        _, identity, _ = request('GET', '/api/v1/service_accounts/me', auth=reader)
        require(identity.get('id') == account_id and identity.get('orgId') == org)
        FUNCTIONAL_STAGE='bootstrap_roles'
        attached = identity.get('serviceAccountRoles')
        require(isinstance(attached, list) and len(attached) == 1)
        require(attached[0].get('roleId') == viewer)
        proxy = FixedRead(key['key'])
        for name, arguments in [('raw_sql', {}), ('empty_fixture_span_count', {'sql': 'SELECT 1'}),
                                ('empty_fixture_span_count', {'path': '/api/v1/roles'})]:
            try:
                proxy.call(name, arguments)
            except ControlFailure:
                pass
            else:
                raise ControlFailure()
        # One actual backend read. No retry hiding migration/query failure.
        FUNCTIONAL_STAGE='bootstrap_fixed_read'
        count, query_seconds = proxy.call('empty_fixture_span_count', {})
        require(count == 0,bootstrap_stage='bootstrap_read_count_nonzero')
        hook = globals().get('FUNCTIONAL_HOOK')
        if hook is not None:
            hook(proxy, key['key'])
        # Verify actual viewer cannot read admin-only resource, no mutation attempted.
        FUNCTIONAL_STAGE='viewer_admin_denial'
        request('GET', '/api/v1/roles', auth=reader, accepted=(403,))
        FUNCTIONAL_STAGE='viewer_revoke'
        request('DELETE', '/api/v1/service_accounts/' + account_id + '/keys/' + key_id,
                auth=admin, accepted=(204,))
        key_id = None
        FUNCTIONAL_STAGE='viewer_revoked_denial'
        request('GET', '/api/v1/service_accounts/me', auth=reader, accepted=(401,))
        return {'bootstrap': 1, 'viewer_identity': 1, 'fixed_read': 1,
                'empty_fixture_span_count': count, 'query_seconds': query_seconds,
                'local_raw_input_negatives': 3, 'admin_read_denied': 1,
                'revoke_denied': 1}
    except BaseException as error:
        primary=error;primary_traceback=sys.exc_info()[2];preserve_failure(error)
        raise
    finally:
        # An unsuccessful path still attempts revoke under the SAME deadline.
        # Outer controller must always remove the whole owned fixture afterward.
        if key_id is not None:
            try:
                request('DELETE', '/api/v1/service_accounts/' + account_id + '/keys/' + key_id,
                        auth=admin, accepted=(204,))
            except Exception:
                if primary is None:raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,primary_traceback)
