"""Prepared real Logto and private TLS Caddy fixture; caller owns every process/lifetime."""
import copy
import json
from pathlib import Path
import re
import ssl

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ('logto', 'logto-migrations', 'caddy')
ACTIVE = ('logto', 'caddy')
MIGRATION = 'npm run cli db seed -- --swe --disable-admin-pwned-password-check && npm run alteration deploy 1.44.0'
CADDY = '''{
  admin off
  auto_https disable_redirects
  skip_install_trust
  metrics
}
https://site.resource.test {
  tls internal
  error /_source_probe/error 503
  reverse_proxy web:3000
}
https://api.resource.test {
  tls internal
  reverse_proxy api:3001
}
http://:9091 {
  @native {
    method GET
    path /metrics
  }
  handle @native {
    metrics {
      disable_openmetrics
    }
  }
  handle {
    respond 403
  }
}
'''
# Only public trust material, never /data/caddy/pki/authorities/local/root.key.
PUBLIC_CA = '/data/caddy/pki/authorities/local/root.crt'
CA_READ = ('attempt=0; while ! test -s ' + PUBLIC_CA + '; do '
           'test "$attempt" -lt 20 || exit 1; attempt=$((attempt + 1)); sleep 0.1; done; cat ' + PUBLIC_CA)


def configure(output, plan, images):
    """Mutate a prepared owned plan only. No container, image acquisition or external calls."""
    if (type(plan) is not dict or type(plan.get('services')) is not dict or type(plan.get('volumes')) is not dict
            or type(plan.get('networks')) is not dict or plan['networks'].get('pilot') != {'internal': True}
            or any(name in plan['services'] for name in SERVICES)
            or any(name in plan['volumes'] for name in ('caddy-data', 'caddy-config'))
            or type(images) is not dict or type(images.get('logto')) is not str
            or re.fullmatch(r'sha256:[a-f0-9]{64}', images['logto']) is None):
        raise ValueError('extra_owned_source_plan')
    postgres = plan['services'].get('postgres')
    password = postgres.get('environment', {}).get('LOGTO_DATABASE_PASSWORD') if type(postgres) is dict else None
    if type(password) is not str or not 16 <= len(password) <= 256 or any(ord(c) < 33 or ord(c) > 126 for c in password):
        raise ValueError('extra_private_database_contract')
    pins = json.loads((ROOT / 'infra/observability/pilot/inputs.lock.json').read_text())['images']
    path = output / 'extra'
    path.mkdir(mode=0o700)
    config = path / 'Caddyfile'
    config.write_text(CADDY)
    config.chmod(0o644)
    logto = {'image': images['logto'], 'pull_policy': 'never', 'init': True,
        'entrypoint': ['/foundation/entrypoint.sh'], 'command': ['npm', 'start'],
        'environment': {'LOGTO_DATABASE_PASSWORD': password, 'ENDPOINT': 'http://logto:3001',
            'ADMIN_ENDPOINT': 'http://logto:3002', 'TRUST_PROXY_HEADER': 'false',
            'DISABLE_TELEMETRY': 'true'},
        'volumes': [str(ROOT / 'infra/production/logto/entrypoint.sh') + ':/foundation/entrypoint.sh:ro'],
        'networks': ['pilot'], 'mem_limit': '768m', 'cpus': 1, 'pids_limit': 256,
        'logging': {'driver': 'none'}}
    migration = copy.deepcopy(logto)
    migration['command'] = ['sh', '-c', MIGRATION]
    plan['services']['logto'] = logto
    plan['services']['logto-migrations'] = migration
    plan['services']['caddy'] = {'image': pins['gateway'], 'pull_policy': 'never',
        'command': ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
        'networks': {'pilot': {'aliases': ['site.resource.test', 'api.resource.test']}},
        'volumes': [str(config) + ':/etc/caddy/Caddyfile:ro', 'caddy-data:/data', 'caddy-config:/config'],
        'environment': {'XDG_DATA_HOME': '/data', 'XDG_CONFIG_HOME': '/config'},
        'cap_drop': ['ALL'], 'cap_add': ['NET_BIND_SERVICE'],
        'security_opt': ['no-new-privileges:true'], 'read_only': True, 'tmpfs': ['/tmp:size=16m'],
        'mem_limit': '256m', 'cpus': .5, 'pids_limit': 128, 'logging': {'driver': 'none'}}
    plan['volumes'].update({'caddy-data': {}, 'caddy-config': {}})


def initialize(output, compose, invoke):
    """Caller has already registered these names. Existing bounded invoke owns all actions."""
    invoke(compose, ['run', '--rm', '--no-deps', 'logto-migrations'], timeout=60)
    invoke(compose, ['up', '-d', 'logto', 'caddy'], timeout=30)
    ca = invoke(compose, ['exec', '-T', 'caddy', 'sh', '-c', CA_READ], timeout=5)
    if type(ca) is not str or not 128 <= len(ca.encode()) <= 16384 or re.fullmatch(
            r'-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n?', ca) is None:
        raise ValueError('extra_public_ca_contract')
    ssl.PEM_cert_to_DER_cert(ca)
    path = output / 'provider/caddy-root.pem'
    # Owned fixture provider directory already exists; do not follow a pre-existing path.
    with path.open('x') as stream:
        path.chmod(0o600)
        stream.write(ca)


def warmup(compose, invoke):
    """Identical OFF/ON public TLS probes instantiate genuine lazy native families."""
    value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','source-warmup'],timeout=4))
    if type(value) is not dict or set(value)!={'ok'} or value['ok'] is not True:
        raise ValueError('source_warmup_unavailable')
