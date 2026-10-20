"""Closed native progress. Terminal failures preserve their first owning phase."""
import copy

MAX_BYTES = 8192
CASES = ('logging', 'identity', 'native_labels', 'http_get', 'http_post',
         'unauthorized', 'fallback', 'body_limit', 'upstream_error', 'privacy',
         'partition', 'mcp', 'gateway_unavailable', 'alloy_stale', 'counter_reset', 'inflight')
PHASES = ('acquisition', 'ownership', 'identity', 'seed', 'partition',
          'mcp_initialize', 'mcp_discovery', 'mcp_values', 'mcp_timestamps',
          'inflight', 'gateway_outage', 'alloy_stale', 'reset', 'complete')
FAILURES = ('contract', 'timeout', 'transport', 'budget', 'unknown')


def refuse():
    raise ValueError('closed Caddy run refused')


def validate(value):
    if (type(value) is not dict or set(value) != {'schema', 'scope', 'state', 'phase', 'reason', 'cases'}
            or type(value['schema']) is not int or value['schema'] != 1
            or value['scope'] != 'isolated-pilot-caddy'
            or type(value['state']) is not str or value['state'] not in ('incomplete', 'passed', 'failed', 'interrupted')
            or type(value['phase']) is not str or value['phase'] not in PHASES
            or type(value['reason']) is not str
            or type(value['cases']) is not dict or set(value['cases']) != set(CASES)
            or any(type(v) is not str or v not in ('unrun', 'passed') for v in value['cases'].values())):
        refuse()
    state = value['state']
    if state == 'passed':
        if value['phase'] != 'complete' or value['reason'] != 'none' or any(v != 'passed' for v in value['cases'].values()):
            refuse()
    elif state == 'incomplete':
        if value['phase'] == 'complete' or value['reason'] != 'none':
            refuse()
    elif state == 'failed':
        if value['reason'] not in FAILURES:
            refuse()
    elif value['reason'] != 'interrupted':
        refuse()
    return copy.deepcopy(value)


class Run:
    def __init__(self):
        self._value = {'schema': 1, 'scope': 'isolated-pilot-caddy', 'state': 'incomplete',
                       'phase': 'acquisition', 'reason': 'none', 'cases': dict.fromkeys(CASES, 'unrun')}

    def start(self, phase):
        if phase not in PHASES or phase == 'complete':
            if phase != 'complete' or self._value['state'] == 'incomplete':
                refuse()
        if self._value['state'] == 'incomplete':
            self._value['phase'] = phase

    def pass_case(self, case):
        if case not in CASES:
            refuse()
        if self._value['state'] == 'incomplete':
            self._value['cases'][case] = 'passed'

    def finish(self):
        if self._value['state'] != 'incomplete':
            return
        candidate = {**self._value, 'state': 'passed', 'phase': 'complete'}
        self._value = validate(candidate)

    def fail(self, reason):
        if reason not in (*FAILURES, 'interrupted'):
            refuse()
        if self._value['state'] == 'incomplete':
            self._value = validate({**self._value, 'state': 'interrupted' if reason == 'interrupted' else 'failed', 'reason': reason})

    def snapshot(self):
        return validate(self._value)
