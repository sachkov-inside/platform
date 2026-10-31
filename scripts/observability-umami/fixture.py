"""Internal synthetic fixture. Seed stdout is SECRET; verify stdout is curated evidence."""
import argparse
from datetime import datetime
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from credentials import credential, native_key
from gateway import NoRedirect, DAY_MS, HISTORY_MS

APP = 'http://umami:3000'
QUERY = 'http://query:3001'
RESPONSE_BYTES = 1_048_576
BARRIER_SECONDS = 60
PROVIDER_TIMEOUT_SECONDS = 10
POLL_INTERVAL_SECONDS = 0.25


SEED_STEPS = ('heartbeat', 'privacy_config', 'bootstrap_login', 'bootstrap_password', 'admin_login',
              'reader_create', 'team_create', 'team_membership', 'website_create', 'reader_login',
              'api_key_create', 'synthetic_send')
FAILURE_KINDS = ('http_status', 'transport', 'invalid_response', 'invariant')
FAILURE_REPORT_BYTES = 1024


class UnexpectedHTTPStatus(RuntimeError):
    def __init__(self, status):
        super().__init__('unexpected fixture HTTP status')
        self.status = status


class InvalidHTTPResponse(ValueError):
    def __init__(self, status):
        super().__init__('invalid fixture HTTP response')
        self.status = status


class FixtureStepFailed(RuntimeError):
    def __init__(self, report):
        super().__init__('synthetic seed step failed')
        self.report = failure_report(report)


def failure_report(raw):
    """The only fixture stderr fields allowed into public readiness evidence."""
    if (not isinstance(raw, dict) or set(raw) != {'phase', 'step', 'error', 'http_status'}
            or raw['phase'] != 'seed' or raw['step'] not in SEED_STEPS
            or raw['error'] not in FAILURE_KINDS):
        raise ValueError('fixture_failure_shape')
    status = raw['http_status']
    if ((status is not None and (type(status) is not int or not 100 <= status <= 599))
            or (raw['error'] == 'http_status' and status is None)
            or (raw['error'] in ('transport', 'invariant') and status is not None)):
        raise ValueError('fixture_failure_status')
    return raw


def created_team(raw):
    """Pinned Umami 3.4.0 returns the [Team, owner TeamUser] transaction tuple."""
    if not isinstance(raw, list) or len(raw) != 2:
        raise ValueError('team_response_shape')
    team, membership = raw
    response_fields(team, {'id': 'uuid'})
    response_fields(membership, {'id': 'uuid', 'teamId': 'uuid', 'userId': 'uuid'})
    if membership['teamId'] != team['id'] or membership.get('role') != 'team-owner':
        raise ValueError('team_response_membership')
    return {'id': team['id']}


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

def call(base, path, *, token=None, body=None, method=None, expected=200, fields=None, response_kind="object"):
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
    if status != expected:
        raise UnexpectedHTTPStatus(status)
    try:
        if len(raw) > RESPONSE_BYTES:
            raise ValueError('response_size')
        parsed = json.loads(raw)
        if response_kind == 'created_team':
            parsed = created_team(parsed)
        elif response_kind != 'object':
            raise ValueError('response_kind')
        return response_fields(parsed, fields or {})
    except (ValueError, KeyError):
        raise InvalidHTTPResponse(status) from None


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
    step = 'heartbeat'
    try:
        deadline = time.monotonic() + BARRIER_SECONDS
        while True:
            try:
                call(APP, '/api/heartbeat')
                break
            except (OSError, RuntimeError):
                if time.monotonic() >= deadline:
                    raise RuntimeError('heartbeat_barrier') from None
                time.sleep(POLL_INTERVAL_SECONDS)
        step = 'privacy_config'
        config = call(APP, '/api/config')
        if any(config.get(key) is not True for key in ('privateMode', 'telemetryDisabled', 'updatesDisabled')):
            raise RuntimeError('privacy_configuration')
        step = 'bootstrap_login'
        admin = call(APP, '/api/auth/login', body={'username': 'admin', 'password': 'umami'}, fields={'token': 'credential'})['token']
        admin_password = secrets.token_hex(24)
        step = 'bootstrap_password'
        call(APP, '/api/me/password', token=admin, body={'currentPassword': 'umami', 'newPassword': admin_password})
        step = 'admin_login'
        admin = call(APP, '/api/auth/login', body={'username': 'admin', 'password': admin_password}, fields={'token': 'credential'})['token']
        password = secrets.token_hex(24)
        step = 'reader_create'
        reader = call(APP, '/api/users', token=admin, body={'username': 'fixture-reader', 'password': password, 'role': 'view-only'}, fields={'id': 'uuid'})
        step = 'team_create'
        team = call(APP, '/api/teams', token=admin, body={'name': 'fixture-team'}, fields={'id': 'uuid'}, response_kind='created_team')
        step = 'team_membership'
        call(APP, f'/api/teams/{team["id"]}/users', token=admin, body={'userId': reader['id'], 'role': 'team-view-only'})
        step = 'website_create'
        site = call(APP, '/api/websites', token=admin, body={'name': 'fixture', 'domain': 'fixture.invalid', 'teamId': team['id']}, fields={'id': 'uuid'})
        step = 'reader_login'
        session = call(APP, '/api/auth/login', body={'username': 'fixture-reader', 'password': password}, fields={'token': 'credential'})['token']
        step = 'api_key_create'
        key = call(APP, '/api/me/api-keys', token=session, body={'name': 'fixture-diagnostic'}, fields={'key': 'api-key', 'id': 'uuid'})
        step = 'synthetic_send'
        call(APP, '/api/send', body=capture({'route': 'material', 'url': '/private?email=sentinel@example.invalid#secret', 'title': 'sentinel-private-title', 'referrer': 'https://private.invalid/person', 'data': {'secret': 'sentinel-private-data'}}, site['id']))
        # Private stdout must be captured into a mode-0600 fixture file, never CI logs/artifacts.
        return {'site': site['id'], 'reader': reader['id'], 'key': key['key'], 'key_id': key['id'], 'session': session, 'team': team['id']}
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        if isinstance(error, UnexpectedHTTPStatus):
            kind, status = 'http_status', error.status
        else:
            kind = 'transport' if isinstance(error, OSError) else 'invalid_response' if isinstance(error, (ValueError, KeyError)) else 'invariant'
            status = error.status if isinstance(error, InvalidHTTPResponse) else None
        raise FixtureStepFailed({'phase': 'seed', 'step': step, 'error': kind, 'http_status': status}) from None


