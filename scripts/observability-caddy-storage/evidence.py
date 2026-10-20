"""Closed native progress. Terminal failures preserve their first owning phase."""
import copy

MAX_BYTES = 8192
CASES = ('logging', 'identity', 'native_labels', 'http_get', 'http_post',
         'unauthorized', 'fallback', 'body_limit', 'upstream_error', 'privacy',
         'partition', 'mcp', 'gateway_unavailable', 'alloy_stale', 'counter_reset', 'inflight')
OWNERSHIP_ROLES = ('metrics', 'logs', 'traces', 'alloy', 'vmauth', 'gateway', 'grafana')
OWNERSHIP_GATES = ('lookup_read', 'lookup_empty', 'lookup_id', 'lookup_duplicate',
    'inspect_read', 'inspect_decode', 'inspect_shape', 'inspect_id', 'inspect_image',
    'inspect_project', 'inspect_service', 'inspect_config', 'inspect_mount_plan',
    'inspect_mount_shape', 'inspect_mount_set', 'inspect_network_set', 'inspect_network_ids',
    'runtime_read', 'runtime_contract')
OWNERSHIP_GLOBAL = ('plan', 'registry_shape', 'registry_networks', 'registry_volumes',
                    'registry_network_count', 'witness')
OWNERSHIP_PHASES = tuple('ownership_' + gate for gate in OWNERSHIP_GLOBAL) + tuple(
    'ownership_' + role + '_' + gate for role in OWNERSHIP_ROLES for gate in OWNERSHIP_GATES)
OWNERSHIP_IO = {'plan', 'witness', 'lookup_read', 'inspect_read', 'runtime_read'}


def ownership_phase(role, gate):
    if type(gate) is not str:
        refuse()
    if role is None and gate in OWNERSHIP_GLOBAL:
        return 'ownership_' + gate
    if type(role) is str and role in OWNERSHIP_ROLES and gate in OWNERSHIP_GATES:
        return 'ownership_' + role + '_' + gate
    refuse()


PHASES = ('acquisition', 'ownership', 'identity', 'seed', 'partition',
          'mcp_initialize', 'mcp_discovery', 'mcp_values', 'mcp_timestamps',
          'inflight', 'gateway_outage', 'alloy_stale', 'reset', 'complete') + OWNERSHIP_PHASES
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
