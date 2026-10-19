"""Supervised disposable Umami compatibility pilot; no production tracker or database."""
import argparse
import base64
from datetime import datetime, timezone
import re
import json
import os
import platform
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).resolve().parent
CONFIG = ROOT / 'infra/observability/umami'
sys.path.insert(0, str(ROOT / 'scripts/observability-pilot'))
import pilot
import ci as core_ci
import prepare
import fixture
import retention_fixture

SERVICES = ('db', 'umami', 'query')
PROJECT_PREFIX = 'inside-observability-umami-'
FIXTURE_BYTES = 65_536
DB_READY_SECONDS = 60
DB_POLL_SECONDS = .25
NATIVE_SETUP_SECONDS = 240


class FixtureCommandFailed(RuntimeError):
    def __init__(self, diagnostic=None):
        super().__init__('owned fixture command failed')
        self.diagnostic = diagnostic


def invoke(compose, args, *, payload=None, timeout=pilot.COMMAND_TIMEOUT_SECONDS, fixture_phase=None):
    """Private fixture input uses stdin, never argv or public diagnostics."""
    deadline = time.monotonic() + timeout
    pilot.assert_docker_identity(deadline=deadline)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('fixture command deadline exhausted before execution')
    result = subprocess.run(pilot.docker_args(compose + args), input=payload,
                            capture_output=True, text=True, timeout=remaining)
    if result.returncode:
        diagnostic = None
        if fixture_phase == 'seed' and len(result.stderr.encode()) <= fixture.FAILURE_REPORT_BYTES:
            try:
                diagnostic = fixture.failure_report(json.loads(result.stderr))
            except (ValueError, TypeError):
                pass
        raise FixtureCommandFailed(diagnostic)
    if len(result.stdout.encode()) > FIXTURE_BYTES:
        raise RuntimeError('owned fixture response exceeds budget')
    return result.stdout


def await_database(compose):
    deadline = time.monotonic() + DB_READY_SECONDS
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('owned database readiness deadline')
        try:
            invoke(compose, ['exec', '-T', 'db', 'pg_isready', '-U', 'pilot_bootstrap', '-d', 'postgres'], timeout=min(pilot.COMMAND_TIMEOUT_SECONDS, remaining))
            return
        except FixtureCommandFailed:
            if time.monotonic() >= deadline:
                raise RuntimeError('owned database readiness deadline') from None
            time.sleep(DB_POLL_SECONDS)


def native_lock(value):
    if not isinstance(value, dict) or value.get('lockfileVersion') != 3 or not isinstance(value.get('packages'), dict):
        raise ValueError('native_lock_shape')
    packages = value['packages']
    root, cli = packages.get(''), packages.get('node_modules/@umami/mcp')
    if (not isinstance(root, dict) or root.get('dependencies') != {'@umami/mcp': '0.2.0'}
            or not isinstance(cli, dict) or cli.get('version') != '0.2.0' or not 2 <= len(packages) <= 100):
        raise ValueError('native_cli_version')
    for name, package in packages.items():
        if not name:
            continue
        if (not isinstance(package, dict) or not isinstance(package.get('version'), str)
                or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', package['version'])
                or not name.startswith('node_modules/') or '..' in name.split('/') or package.get('link')):
            raise ValueError('native_package')
        package_name = name.removeprefix('node_modules/')
        expected = 'https://registry.npmjs.org/' + package_name + '/-/' + package_name.split('/')[-1] + '-' + package['version'] + '.tgz'
        if package.get('resolved') != expected or not isinstance(package.get('integrity'), str) or not package['integrity'].startswith('sha512-'):
            raise ValueError('native_integrity_pin')
        try:
            digest = base64.b64decode(package['integrity'].removeprefix('sha512-'), validate=True)
        except ValueError:
            raise ValueError('native_integrity_pin') from None
        if len(digest) != 64:
            raise ValueError('native_integrity_size')
    return value


def native_result(result, site):
    if not isinstance(result, dict):
        raise RuntimeError('native_result_shape')
    payload = result.get('structuredContent')
    if not isinstance(payload, dict):
        content = result.get('content')
        if not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict) or not isinstance(content[0].get('text'), str):
            raise RuntimeError('native_result_content')
        try:
            payload = json.loads(content[0]['text'])
        except ValueError:
            raise RuntimeError('native_result_json') from None
    if (not isinstance(payload, dict) or payload.get('websiteId') != site
            or not isinstance(payload.get('current'), dict)
            or type(payload['current'].get('pageviews')) is not int or payload['current']['pageviews'] != 1):
        raise RuntimeError('native_fixture_count')


