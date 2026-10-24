#!/usr/bin/env python3
"""Two repeated synthetic production-stack measurements, never whole-host capacity acceptance."""
import argparse
import http.client
import json
import math
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time
import urllib.parse

import check

production, pilot = check.production, check.pilot
sys.path.insert(0, str(production.HERE.parent / 'observability-resource'))
import engine

MAX_BYTES = 1_048_576
CORE = tuple(pilot.SERVICES)


def summarize(rows):
    if not rows:
        raise ValueError('measurement_samples_required')
    services = set().union(*(row['services'] for row in rows))
    if not services:
        raise ValueError('measurement_services_required')
    result = {}
    for service in sorted(services):
        values = [row['services'].get(service, {}) for row in rows]
        def maximum(key):
            known = [value.get(key) for value in values if type(value.get(key)) in (int, float)]
            return max(known) if known else None
        def delta(key):
            numbers = [value.get(key) for value in values]
            if any(type(value) is not int or value < 0 for value in numbers):
                return None
            if any(b < a for a, b in zip(numbers, numbers[1:])):
                return None
            return numbers[-1] - numbers[0]
        cpu = delta('cpu_total_ns')
        elapsed = rows[-1]['at_seconds'] - rows[0]['at_seconds']
        result[service] = {'samples': len(rows), 'sample_errors': sum(service in row['errors'] for row in rows),
            'cpu_seconds': cpu / 1e9 if cpu is not None else None,
            'mean_cpu_cores': cpu / 1e9 / elapsed if cpu is not None and elapsed > 0 else None,
            'maximum_observed_charged_bytes': maximum('memory_charged_bytes'),
            'maximum_observed_working_set_bytes': maximum('memory_working_set_bytes'),
            'maximum_observed_file_bytes': maximum('memory_file_bytes'),
            'maximum_observed_inactive_file_bytes': maximum('memory_inactive_file_bytes'),
            'io_read_operations': delta('io_read_operations'), 'io_write_operations': delta('io_write_operations')}
    return result


def owned(compose, project, services):
    ids = pilot.command(compose + ['ps', '-q', *services]).split()
    if len(ids) != len(services) or any(re.fullmatch(r'[a-f0-9]{64}', value) is None for value in ids):
        raise ValueError('complete_owned_container_set_required')
    projection = '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}}}'
    raw = pilot.command(['docker', 'inspect', '--format', projection, *ids])
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError('owned_container_projection_limit')
    result = {}
    for line in raw.splitlines():
        row = json.loads(line)
        labels = row['labels']
        service = labels.get('com.docker.compose.service')
        if (labels.get('com.docker.compose.project') != project or service not in services or service in result
                or row['id'] not in ids or row['running'] is not True or type(row['oom']) is not bool
                or type(row['restarts']) is not int):
            raise ValueError('owned_container_state_changed')
        result[service] = row
    if set(result) != set(services):
        raise ValueError('missing_owned_service')
    return result


def capture(states):
    pilot.assert_docker_identity()
    frame = {'at_seconds': time.monotonic(), 'services': {}, 'errors': {}}
    for service, state in states.items():
        try:
            value = engine.fetch(pilot.FROZEN_DOCKER_ENDPOINT, state['id'])['counters']
            frame['services'][service] = value
            if value['cpu_total_ns'] is None or value['memory_charged_bytes'] is None:
                frame['errors'][service] = 'required_counter_unavailable'
        except (OSError, ValueError, RuntimeError, http.client.HTTPException):
            frame['services'][service] = {}
            frame['errors'][service] = 'engine_read_failed'
    pilot.assert_docker_identity()
    return frame


