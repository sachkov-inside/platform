#!/usr/bin/env python3
"""One native SDK/S3 -> pinned Alloy/VM/VT vertical, in an owned disposable project."""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'observability-pilot'))
import pilot
import ci
import source_status_query
import source_status_scenario
import oracle
import diagnostics
import emitter_phase

SCOPE = 'One production SDK S3 cold read under a test-owned HTTP scope; not genuine API-to-store or resource acceptance'
# Keep inactive representative imports independent of the SDK-only observer.
COLLECTOR_ARTIFACT = 'sdk-collector-observation.json'
ARTIFACTS = ('evidence.json', 'cleanup.json', 'worker-outcome.json', 'sdk-storage.json', 'runtime-modules.json', 'recovery.json', diagnostics.NAME, emitter_phase.NAME, COLLECTOR_ARTIFACT)
EMITTER_SECONDS = 30
STORAGE_SECONDS = 60
CHILD_BYTES = 512 * 1024


def source_inputs():
    paths = ci.read_command(['git', '-C', str(pilot.ROOT), 'ls-files']).splitlines()
    # Deliberately conservative: whole production source and every workspace manifest,
    # build/toolchain/config/patch input, not the synthetic Core23 manifest.
    selected = [name for name in paths if (
        name.startswith(('apps/backend/src/', 'apps/backend/prisma/', 'packages/', 'docs/contracts/', 'patches/', 'scripts/observability-pilot/',
                         'scripts/observability-sdk-storage/', 'infra/observability/pilot/', '.github/actions/setup-platform/'))
        or name.endswith('/package.json') or name.startswith('tsconfig')
        or name in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.node-version',
                    'apps/backend/tsconfig.json', 'apps/backend/tsconfig.build.json', 'apps/backend/prisma.config.ts',
                    'scripts/heavy-check.sh', 'scripts/observability-sdk-storage.test.mjs', 'docs/runbooks/observability-pilot.md', '.github/workflows/observability-sdk-storage.yml'))]
    return tuple(pilot.ROOT / name for name in sorted(selected))


def emitter(*, argv=None, environment=None, budget=EMITTER_SECONDS, diagnostic=None, collector=None):
    """Own the single native Node child and its in-process HTTP listener until reaped.

    No new process group: the existing outside supervisor also owns this child on
    interruption/SIGKILL of the Python worker. The emitter launches no subprocess.
    """
    if not 0 < budget <= EMITTER_SECONDS:
        raise ValueError('closed emitter budget')
    if diagnostic is not None: diagnostic.start('capture')
    child = None
    primary = None
    try:
        child = subprocess.Popen(argv or ['node', str(HERE / 'emitter.mjs')], cwd=pilot.ROOT,
                                 env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        launched = time.monotonic()
        deadline = launched + budget
        if collector is not None:
            try:collector.start(origin=launched)
            except Exception:pass
        assert child.stdout is not None
        data = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                wait = remaining
                if collector is not None:
                    try:wait = min(wait,collector.poll())
                    except Exception:pass
                if not selector.select(wait):
                    if time.monotonic() >= deadline:raise TimeoutError()
                    continue
                part = os.read(child.stdout.fileno(), min(65536, CHILD_BYTES+1-len(data)))
                if not part:
                    break
                data.extend(part)
                if len(data) > CHILD_BYTES:
                    if diagnostic is not None: diagnostic.fail('protocol_cap')
                    raise ValueError()
        while True:
            remaining = deadline-time.monotonic()
            if remaining <= 0:raise TimeoutError()
            wait = remaining
            if collector is not None:
                try:wait = min(wait,collector.poll())
                except Exception:pass
            try:
                exit_code = child.wait(timeout=max(.001,wait))
                break
            except subprocess.TimeoutExpired:
                if collector is None:raise
        if exit_code != 0:
            if diagnostic is not None: diagnostic.fail('native_exit')
            raise RuntimeError()
        if diagnostic is not None: diagnostic.start('protocol_decode')
        try:
            value = oracle.decode(bytes(data).decode('utf-8'))
        except Exception:
            if diagnostic is not None: diagnostic.fail('protocol_decode')
            raise
        if diagnostic is not None: diagnostic.observed(True)
        return value
    except BaseException as error:
        primary = error
        if diagnostic is not None:
            diagnostic.fail('interrupted' if isinstance(error, KeyboardInterrupt) else
                            'deadline' if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)) else
                            'transport' if isinstance(error, OSError) else 'unknown')
        raise
    finally:
        try:
            if child is not None:
                def reap(timeout):
                    if collector is None:return child.wait(timeout=timeout)
                    until=time.monotonic()+timeout
                    while True:
                        try:collector.poll()
                        except Exception:pass
                        remaining=until-time.monotonic()
                        if remaining<=0:raise subprocess.TimeoutExpired('owned emitter',timeout)
                        try:return child.wait(timeout=min(.05,remaining))
                        except subprocess.TimeoutExpired:pass
                try:
                    if child.poll() is None:
                        child.terminate()
                        try:reap(2)
                        except subprocess.TimeoutExpired:child.kill()
                    reap(2)
                finally:
                    if child.stdout is not None:
                        child.stdout.close()
        finally:
            if collector is not None:
                try:collector.finish()
                except BaseException as error:
                    if primary is None and isinstance(error, KeyboardInterrupt):raise


