#!/usr/bin/env python3
"""Prepare opt-in monitoring artifacts. No Docker, host changes or production mutation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONFIG = ROOT / 'infra/observability/production'
sys.path.insert(0, str(HERE.parent / 'observability-pilot'))
import pilot
import privacy_config
import owner_overview

BACKENDS = ('api', 'mcp', 'material-assets-worker', 'profile-avatars-worker',
            'video-deletions-worker', 'billing-worker', 'notifications-worker')
APPLICATIONS = (*BACKENDS, 'web', 'rabbitmq')
SERVICES = (*pilot.SERVICES, 'host-agent')


def write(path, value, *, private=False):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600 if private else 0o644)


def logging(service):
    return {'driver': 'syslog', 'options': {'syslog-address': 'tcp://127.0.0.1:1514',
        'syslog-format': 'rfc5424micro', 'tag': service, 'mode': 'non-blocking',
        'max-buffer-size': '1m', 'cache-disabled': 'true'}}


def overlay(services, *, network, sdk=()):
    return {'services': {service: {
        'logging': logging('platform-' + service if service in APPLICATIONS else service),
        'networks': {'telemetry': {'aliases': ['inside-web-http']}} if service == 'web' else ['telemetry'],
        **({'environment': {'INSIDE_WEB_HTTP_METRICS_ENABLED': '${INSIDE_OTEL_ENABLED:-false}'}} if service == 'web' else {}),
        **({'environment': {'INSIDE_OTEL_ENABLED': '${INSIDE_OTEL_ENABLED:-false}',
                           'INSIDE_OTEL_ENDPOINT': 'http://inside-telemetry:4318',
                           'INSIDE_OTEL_SAMPLE_RATIO': '${INSIDE_OTEL_SAMPLE_RATIO:-1}'}}
           if service in sdk else {})} for service in services},
        'networks': {'telemetry': {'external': True, 'name': network}}}


def compose(output, data, project):
    images = json.loads((pilot.CONFIG / 'inputs.lock.json').read_text())['images']
    uid = f'{os.getuid()}:{os.getgid()}'
    stack = pilot.compose_plan(pilot.CONFIG, output, images, credential_owner=(os.getuid(), os.getgid()))
    stack['name'] = project
    stack['networks'] = {'storage': {'internal': True},
                         'telemetry': {'internal': True, 'name': project + '-telemetry'},
                         'hostsource': {'internal': True}, 'loopback': {}}
    stack.pop('volumes')
    for name, service in stack['services'].items():
        service.update({'user': uid, 'restart': 'unless-stopped', 'networks': ['storage'],
                        'logging': {'driver': 'none'}, 'stop_grace_period': '30s'})
        service.pop('ports', None)
        if name in ('metrics', 'logs', 'traces'):
            service['volumes'] = [f'{data / name}:/data']
            service['command'] += ['-storage.minFreeDiskSpaceBytes=1GiB']
        if name in ('logs', 'traces'):
            service['command'] += ['-retention.maxDiskSpaceUsageBytes=8GiB']
    stack['services']['metrics']['networks'].append('hostsource')
    stack['services']['alloy'].update({'networks': {'storage': {}, 'telemetry': {'aliases': ['inside-telemetry']}, 'loopback': {}},
        'ports': ['127.0.0.1:1514:1514'], 'command': ['run', '/etc/alloy/config.alloy',
            '--server.http.listen-addr=127.0.0.1:12345', '--storage.path=/tmp/alloy', '--disable-reporting'],
        'volumes': [f'{output / "config.alloy"}:/etc/alloy/config.alloy:ro']})
    stack['services']['gateway'].update({'ports': ['127.0.0.1:18427:8080'],
        'networks': ['storage', 'loopback'], 'volumes': [f'{CONFIG / "Query.Caddyfile"}:/etc/caddy/Caddyfile:ro']})
    stack['services']['grafana'].update({'ports': ['127.0.0.1:13000:3000'], 'networks': ['storage', 'loopback'],
        'volumes': [f'{data / "grafana"}:/var/lib/grafana', f'{output / "plugins"}:/var/lib/grafana/plugins:ro',
                    f'{output / "datasources.json"}:/etc/grafana/provisioning/datasources/production.yaml:ro',
                    f'{output / "dashboard-provider.json"}:/etc/grafana/provisioning/dashboards/owner.yaml:ro',
                    f'{output / "owner-overview"}:/etc/grafana/owner-overview:ro',
                    f'{output / "grafana.password"}:/run/secrets/grafana.password:ro'],
        'environment': {'GF_AUTH_ANONYMOUS_ENABLED': 'false', 'GF_AUTH_BASIC_ENABLED': 'true',
            'GF_SECURITY_ADMIN_USER': 'owner', 'GF_SECURITY_ADMIN_PASSWORD__FILE': '/run/secrets/grafana.password',
            'GF_USERS_ALLOW_SIGN_UP': 'false', 'GF_AUTH_DISABLE_LOGIN_FORM': 'false',
            'GF_ANALYTICS_REPORTING_ENABLED': 'false', 'GF_ANALYTICS_CHECK_FOR_UPDATES': 'false',
            'GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES': 'false', 'GF_PLUGINS_PREINSTALL_DISABLED': 'true'}})
    # Official cAdvisor deployment requires host privilege. Keep it an explicit Linux-only profile,
    # outside the application/query networks; the main collector never receives a Docker socket.
    stack['services']['host-agent'] = {'image': images['alloy'], 'profiles': ['host-metrics'],
        'command': ['run', '/etc/alloy/host.alloy', '--server.http.listen-addr=127.0.0.1:12345',
                    '--storage.path=/tmp/alloy', '--disable-reporting'],
        'privileged': True, 'read_only': True, 'restart': 'unless-stopped', 'mem_limit': '512m', 'cpus': .25,
        'pids_limit': 128, 'tmpfs': ['/tmp:size=32m'], 'networks': ['hostsource'], 'logging': {'driver': 'none'},
        'volumes': [f'{CONFIG / "host.alloy"}:/etc/alloy/host.alloy:ro', '/:/rootfs:ro,rslave',
            '/proc:/host/proc:ro', '/sys:/sys:ro', '/var/run:/var/run:rw',
            '/var/lib/docker:/var/lib/docker:ro', '/dev/disk:/dev/disk:ro',
            {'type': 'bind', 'source': '/var/lib/inside/watchdog/metrics', 'target': '/watchdog-metrics',
             'read_only': True, 'bind': {'create_host_path': False}}]}
    return stack


def dashboard():
    result = owner_overview.dashboard()
    overview = json.loads((CONFIG / 'overview.json').read_text())
    result['dashboard']['title'] = 'Platform production overview'
    result['dashboard']['uid'] = 'platform-production-overview'
    result['dashboard']['description'] = 'Stored observations. Missing or stale data is unknown. NoData never means healthy.'
    result['dashboard']['panels'][0]['options']['content'] = overview['coverage']
    for index, panel in enumerate(overview['panels'], start=100):
        result['dashboard']['panels'].append({'id': index, 'type': 'timeseries', 'title': panel['title'],
            'datasource': {'type': 'prometheus', 'uid': 'pilot-metrics'},
            'gridPos': {'x': (index % 2) * 12, 'y': 52 + ((index-100)//2)*8, 'w': 12, 'h': 8},
            'description': panel.get('description', ''),
            'targets': [{'refId': 'A', 'expr': panel['query']}],
            'fieldConfig': {'defaults': {'noValue': 'Unknown / source unavailable'}, 'overrides': []}})
    # Fixed expectation rows survive absent series, so missing sources are visibly UNKNOWN.
    rows = []
    for source in overview['sources']:
        age = '(time() - (' + source['observed_at'] + '))'
        state = ('((' + source['value'] + ') and on() (' + age + ' >= 0 and ' + age + ' <= ' +
                 str(source['maximum_age_seconds']) + ')) or on() vector(-1)')
        rows.append('label_set((' + state + '),"source",' + json.dumps(source['name']) + ')')
    end_y = max(panel['gridPos']['y'] + panel['gridPos']['h'] for panel in result['dashboard']['panels'])
    result['dashboard']['panels'].append({'id': 200, 'type': 'table', 'title': 'Every expected source: 1 observed,0 down,-1 UNKNOWN/stale',
        'gridPos': {'x': 0, 'y': end_y, 'w': 24, 'h': 12},
        'datasource': {'type': 'prometheus', 'uid': 'pilot-metrics'},
        'targets': [{'refId': 'A', 'expr': ' or '.join(rows), 'instant': True, 'range': False, 'format': 'table'}],
        'fieldConfig': {'defaults': {'noValue': 'UNKNOWN', 'mappings': [{'type': 'value', 'options': {
            '-1': {'text': 'UNKNOWN / stale'}, '0': {'text': 'DOWN / read failed'}, '1': {'text': 'Observed / up'}}}]}, 'overrides': []}})
    result['dashboard']['panels'].append({'id': 201, 'type': 'text', 'title': 'Bounded owner investigations and analytics',
        'gridPos': {'x': 0, 'y': end_y + 12, 'w': 24, 'h': 5}, 'options': {'mode': 'markdown', 'content':
        '[Payment/access and sales-funnel owner reports](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/production-diagnostics.md): '
        'use existing Platform MCP platform:admin session, last24h UTC, limit20, follow nextCursor. Counts describe the bounded returned cohort/page; '
        'do not sum pagination or infer effective access from paid grant. Private examples stay out of dashboard. '
        '[Native Umami read-only analytics](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/observability-umami-pilot.md): '
        'separate read key and fixed window; missing/disabled analytics is UNKNOWN, not zero. '
        '[Investigation and trace links](https://github.com/sachkov-inside/platform/blob/main/docs/runbooks/observability-investigation.md).'}})
    return result


def analytics(output, *, network):
    """Separate opt-in project. Only the send-only bridge joins the application's network."""
    images = json.loads((ROOT / 'infra/observability/umami/inputs.lock.json').read_text())['images']
    password = secrets.token_hex(24)
    write(output / 'umami.database.password', password + '\n', private=True)
    write(output / 'umami.reader.key', '', private=True)
    write(output / 'umami.env', '\n'.join([
        f'DATABASE_URL=postgresql://umami:{password}@postgres:5432/umami?connection_limit=8&pool_timeout=5',
        'APP_SECRET=' + secrets.token_hex(32), 'TWO_FACTOR_ENCRYPTION_KEY=' + secrets.token_hex(32),
        'PRIVATE_MODE=1', 'DISABLE_TELEMETRY=1', 'DISABLE_UPDATES=1', 'NEXT_TELEMETRY_DISABLED=1',
        'MCP_ENABLED=1', 'SALT_ROTATION=month', 'HOSTNAME=0.0.0.0', '']) , private=True)
    common = {'profiles': ['analytics'], 'init': True, 'cap_drop': ['ALL'],
              'security_opt': ['no-new-privileges:true'], 'pids_limit': 128,
              'logging': {'driver': 'none'}, 'restart': 'unless-stopped'}
    plan = {'services': {
        'umami': {**common, 'image': images['umami'], 'env_file': [str(output / 'umami.env')],
            'networks': ['analytics', 'database'], 'mem_limit': '1g', 'cpus': 1},
        'umami-ingest': {**common, 'image': json.loads((pilot.CONFIG / 'inputs.lock.json').read_text())['images']['gateway'],
            'networks': ['analytics', 'telemetry'], 'mem_limit': '64m', 'cpus': .1, 'read_only': True,
            'cap_add': ['NET_BIND_SERVICE'], 'tmpfs': ['/tmp:size=16m'],
            'environment': {'XDG_CONFIG_HOME': '/tmp/config', 'XDG_DATA_HOME': '/tmp/data'},
            'volumes': [f'{CONFIG / "Analytics.Caddyfile"}:/etc/caddy/Caddyfile:ro']},
        'query': {**common, 'image': images['python'], 'user': f'{os.getuid()}:{os.getgid()}',
            'command': ['python', '/pilot/gateway.py', '--key-file', '/private/reader.key'],
            'networks': ['analytics', 'loopback'], 'ports': ['127.0.0.1:13301:3001'],
            'read_only': True, 'tmpfs': ['/tmp:size=16m'], 'mem_limit': '64m', 'cpus': .25,
            'environment': {'PYTHONDONTWRITEBYTECODE': '1'},
            'volumes': [str(ROOT / 'scripts/observability-umami') + ':/pilot:ro',
                        str(output / 'umami.reader.key') + ':/private/reader.key:ro']}},
        'networks': {'analytics': {'internal': True}, 'loopback': {},
            'telemetry': {'external': True, 'name': network},
            'database': {'external': True, 'name': '${FOUNDATION_DATABASE_NETWORK:?existing foundation database network required}'}}}
    write(output / 'umami.compose.json', plan)