def load_state(raw):
    fields = {'site', 'reader', 'team', 'key_id', 'key', 'session'}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise ValueError('state_shape')
    response_fields(raw, {field: 'uuid' if field in ('site', 'reader', 'team', 'key_id') else 'api-key' if field == 'key' else 'credential' for field in fields})
    return raw


def retention_query(state):
    """Prove the approved query boundary hides old rows BEFORE physical cleanup."""
    now = int(time.time() * 1000)
    cutoff = now - HISTORY_MS
    site = state['site']
    for route in (
        f'/api/websites/{site}/events?startAt={cutoff - DAY_MS}&endAt={cutoff}',
        f'/api/websites/{site}/stats?startAt={cutoff - DAY_MS}&endAt={cutoff}',
        f'/api/websites/{site}/stats?startAt={cutoff + 3_600_000}&endAt={cutoff + 10_800_000}',
        f'/api/websites/{site}/events', f'/api/websites/{site}/stats',
        f'/api/websites/{site}/sessions', f'/api/websites/{site}/sessions/00000000-0000-4000-8000-000000000001',
        f'/api/websites/{site}/event-data',
    ):
        call(QUERY, route, token=state['key'], expected=403)
    start = now - 2 * DAY_MS
    route = f'/api/websites/{site}/events?' + urllib.parse.urlencode({'startAt': start, 'endAt': now, 'page': 1, 'pageSize': 100})
    result = call(QUERY, route, token=state['key'])
    rows = result.get('data')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValueError('retention_event_rows')
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('createdAt'), str) or len(row['createdAt']) > 40:
            raise ValueError('retention_event_time')
        created = datetime.fromisoformat(row['createdAt'].replace('Z', '+00:00'))
        if created.tzinfo is None or not start <= int(created.timestamp() * 1000) <= now:
            raise ValueError('retention_event_horizon')
    if (not any(row.get('eventName') == 'ttl_recent' for row in rows)
            or any(row.get('eventName') in ('ttl_expired', 'ttl_null') for row in rows)):
        raise ValueError('retention_event_fixture')
    return {'history_window_denied': True, 'windowless_detail_denied': True,
            'recent_events_visible_before_cleanup': True}


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
    parser.add_argument('phase', choices=['seed', 'verify', 'retention'])
    args = parser.parse_args()
    try:
        result = seed() if args.phase == 'seed' else (retention_query if args.phase == 'retention' else verify)(load_state(json.load(sys.stdin)))
        print(json.dumps(result, separators=(',', ':')))
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        # Exception text/bodies may contain credentials or private provider output.
        report = error.report if isinstance(error, FixtureStepFailed) else {'error': type(error).__name__, 'phase': args.phase}
        print(json.dumps(report), file=sys.stderr)
        sys.exit(1)