def volume_sizes(project):
    """Bounded Engine disk-usage read, projected to this project's four named volumes only."""
    endpoint = pilot.FROZEN_DOCKER_ENDPOINT
    if not isinstance(endpoint, str) or not endpoint.startswith('unix:///'):
        raise ValueError('local_frozen_engine_required')
    pilot.assert_docker_identity()
    connection = http.client.HTTPConnection('localhost', timeout=2)
    connection.sock = socket.socket(socket.AF_UNIX)
    connection.sock.settimeout(2)
    try:
        connection.sock.connect(endpoint[len('unix://'):])
        connection.request('GET', '/system/df?type=volume', headers={'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(MAX_BYTES + 1)
        if response.status != 200 or len(raw) > MAX_BYTES:
            raise ValueError('volume_measurement_unavailable')
        rows = json.loads(raw)['Volumes']
        result = {name: None for name in ('metrics', 'logs', 'traces', 'grafana')}
        for row in rows:
            for name in result:
                if row.get('Name') == project + '_' + name:
                    labels = row.get('Labels') or {}
                    size = (row.get('UsageData') or {}).get('Size')
                    if (labels.get('com.docker.compose.project') == project
                            and type(size) is int and 0 <= size <= 2**63 - 1):
                        result[name] = size
        return result
    finally:
        connection.close()
        pilot.assert_docker_identity()


def numeric_query(expression, token):
    status, raw = check.request('/metrics/api/v1/query?' + urllib.parse.urlencode({'query': expression}), token=token)
    if status != 200:
        return None
    try:
        value = json.loads(raw)
        data = value['data']
        if value['status'] != 'success' or data['resultType'] != 'vector' or len(data['result']) != 1:
            return None
        number = float(data['result'][0]['value'][1])
        return number if math.isfinite(number) else None
    except (ValueError, TypeError, KeyError, IndexError):
        return None


def phase(definition, *, repetition, states, project, token, profile):
    rows, queries, failures = [], [], []
    stop = threading.Event()
    started = time.monotonic()
    def sampling():
        try:
            while True:
                rows.append(capture(states))
                if stop.wait(profile['sample_interval_seconds']):
                    break
        except BaseException:
            failures.append('sampler_failed')
    def reading():
        paths = ('/metrics/api/v1/query?query=1',
                 '/logs/select/logsql/query?' + urllib.parse.urlencode({'query': '_time:1m', 'limit': '1'}),
                 '/traces/select/jaeger/api/services')
        try:
            while not stop.is_set():
                for signal, path in zip(('metrics', 'logs', 'traces'), paths):
                    before = time.monotonic()
                    status, raw = check.request(path, token=token)
                    valid = status == 200
                    if signal == 'metrics':
                        valid = check.query_one((status, raw))
                    elif signal == 'traces' and valid:
                        body = json.loads(raw)
                        valid = isinstance(body.get('data'), list)
                    elif valid:
                        valid = all(isinstance(json.loads(line), dict) for line in raw.splitlines() if line.strip())
                    queries.append({'signal': signal, 'seconds': time.monotonic() - before,
                                    'status': status, 'valid_response': valid})
                stop.wait(profile['query_interval_seconds'])
        except BaseException:
            failures.append('concurrent_query_failed')
    sampler = threading.Thread(target=sampling)
    reader = threading.Thread(target=reading)
    drops_expression = 'sum({__name__=~"otelcol_receiver_refused_.*|otelcol_exporter_send_failed_.*|loki_write_dropped_entries_total"})'
    before_drop = numeric_query(drops_expression, token)
    sampler.start()
    reader.start()
    sent, rejected, scheduled = 0, 0, 0
    try:
        rate = definition['chains_per_second']
        deadline = started + definition['seconds']
        while time.monotonic() < deadline:
            if not rate:
                stop.wait(max(0, deadline - time.monotonic()))
                break
            at = started + scheduled / rate
            stop.wait(max(0, at - time.monotonic()))
            if time.monotonic() >= deadline:
                break
            fixture = pilot.corpus(now_ns=time.time_ns(), sequence=repetition * 10000 + sent)
            for signal, payload in fixture.items():
                response = pilot.request('/v1/' + signal, body=payload, method='POST', port=14318)
                if response[0] != 200:
                    rejected += 1
            check.syslog(json.dumps({'event': 'request_completed', 'level': 'info'}))
            sent += 1
            scheduled += 1
    finally:
        stop.set()
        sampler.join(timeout=25)
        reader.join(timeout=35)
        if sampler.is_alive() or reader.is_alive():
            raise RuntimeError('measurement_threads_did_not_stop')
    rows.append(capture(states))
    after_drop = numeric_query(drops_expression, token)
    sample_time = numeric_query('max(timestamp(pilot_requests))', token)
    lag = max(0, time.time() - sample_time) if sample_time is not None and sent else None
    try:
        volumes = volume_sizes(project)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, http.client.HTTPException):
        volumes = {name: None for name in ('metrics', 'logs', 'traces', 'grafana')}
    return {'phase': definition['name'], 'repetition': repetition, 'duration_seconds': time.monotonic() - started,
        'requested_chains_per_second': definition['chains_per_second'], 'sent_chains': sent,
        'rejected_ingest_requests': rejected, 'ingestion_lag_seconds': lag,
        'observed_drop_delta': after_drop - before_drop if before_drop is not None and after_drop is not None and after_drop >= before_drop else None,
        'drop_completeness': 'unknown: observed collector counters omit Docker producer buffer loss',
        'raw_counter_samples': rows, 'services': summarize(rows), 'queries': queries,
        'volumes_used_bytes': volumes, 'errors': failures}


def prepare(output, *, host_metrics):
    check.prepare(output)
    plan = json.loads((output / 'compose.json').read_text())
    plan['services']['alloy']['ports'].append('127.0.0.1:14318:4318')
    pilot.write_json(output / 'compose.json', plan)
    pilot.write_json(output / 'measurement-mode.json', {'host_metrics': host_metrics})


def worker(output):
    if sys.platform != 'linux':
        raise ValueError('measurement_requires_owned_linux_runner')
    check.worker(output)
    owner = json.loads((output / 'owner.json').read_text())
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    host_metrics = json.loads((output / 'measurement-mode.json').read_text())['host_metrics']
    services = (*CORE, 'host-agent') if host_metrics else CORE
    profile = json.loads((production.CONFIG / 'workload.json').read_text())
    token = json.loads((output / 'auth.json').read_text())['users'][0]['bearer_token']
    report = {'schema': 1, 'scope': 'isolated synthetic production technical topology only',
        'acceptance': 'pending', 'host_metrics': 'enabled: privileged owned Linux runner' if host_metrics else 'disabled',
        'profile': profile, 'phases': [], 'missing': profile['missing'], 'state': 'running'}
    try:
        with pilot.worker_storage_guard(owner, compose, output):
            if host_metrics:
                pilot.command(compose + ['--profile', 'host-metrics', 'up', '-d', 'host-agent'])
                for job in ('platform-host', 'platform-containers'):
                    pilot.await_fact(lambda job=job: numeric_query('up{job="' + job + '"}', token),
                                     lambda value: value == 1, output=output, probe='measured_' + job)
                pilot.await_fact(lambda: numeric_query('count(container_memory_working_set_bytes{job="platform-containers",service=~".+",project=~".+"})', token),
                                 lambda value: value is not None and value > 0, output=output, probe='owned_container_series')
                for label in ('service', 'project'):
                    value = numeric_query('count({__name__=~"container_.+",job="platform-containers",' + label + '=""}) or vector(0)', token)
                    if value != 0:
                        raise ValueError('unowned_container_series_retained')
            states = owned(compose, owner['project'], services)
            for repetition in range(profile['repetitions']):
                for definition in profile['phases']:
                    report['phases'].append(phase(definition, repetition=repetition, states=states,
                        project=owner['project'], token=token, profile=profile))
                    measured = report['phases'][-1]
                    if (measured['errors'] or measured['rejected_ingest_requests']
                            or any(not query['valid_response'] for query in measured['queries'])
                            or any(row['errors'] for row in measured['raw_counter_samples'])
                            or measured['sent_chains'] and measured['ingestion_lag_seconds'] is None):
                        raise ValueError('measurement_has_failed_required_observations')
                    current = owned(compose, owner['project'], services)
                    if any(current[name]['id'] != states[name]['id'] or current[name]['oom']
                           or current[name]['restarts'] != states[name]['restarts'] for name in services):
                        raise ValueError('measurement_container_replaced_oom_or_restarted')
                    pilot.write_json(output / 'production-measurements.json', report)
            report['state'] = 'completed: capacity acceptance remains pending'
    except BaseException:
        report['state'] = 'failed'
        raise
    finally:
        pilot.write_json(output / 'production-measurements.json', report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'worker'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--host-metrics', action='store_true')
    args = parser.parse_args()
    if args.action == 'worker':
        worker(args.output)
    else:
        if sys.platform != 'linux': parser.error('use an isolated Linux runner, not Mac/production')
        pilot.run(args.output, prepare_inputs=lambda output: prepare(output, host_metrics=args.host_metrics),
            worker_script=Path(__file__).resolve(), ports=(18427, 1514, 14318, 13000), project_prefix=check.PREFIX,
            services=production.SERVICES, scope='two repeated synthetic technical production topology measurements',
            missing=['shared PG18 and Umami', 'real application HTTP baseline', 'Timeweb reserve', 'seven days'])


if __name__ == '__main__':
    main()