def prepare(output, *, data, project='inside-observability-production'):
    if (not output.is_absolute() or not data.is_absolute() or output.exists() or output.is_symlink()
            or re.fullmatch(r'inside-observability-[a-z0-9-]{1,48}', project) is None
            or output == data or output in data.parents or data in output.parents):
        raise ValueError('fresh_absolute_separate_paths_and_owned_project_required')
    for path in (output, data):
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError('symlink_path_not_supported')
    output.mkdir(mode=0o700)
    output.chmod(0o700)
    token, grafana_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    auth = pilot.auth_config(token)
    auth['users'].extend(pilot.auth_config(grafana_token)['users'])
    write(output / 'auth.json', auth, private=True)
    write(output / 'reader.key', token + '\n', private=True)
    write(output / 'grafana.password', secrets.token_urlsafe(32) + '\n', private=True)
    # Privacy policy has one owner. Production appends the stdout boundary after its OTLP filter.
    write(output / 'config.alloy', privacy_config.render() + '\n' + (CONFIG / 'stdout.alloy').read_text()
          + '\n' + (CONFIG / 'web-http.alloy').read_text())
    write(output / 'compose.json', compose(output, data, project))
    network = project + '-telemetry'
    write(output / 'platform.compose.json', overlay(APPLICATIONS, network=network, sdk=BACKENDS))
    telegram = overlay(('app',), network=network, sdk=('app',))
    telegram['services']['app']['logging'] = logging('inside-telegram')
    write(output / 'telegram.compose.json', telegram)
    write(output / 'database.compose.json', overlay(('postgres', 'pgbackrest'), network=network))
    write(output / 'logto.compose.json', overlay(('logto', 'logto-migrations'), network=network))
    analytics(output, network=network)
    sources = [
        {'name': 'Platform metrics', 'uid': 'pilot-metrics', 'type': 'prometheus', 'url': 'http://gateway:8080/metrics'},
        {'name': 'Platform logs', 'uid': 'pilot-logs', 'type': 'victoriametrics-logs-datasource', 'url': 'http://gateway:8080/logs'},
        {'name': 'Platform traces', 'uid': 'pilot-traces', 'type': 'jaeger', 'url': 'http://gateway:8080/traces/select/jaeger'}]
    for source in sources:
        source.update({'access': 'proxy', 'editable': False, 'jsonData': {'httpHeaderName1': 'Authorization'},
                       'secureJsonData': {'httpHeaderValue1': 'Bearer ' + grafana_token}})
    write(output / 'datasources.json', {'apiVersion': 1, 'datasources': sources}, private=True)
    view = dashboard()
    write(output / 'dashboard-provider.json', view['provider'])
    (output / 'owner-overview').mkdir()
    write(output / 'owner-overview/dashboard.json', view['dashboard'])
    (output / 'plugins').mkdir()
    import horizon_build
    horizon_build.prepare(output)
    inputs = [*CONFIG.glob('*'), pilot.CONFIG / 'inputs.lock.json', pilot.CONFIG / 'vmauth.routes.json',
              pilot.CONFIG / 'privacy-policy.json', Path(__file__), *pilot.ROOT.joinpath('infra/observability/horizon').glob('*'),
              pilot.ROOT / 'scripts/observability-pilot/horizon_build.py', pilot.ROOT / 'scripts/heavy-check/bounded.py']
    write(output / 'inputs.json', {'schema': 1, 'project': project, 'data': str(data),
        'inputs': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(inputs) if path.is_file()},
        'activation': 'disabled until explicit SDK opt-in and production authorization'})


