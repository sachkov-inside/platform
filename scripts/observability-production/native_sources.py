#!/usr/bin/env python3
"""Opt-in finite host-local source reads and separately gated dedicated reader bootstrap."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

import source_cache
sys.path.insert(0, str(source_cache.ROOT / 'scripts/observability-pilot'))
import source_status_query

ENDPOINT = 'unix:///var/run/docker.sock'
INSPECT = '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}}}'
HTTP_PATHS = ('/metrics', '/config/')
MAX_HTTP_BYTES = 1_048_576


def _execute(args, *, timeout, payload=None):
    result = subprocess.run(args, input=payload, capture_output=True, check=True, timeout=timeout,
        env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'})
    if len(result.stdout) > 4096:
        raise ValueError('native_source_command_size')
    return result.stdout


def postgres_read(project, sql, *, setup=False, execute=_execute):
    """One exact verified running container; fixed role/database, bounded read or separate bootstrap."""
    if type(project) is not str or re.fullmatch(r'[a-z][a-z0-9-]{0,62}', project) is None:
        raise ValueError('native_source_project')
    if type(setup) is not bool or sql != (source_cache.postgres_setup_sql() if setup else source_cache.postgres_sql()):
        raise ValueError('native_source_sql_scope')
    deadline = time.monotonic() + 3
    docker = ['docker', '--host', ENDPOINT]
    def call(args, payload=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0: raise TimeoutError('native_source_deadline')
        return execute(args, timeout=remaining, payload=payload)
    identity = call([*docker, 'ps', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project,
        '--filter', 'label=com.docker.compose.service=postgres', '--format', '{{.ID}}']).decode().strip()
    if re.fullmatch(r'[a-f0-9]{64}', identity) is None:
        raise ValueError('native_source_identity')
    def verify():
        actual = json.loads(call([*docker, 'inspect', identity, '--format', INSPECT]))
        if actual != {'id': identity, 'project': project, 'service': 'postgres', 'running': True} or actual.get('running') is not True:
            raise ValueError('native_source_identity')
    verify()
    role, database = ('postgres', 'postgres') if setup else ('postgres_source_reader', 'inside')
    result = call([*docker, 'exec', '-i', identity, 'psql', '-X', '-qAt', '-w', '-U', role, '-d', database,
        '-v', 'ON_ERROR_STOP=1'], payload=sql.encode())
    verify()
    return result


def caddy_get(path):
    """Fixed loopback read paths only; no proxy/redirect or admin mutation crosses this module."""
    if path not in HTTP_PATHS:
        raise ValueError('native_source_http_scope')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), source_status_query.NoRedirect())
    request = urllib.request.Request('http://127.0.0.1:2019' + path, method='GET')
    with source_status_query._deadline(1):
        with opener.open(request, timeout=1) as response:
            if response.status != 200:
                raise ValueError('native_source_http_status')
            raw = response.read(MAX_HTTP_BYTES + 1)
            if len(raw) > MAX_HTTP_BYTES:
                raise ValueError('native_source_http_size')
            return raw


def sample(directory, project):
    # Configuration is transient private input. Only the finite selected server leaves this read.
    try:
        selected = source_cache.select_caddy_server(caddy_get('/config/'))
    except (OSError, ValueError, RuntimeError):
        selected = None
    def caddy_read():
        if selected is None:
            raise ValueError('native_source_caddy_configuration')
        raw = caddy_get('/metrics')
        if source_cache.select_caddy_server(caddy_get('/config/')) != selected:
            raise ValueError('native_source_caddy_configuration_changed')
        return raw
    return source_cache.sample(directory, postgres_read=lambda sql: postgres_read(project, sql),
        caddy_read=caddy_read, caddy_server=selected, clock=time.time)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('sample', 'setup-postgres'))
    parser.add_argument('--project', default=os.environ.get('INSIDE_SOURCE_DATABASE_PROJECT', 'inside-production-database'))
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise ValueError('native_sources_require_authorized_linux_operator')
    flag = 'INSIDE_PRODUCTION_SOURCE_SETUP_ENABLED' if args.action == 'setup-postgres' else 'INSIDE_PRODUCTION_SOURCES_ENABLED'
    if os.environ.get(flag) != 'true':
        raise ValueError('native_sources_disabled')
    if args.action == 'setup-postgres':
        postgres_read(args.project, source_cache.postgres_setup_sql(), setup=True)
        print(json.dumps({'state': 'reader_prepared', 'monitoring': 'not_activated'}))
        return
    directory = Path('/var/lib/inside/watchdog/metrics')
    directory.mkdir(mode=0o755, parents=True, exist_ok=True)
    print(json.dumps(sample(directory, args.project)))


if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit('native sources refused or unavailable; raw configuration/SQL/diagnostics withheld') from None
