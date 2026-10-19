"""Write private isolated Umami pilot inputs; this command never starts Docker."""
import argparse
import json
import datetime
import re
import os
import pathlib
import secrets

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = ROOT / 'infra/observability/umami/inputs.lock.json'


LOCK_BYTES = 131_072


def validate_lock(raw):
    fields = {'schema', 'umami_version', 'upstream_commit', 'checked_at', 'images', 'sources'}
    if not isinstance(raw, dict) or set(raw) != fields or type(raw['schema']) is not int or raw['schema'] != 1:
        raise ValueError('lock_shape')
    def matches(pattern, value):
        return isinstance(value, str) and re.fullmatch(pattern, value, flags=re.ASCII) is not None
    if not matches(r'[0-9]+\.[0-9]+\.[0-9]+', raw['umami_version']) or not matches(r'[0-9a-f]{40}', raw['upstream_commit']):
        raise ValueError('lock_revision')
    if not isinstance(raw['checked_at'], str) or datetime.date.fromisoformat(raw['checked_at']).isoformat() != raw['checked_at']:
        raise ValueError('lock_date')
    images = raw['images']
    if not isinstance(images, dict) or set(images) != {'umami', 'postgres', 'python'}:
        raise ValueError('lock_images')
    patterns = {'umami': re.escape('ghcr.io/umami-software/umami:' + raw['umami_version']) + r'@sha256:[0-9a-f]{64}', 'postgres': r'postgres:[0-9]+\.[0-9]+-alpine@sha256:[0-9a-f]{64}', 'python': r'python:[0-9]+\.[0-9]+\.[0-9]+-alpine[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}'}
    if any(not matches(patterns[name], value) for name, value in images.items()):
        raise ValueError('lock_image_pin')
    if not isinstance(raw['sources'], list) or not 1 <= len(raw['sources']) <= 64:
        raise ValueError('lock_sources')
    paths = set()
    for source in raw['sources']:
        if not isinstance(source, dict) or set(source) != {'path', 'url', 'sha256'}:
            raise ValueError('lock_source')
        path = source['path']
        if not isinstance(path, str) or not path or len(path) > 512 or any(ord(char) < 33 or ord(char) > 126 for char in path):
            raise ValueError('lock_source_path')
        normalized = pathlib.PurePosixPath(path)
        if normalized.is_absolute() or '..' in normalized.parts or str(normalized) != path or path in paths:
            raise ValueError('lock_source_path')
        paths.add(path)
        expected = 'https://github.com/umami-software/umami/blob/' + raw['upstream_commit'] + '/' + path
        if source['url'] != expected or not matches(r'[0-9a-f]{64}', source['sha256']):
            raise ValueError('lock_source_proof')
    return raw


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_lock_key')
        result[key] = value
    return result


def prepare(output, *, lock_path=LOCK):
    with lock_path.open('rb') as source:
        encoded = source.read(LOCK_BYTES + 1)
    if len(encoded) > LOCK_BYTES:
        raise ValueError('lock_size')
    lock = validate_lock(json.loads(encoded, object_pairs_hook=unique_keys))
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    password = secrets.token_hex(24)
    bootstrap = secrets.token_hex(24)
    init = f"""CREATE ROLE umami LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
CREATE DATABASE umami OWNER umami;
ALTER ROLE umami SET statement_timeout = '5s';
ALTER ROLE umami SET idle_in_transaction_session_timeout = '10s';
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
"""
    (output / 'init.sql').write_text(init)
    (output / 'reader.key').write_text('')
    app_env = {'DATABASE_URL': f'postgresql://umami:{password}@db:5432/umami?connection_limit=5', 'APP_SECRET': secrets.token_hex(32), 'TWO_FACTOR_ENCRYPTION_KEY': secrets.token_hex(32), 'PRIVATE_MODE': '1', 'DISABLE_TELEMETRY': '1', 'DISABLE_UPDATES': '1', 'NEXT_TELEMETRY_DISABLED': '1', 'MCP_ENABLED': '1', 'SALT_ROTATION': 'month', 'HOSTNAME': '0.0.0.0'}
    plan = {'services': {
        'db': {'image': lock['images']['postgres'], 'environment': {'POSTGRES_USER': 'pilot_bootstrap', 'POSTGRES_PASSWORD': bootstrap}, 'volumes': [str(output / 'init.sql') + ':/docker-entrypoint-initdb.d/10-umami.sql:ro', 'database:/var/lib/postgresql/data'], 'networks': ['private'], 'mem_limit': '512m', 'cpus': '0.5', 'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U pilot_bootstrap -d postgres'], 'interval': '2s', 'timeout': '2s', 'retries': 30}},
        'umami': {'image': lock['images']['umami'], 'environment': app_env, 'depends_on': {'db': {'condition': 'service_healthy'}}, 'networks': ['private'], 'mem_limit': '1g', 'cpus': '1', 'init': True},
        'query': {'init': True, 'image': lock['images']['python'], 'command': ['python', '/pilot/gateway.py', '--key-file', '/private/reader.key'], 'volumes': [str(ROOT / 'scripts/observability-umami') + ':/pilot:ro', str(output / 'reader.key') + ':/private/reader.key:ro'], 'ports': ['127.0.0.1:13301:3001'], 'networks': ['private'], 'mem_limit': '64m', 'cpus': '0.25', 'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'environment': {'PYTHONDONTWRITEBYTECODE': '1'}}}, 'networks': {'private': {'internal': True}}, 'volumes': {'database': {}}}
    for service in plan['services'].values():
        service['dns'] = ['127.0.0.1']
    (output / 'compose.json').write_text(json.dumps(plan, indent=2) + '\n')
    for child in output.iterdir():
        os.chmod(child, 0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=pathlib.Path)
    prepare(parser.parse_args().output.resolve())