def preflight(output, *, application_data):
    """Validate disk separation on the real Linux host. Does not provision or resize disks."""
    record = json.loads((output / 'inputs.json').read_text())
    data = Path(record['data'])
    if (sys.platform != 'linux' or not data.is_mount() or data.stat().st_dev == application_data.stat().st_dev):
        raise ValueError('separate_mounted_monitoring_filesystem_required')
    disk = shutil.disk_usage(data)
    app_disk = shutil.disk_usage(application_data)
    if disk.total > 32 * 1024**3 or disk.free < disk.total * .25 or app_disk.free < app_disk.total * .25:
        raise ValueError('monitoring_disk_cap_or_application_reserve_failed')
    if any((data / name).is_symlink() for name in ('metrics', 'logs', 'traces', 'grafana')):
        raise ValueError('data_symlinks_refused')
    for name in ('metrics', 'logs', 'traces', 'grafana'):
        (data / name).mkdir(mode=0o700, exist_ok=True)
    import horizon_build
    horizon_build.verify(output)
    return {'disk_isolation': 'passed', 'monitoring_capacity_bytes': disk.total,
            'application_free_fraction': round(app_disk.free / app_disk.total, 4),
            'resource_acceptance': 'not_measured'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'preflight', 'install-plugin'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--data', type=Path)
    parser.add_argument('--application-data', type=Path)
    parser.add_argument('--project', default='inside-observability-production')
    args = parser.parse_args()
    if args.action == 'prepare':
        if args.data is None: parser.error('--data required')
        prepare(args.output, data=args.data, project=args.project)
    elif args.action == 'preflight':
        if args.application_data is None: parser.error('--application-data required')
        print(json.dumps(preflight(args.output, application_data=args.application_data)))
    else:
        pilot.install_horizon(args.output)
        pilot.install_plugin(args.output)


if __name__ == '__main__':
    main()
