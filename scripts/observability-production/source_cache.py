"""Finite native source projection into a numeric cache. Caller owns reads, clocks and lifetime."""
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/observability-postgres-storage'))
import frame
sys.path.insert(0, str(ROOT / 'scripts/observability-caddy-storage'))
import native_source


def postgres_sql():
    """Reuse the admitted ordinary-role SQL/controls, changing only the declared database scope."""
    text = (ROOT / 'scripts/observability-postgres-storage/query.mjs').read_text()
    sql = re.search(r'export const SQL = `([^`]+)`;', text)
    controls = re.search(r'export const controls = Object.freeze\(\[([^\]]+)\]\);', text)
    if sql is None or controls is None or sql[1].count("(current_database() = 'tracking')") != 1:
        raise ValueError('source_sql_owner_contract')
    control = json.loads('[' + controls[1].strip().rstrip(',') + ']')
    if (type(control) is not list or len(control) != 6 or any(type(item) is not str for item in control)
            or control[0] != 'BEGIN READ ONLY' or control[1] != 'SET LOCAL search_path = pg_catalog'):
        raise ValueError('source_sql_controls')
    fixed = sql[1].replace("(current_database() = 'tracking')", "(current_database() = 'inside')").rstrip(';')
    fields = ','.join("json_build_object('name','" + name + "','oid'," + str(oid) + ')' for name, oid in frame.FIELDS)
    columns = ','.join('q.' + name for name, _ in frame.FIELDS)
    return ';\n'.join(control) + ";\nSELECT json_build_object('schema',1,'fields',json_build_array(" + fields + \
        "),'rows',json_build_array(json_build_array(" + columns + '))) FROM (' + fixed + ') q;\nROLLBACK;\n'


def postgres_setup_sql():
    """Dedicated ordinary local reader. Never grant pg_monitor/read_all_stats or application tables."""
    return """SET statement_timeout='2s';
BEGIN;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres_source_reader') AND
(COALESCE(shobj_description((SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader'),'pg_authid'),'')<>'Inside monitoring PostgreSQL reader v1' OR
 EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader') AND
 NOT(deptype='a' AND classid='pg_database'::regclass AND objid=(SELECT oid FROM pg_database WHERE datname='inside'))) OR
 EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
 WHERE d.datname='inside' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader')
 AND (a.privilege_type<>'CONNECT' OR a.is_grantable)) OR
 EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader')) OR
 EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader')) OR
 EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres_source_reader' AND
 (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit OR NOT rolcanlogin OR rolconnlimit<>1)))
THEN RAISE EXCEPTION 'existing source reader authority requires owner review' USING ERRCODE='P1567'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres_source_reader') THEN
 CREATE ROLE postgres_source_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 1;
END IF;
END $$;
ALTER ROLE postgres_source_reader SET default_transaction_read_only='on';
ALTER ROLE postgres_source_reader SET search_path='pg_catalog';
ALTER ROLE postgres_source_reader SET statement_timeout='2s';
ALTER ROLE postgres_source_reader SET lock_timeout='250ms';
ALTER ROLE postgres_source_reader SET idle_in_transaction_session_timeout='3s';
GRANT CONNECT ON DATABASE inside TO postgres_source_reader;
COMMENT ON ROLE postgres_source_reader IS 'Inside monitoring PostgreSQL reader v1';
COMMIT;
"""


def postgres_projection(raw, completed):
    observed = frame.decode(raw, int(completed * 1_000_000))
    return '\n'.join('inside_postgresql_server_' + name + ' ' + str(observed[key]) for name, key in frame.METRICS) + '\n'


