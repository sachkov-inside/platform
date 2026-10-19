"""Internal synthetic fixture. Seed stdout is SECRET; verify stdout is curated evidence."""
import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from credentials import credential, native_key
from gateway import NoRedirect

APP = 'http://umami:3000'
QUERY = 'http://query:3001'
RESPONSE_BYTES = 1_048_576
BARRIER_SECONDS = 60
PROVIDER_TIMEOUT_SECONDS = 10
POLL_INTERVAL_SECONDS = 0.25


def capture(raw, website):
    """Pilot fixture only: derive payload from closed codes, never the page defaults."""
    routes = {'product': '/products/fixture', 'material': '/materials/fixture'}
    if not isinstance(raw, dict) or raw.get('route') not in routes:
        raise ValueError('route_not_allowed')
    payload = {'website': website, 'hostname': 'fixture.invalid', 'url': routes[raw['route']], 'userAgent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'}
    if raw.get('event') == 'material_view':
        payload['name'] = 'material_view'
    elif raw.get('event') is not None:
        raise ValueError('event_not_allowed')
    return {'type': 'event', 'payload': payload}



def response_fields(raw, fields):
    if not isinstance(raw, dict):
        raise ValueError('response_shape')
    for field, kind in fields.items():
        value = raw.get(field)
        credential(value)
        if kind == 'uuid' and str(uuid.UUID(value)) != value:
            raise ValueError('response_uuid')
        if kind == 'api-key':
            native_key(value)
    return raw

def call(base, path, *, token=None, body=None, method=None, expected=200, fields=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            status = response.status
            raw = response.read(RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raw = b'{}'
    if status != expected or len(raw) > RESPONSE_BYTES:
        raise RuntimeError(f'http_{status}_expected_{expected}')
    parsed = json.loads(raw)
    return response_fields(parsed, fields or {})


def await_stats(site, key):
    end = int(time.time() * 1000)
    path = f'/api/websites/{site}/stats?' + urllib.parse.urlencode({'startAt': end - 3_600_000, 'endAt': end})
    deadline = time.monotonic() + BARRIER_SECONDS
    while True:
        result = call(QUERY, path, token=key)
        if type(result.get('pageviews')) is not int or result['pageviews'] < 0:
            raise ValueError('stats_count')
        if result['pageviews'] == 1:
            return path, result
        if time.monotonic() >= deadline:
            raise RuntimeError('stored_pageview_barrier')
        time.sleep(POLL_INTERVAL_SECONDS)


def seed():
    deadline = time.monotonic() + BARRIER_SECONDS
    while True:
        try:
            call(APP, '/api/heartbeat')
            break
        except (OSError, RuntimeError):
            if time.monotonic() >= deadline:
                raise RuntimeError('heartbeat_barrier') from None
            time.sleep(POLL_INTERVAL_SECONDS)
    config = call(APP, '/api/config')
    if any(config.get(key) is not True for key in ('privateMode', 'telemetryDisabled', 'updatesDisabled')):
        raise RuntimeError('privacy_configuration')
    admin = call(APP, '/api/auth/login', body={'username': 'admin', 'password': 'umami'}, fields={'token': 'credential'})['token']
    admin_password = secrets.token_hex(24)
    call(APP, '/api/me/password', token=admin, body={'currentPassword': 'umami', 'newPassword': admin_password})
    admin = call(APP, '/api/auth/login', body={'username': 'admin', 'password': admin_password}, fields={'token': 'credential'})['token']
    password = secrets.token_hex(24)
    reader = call(APP, '/api/users', token=admin, body={'username': 'fixture-reader', 'password': password, 'role': 'view-only'}, fields={'id': 'uuid'})
    team = call(APP, '/api/teams', token=admin, body={'name': 'fixture-team'}, fields={'id': 'uuid'})
    call(APP, f'/api/teams/{team["id"]}/users', token=admin, body={'userId': reader['id'], 'role': 'team-view-only'})
    site = call(APP, '/api/websites', token=admin, body={'name': 'fixture', 'domain': 'fixture.invalid', 'teamId': team['id']}, fields={'id': 'uuid'})
    session = call(APP, '/api/auth/login', body={'username': 'fixture-reader', 'password': password}, fields={'token': 'credential'})['token']
    key = call(APP, '/api/me/api-keys', token=session, body={'name': 'fixture-diagnostic'}, fields={'key': 'api-key', 'id': 'uuid'})
    call(APP, '/api/send', body=capture({'route': 'material', 'url': '/private?email=sentinel@example.invalid#secret', 'title': 'sentinel-private-title', 'referrer': 'https://private.invalid/person', 'data': {'secret': 'sentinel-private-data'}}, site['id']))
    # Private stdout must be captured into a mode-0600 fixture file, never CI logs/artifacts.
    return {'site': site['id'], 'reader': reader['id'], 'key': key['key'], 'key_id': key['id'], 'session': session, 'team': team['id']}


def load_state(raw):
    fields = {'site', 'reader', 'team', 'key_id', 'key', 'session'}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise ValueError('state_shape')
    response_fields(raw, {field: 'uuid' if field in ('site', 'reader', 'team', 'key_id') else 'api-key' if field == 'key' else 'credential' for field in fields})
    return raw


def verify(state):
    path, stats = await_stats(state['site'], state['key'])
    for method, route, body in [
        ('POST', '/api/send', capture({'route': 'product'}, state['site'])),
        ('POST', f'/api/websites/{state["site"]}/reset', {}),
        ('DELETE', f'/api/websites/{state["site"]}', None),
        ('POST', '/api/users', {'username': 'bad', 'password': 'never-created', 'role': 'admin'}),
        ('POST', '/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}),
        ('GET', '/api/websites/../users', None),
    ]:
        call(QUERY, route, token=state['key'], method=method, body=body, expected=403)
    # Native role also rejects team-owned website mutation, independently of gateway policy.
    call(APP, f'/api/websites/{state["site"]}/reset', token=state['key'], body={}, expected=401)
    events_path = path.replace('/stats?', '/events?') + '&page=1&pageSize=10'
    events = call(QUERY, events_path, token=state['key'])
    serialized = json.dumps(events)
    if 'sentinel' in serialized or 'email=' in serialized or 'private.invalid' in serialized:
        raise RuntimeError('stored_payload_privacy')
    call(APP, f'/api/me/api-keys/{state["key_id"]}', token=state['session'], method='DELETE')
    call(QUERY, path, token=state['key'], expected=401)
    return {'synthetic_pageviews': stats['pageviews'], 'gateway_mutation_corpus': 'passed', 'native_team_reset_denied': True, 'revoked_key_denied': True, 'stored_fixture_privacy': 'passed', 'native_stdio_mcp': 'pending', 'retention_restore_runtime': 'pending'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['seed', 'verify'])
    args = parser.parse_args()
    try:
        result = seed() if args.phase == 'seed' else verify(load_state(json.load(sys.stdin)))
        print(json.dumps(result, separators=(',', ':')))
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        # Exception text/bodies may contain credentials or private provider output.
        print(json.dumps({'error': type(error).__name__, 'phase': args.phase}), file=sys.stderr)
        sys.exit(1)
