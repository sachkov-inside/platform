#!/usr/bin/env python3
"""Owned production-config/auth/stdout vertical on synthetic data. Never deploys production."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import urllib.parse

import production

pilot = production.pilot
SCOPE = 'Production generated config, read-key revocation and syslog sanitizer on synthetic owned storage; not Linux host/physical disk or capacity acceptance'


def prepare(output):
    project = 'inside-observability-check-' + secrets.token_hex(6)
    data = output.parent / (project + '-data')
    production.prepare(output, data=data, project=project)
    # Synthetic storage has the supervisor's existing lifecycle. It does not exercise real bind disks.
    plan = json.loads((output / 'compose.json').read_text())
    plan['volumes'] = {name: {} for name in ('metrics', 'logs', 'traces', 'grafana')}
    for name in plan['volumes']:
        destination = '/var/lib/grafana' if name == 'grafana' else '/data'
        plan['services'][name]['user'] = '0:0'
        plan['services'][name]['volumes'][0] = name + ':' + destination
    plan['services']['alloy']['volumes'].append(f'{production.CONFIG / "host.alloy"}:/etc/alloy/host.alloy:ro')
    pilot.write_json(output / 'compose.json', plan)


def request(path, *, token=None, method='GET', port=18427):
    return pilot.request(path, token=token, method=method, port=port)


def read_ready(token):
    return request('/metrics/api/v1/query?query=1', token=token)


def denied(response):
    # An upstream failure is not proof of denial.
    if response[0] not in (400, 401, 403, 404, 405):
        raise RuntimeError('negative_query_did_not_prove_denial')


def syslog(message, *, service='platform-api'):
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    wire = f'<14>1 {stamp} host {service} - - - {message}\n'.encode()
    with socket.create_connection(('127.0.0.1', 1514), timeout=2) as connection:
        connection.sendall(wire)


def worker(output):
    owner = json.loads((output / 'owner.json').read_text())
    if owner['supervisor_pid'] != os.getppid():
        raise ValueError('external_supervisor_required')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    token = (output / 'reader.key').read_text().strip()
    with pilot.worker_storage_guard(owner, compose, output):
        pilot.command(compose + ['config', '--quiet'])
        pilot.command(compose + ['run', '--rm', '--no-deps', 'alloy', 'validate', '/etc/alloy/config.alloy'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
        pilot.command(compose + ['run', '--rm', '--no-deps', 'alloy', 'validate', '/etc/alloy/host.alloy'])
        pilot.command(compose + ['up', '-d'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
        pilot.await_fact(lambda: read_ready(token), lambda response: response[0] == 200, output=output, probe='production_query')
        denied(read_ready(None))
        denied(read_ready('invalid-reader'))
        for path, method in (
            ('/metrics/api/v1/admin/tsdb/delete_series?match[]=x', 'POST'),
            ('/metrics/api/v1/write', 'POST'), ('/metrics/internal/force_flush', 'GET'),
            ('/logs/insert/jsonline', 'POST'), ('/traces/insert/opentelemetry/v1/traces', 'POST'),
            ('/metrics/api/v1/query?query=1', 'PUT'), ('/metrics/../api/v1/write', 'POST')):
            denied(request(path, token=token, method=method))
        pilot.await_fact(lambda: request('/api/user', port=13000), lambda response: response[0] == 401,
                         output=output, probe='grafana_requires_login')
        sentinel = 'inside_production_sentinel_1566'
        trace = '1566' * 8
        syslog(json.dumps({'event': 'request_completed', 'level': 'error', 'traceId': trace,
                           'spanId': '1566' * 4, 'message': sentinel, 'url': '/person?email=' + sentinel,
                           'scope': {'secret': sentinel}, 'event_extra': sentinel}))
        syslog('unstructured ' + sentinel)
        syslog(sentinel, service=sentinel)
        query = '/logs/select/logsql/query?' + urllib.parse.urlencode({'query': 'source:stdout', 'limit': '20'})
        def stored():
            status, raw = request(query, token=token)
            if status != 200:
                return False
            if sentinel in raw:
                raise RuntimeError('stdout_sentinel_retained')
            rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
            return (any(row.get('traceId') == trace and row.get('event') == 'request_completed' for row in rows)
                    and any(row.get('event') == 'stdout_redacted' for row in rows))
        pilot.await_fact(stored, bool, output=output, probe='production_stdout_projection')
        auth = json.loads((output / 'auth.json').read_text())
        grafana_token = auth['users'][1]['bearer_token']
        auth['users'] = auth['users'][1:]
        pilot.write_json(output / 'auth.json', auth)
        pilot.command(compose + ['restart', 'vmauth'])
        pilot.await_fact(lambda: read_ready(grafana_token), lambda response: response[0] == 200,
                         output=output, probe='grafana_reader_after_revocation')
        denied(read_ready(token))
        pilot.write_json(output / 'production-proof.json', {'schema': 1, 'config': 'passed',
            'read_only_negatives': 'passed', 'reader_revocation': 'passed', 'anonymous_grafana': 'denied',
            'stdout_sentinel': 'absent', 'structured_correlation': 'retained',
            'missing': ['real Docker syslog driver wire', 'Linux host/container exporter execution',
                        'physical disk isolation', 'full process/capacity corpus', 'production and seven days']})
        evidence = json.loads((output / 'evidence.json').read_text())
        evidence['status'] = 'synthetic production config/auth/stdout vertical passed'
        pilot.write_json(output / 'evidence.json', evidence)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'worker'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'worker':
        worker(args.output)
    else:
        pilot.run(args.output, prepare_inputs=prepare, worker_script=Path(__file__).resolve(),
            ports=(18427, 1514, 13000), project_prefix='inside-observability-production-check-',
            services=production.SERVICES, scope=SCOPE,
            missing=['production rollout', 'Linux host metrics', 'full resource acceptance', 'seven days'])


if __name__ == '__main__':
    main()
