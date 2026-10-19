"""Public supervised first real application SDK-only resource experiment, not capacity acceptance."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import stat
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
import sdk_diagnostics
import binding
import profile as resource_profile

PROJECT_PREFIX = resource_profile.PROJECT_PREFIX
SERVICES = (*pilot.SERVICES, 'postgres', 'migrations', 'api', 'provider', 'loadgen')
ACTIVE = tuple(name for name in SERVICES if name != 'migrations')
COMMAND_SECONDS = 15
ENGINE_SECONDS = 8
LATENCY_COMMAND_SECONDS = 10
PHASE_SECONDS = 40
SAMPLER_STOP_SECONDS = 12
MAX_ROUNDS = 20
MISSING = ['accepted representative workload', 'Web/workers/broker/Umami/full MCP process corpus',
           'long steady/spike/concurrent storage queries/restart/loss ledger', 'all volume/log/temp bytes and inodes',
           'physical-host/Timeweb baseline and reserve', 'normalized whole-host CPU overhead and acceptance thresholds', 'full retention/deletion/isolated restore/pgBackRest',
           'production and seven days']


def invoke(compose, args, *, timeout=COMMAND_SECONDS, retain_partial=False):
    deadline = time.monotonic() + timeout
    pilot.assert_docker_identity(deadline=deadline)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('resource_command_deadline')
    try:
        result = subprocess.run(pilot.docker_args(compose + args), capture_output=True, text=True, timeout=remaining)
    except subprocess.TimeoutExpired as error:
        if not retain_partial:
            raise
        partial = error.stdout or b''
        if len(partial) > 65_536:
            raise ValueError('partial_client_size')
        return (partial.decode('utf-8') if isinstance(partial, bytes) else partial), False
    if retain_partial:
        if len(result.stdout.encode()) > 65_536:
            raise ValueError('partial_client_size')
        return result.stdout, result.returncode == 0
    if result.returncode or len(result.stdout.encode()) > 1_048_576:
        raise RuntimeError('resource_command_failed')
    return result.stdout


def owned(rows, project):
    if not isinstance(rows, list) or len(rows) > len(SERVICES) + 1:
        raise ValueError('owned_container_set')
    result = {}
    for row in rows:
        if (not isinstance(row, dict) or any(not isinstance(row.get(key), dict) for key in ('Config','HostConfig','State'))
                or not isinstance(row['Config'].get('Labels'), dict)):
            raise ValueError('container_record_shape')
        labels = row['Config']['Labels']
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
    raw = invoke(compose, ['exec', '-T', 'loadgen', 'node', '/resource/client.mjs', action, '/private/token.json'], timeout=timeout, retain_partial=action == 'load')
    if action != 'load':
        return json.loads(raw)
    text, clean = raw
    result = parse_phase(text)
    result['client_completed'] = result['client_completed'] and clean
    return result


def startup_stage(action, mode):
    if action not in ('ready','establish','protected-ready') or mode not in ('off','on'):
        raise ValueError('closed_startup_action')
    return 'api_' + mode + '_' + ('public_ready' if action == 'ready' else action.replace('-','_'))


def startup_client(output, compose, action, mode, *, timeout=PHASE_SECONDS):
    stage = startup_stage(action, mode)
    record = {'schema':1,'stage':stage}
    path = output / 'startup-client.json'
    binding.write(path, {**record,'state':'pending'})
    try:
        value = client(compose, action, timeout=timeout)
        valid_sample(value, success_status=201 if action == 'establish' else 200)
        if (value['label'] != ('public_index' if action == 'ready' else 'protected_account')
                or value['outcome'] in ('schedule_missed','phase_aborted')):
            raise ValueError('closed_startup_sample')
        binding.write(path, {**record,'state':'sampled','sample':value})
        return value
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        reason = 'transport' if isinstance(error, (OSError, subprocess.SubprocessError)) else 'invalid_sample' if isinstance(error, ValueError) else 'client_failed'
        binding.write(path, {**record,'state':'client_error','error_type':reason})
        raise


def sdk_probe_snapshot(compose):
    raw = invoke(compose, ['exec','-T','loadgen','node','/resource/client.mjs','metric-probe','/query/key'])
    try:
        value = json.loads(raw)
    except ValueError:
        return sdk_diagnostics.unknown_probe()
    return sdk_diagnostics.parse_probe(value, now=time.time())


def write_sdk_probes(output, records):
    binding.write(output / 'resource-sdk-diagnostics.json', {'schema':1,
        'scope':'fixed aggregate snapshots around ON measurement and existing SDK observation; not acceptance, producer attribution or SDK absence proof',
        'phases':records})


def begin_sdk_probe(output, compose, records, *, pair, started):
    if (type(pair) is not int or pair not in (0,1) or len(records) >= 2
            or any(record['pair'] == pair for record in records)
            or type(started) not in (int,float) or not 0 < started <= sdk_diagnostics.MAX_SAFE_INTEGER or not math.isfinite(started)):
        raise ValueError('closed_sdk_diagnostic_phase')
    record = {'pair':pair,'mode':'on','phase_started_seconds':started,'state':'before_pending',
              'before':None,'after':None,'original':None,'facts':None,'latency':None}
    records.append(record)
    write_sdk_probes(output, records)
    try:
        record.update({'before':sdk_probe_snapshot(compose),'state':'before_measurement'})
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        record.update({'state':'before_failed','error_type':'command_failed'})
        write_sdk_probes(output, records)
        raise
    write_sdk_probes(output, records)
    return record


def finish_sdk_probe(output, compose, records, record, original):
    try:
        after = sdk_probe_snapshot(compose)
        checked = sdk_observation(original, record['phase_started_seconds'], 'on')
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        record.update({'state':'after_failed','error_type':'command_failed'})
        write_sdk_probes(output, records)
        raise
    observation = {key:checked[key] for key in ('state','latest_seconds')}
    record.update({'after':after,'original':observation,'state':'observed',
        'facts':sdk_diagnostics.facts(record['before'],after,observation,started=record['phase_started_seconds'])})
    record.update({'state':'latency_pending','latency':{'state':'pending','attempts':[]}})
    write_sdk_probes(output, records)
    try:
        raw = invoke(compose, ['exec','-T','loadgen','node','/resource/client.mjs','metric-latency-probe','/query/key',str(record['phase_started_seconds'])], timeout=LATENCY_COMMAND_SECONDS)
        try:
            value = json.loads(raw)
        except ValueError:
            value = None
        record['latency'] = sdk_diagnostics.parse_latency(value,now=time.time(),started=record['phase_started_seconds'])
        record['state'] = 'observed'
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        record.update({'state':'latency_failed','latency':{'state':'command_failed','attempts':[]}})
        write_sdk_probes(output, records)
        raise
    write_sdk_probes(output, records)


def valid_sample(value, *, success_status=200):
    if (not isinstance(value, dict) or set(value) != {'label', 'outcome', 'status', 'elapsed_ms'}
            or value['label'] not in resource_profile.LABELS
            or value['outcome'] not in ('ok', 'timeout', 'oversize', 'transport_error', 'unexpected_response', 'schedule_missed', 'phase_aborted')
            or value['status'] is not None and (type(value['status']) is not int or not 100 <= value['status'] <= 599)
            or value['elapsed_ms'] is not None and (type(value['elapsed_ms']) not in (int, float) or not math.isfinite(value['elapsed_ms']) or not 0 <= value['elapsed_ms'] <= PHASE_SECONDS * 1000)
            or (value['outcome'] in ('schedule_missed', 'phase_aborted')) != (value['elapsed_ms'] is None)
            or value['outcome'] == 'ok' and value['status'] != success_status):
        raise ValueError('closed_latency_sample')
    return value


def parse_phase(text):
    if not isinstance(text, str) or len(text.encode()) > 65_536:
        raise ValueError('phase_size')
    samples, warmup, completed = [], [], None
    for line in text.splitlines(keepends=True):
        if not line.endswith('\n'):
            break  # interrupted final write has no acknowledged complete record
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError('phase_record')
        if value.get('kind') == 'warmup' and set(value) == {'kind','samples'} and not warmup and not samples:
            if not isinstance(value['samples'], list) or len(value['samples']) != 20:
                raise ValueError('warmup_shape')
            warmup = [valid_sample(sample) for sample in value['samples']]
            if any(sample['label'] != resource_profile.LABELS[index % 2] for index,sample in enumerate(warmup)):
                raise ValueError('warmup_schedule')
        elif value.get('kind') == 'sample' and set(value) == {'kind','index','label','outcome','status','elapsed_ms'} and warmup and completed is None:
            if type(value['index']) is not int or value['index'] != len(samples) or len(samples) >= 100:
                raise ValueError('phase_index')
            sample = valid_sample({key: value[key] for key in ('label','outcome','status','elapsed_ms')})
            if sample['label'] != resource_profile.LABELS[len(samples) % 2]:
                raise ValueError('phase_schedule')
            samples.append(sample)
        elif value.get('kind') == 'completed' and set(value) == {'kind','elapsed_seconds','client_cpu_seconds'} and len(samples) == 100 and completed is None:
            for key in ('elapsed_seconds','client_cpu_seconds'):
                if type(value[key]) not in (int,float) or not math.isfinite(value[key]) or not 0 <= value[key] <= PHASE_SECONDS:
                    raise ValueError('phase_counter')
            completed = value
        else:
            raise ValueError('closed_phase_record')
    received = len(samples)
    while len(samples) < 100:
        samples.append({'label':resource_profile.LABELS[len(samples) % 2], 'outcome':'phase_aborted', 'status':None, 'elapsed_ms':None})
    return {'samples':samples,'warmup_samples':warmup,'received_samples':received,'client_completed':completed is not None,
            'elapsed_seconds':completed['elapsed_seconds'] if completed else None,
            'client_cpu_seconds':completed['client_cpu_seconds'] if completed else None}


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
    value = json.loads(result.stdout)
    if not isinstance(value,dict) or set(value) != {states[name]['container'] for name in ACTIVE}:
        raise ValueError('closed_counter_container_set')
    return value


def operations(compose, states):
    result = {}
    for name in ACTIVE:
        if not states[name]['cgroup_private']:
            result[name] = None
            continue
        try:
            # Fixed read from each verified owned private cgroup, no host namespace or privileged mount.
            result[name] = measurements.io_devices(invoke(compose, ['exec', '-T', name, 'cat', '/sys/fs/cgroup/io.stat'], timeout=3))
        except (OSError, RuntimeError, subprocess.SubprocessError):
            result[name] = None
    return result


def measure(output, compose, project):
    states = inspect(compose, project)
    if any(name not in states or not states[name]['running'] for name in ACTIVE):
        raise RuntimeError('active_corpus_incomplete')
    before_io = operations(compose, states)
    samples, stop, failure = [], threading.Event(), []
    start = time.monotonic()
    host_cpu = resource.getrusage(resource.RUSAGE_SELF)
    child_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
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
                    reading = raw.get(container)
                    data = measurements.engine({})
                    finished, collection = time.monotonic(), None
                    if reading is not None:
                        if not isinstance(reading, dict) or set(reading) != {'counters','started','finished'}:
                            raise ValueError('raw_reading_shape')
                        begin, end = reading['started'], reading['finished']
                        if (type(begin) not in (int,float) or type(end) not in (int,float) or not math.isfinite(begin)
                                or not math.isfinite(end) or not start <= begin <= end <= time.monotonic()):
                            raise ValueError('raw_reading_clock')
                        data, finished, collection = reading['counters'], end, end-begin
                    if not isinstance(data, dict) or set(data) != set(measurements.engine({})) or any(value is not None and measurements.counter(value) is None for value in data.values()):
                        raise ValueError('closed_raw_counters')
                    rows[name] = {'container':container,'at_seconds':finished-start,'collection_seconds':collection,**data}

                samples.append(rows)
                stop.wait(resource_profile.load()['sample_interval_seconds'])
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            failure.append('counter_transport_unknown')
        finally:
            cpu[0] = time.thread_time() - thread_start
    monitor = threading.Thread(target=sample_loop, name='owned-resource-sampler')
    monitor.start()
    try:
        measured = client(compose, 'load')
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        measured = parse_phase('')
        failure.append('client_transport_unknown')
    finally:
        stop.set()
        monitor.join(SAMPLER_STOP_SECONDS)
        if monitor.is_alive():
            # External supervisor owns the worker group, including a failed/stuck sampler's child.
            raise RuntimeError('sampler_shutdown_failed')
    try:
        after_io = operations(compose, states)
        final = inspect(compose, project)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        after_io = {name:None for name in ACTIVE}
        final = {}
        failure.append('final_counters_unknown')
    coherent = all(name in final and final[name]['container'] == states[name]['container'] and final[name]['running']
                   and final[name]['oom'] is False and final[name]['restarts'] == states[name]['restarts'] == 0 for name in ACTIVE)
    counters = {}
    for name in ACTIVE:
        first, last = (samples[0][name], samples[-1][name]) if len(samples) >= 2 else ({}, {})
        elapsed = last.get('at_seconds', 0) - first.get('at_seconds', 0)
        ns = measurements.series_delta([row[name] for row in samples], 'cpu_total_ns') if coherent else None
        counts = measurements.io_delta(before_io[name], after_io[name]) if coherent else (None,None)
        counters[name] = {'cpu_seconds': ns / 1e9 if ns is not None else None,
            'cpu_interval_seconds': elapsed if ns is not None else None,
            'cpu_interval_uncertainty_seconds': first['collection_seconds'] + last['collection_seconds'] if ns is not None and first.get('collection_seconds') is not None and last.get('collection_seconds') is not None else None,
            'io_read_operations_delta': counts[0], 'io_write_operations_delta': counts[1],
            'memory_missing_samples': sum(row[name]['memory_charged_bytes'] is None for row in samples),
            'memory_sampled_max_charged_bytes': max((row[name]['memory_charged_bytes'] for row in samples if row[name]['memory_charged_bytes'] is not None), default=None)}
    current_cpu = resource.getrusage(resource.RUSAGE_SELF)
    current_child_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {**measured, 'helper_host_cpu_seconds': current_cpu.ru_utime+current_cpu.ru_stime-host_cpu.ru_utime-host_cpu.ru_stime,
            'helper_child_cpu_seconds':current_child_cpu.ru_utime+current_child_cpu.ru_stime-child_cpu.ru_utime-child_cpu.ru_stime, 'raw_samples':samples, 'counter_summary':counters, 'counter_errors':failure,
            'lifecycle_coherent':coherent, 'sampler_thread_cpu_seconds':cpu[0],
            'counter_window':'phase includes equal warmup; io brackets entire phase and sampling', 'state_before':states, 'state_after':final}


def registration(output):
    deadline=time.monotonic()+2
    path=output/'worker.json'
    while True:
        if path.is_symlink():
            raise ValueError('worker_registration_symlink')
        try:
            record=json.loads(path.read_text())
        except (FileNotFoundError,ValueError):
            record=None
        if record is not None:
            if (not isinstance(record,dict) or record.get('pid')!=os.getpid() or record.get('group')!=os.getpid()
                    or os.getpgrp()!=os.getpid() or record.get('supervisor_pid')!=os.getppid()):
                raise ValueError('worker_registration_mismatch')
            return
        if time.monotonic()>=deadline:
            raise ValueError('worker_registration_deadline')
        time.sleep(.02)


def worker(output):
    owner = json.loads((output / 'owner.json').read_text())
    if (not isinstance(owner,dict) or owner.get('supervisor_pid') != os.getppid()
            or owner.get('cwd') != str(ROOT) or not isinstance(owner.get('project'),str)
            or not re.fullmatch(re.escape(PROJECT_PREFIX)+r'[0-9a-f]{12}',owner['project'])):
        raise RuntimeError('resource_worker_requires_external_supervisor')
    registration(output)
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    stage = 'configuration'
    proof = {'schema':1, 'acceptance':'pending', 'scope':'short proposed synthetic SDK-only comparison', 'pairs':[], 'missing':MISSING}
    binding.write(output / 'resource-proof.json',proof)
    diagnostic_records = []
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
            foundation_version=invoke(compose,['run','--rm','--no-deps','postgres','postgres','--version']).strip()
            if foundation_version!='postgres (PostgreSQL) 18.4':
                raise ValueError('foundation_postgres_version')
            proof['runtime_identity']={'backend_release':'v1','backend_source':pins['source'],'node':version,'postgres':foundation_version}
            stage = 'acquisition'
            invoke(compose, ['up', '-d', *pilot.SERVICES, 'postgres', 'provider', 'loadgen'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
            wait_ready(compose)
            stage = 'provider_readiness'
            deadline = time.monotonic() + 60
            while True:
                try:
                    invoke(compose, ['exec','-T','provider','node','-e',
                        "const value=JSON.parse(require('node:fs').readFileSync('/private/token.json','utf8'));if(typeof value.token!=='string')process.exit(1)"],
                        timeout=min(5,max(.01,deadline-time.monotonic())))
                    break
                except RuntimeError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('provider_readiness_deadline') from None
                    time.sleep(.25)
            stage = 'migrations'
            invoke(compose, ['run', '--rm', 'migrations'], timeout=60)
            for pair, order in enumerate(manifest['pairs']):
                result = {'pair':pair, 'order':order, 'modes':{}}
                for mode in order:
                    stage = 'api_' + mode
                    fixture.mode(output / 'compose.json', mode)
                    phase_started = time.time()
                    invoke(compose, ['up', '-d', '--force-recreate', '--no-deps', 'api'], timeout=60)
                    stage = startup_stage('ready', mode)
                    deadline = time.monotonic() + 60
                    while True:
                        try:
                            ready = startup_client(output, compose, 'ready', mode, timeout=min(5, max(.01, deadline - time.monotonic())))
                        except RuntimeError:
                            ready = {'outcome':'not_ready'}
                        if ready.get('outcome') == 'ok':
                            break
                        if time.monotonic() >= deadline:
                            raise RuntimeError('api_readiness_deadline')
                        time.sleep(.25)
                    if not proof['pairs'] and not result['modes']:
                        stage = startup_stage('establish', mode)
                        if startup_client(output, compose, 'establish', mode).get('outcome') != 'ok':
                            raise RuntimeError('owned_account_seed')
                    stage = startup_stage('protected-ready', mode)
                    if startup_client(output, compose, 'protected-ready', mode).get('outcome') != 'ok':
                        raise RuntimeError('protected_fixture_readiness')
                    diagnostic_record = None
                    if mode == 'on':
                        stage = 'sdk_diagnostics_before_on'
                        diagnostic_record = begin_sdk_probe(output, compose, diagnostic_records, pair=pair, started=phase_started)
                    stage = 'measure_' + mode
                    result['modes'][mode] = measure(output, compose, owner['project'])
                    binding.write(output / 'resource-current.json', {'pair':pair,'mode':mode,'measurement':result['modes'][mode]})
                    observation = json.loads(invoke(compose, ['exec','-T','loadgen','node','/resource/client.mjs','metric','/query/key']))
                    result['modes'][mode]['sdk_observation'] = sdk_observation(observation, phase_started, mode)
                    if diagnostic_record is not None:
                        stage = 'sdk_diagnostics_after_on'
                        finish_sdk_probe(output, compose, diagnostic_records, diagnostic_record, observation)
                    binding.write(output / 'resource-proof.json', {**proof, 'partial_pair':result})
                result['p95_overhead_percent'] = {label: measurements.overhead(result['modes']['off']['samples'], result['modes']['on']['samples'], label) if all(result['modes'][switch]['sdk_observation']['matches_configured_mode'] is True and result['modes'][switch]['client_completed'] and len(result['modes'][switch]['warmup_samples']) == 20 and all(sample['outcome'] == 'ok' for sample in result['modes'][switch]['warmup_samples']) for switch in ('off','on')) else None for label in resource_profile.LABELS}
                proof['pairs'].append(result)
                binding.write(output / 'resource-proof.json', proof)
            proof['state'] = 'completed_short_profile' if all(mode['lifecycle_coherent'] and mode['sdk_observation']['matches_configured_mode'] is True and mode['client_completed'] and not mode['counter_errors']
                and all(sample['outcome'] == 'ok' for sample in mode['samples'] + mode['warmup_samples'])
                and all(counter['cpu_seconds'] is not None and counter['memory_sampled_max_charged_bytes'] is not None
                        and counter['memory_missing_samples'] == 0 and counter['io_read_operations_delta'] is not None for counter in mode['counter_summary'].values()) for pair in proof['pairs'] for mode in pair['modes'].values()) else 'partial'
            binding.write(output / 'resource-proof.json', proof)
            evidence = json.loads((output / 'evidence.json').read_text())
            evidence.update({'resource_profile':manifest['profile'], 'status':proof['state'] + '; full resource acceptance pending'})
            pilot.write_json(output / 'evidence.json', evidence)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        pilot.write_json(output / 'readiness.json', {'stage':stage, 'state':'failed', 'error_type':type(error).__name__})
        raise RuntimeError('resource_phase_failed') from None


def sdk_observation(value, started, mode):
    if not isinstance(value,dict) or set(value)!={'state','latest_seconds'} or value['state'] not in ('known','unknown'):
        raise ValueError('closed_sdk_observation')
    latest=value['latest_seconds']
    if latest is not None and (type(latest) not in (int,float) or not math.isfinite(latest) or not 0 < latest <= time.time()+2):
        value={'state':'unknown','latest_seconds':None}
        latest=None
    fresh=latest is not None and latest >= started if value['state']=='known' else None
    return {**value,'phase_started_seconds':started,'fresh_sample_observed':fresh,
            'matches_configured_mode':fresh == (mode=='on') if fresh is not None else None,
            'scope':'one bounded post-phase query, not an absence or no-loss guarantee'}


def cleanup_private(output, *, acquired=False):
    # Never touch a preexisting/refused output, or break env_file recovery after failed down.
    if acquired is not True or not (output / 'cleanup.json').is_file() or (output / 'cleanup.json').is_symlink():
        return
    cleanup = json.loads((output / 'cleanup.json').read_text())
    if not isinstance(cleanup, dict) or cleanup.get('down') != 'passed' or cleanup.get('residue') != 'passed':
        return
    names = {'runtime':('runtime.env','api.env','mcp.env','migrations.env','material-assets-worker.env',
                        'profile-avatars-worker.env','video-deletions-worker.env','billing-worker.env','notifications-worker.env','web.env'),
             'provider':('token.json','token.json.new'), 'query':('key',),
             'provider-tls':('server.key','server.pem'), 'trust':('provider.pem',)}
    for directory, files in names.items():
        private = output / directory
        if private.is_dir() and not private.is_symlink():
            for name in files:
                path = private / name
                if path.is_file() and not path.is_symlink():
                    path.unlink()


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
        result = ci.recover(output, project_prefix=PROJECT_PREFIX, services=SERVICES)
        if result.get('down') == 'passed' and result.get('residue') == 'passed':
            cleanup_private(output, acquired=True)
        return result
    if not args.images:
        raise ValueError('private_cache_manifest_required')
    descriptor=os.open(args.images,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('private_cache_manifest_regular_file')
        encoded=stream.read(4097)
    if len(encoded)>4096:
        raise ValueError('private_cache_manifest_size')
    cache = json.loads(encoded)
    resource_profile.load()
    acquired = False
    def prepare_owned(path):
        nonlocal acquired
        fixture.prepare(path, cache)
        acquired = True
    try:
        return pilot.run(output, prepare_inputs=prepare_owned, worker_script=Path(__file__).resolve(),
                         project_prefix=PROJECT_PREFIX, services=SERVICES, scope='short proposed real API SDK-only resource experiment', missing=MISSING.copy())
    finally:
        cleanup_private(output, acquired=acquired)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('observability-resource: failed', file=sys.stderr)
        sys.exit(1)
