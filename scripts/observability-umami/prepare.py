"""Write private isolated Umami pilot inputs; this command never starts Docker."""
import argparse
import json
import os
import pathlib
import secrets

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = ROOT / 'infra/observability/umami/inputs.lock.json'


def prepare(output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    lock = json.loads(LOCK.read_text())
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
        'query': {'image': lock['images']['python'], 'command': ['python', '/pilot/gateway.py', '--key-file', '/private/reader.key'], 'volumes': [str(ROOT / 'scripts/observability-umami') + ':/pilot:ro', str(output / 'reader.key') + ':/private/reader.key:ro'], 'ports': ['127.0.0.1:13301:3001'], 'networks': ['private'], 'mem_limit': '64m', 'cpus': '0.25', 'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'environment': {'PYTHONDONTWRITEBYTECODE': '1'}}}, 'networks': {'private': {'internal': True}}, 'volumes': {'database': {}}}
    for service in plan['services'].values():
        service['dns'] = ['127.0.0.1']
    (output / 'compose.json').write_text(json.dumps(plan, indent=2) + '\n')
    for child in output.iterdir():
        os.chmod(child, 0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=pathlib.Path)
    prepare(parser.parse_args().output.resolve())