def witness(value):
    """Validate the private row protocol completely before the public map projection."""
    if (type(value) is not dict or set(value) != {'schema', 'trace_id', 'root_id', 'provider_requests', 'body_read', 'runtime_modules'}
            or type(value['schema']) is not int or value['schema'] != 2
            or type(value['provider_requests']) is not int or value['provider_requests'] != 1 or value['body_read'] != 'passed'
            or type(value['trace_id']) is not str or re.fullmatch(r'[0-9a-f]{32}', value['trace_id']) is None
            or type(value['root_id']) is not str or re.fullmatch(r'[0-9a-f]{16}', value['root_id']) is None
            or type(value['runtime_modules']) is not list or not 4 <= len(value['runtime_modules']) <= 1000):
        raise ValueError('invalid emitter witness')
    if value['trace_id'] == '0'*32 or value['root_id'] == '0'*16:
        raise ValueError('invalid emitter identity')
    required = {'apps/backend/dist/infrastructure/observability/'+name+'.js' for name in ('technical-telemetry-runtime', 'technical-telemetry')}
    required |= {'apps/backend/dist/infrastructure/object-storage/'+name+'.js' for name in ('s3-object-storage', 's3-request-observation')}
    seen = set()
    for row in value['runtime_modules']:
        if type(row) is not dict or set(row) != {'path', 'sha256'}:
            raise ValueError('invalid module witness')
        name, digest = row['path'], row['sha256']
        if (type(name) is not str or len(name) > 512 or name.startswith('/') or '..' in name.split('/')
                or not name.startswith(('apps/backend/dist/', 'node_modules/', 'packages/', 'docs/contracts/dist/'))
                or any(marker in name for marker in oracle.PRIVATE)
                or type(digest) is not str or re.fullmatch(r'[0-9a-f]{64}', digest) is None):
            raise ValueError('invalid module witness')
        if name in seen:
            raise ValueError('duplicate module witness')
        seen.add(name)
    if not required <= seen:
        raise ValueError('production module witness missing')
    return {**value, 'runtime_modules': {row['path']: row['sha256'] for row in value['runtime_modules']}}


def metric_response(token, *, budget=10):
    path = '/metrics/api/v1/query?' + urllib.parse.urlencode({
        'query': 'last_over_time({__name__=~".+"}[10m])', 'timeout': '2s', 'nocache': '1'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), source_status_query.NoRedirect())
    with source_status_query._deadline(budget):
        request = urllib.request.Request('http://127.0.0.1:18427'+path, headers={'Authorization': 'Bearer '+token})
        with opener.open(request, timeout=budget) as response:
            if response.status != 200:
                raise diagnostics.QueryReadFailure('SDK storage metric read unavailable')
            raw = response.read(oracle.MAX_BYTES+1)
            if len(raw) > oracle.MAX_BYTES:
                raise diagnostics.ResponseDecode('SDK storage response cap')
            return raw.decode('utf-8')


