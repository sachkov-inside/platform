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

SCOPE = 'One production SDK S3 cold read under a test-owned HTTP scope; not genuine API-to-store or resource acceptance'
ARTIFACTS = ('evidence.json', 'cleanup.json', 'worker-outcome.json', 'sdk-storage.json', 'runtime-modules.json', 'recovery.json')
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


def emitter(*, argv=None, environment=None, budget=EMITTER_SECONDS):
    """Own the single native Node child and its in-process HTTP listener until reaped.

    No new process group: the existing outside supervisor also owns this child on
    interruption/SIGKILL of the Python worker. The emitter launches no subprocess.
    """
    if not 0 < budget <= EMITTER_SECONDS:
        raise ValueError('closed emitter budget')
    child = None
    try:
        child = subprocess.Popen(argv or ['node', str(HERE / 'emitter.mjs')], cwd=pilot.ROOT,
                                 env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert child.stdout is not None
        deadline = time.monotonic() + budget
        data = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                if not selector.select(remaining):
                    raise TimeoutError()
                part = os.read(child.stdout.fileno(), min(65536, CHILD_BYTES+1-len(data)))
                if not part:
                    break
                data.extend(part)
                if len(data) > CHILD_BYTES:
                    raise ValueError()
        if child.wait(timeout=max(.001, deadline-time.monotonic())) != 0:
            raise RuntimeError()
        return oracle.decode(bytes(data).decode('utf-8'))
    finally:
        if child is not None:
            try:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill()
                child.wait(timeout=2)
            finally:
                if child.stdout is not None:
                    child.stdout.close()


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
                raise RuntimeError('SDK storage metric read unavailable')
            raw = response.read(oracle.MAX_BYTES+1)
            if len(raw) > oracle.MAX_BYTES:
                raise ValueError('SDK storage response cap')
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
            raise ValueError('SDK storage response cap')
        return raw

def worker(output):
    owner = json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid'] != os.getppid():
        raise RuntimeError('registered external supervisor required')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output/'compose.json')]
    result = {'state': 'incomplete', 'scope': SCOPE}
    started = time.monotonic()
    result['stage'] = 'acquisition'
    try:
        with pilot.worker_storage_guard(owner, compose, output):
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
            targets = source_status_scenario.OwnedTargets(output, compose, plan, pilot.command)
            pilot.verify_trace_store_logging(output, compose)
            if pilot.command(['docker', 'inspect', '--format', '{{.HostConfig.LogConfig.Type}}', targets.targets['alloy']['id']]).strip() != 'none':
                raise RuntimeError('SDK storage collector logging unproved')
            pilot.await_otlp_ready(output=output)
            token = source_status_query._read_private_token(output)
            pilot.await_fact(lambda: pilot.request('/metrics/api/v1/query?query=1', token=token),
                             lambda response: response[0] == 200, output=output, probe='sdk_storage_query_ready')
            release = ci.read_command(['git', '-C', str(pilot.ROOT), 'rev-parse', 'HEAD'])
            # Frozen daemon and exact owned plan/logging are established before secret ingress.
            pilot.assert_docker_identity()
            result['stage'] = 'producer'
            observed = witness(emitter(environment={**os.environ, 'SDK_STORAGE_RELEASE': release}))
            pilot.write_json(output/'runtime-modules.json', {'schema': 1, 'sha256': observed['runtime_modules']})
            deadline = time.monotonic()+STORAGE_SECONDS
            metrics = traces = None
            attempts = 0
            while time.monotonic() < deadline:
                attempts += 1
                result['stage'] = 'stored_metrics'
                metrics = oracle.metrics(metric_response(token, budget=min(10, max(.001, deadline-time.monotonic()))), release=release)
                result['metrics_state'] = 'passed' if metrics is not None else 'pending'
                result['stage'] = 'stored_traces'
                traces = oracle.traces(trace_response(compose, targets, observed['trace_id'], budget=min(10, max(.001, deadline-time.monotonic()))),
                    trace_id=observed['trace_id'], root_id=observed['root_id'], release=release)
                result['traces_state'] = 'passed' if traces is not None else 'pending'
                if metrics is not None and traces is not None:
                    break
                # Poll only the current producer's committed metric/trace facts.
                time.sleep(pilot.POLL_INTERVAL_SECONDS)
            if metrics is None or traces is None:
                raise TimeoutError('SDK storage visibility deadline')
            result['stage'] = 'complete'
            result.update({'state': 'passed', 'provider_requests': 1, 'body_read': 'passed',
                           'metrics': metrics, 'traces': traces, 'attempts': attempts,
                           'services': len(plan['services']), 'native_api_request': False})
            evidence = json.loads((output/'evidence.json').read_text())
            evidence['status'] = 'passed: one native SDK S3 composition only'
            pilot.write_json(output/'evidence.json', evidence)
    finally:
        result['duration_seconds'] = time.monotonic()-started
        pilot.write_json(output/'sdk-storage.json', result)


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
        ci.collect(output, args.metadata, args.public, artifacts=ARTIFACTS)
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
