"""Compose preparation only; immutable cache inputs, one disposable project, no smoke execution."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/observability-pilot'))
import pilot


def images(value, source):
    if (not isinstance(value, dict) or set(value) != {'schema', 'source', 'owner', 'backend', 'foundation'}
            or type(value['schema']) is not int or value['schema'] != 1
            or value['source'] != source or not re.fullmatch(r'[a-f0-9]{40}', source)
            or not isinstance(value['owner'], str)
            or not re.fullmatch(r'inside-platform-production-smoke-cache-[a-z0-9][a-z0-9-]{0,80}', value['owner'])):
        raise ValueError('cache_source_contract')
    for key in ('backend', 'foundation'):
        if not isinstance(value[key], str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', value[key]):
            raise ValueError('immutable_cache_image')
    if value['backend'] == value['foundation']:
        raise ValueError('distinct_cache_images')
    return value


def configuration(output, source):
    runtime = output / 'runtime'
    runtime.mkdir(mode=0o700)
    # This shared writer has no acquisition, env loading, database reset or provider calls.
    shell = '''set -euo pipefail
runtime_config_dir="$1"
source_sha="$2"
release_version=v1
smoke_encryption_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
broker_vhost=inside-production-smoke
broker_url() { printf 'amqps://%s:inside-production-smoke-%s-password@rabbitmq:5671/%s?heartbeat=30' "$1" "$1" "$broker_vhost"; }
source scripts/production-runtime-configuration.sh
write_disposable_runtime_configuration
'''
    result = subprocess.run(['bash', '-c', shell, 'resource-config', str(runtime), source],
                            cwd=ROOT, capture_output=True, timeout=5)
    if result.returncode:
        raise RuntimeError('private_configuration_failed')
    password = secrets.token_hex(24)
    for path in runtime.iterdir():
        content = path.read_text().replace('platform-production-smoke-password', password)
        content = content.replace('https://identity.production-smoke.invalid/oidc/jwks', 'http://provider:8081/oidc/jwks')
        content = content.replace('https://identity.production-smoke.invalid/oidc', 'https://identity.resource.test/oidc')
        content = content.replace('https://api.production-smoke.invalid', 'https://api.resource.test')
        content = content.replace('https://sachkov.dev', 'https://site.resource.test').replace('https://inside.sachkov.dev', 'https://api.resource.test')
        path.write_text(content)
        os.chmod(path, 0o600)
    return password


def mode(path, value):
    if value not in ('off', 'on'):
        raise ValueError('sdk_mode')
    plan = json.loads(path.read_text())
    plan['services']['api']['environment']['INSIDE_OTEL_ENABLED'] = 'true' if value == 'on' else 'false'
    pilot.write_json(path, plan)


def prepare(output, cache):
    source = pilot.command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).strip()
    pins = images(cache, source)
    # Same narrow tag-to-immutable-ID admission as production cache-only smoke; no build/pull fallback.
    for key, suffix in (('backend', '-backend:v1'), ('foundation', '-foundation:local')):
        pilot.assert_docker_identity()
        found = pilot.command(['docker', 'image', 'inspect', pins['owner'] + suffix, '--format', '{{.Id}}']).strip()
        if found != pins[key]:
            raise RuntimeError('owned_cache_identity_mismatch')
    pilot.prepare(output)
    password = configuration(output, source)
    plan = json.loads((output / 'compose.json').read_text())
    uid = str(output.stat().st_uid) + ':' + str(output.stat().st_gid)
    shared = {'image': pins['backend'], 'pull_policy': 'never', 'init': True, 'cap_drop': ['ALL'],
              'security_opt': ['no-new-privileges:true'], 'read_only': True, 'tmpfs': ['/tmp:size=16777216'],
              'mem_limit': '512m', 'cpus': '1', 'pids_limit': 256, 'networks': ['pilot'],
              'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '1'}},
              'dns': ['127.0.0.1']}
    runtime = output / 'runtime'
    service = lambda name, command: {**shared, 'command': command,
        'env_file': [str(runtime / 'runtime.env'), str(runtime / (name + '.env'))]}
    # Keep the established production foundation image/entrypoint and disposable archive-off override.
    # No backup/restore service or host directory is mounted; no foreign database is addressed.
    plan['services']['postgres'] = {'image': pins['foundation'], 'pull_policy': 'never', 'init': True,
        'command': ['postgres', '-c', 'archive_mode=off'], 'networks': ['pilot'], 'dns': ['127.0.0.1'],
        'environment': {'POSTGRES_DB': 'postgres', 'POSTGRES_USER': 'postgres', 'POSTGRES_PASSWORD': secrets.token_hex(24),
                        'PLATFORM_DATABASE_PASSWORD': password, 'LOGTO_DATABASE_PASSWORD': secrets.token_hex(24)},
        'volumes': ['application-database:/var/lib/postgresql'], 'mem_limit': '512m', 'cpus': '1', 'pids_limit': 128,
        'security_opt': ['no-new-privileges:true'], 'logging': shared['logging']}
    plan['volumes']['application-database'] = {}
    plan['services']['migrations'] = service('migrations', ['node', 'dist/migrations/migrate.js'])
    plan['services']['api'] = service('api', ['node', 'dist/entrypoints/api.js'])
    plan['services']['api']['environment'] = {'INSIDE_OTEL_ENABLED': 'false', 'INSIDE_OTEL_ENDPOINT': 'http://alloy:4318', 'INSIDE_OTEL_SAMPLE_RATIO': '1'}
    private = output / 'provider'
    private.mkdir(mode=0o700)
    for name in ('provider', 'loadgen'):
        plan['services'][name] = {**shared, 'user': uid, 'mem_limit': '96m', 'cpus': '0.25',
            'volumes': [str(Path(__file__).with_name('client.mjs')) + ':/resource/client.mjs:ro',
                        str(ROOT / 'infra/observability/resource/profile.json') + ':/infra/observability/resource/profile.json:ro',
                        str(private) + ':/private:' + ('rw' if name == 'provider' else 'ro')],
            'command': ['node', '/resource/client.mjs', 'provider', '/private/token.json'] if name == 'provider'
                else ['node', '-e', 'setInterval(()=>{},1000)']}
    # Core and application images must already exist locally; the prepared run cannot pull candidates.
    for item in plan['services'].values():
        item['pull_policy'] = 'never'
    pilot.write_json(output / 'compose.json', plan)
    os.chmod(output / 'compose.json', 0o600)
    pilot.write_json(output / 'resource-images.json', {key: pins[key] for key in ('source', 'backend', 'foundation')})