def trace_response(compose, targets, trace_id, *, budget=10):
    """Fixed read-only full-row lookup for the admitted producer trace, never user input."""
    with source_status_query._deadline(budget):
        if re.fullmatch(r'[0-9a-f]{32}', trace_id) is None:
            raise ValueError('invalid fixed trace')
        deadline = time.monotonic()+budget
        pilot.assert_docker_identity(deadline=deadline)
        target = targets.targets['gateway']
        current = pilot.command(compose+['ps', '-q', 'gateway'], timeout=max(.001, deadline-time.monotonic())).strip()
        if current != target['id'] or targets.inspect('gateway', current) != target:
            raise RuntimeError('SDK storage ownership unproved')
        query = urllib.parse.urlencode({'query': 'trace_id:="'+trace_id+'"', 'limit': 4, 'timeout': '2s'})
        url = 'http://traces:10428/select/logsql/query?'+query
        raw = pilot.command(['docker', 'exec', current, 'sh', '-euc',
                             "set -o pipefail; wget -q -T 3 -O - '"+url+"' | head -c 1048577"],
                            timeout=max(.001, deadline-time.monotonic()))
        if len(raw.encode()) > oracle.MAX_BYTES:
            raise diagnostics.ResponseDecode('SDK storage response cap')
        return raw

def producer_observation(output, *, environment, diagnostic, phase_source=None, collector=None):
    observation_options = {} if collector is None else {"collector":collector}
    if phase_source is None:
        wire = emitter(environment=environment, diagnostic=diagnostic, **observation_options)
    else:
        with emitter_phase.OwnedSdkPhase(output,source=phase_source) as phase:
            wire = emitter(environment=phase.environment(environment), diagnostic=diagnostic, **observation_options)
    diagnostic.start('witness')
    try:
        observed = witness(wire)
    except Exception as error:
        diagnostic.fail('witness_refusal' if isinstance(error, (ValueError, TypeError, KeyError)) else 'unknown'); raise
    diagnostic.start('module_projection')
    try:
        module_artifact = {'schema':1, 'sha256':observed['runtime_modules']}
    except Exception:
        diagnostic.fail('module_projection'); raise
    diagnostic.start('module_write')
    try:
        pilot.write_json(output/'runtime-modules.json', module_artifact)
    except Exception:
        diagnostic.fail('write_failure'); raise
    diagnostic.observed(True)
    return observed


def stored_metrics_and_traces(*, token, compose, targets, observed, release, result, diagnostic):
    """The SDK owner's unchanged raw oracles and visibility budget, with closed boundaries."""
    deadline = time.monotonic()+STORAGE_SECONDS
    metrics = traces = None
    attempts = 0
    while time.monotonic() < deadline:
        attempts += 1
        result['stage'] = 'stored_metrics'
        diagnostic.start('metric_query')
        diagnostic.attempt()
        try:
            raw_metrics = metric_response(token, budget=min(10, max(.001, deadline-time.monotonic())))
        except Exception as error:
            diagnostic.fail(diagnostics.query_reason(error)); raise
        diagnostic.start('metric_validation')
        try:
            metrics = oracle.metrics(raw_metrics, release=release)
        except Exception as error:
            diagnostic.fail(diagnostics.oracle_reason(error)); raise
        diagnostic.observed(metrics)
        result['metrics_state'] = 'passed' if metrics is not None else 'pending'
        result['stage'] = 'stored_traces'
        diagnostic.start('trace_query')
        try:
            raw_traces = trace_response(compose, targets, observed['trace_id'],
                                        budget=min(10, max(.001, deadline-time.monotonic())))
        except Exception as error:
            diagnostic.fail(diagnostics.query_reason(error)); raise
        diagnostic.start('trace_validation')
        try:
            traces = oracle.traces(raw_traces, trace_id=observed['trace_id'], root_id=observed['root_id'], release=release)
        except Exception as error:
            diagnostic.fail(diagnostics.oracle_reason(error,scope='sdk')); raise
        diagnostic.observed(traces)
        result['traces_state'] = 'passed' if traces is not None else 'pending'
        if metrics is not None and traces is not None:
            break
        time.sleep(pilot.POLL_INTERVAL_SECONDS)
    if metrics is None or traces is None:
        diagnostic.start('visibility'); diagnostic.fail('deadline')
        raise TimeoutError('SDK storage visibility deadline')
    return metrics, traces, attempts