def select_caddy_server(raw):
    """Admitted adaptation, not a guessed exporter label. Return only the finite public role."""
    value = native_source.status.source_status.decode_json(raw)
    if type(value) is not dict or type(value.get('admin')) is not dict:
        raise ValueError('source_caddy_adaptation')
    admin = value['admin']
    if admin != {'disabled': True} and admin.get('listen') != '127.0.0.1:2019':
        raise ValueError('source_caddy_admin')
    apps = value.get('apps')
    http = apps.get('http') if type(apps) is dict else None
    if type(http) is not dict or http.get('metrics') != {} or type(http.get('servers')) is not dict:
        raise ValueError('source_caddy_metrics')
    servers = http['servers']
    if not 1 <= len(servers) <= 64:
        raise ValueError('source_caddy_servers')
    selected = []
    for name, server in servers.items():
        if (type(name) is not str or re.fullmatch(r'srv(?:[0-9]|[1-5][0-9]|6[0-3])', name) is None
                or type(server) is not dict or type(server.get('listen')) is not list
                or not 1 <= len(server['listen']) <= 8 or any(type(item) is not str for item in server['listen'])):
            raise ValueError('source_caddy_servers')
        if any(item in (':443', '0.0.0.0:443', '[::]:443') for item in server['listen']):
            selected.append(name)
    if len(selected) != 1:
        raise ValueError('source_caddy_public_partition')
    return selected[0]


def caddy_projection(raw, server, completed):
    observed = native_source.parse_production(raw, server=server)
    if observed is None:
        raise ValueError('source_caddy_incomplete')
    starts = []
    for line in raw.decode('utf-8').splitlines():
        if line.startswith('process_start_time_seconds '):
            starts.append(native_source.status.number(line.split(' ', 1)[1]))
    if len(starts) != 1 or not 0 < starts[0] <= completed:
        raise ValueError('source_caddy_epoch')
    result = ['caddy_process_start_time_seconds ' + str(starts[0])]
    common = '{server="public",handler="subroute"}'
    for name, key in (('requests_total', 'requests_total'), ('request_errors_total', 'request_errors_total'), ('requests_in_flight', 'in_flight')):
        result.append('caddy_http_' + name + common + ' ' + str(observed[key]))
    for group in observed['duration']:
        labels = 'server="public",handler="subroute",method=' + json.dumps(group['method']) + ',code=' + json.dumps(str(group['code']))
        for bound, value in zip(native_source.status.BUCKETS, group['buckets']):
            result.append('caddy_http_request_duration_seconds_bucket{' + labels + ',le=' + json.dumps(bound) + '} ' + str(value))
        result += ['caddy_http_request_duration_seconds_sum{' + labels + '} ' + str(group['sum_seconds']),
                   'caddy_http_request_duration_seconds_count{' + labels + '} ' + str(group['count'])]
    return '\n'.join(result) + '\n'


def _publish(directory, source, text):
    if (not directory.is_absolute() or not directory.is_dir() or directory.is_symlink()
            or directory.stat().st_uid != os.geteuid() or directory.stat().st_mode & 0o022):
        raise ValueError('source_cache_directory')
    target = directory / (source + '-source.prom')
    if target.is_symlink() or target.exists() and not stat.S_ISREG(target.stat().st_mode):
        raise ValueError('source_cache_target')
    descriptor, name = tempfile.mkstemp(prefix='.' + source + '-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o644)
        os.replace(name, target)
    finally:
        if os.path.exists(name): os.unlink(name)


def sample(directory, *, postgres_read, caddy_read, caddy_server, clock):
    """Exactly two read callbacks. Failures publish unavailable, never zero business/native facts.

    postgres_read receives only postgres_sql(); caddy_read returns one native exposition.
    caddy_server comes from the caller's admitted adapted public :443 server, never a metric label.
    Cancellation and cache publication errors propagate to the existing outer process owner.
    """
    directory = Path(directory)
    result = {}
    for source, read, project in (
            ('postgresql', lambda: postgres_read(postgres_sql()), postgres_projection),
            ('caddy', caddy_read, lambda raw, completed: caddy_projection(raw, caddy_server, completed))):
        state = 0; projected = ''
        try:
            raw = read()
            completed = clock()
            if type(completed) not in (int, float) or not math.isfinite(completed) or not 0 < completed <= frame.MAX / 1_000_000:
                raise ValueError('source_clock')
            projected = project(raw, completed); state = 1
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            completed = clock()
            if type(completed) not in (int, float) or not math.isfinite(completed) or not 0 < completed <= frame.MAX / 1_000_000:
                raise ValueError('source_clock') from None
        text = ('inside_production_source_available{source="' + source + '"} ' + str(state) + '\n' +
                'inside_production_source_observed_at_seconds{source="' + source + '"} ' + str(completed) + '\n' + projected)
        if len(text.encode()) > 65536:
            raise ValueError('source_projection_size')
        _publish(directory, source, text)
        result[source] = 'observed' if state else 'unavailable'
    return result
