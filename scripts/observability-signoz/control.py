#!/usr/bin/env python3
"""Fixed fixture bootstrap, managed viewer identity, read and revoke protocol."""
import http.client
import json
import math
import secrets
import time
import uuid

HOST = 'signoz-signoz-0'
PORT = 8080
OWNER = 'monitoring-1566-signoz-functional'
MAX_BODY = 65536
DEADLINE = None
FAILURE_STAGES = frozenset(('entry','bootstrap','bootstrap_key','bootstrap_identity','bootstrap_roles','bootstrap_fixed_read',
    'mcp_ready','mcp_initialize','mcp_inventory','ingest','retained_metrics','trace_log','mcp_read','finite_gateway',
    'viewer_admin_denial','viewer_revoke','viewer_revoked_denial'))
FAILURE_TRANSPORTS = frozenset(('none','query_v5','register','session','roles','reader_identity','revoke','service_account_setup'))
FAILURE_CATEGORIES = frozenset(('ControlFailure','RuntimeError','TimeoutError','ConnectionRefusedError','ConnectionResetError',
    'RemoteDisconnected','JSONDecodeError','OSError','BrokenPipeError','ValueError'))
_FAILURE_AUTHORITY = object()

class ControlFailure(Exception):
    pass

def _closed_name(value, allowed):
    return value if type(value) is str and len(value)<=48 and value in allowed else 'unavailable'

def _current_failure(error):
    status=globals().get('LAST_HTTP_STATUS',0)
    return (_closed_name(globals().get('FUNCTIONAL_STAGE','entry'),FAILURE_STAGES),
            _closed_name(globals().get('STEP','none'),FAILURE_TRANSPORTS),
            status if type(status) is int and 0<=status<=599 else 0,
            _closed_name(type(error).__name__,FAILURE_CATEGORIES))

def preserve_failure(error):
    # Per-exception authority, never a global first-error latch. Local negatives stay local.
    fields=vars(error);saved=fields.get('_signoz_first_failure')
    if type(saved) is tuple and len(saved)==2 and saved[0] is _FAILURE_AUTHORITY:return
    fields['_signoz_first_failure']=(_FAILURE_AUTHORITY,_current_failure(error))

def failure_context(error):
    saved=vars(error).get('_signoz_first_failure')
    if type(saved) is tuple and len(saved)==2 and saved[0] is _FAILURE_AUTHORITY:
        row=saved[1]
        if not (type(row) is tuple and len(row)==4 and type(row[2]) is int and 0<=row[2]<=599):
            row=('unavailable','unavailable',0,'unavailable')
    else:row=_current_failure(error)
    return {'inside_failed':1,'stage':_closed_name(row[0],FAILURE_STAGES),
        'category':_closed_name(row[3],FAILURE_CATEGORIES),'http_status':row[2],
        'transport':_closed_name(row[1],FAILURE_TRANSPORTS)}

def require(ok):
    if not ok:
        raise ControlFailure()

def uid(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    return value

def remaining():
    value = DEADLINE - time.monotonic()
    require(value > 0)
    return min(10, value)

def request(method, path, body=None, auth=None, accepted=(200,)):
    # Only internal call sites supply this path/body. No URL or raw query CLI exists.
    global STEP, LAST_HTTP_STATUS
    LAST_HTTP_STATUS=0
    STEP = 'query_v5' if path=='/api/v5/query_range' else 'register' if path=='/api/v1/register' else 'session' if path=='/api/v2/sessions/email_password' else 'roles' if path=='/api/v1/roles' else 'reader_identity' if path=='/api/v1/service_accounts/me' else 'revoke' if method=='DELETE' else 'service_account_setup'
    conn = http.client.HTTPConnection(HOST, PORT, timeout=remaining())
    headers = {'Accept': 'application/json', 'Connection': 'close'}
    if auth:
        headers.update(auth)
    raw = None
    if body is not None:
        raw = json.dumps(body, separators=(',', ':')).encode()
        headers['Content-Type'] = 'application/json'
    started = time.monotonic()
    try:
        conn.request(method, path, raw, headers)
        response = conn.getresponse()
        LAST_HTTP_STATUS=response.status
        payload = response.read(MAX_BODY + 1)
        require(len(payload) <= MAX_BODY and response.status in accepted)
        elapsed = time.monotonic() - started
        require(elapsed <= 10)
        if response.status == 204:
            require(not payload)
            return response.status, None, elapsed
        value = json.loads(payload)
        require(isinstance(value, dict))
        if response.status == 200 or response.status == 201:
            require(value.get('status') == 'success' and 'data' in value)
        return response.status, value.get('data'), elapsed
    finally:
        conn.close()

def scalar(value):
    require(isinstance(value, dict) and value.get('type') == 'scalar')
    require(not value.get('warning'))
    results = value.get('data', {}).get('results')
    require(isinstance(results, list) and len(results) == 1)
    result = results[0]
    require(isinstance(result, dict) and result.get('queryName') == 'A')
    columns, rows = result.get('columns'), result.get('data')
    require(isinstance(columns, list) and len(columns) == 1)
    require(isinstance(rows, list) and len(rows) == 1 and len(rows[0]) == 1)
    count = rows[0][0]
    require(type(count) in (int, float) and math.isfinite(count))
    require(count >= 0 and count.is_integer() if type(count) is float else count >= 0)
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
                         'filter': {'expression': "service.name = 'platform-fallback-control'"}}}]}}
        _, value, elapsed = request('POST', '/api/v5/query_range', query, self._auth)
        return scalar(value), elapsed

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
        require(count == 0)
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
        primary=error;preserve_failure(error)
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
