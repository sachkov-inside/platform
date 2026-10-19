"""Public supervised first real application SDK-only resource experiment, not capacity acceptance."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
sys.path.insert(0, str(ROOT / 'scripts/observability-pilot'))
import pilot
import ci
sys.path.insert(0, str(SCRIPTS))
import fixture
import measurements
import profile as resource_profile

PROJECT_PREFIX = 'inside-observability-resource-'
SERVICES = (*pilot.SERVICES, 'postgres', 'migrations', 'api', 'provider', 'loadgen')
ACTIVE = tuple(name for name in SERVICES if name != 'migrations')
COMMAND_SECONDS = 15
ENGINE_SECONDS = 8
PHASE_SECONDS = 40
SAMPLER_STOP_SECONDS = 12
MAX_ROUNDS = 20
MISSING = ['accepted representative workload', 'Web/workers/broker/Umami/full MCP process corpus',
           'long steady/spike/concurrent storage queries/restart/loss ledger', 'all volume/log/temp bytes and inodes',
           'physical-host/Timeweb baseline and reserve', 'full retention/deletion/isolated restore/pgBackRest',
           'production and seven days']


def invoke(compose, args, *, timeout=COMMAND_SECONDS):
    deadline = time.monotonic() + timeout
    pilot.assert_docker_identity(deadline=deadline)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('resource_command_deadline')
    result = subprocess.run(pilot.docker_args(compose + args), capture_output=True, text=True, timeout=remaining)
    if result.returncode or len(result.stdout.encode()) > 1_048_576:
        raise RuntimeError('resource_command_failed')
    return result.stdout


def owned(rows, project):
    if not isinstance(rows, list) or len(rows) > len(SERVICES) + 1:
        raise ValueError('owned_container_set')
    result = {}
    for row in rows:
        labels = row.get('Config', {}).get('Labels', {})
        name, container = labels.get('com.docker.compose.service'), row.get('Id')
        if (labels.get('com.docker.compose.project') != project or name not in (*SERVICES, 'storage-probe')
                or name in result or not isinstance(container, str) or not re.fullmatch(r'[a-f0-9]{64}', container)):
            raise ValueError('foreign_or_duplicate_container')
        state = row.get('State', {})
        result[name] = {'container': container, 'running': state.get('Running') is True,
                        'oom': state.get('OOMKilled') if type(state.get('OOMKilled')) is bool else None,
                        'restarts': measurements.counter(row.get('RestartCount')),
                        'cgroup_private': row.get('HostConfig', {}).get('CgroupnsMode') == 'private'}
    return result


def inspect(compose, project):
    ids = invoke(compose, ['ps', '-aq']).split()
    if not ids or len(ids) > len(SERVICES) + 1 or any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in ids):
        raise RuntimeError('owned_container_ids')
    return owned(json.loads(invoke(['docker'], ['inspect', *ids])), project)


def wait_ready(compose):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            # TCP plus SQL on the final server, never init-only Unix readiness.
            invoke(compose, ['exec', '-T', 'postgres', 'sh', '-c',
                'PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=1 PGOPTIONS="-c statement_timeout=1000" psql --host 127.0.0.1 --username postgres --dbname inside -Atqc "SELECT 1"'],
                timeout=min(5, deadline - time.monotonic()))
            return
        except RuntimeError:
            time.sleep(.25)
    raise RuntimeError('resource_database_readiness_deadline')


def client(compose, action, *, timeout=PHASE_SECONDS):
    raw = invoke(compose, ['exec', '-T', 'loadgen', 'node', '/resource/client.mjs', action, '/private/token.json'], timeout=timeout)
    return json.loads(raw)


def valid_sample(value):
    if (not isinstance(value, dict) or set(value) != {'label', 'outcome', 'status', 'elapsed_ms'}
            or value['label'] not in resource_profile.LABELS
            or value['outcome'] not in ('ok', 'timeout', 'oversize', 'transport_error', 'unexpected_response', 'schedule_missed')
            or value['status'] is not None and (type(value['status']) is not int or not 100 <= value['status'] <= 599)
            or value['elapsed_ms'] is not None and (type(value['elapsed_ms']) not in (int, float) or not math.isfinite(value['elapsed_ms']) or not 0 <= value['elapsed_ms'] <= PHASE_SECONDS * 1000)
            or (value['outcome'] == 'schedule_missed') != (value['elapsed_ms'] is None)
            or value['outcome'] == 'ok' and value['status'] != 200):
        raise ValueError('closed_latency_sample')
    return value


def phase_result(raw):
    if not isinstance(raw, dict) or set(raw) != {'samples', 'elapsed_seconds', 'client_cpu_seconds'}:
        raise ValueError('closed_phase_fields')
    if not isinstance(raw['samples'], list) or len(raw['samples']) != 100:
        raise ValueError('closed_phase_samples')
    for index, sample in enumerate(raw['samples']):
        valid_sample(sample)
        if sample['label'] != resource_profile.LABELS[index % 2]:
            raise ValueError('closed_schedule')
    for key in ('elapsed_seconds', 'client_cpu_seconds'):
        if type(raw[key]) not in (int, float) or not math.isfinite(raw[key]) or not 0 <= raw[key] <= PHASE_SECONDS:
            raise ValueError('closed_phase_counter')
    return raw


def raw_round(output, states):
    deadline = time.monotonic() + ENGINE_SECONDS
    pilot.assert_docker_identity(deadline=deadline)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('engine_preflight_deadline')
    result = subprocess.run([sys.executable, str(SCRIPTS / 'engine.py'), str(output), json.dumps([states[name]['container'] for name in ACTIVE])],
                            capture_output=True, text=True, timeout=remaining)
    pilot.assert_docker_identity(deadline=deadline)
    if result.returncode or len(result.stdout.encode()) > 65_536:
        return {}
    return json.loads(result.stdout)


def operations(compose, states):
    result = {}
    for name in ACTIVE:
        if not states[name]['cgroup_private']:
            result[name] = (None, None)
            continue
        try:
            # Fixed read from each verified owned private cgroup, no host namespace or privileged mount.
            result[name] = measurements.io_stat(invoke(compose, ['exec', '-T', name, 'cat', '/sys/fs/cgroup/io.stat'], timeout=3))
        except (OSError, RuntimeError, subprocess.SubprocessError):
            result[name] = (None, None)
    return result


def measure(output, compose, project):
    states = inspect(compose, project)
    if any(name not in states or not states[name]['running'] for name in ACTIVE):
        raise RuntimeError('active_corpus_incomplete')
    before_io = operations(compose, states)
    samples, stop, failure = [], threading.Event(), []
    start = time.monotonic()
    cpu = [0.0]
    def sample_loop():
        thread_start = time.thread_time()
        try:
            while not stop.is_set() and len(samples) < MAX_ROUNDS:
                raw = raw_round(output, states)
                at = time.monotonic() - start
                rows = {}
                for name in ACTIVE:
                    container = states[name]['container']
                    data = raw.get(container, measurements.engine({}))
                    if not isinstance(data, dict) or set(data) != set(measurements.engine({})) or any(value is not None and measurements.counter(value) is None for value in data.values()):
                        raise ValueError('closed_raw_counters')
                    rows[name] = {'container':container, 'at_seconds':at, **data}
                samples.append(rows)
                stop.wait(resource_profile.load()['sample_interval_seconds'])
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            failure.append('counter_transport_unknown')
        finally:
            cpu[0] = time.thread_time() - thread_start
    monitor = threading.Thread(target=sample_loop, name='owned-resource-sampler')
    monitor.start()
    try:
        measured = phase_result(client(compose, 'load'))
    finally:
        stop.set()
        monitor.join(SAMPLER_STOP_SECONDS)
        if monitor.is_alive():
            # External supervisor owns the worker group, including a failed/stuck sampler's child.
            raise RuntimeError('sampler_shutdown_failed')
    after_io = operations(compose, states)
    final = inspect(compose, project)
    coherent = all(name in final and final[name]['container'] == states[name]['container'] and final[name]['running']
                   and final[name]['oom'] is False and final[name]['restarts'] == states[name]['restarts'] == 0 for name in ACTIVE)
    counters = {}
    for name in ACTIVE:
        first, last = (samples[0][name], samples[-1][name]) if len(samples) >= 2 else ({}, {})
        elapsed = last.get('at_seconds', 0) - first.get('at_seconds', 0)
        ns = measurements.delta(first, last, 'cpu_total_ns') if coherent else None
        counts = []
        for a, b in zip(before_io[name], after_io[name]):
            counts.append(b - a if coherent and a is not None and b is not None and b >= a else None)
        counters[name] = {'cpu_seconds': ns / 1e9 if ns is not None else None,
            'cpu_interval_seconds': elapsed if ns is not None else None,
            'io_read_operations_delta': counts[0], 'io_write_operations_delta': counts[1],
            'memory_peak_charged_bytes': max((row[name]['memory_charged_bytes'] for row in samples if row[name]['memory_charged_bytes'] is not None), default=None)}
    return {**measured, 'raw_samples':samples, 'counter_summary':counters, 'counter_errors':failure,
            'lifecycle_coherent':coherent, 'sampler_thread_cpu_seconds':cpu[0],
            'counter_window':'phase includes equal warmup; io brackets entire phase and sampling', 'state_before':states, 'state_after':final}


def worker(output):
    owner = json.loads((output / 'owner.json').read_text())
    if owner.get('supervisor_pid') != os.getppid():
        raise RuntimeError('resource_worker_requires_external_supervisor')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    stage = 'configuration'
    proof = {'schema':1, 'acceptance':'pending', 'scope':'short proposed synthetic SDK-only comparison', 'pairs':[], 'missing':MISSING}
    try:
        with pilot.worker_storage_guard(owner, compose, output):
            manifest = resource_profile.load()
            pilot.install_plugin(output)
            invoke(compose, ['config', '--quiet'])
            stage = 'image_source_identity'
            identity = json.loads(invoke(compose, ['run', '--rm', '--no-deps', 'migrations', 'node', '-e', "process.stdout.write(require('node:fs').readFileSync('/app/release-identity.json','utf8'))"]))
            pins = json.loads((output / 'resource-images.json').read_text())
            if identity != {'release':'v1', 'sourceSha':pins['source']}:
                raise ValueError('backend_source_mismatch')
            version = invoke(compose, ['run', '--rm', '--no-deps', 'migrations', 'node', '--version']).strip()
            if version.removeprefix('v') != (ROOT / '.node-version').read_text().strip().removeprefix('v'):
                raise ValueError('backend_node_mismatch')
            stage = 'acquisition'
            invoke(compose, ['up', '-d', *pilot.SERVICES, 'postgres', 'provider', 'loadgen'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
            wait_ready(compose)
            stage = 'migrations'
            invoke(compose, ['run', '--rm', 'migrations'], timeout=60)
            for pair, order in enumerate(manifest['pairs']):
                result = {'pair':pair, 'order':order, 'modes':{}}
                for mode in order:
                    stage = 'api_' + mode
                    fixture.mode(output / 'compose.json', mode)
                    invoke(compose, ['up', '-d', '--force-recreate', '--no-deps', 'api'], timeout=60)
                    deadline = time.monotonic() + 60
                    while True:
                        ready = client(compose, 'ready', timeout=min(5, max(.01, deadline - time.monotonic())))
                        if ready.get('outcome') == 'ok':
                            break
                        if time.monotonic() >= deadline:
                            raise RuntimeError('api_readiness_deadline')
                        time.sleep(.25)
                    if not proof['pairs'] and not result['modes']:
                        if client(compose, 'establish').get('outcome') != 'ok':
                            raise RuntimeError('owned_account_seed')
                    stage = 'measure_' + mode
                    result['modes'][mode] = measure(output, compose, owner['project'])
                    pilot.write_json(output / 'resource-proof.json', {**proof, 'partial_pair':result})
                result['p95_overhead_percent'] = {label: measurements.overhead(result['modes']['off']['samples'], result['modes']['on']['samples'], label) for label in resource_profile.LABELS}
                proof['pairs'].append(result)
                pilot.write_json(output / 'resource-proof.json', proof)
            proof['state'] = 'completed_short_profile' if all(mode['lifecycle_coherent'] and all(sample['outcome'] == 'ok' for sample in mode['samples']) for pair in proof['pairs'] for mode in pair['modes'].values()) else 'partial'
            pilot.write_json(output / 'resource-proof.json', proof)
            evidence = json.loads((output / 'evidence.json').read_text())
            evidence.update({'resource_profile':manifest['profile'], 'status':proof['state'] + '; full resource acceptance pending'})
            pilot.write_json(output / 'evidence.json', evidence)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        pilot.write_json(output / 'readiness.json', {'stage':stage, 'state':'failed', 'error_type':type(error).__name__})
        raise RuntimeError('resource_phase_failed') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'worker', 'recover'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--images', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if args.action == 'worker':
        return worker(output)
    if args.action == 'recover':
        return ci.recover(output, project_prefix=PROJECT_PREFIX, services=SERVICES)
    # WIP checkpoint: never run incomplete measurement semantics.
    raise RuntimeError('resource_runner_incomplete_no_runtime')
    if not args.images or args.images.is_symlink() or args.images.stat().st_size > 4096:
        raise ValueError('private_cache_manifest_required')
    cache = json.loads(args.images.read_text())
    resource_profile.load()
    try:
        return pilot.run(output, prepare_inputs=lambda path: fixture.prepare(path, cache), worker_script=Path(__file__).resolve(),
                         project_prefix=PROJECT_PREFIX, services=SERVICES, scope='short proposed real API SDK-only resource experiment', missing=MISSING.copy())
    finally:
        for directory in ('runtime', 'provider'):
            private = output / directory
            if private.is_dir() and not private.is_symlink():
                for path in private.iterdir():
                    if path.is_file() and not path.is_symlink():
                        path.unlink()


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('observability-resource: failed', file=sys.stderr)
        sys.exit(1)
