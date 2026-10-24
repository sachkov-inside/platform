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
sys.path.insert(0, str(production.HERE.parent / 'observability-pilot'))
import ci
SCOPE = 'Production generated config, read-key revocation and syslog sanitizer on synthetic owned storage; not Linux host/physical disk or capacity acceptance'
PREFIX = 'inside-observability-production-check-'
ARTIFACTS = ('production-proof.json', 'production-validation.json', 'production-measurements.json',
             'evidence.json', 'cleanup.json', 'worker-outcome.json', 'monitor-failure.json')


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


def prepare_validation(output):
    """Stateless, no-network parser checks. No application, store, host mounts or VM probe starts."""
    prepare(output)
    plan = json.loads((output / 'compose.json').read_text())
    plan = {'services': {'alloy': {'image': plan['services']['alloy']['image'],
        'user': f'{os.getuid()}:{os.getgid()}', 'network_mode': 'none', 'read_only': True,
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'logging': {'driver': 'none'},
        'mem_limit': '512m', 'cpus': .25, 'pids_limit': 64, 'tmpfs': ['/tmp:size=16m'],
        'volumes': [f'{output / "config.alloy"}:/config/collector.alloy:ro',
                    f'{production.CONFIG / "host.alloy"}:/config/host.alloy:ro']}}}
    pilot.write_json(output / 'compose.json', plan)
    pilot.write_json(output / 'validation-only.json', {'validation_only': True})


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
    if (output / 'validation-only.json').exists():
        if json.loads((output / 'validation-only.json').read_text()) != {'validation_only': True}:
            raise ValueError('invalid_validation_mode')
        # The external lifecycle/host monitor still owns this bounded no-network container.
        # Runtime ingestion always takes the stronger VM storage guard below.
        for config in ('collector', 'host'):
            pilot.command(compose + ['run', '--rm', '--no-deps', 'alloy', 'validate', '/config/' + config + '.alloy'])
        pilot.write_json(output / 'production-validation.json', {'schema': 1, 'alloy_parser': 'passed',
                         'runtime': 'not_executed', 'host_metrics': 'not_executed'})
        return
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
    parser.add_argument('action', choices=('run', 'validate', 'worker', 'admission', 'recover', 'collect'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--public', type=Path)
    args = parser.parse_args()
    if args.action == 'admission':
        if args.metadata is None: parser.error('--metadata required')
        names = ci.read_command(['git', '-C', str(production.ROOT), 'ls-files']).splitlines()
        inputs = tuple(production.ROOT / name for name in names if name.startswith((
            'scripts/observability-production', 'infra/observability/production/', 'infra/observability/pilot/',
            'scripts/observability-pilot/', 'scripts/observability-umami/', 'scripts/heavy-check/'))
            or name in ('.github/workflows/observability-production.yml', 'scripts/heavy-check.sh'))
        sys.exit(ci.admission(args.metadata, inputs=inputs, scope=SCOPE))
    elif args.action == 'recover':
        print(json.dumps(ci.recover(args.output, project_prefix=PREFIX, services=production.SERVICES)))
    elif args.action == 'collect':
        if args.metadata is None or args.public is None: parser.error('--metadata and --public required')
        ci.collect(args.output, args.metadata, args.public, artifacts=ARTIFACTS)
    elif args.action == 'worker':
        worker(args.output)
    else:
        validation = args.action == 'validate'
        pilot.run(args.output, prepare_inputs=prepare_validation if validation else prepare,
            worker_script=Path(__file__).resolve(), ports=() if validation else (18427, 1514, 13000),
            project_prefix=PREFIX,
            services=('alloy',) if validation else production.SERVICES,
            scope='Stateless no-network Alloy parser validation only' if validation else SCOPE,
            missing=['production rollout', 'Linux host metrics', 'full resource acceptance', 'seven days'])


if __name__ == '__main__':
    main()