def worker(output):
    owner = json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid'] != os.getppid():
        raise RuntimeError('registered external supervisor required')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output/'compose.json')]
    result = {'state': 'incomplete', 'scope': SCOPE}
    started = time.monotonic()
    result['stage'] = 'acquisition'
    diagnostic = diagnostics.Diagnostic('sdk')
    diagnostic.start('acquisition')
    try:
        with pilot.worker_storage_guard(owner, compose, output):
            pilot.install_horizon(output)
            pilot.install_plugin(output)
            pilot.command(compose+['config', '--quiet'])
            pilot.command(compose+['up', '-d'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
            auth_owner = (output/'auth.json').stat()
            plan = pilot.compose_plan(pilot.CONFIG, output,
                json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images'],
                credential_owner=(auth_owner.st_uid, auth_owner.st_gid))
            if json.loads((output/'compose.json').read_text()) != plan:
                raise RuntimeError('SDK storage plan mismatch')
            result['stage'] = 'ownership'
            diagnostic.start('ownership')
            targets = source_status_scenario.OwnedTargets(output, compose, plan, pilot.command)
            pilot.verify_trace_store_logging(output, compose)
            if pilot.command(['docker', 'inspect', '--format', '{{.HostConfig.LogConfig.Type}}', targets.targets['alloy']['id']]).strip() != 'none':
                raise RuntimeError('SDK storage collector logging unproved')
            readiness_start = time.monotonic()
            pilot.await_otlp_ready(output=output)
            readiness_end = time.monotonic()
            token = source_status_query._read_private_token(output)
            pilot.await_fact(lambda: pilot.request('/metrics/api/v1/query?query=1', token=token),
                             lambda response: response[0] == 200, output=output, probe='sdk_storage_query_ready')
            release = ci.read_command(['git', '-C', str(pilot.ROOT), 'rev-parse', 'HEAD'])
            # Frozen daemon and exact owned plan/logging are established before secret ingress.
            pilot.assert_docker_identity()
            import collector_observation
            collector = collector_observation.OwnedCollector(output,source=release,
                admitted=pilot.FROZEN_DOCKER_IDENTITY,
                target={key:targets.targets['alloy'][key] for key in ('id','image','project','service')},
                readiness_times=(readiness_start,readiness_end))
            result['stage'] = 'producer'
            observed = producer_observation(output, environment={**os.environ, 'SDK_STORAGE_RELEASE': release}, diagnostic=diagnostic, phase_source=release, collector=collector)
            metrics, traces, attempts = stored_metrics_and_traces(token=token, compose=compose, targets=targets,
                observed=observed, release=release, result=result, diagnostic=diagnostic)
            result['stage'] = 'complete'
            result.update({'state': 'passed', 'provider_requests': 1, 'body_read': 'passed',
                           'metrics': metrics, 'traces': traces, 'attempts': attempts,
                           'services': len(plan['services']), 'native_api_request': False})
            evidence = json.loads((output/'evidence.json').read_text())
            evidence['status'] = 'passed: one native SDK S3 composition only'
            pilot.write_json(output/'evidence.json', evidence)
            diagnostic.start('complete')
    except BaseException as error:
        diagnostic.fail('interrupted' if isinstance(error, KeyboardInterrupt) else 'unknown')
        raise
    finally:
        result['duration_seconds'] = time.monotonic()-started
        try:
            pilot.write_json(output/'sdk-storage.json', result)
        finally:
            diagnostic.persist(output/diagnostics.NAME)


def collect_unacquired(output,metadata,destination):
    try:output.lstat()
    except FileNotFoundError:pass
    else:return False
    # Only a genuinely absent child of a visible canonical parent is pre-owner.
    if not output.is_absolute() or output.resolve()!=output or not output.parent.is_dir():
        raise ValueError('closed SDK admission collection refused')
    paths=(metadata,metadata/'source.json',metadata/'admission.json')
    before={path:emitter_phase._identity(path.lstat()) for path in paths}
    if any(path.lstat().st_mode & 0o022 for path in paths):
        raise ValueError('closed SDK admission collection refused')
    emitter_phase.source_from_metadata(metadata)
    source=emitter_phase._decode(emitter_phase._read_bytes(paths[1],1_048_576,mode=None))
    admission=emitter_phase._decode(emitter_phase._read_bytes(paths[2],256,mode=None))
    if source['scope']!=SCOPE:raise ValueError('closed SDK admission collection refused')
    if any(emitter_phase._identity(path.lstat())!=before[path] for path in paths):
        raise ValueError('closed SDK admission collection refused')
    if (type(admission) is not dict or set(admission)!={'ready','error_type'} or admission['ready'] is not False
            or type(admission['error_type']) is not str or admission['error_type'] not in
            ('OSError','FileNotFoundError','PermissionError','NotADirectoryError','IsADirectoryError',
             'ValueError','TimeoutExpired','CalledProcessError','SubprocessError')):
        raise ValueError('closed SDK admission collection refused')
    # Publish the already-validated snapshots, never re-read mutable metadata via ci.collect.
    if (output.exists() or output.is_symlink() or destination==output or not destination.is_absolute()
            or destination.resolve()!=destination or not destination.parent.is_dir()):
        raise ValueError('closed SDK admission collection refused')
    destination.mkdir(mode=0o700)
    directory=emitter_phase._directory(destination/'source.json');initial=os.fstat(directory)
    try:
        for name,value in (('source.json',source),('admission.json',admission)):
            emitter_phase._same_directory(directory,destination/name,initial)
            fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
            with os.fdopen(fd,'w') as stream:
                stream.write(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
            emitter_phase._same_directory(directory,destination/name,initial)
    finally:os.close(directory)
    return True


def collect(output, metadata, destination):
    if collect_unacquired(output,metadata,destination):return
    import collector_observation
    source=emitter_phase.source_from_metadata(metadata)
    projected = diagnostics.read(output/diagnostics.NAME, scope='sdk')
    phase=emitter_phase.load_for_collection(output,source=source)
    collector=collector_observation.load_for_collection(output,source=source)
    ci.collect(output, metadata, destination, artifacts=tuple(name for name in ARTIFACTS if name not in (diagnostics.NAME,emitter_phase.NAME,collector_observation.NAME)))
    diagnostics.write(destination/diagnostics.NAME, projected, scope='sdk')
    emitter_phase.write(destination/emitter_phase.NAME,phase,source=source)
    collector_observation.write(destination/collector_observation.NAME,collector,source=source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('admission', 'run', 'worker', 'recover', 'collect'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--public', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if args.action == 'admission':
        return ci.admission(args.metadata, inputs=source_inputs(), scope=SCOPE)
    if args.action == 'run':
        pilot.run(output, worker_script=Path(__file__).resolve(), services=pilot.SERVICES, scope=SCOPE,
                  missing=['genuine API-to-store', 'S3 retries/failures/OFF/503', 'other SDK producers',
                           'full resources and loss accounting', 'production and seven days'])
    elif args.action == 'worker':
        worker(output)
    elif args.action == 'recover':
        ci.recover(output, services=pilot.SERVICES)
    else:
        collect(output, args.metadata, args.public)
    return 0


def cli():
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        return main()
    except KeyboardInterrupt:
        return 130
    except Exception:
        # No raw response, argv, credentials, object metadata or subprocess diagnostics.
        print('sdk-storage: closed boundary failure; inspect curated outcomes', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(cli())