def native_setup(output):
    """Install only this independent, fully locked third-party CLI with scripts off."""
    node, npm = shutil.which('node'), shutil.which('npm')
    if not node or not npm:
        raise RuntimeError('pinned host Node/npm required for native MCP')
    expected = 'v' + (ROOT / '.node-version').read_text().strip().removeprefix('v')
    if pilot.command([node, '--version']).strip() != expected:
        raise RuntimeError('native MCP requires the repository pinned Node version')
    native_lock(json.loads((CONFIG / 'mcp/package-lock.json').read_text()))
    native = output / 'native'
    native.mkdir(mode=0o700)
    for name in ('package.json', 'package-lock.json'):
        shutil.copyfile(CONFIG / 'mcp' / name, native / name)
    pilot.command([npm, 'ci', '--prefix', str(native), '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], timeout=NATIVE_SETUP_SECONDS)
    return node, native / 'node_modules/@umami/mcp/bin/umami-mcp.js'


def fixture_proof(value):
    expected = {'synthetic_pageviews':1, 'gateway_mutation_corpus':'passed', 'native_team_reset_denied':True,
                'revoked_key_denied':True, 'stored_fixture_privacy':'passed', 'native_stdio_mcp':'pending',
                'retention_restore_runtime':'pending'}
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError('fixture_proof_shape')
    if any(type(value[key]) is not type(expected[key]) or value[key] != expected[key] for key in expected):
        raise ValueError('fixture_proof_value')
    return value


def smoke(output, compose):
    stage = 'database_start'
    try:
        pilot.command(compose + ['up', '-d', 'db'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
        await_database(compose)
        stage = 'database_role'
        invoke(compose, ['exec', '-T', 'db', 'psql', '-U', 'pilot_bootstrap', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], payload=(output / 'init.sql').read_text())
        stage = 'umami_start'
        pilot.command(compose + ['up', '-d', 'umami', 'query'], timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
        stage = 'synthetic_seed'
        state = fixture.load_state(json.loads(invoke(compose, ['exec', '-T', 'query', 'python', '/pilot/fixture.py', 'seed'], fixture_phase='seed')))
        # Preserve inode: the bind mount must observe this key, not a replaced file.
        (output / 'reader.key').write_text(state['key'])
        os.chmod(output / 'reader.key', 0o600)
        stage = 'native_mcp_setup'
        node, executable = native_setup(output)
        end = int(time.time() * 1000)
        arguments = {'websiteId': state['site'], 'startAt': datetime.fromtimestamp((end - 3_600_000) / 1000, timezone.utc).isoformat(),
                     'endAt': datetime.fromtimestamp(end / 1000, timezone.utc).isoformat()}
        stage = 'native_mcp_query'
        native = pilot.stdio_probe(node, {'PATH':os.environ.get('PATH', ''), 'NODE_USE_ENV_PROXY':'0', 'UMAMI_URL':'http://127.0.0.1:13301', 'UMAMI_API_TOKEN':state['key']},
                                   'get_website_stats', arguments, state['site'], argv=[node, str(executable)], validate_result=lambda result: native_result(result, state['site']))
        native.update({'version':'0.2.0', 'transport':'stdio', 'host_os':platform.system()})
        stage = 'retention_compatibility'
        def maintenance(sql, *, timeout):
            return invoke(compose, ['exec', '-T', 'db', 'psql', '-X', '-qAt', '-U', 'umami', '-d', 'umami', '-v', 'ON_ERROR_STOP=1'], payload=sql, timeout=timeout)
        retention_fixture.exercise(maintenance,
            lambda: invoke(compose, ['exec', '-T', 'query', 'python', '/pilot/fixture.py', 'retention'], payload=json.dumps(state)),
            state['site'], lambda evidence: pilot.write_json(output / 'umami-retention.json', evidence))
        stage = 'api_privacy_readonly_revocation'
        proof = fixture_proof(json.loads(invoke(compose, ['exec', '-T', 'query', 'python', '/pilot/fixture.py', 'verify'], payload=json.dumps(state))))
        proof['native_stdio_mcp'] = native
        proof['retention_history_runtime'] = 'passed_synthetic_only'
        proof['retention_restore_runtime'] = 'pending'
        pilot.write_json(output / 'umami-proof.json', proof)
        pilot.write_json(output / 'readiness.json', {'stage': 'completed', 'state': 'passed'})
        return {'umami': proof, 'status': 'Umami synthetic compatibility passed; full acceptance pending'}
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report = {'stage': stage, 'state': 'failed', 'error_type': type(error).__name__}
        if isinstance(error, FixtureCommandFailed) and error.diagnostic is not None:
            report['fixture'] = error.diagnostic
        pilot.write_json(output / 'readiness.json', report)
        raise RuntimeError('Umami pilot phase failed; inspect curated readiness evidence') from None


def run_worker(output):
    owner = json.loads((output / 'owner.json').read_text())
    if owner.get('supervisor_pid') != os.getppid():
        raise RuntimeError('Umami worker requires its registered external supervisor')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    with pilot.worker_storage_guard(owner, compose, output):
        pilot.command(compose + ['config', '--quiet'])
        result = smoke(output, compose)
        evidence = json.loads((output / 'evidence.json').read_text())
        evidence.update(result)
        if pilot.native_cpu.has_measurements({'umami': result['umami']['native_stdio_mcp']}, ('umami',)):
            evidence['missing'] = [item for item in evidence['missing'] if item != 'Mac native MCP CPU measurement']
        pilot.write_json(output / 'evidence.json', evidence)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'worker', 'recover'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if args.action == 'worker':
        run_worker(output)
    elif args.action == 'recover':
        core_ci.recover(output, project_prefix=PROJECT_PREFIX, services=SERVICES)
    else:
        try:
            pilot.run(output, prepare_inputs=prepare.prepare, worker_script=Path(__file__).resolve(), ports=(13301,),
                      project_prefix=PROJECT_PREFIX, services=SERVICES, scope='synthetic Umami API/MCP and retention compatibility only',
                      missing=['PostgreSQL retention scheduling/isolated restore/deletion replay/pgBackRest', 'browser consent/identity integration',
                               'complete analytics catalog', 'resource acceptance', 'production and seven days'])
        finally:
            (output / 'reader.key').unlink(missing_ok=True)
            (output / 'init.sql').unlink(missing_ok=True)


if __name__ == '__main__':
    def interrupt(signum, _frame):
        raise KeyboardInterrupt('Umami pilot interrupted')
    signal.signal(signal.SIGTERM, interrupt)
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('observability-umami: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
