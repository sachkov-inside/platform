"""Owned synthetic PG18 backup/recovery corpus, separate from production recovery."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import uuid
from urllib.parse import urlsplit

import prepare

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).resolve().parent
FOUNDATION = ROOT / 'infra/production/database'
SERVICES = ('repo-init', 'db', 'backup', 'restore', 'recovered', 'read-db', 'reader', 'ingest')
PROJECT_PREFIX = 'inside-observability-umami-recovery-'
PGDATA = '/var/lib/postgresql/18/docker'
RECOVERY_PREFIX = 'inside-production-postgres-data-recovery-'
SITE = '00000000-0000-4000-8000-000000001566'
DELETE_EVENT = '00000000-0000-4000-8000-000000001567'
INGEST_EVENT = '00000000-0000-4000-8000-000000001568'
SQL_COMMAND = ['psql', '-X', '-qAt', '-U', 'umami', '-d', 'umami', '-v', 'ON_ERROR_STOP=1']


def prepare_inputs(output, *, foundation_image):
    """Generate one private, cache-only project; no runtime commands or shared inputs."""
    if not isinstance(foundation_image, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', foundation_image):
        raise ValueError('recovery_image_identity')
    prepare.prepare(output)
    recovery_volume = RECOVERY_PREFIX + uuid.uuid4().hex
    plan = json.loads((output / 'compose.json').read_text())
    bootstrap_env = plan['services']['db']['environment']
    umami_password = urlsplit(plan['services']['umami']['environment']['DATABASE_URL']).password
    # Existing role setup remains the owner of Umami limits and password generation.
    cipher = secrets.token_hex(32)
    config = (FOUNDATION / 'pgbackrest.conf').read_text().replace('repo1-path=/inside-platform', 'repo1-path=/backup')
    (output / 'pgbackrest.conf').write_text(config)
    os.chmod(output / 'pgbackrest.conf', 0o644)  # Secret-free file; containing directory is private.
    environment = {'PGDATA': PGDATA, 'INSIDE_POSTGRES_DATA_PATH': PGDATA,
                   'PGBACKREST_PG1_PATH': PGDATA, 'PGBACKREST_PG1_USER': bootstrap_env['POSTGRES_USER'], 'PGBACKREST_CONFIG': '/config/pgbackrest.conf',
                   'PGBACKREST_REPO1_TYPE': 'posix', 'PGBACKREST_REPO1_CIPHER_PASS': cipher}
    config_mount = str(output / 'pgbackrest.conf') + ':/config/pgbackrest.conf:ro'
    common = {'image': foundation_image, 'pull_policy': 'never', 'init': True,
              'mem_limit': '512m', 'cpus': '0.5', 'pids_limit': 128,
              'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '1'}},
              'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL']}
    root_caps = ['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID']
    source_mounts = ['database:/var/lib/postgresql', 'socket:/var/run/postgresql',
                     'repository:/backup', 'spool:/var/spool/pgbackrest', config_mount]
    restored_mounts = ['recovery:/var/lib/postgresql', 'recovery-socket:/var/run/postgresql']
    reader_profile = ['readers-after-replay']
    services = {
        'repo-init': {**common, 'user': 'root', 'cap_add': root_caps, 'network_mode': 'none',
            'entrypoint': ['sh', '-ec'], 'command': ['install -d -o postgres -g postgres -m 700 /backup /var/spool/pgbackrest; install -d -o postgres -g postgres -m 3777 /var/run/postgresql /recovery-socket; install -d -o postgres -g postgres -m 700 /recovery-spool; pgbackrest version'],
            'volumes': ['repository:/backup', 'spool:/var/spool/pgbackrest', 'socket:/var/run/postgresql',
                        'recovery-socket:/recovery-socket', 'recovery-spool:/recovery-spool']},
        'db': {**common, 'cap_add': root_caps, 'networks': ['private'],
            'environment': {**environment, **bootstrap_env, 'POSTGRES_DB': 'postgres',
                'PLATFORM_DATABASE_PASSWORD': secrets.token_hex(24), 'LOGTO_DATABASE_PASSWORD': secrets.token_hex(24)},
            'volumes': source_mounts},
        'backup': {**common, 'profiles': ['maintenance-only'], 'user': 'postgres', 'network_mode': 'none', 'entrypoint': ['pgbackrest'],
            'environment': environment, 'volumes': source_mounts,
            'command': ['--stanza=production', '--type=full', 'backup']},
        'restore': {**common, 'profiles': ['maintenance-only'], 'user': 'root', 'cap_add': root_caps, 'network_mode': 'none',
            'entrypoint': ['inside-pgbackrest-restore'],
            'environment': {**environment, 'INSIDE_RESTORE_VOLUME': recovery_volume},
            'volumes': restored_mounts + ['repository:/backup:ro', config_mount],
            'command': ['--stanza=production', '--archive-mode=off', '--type=immediate', '--target-action=promote', 'restore']},
        'recovered': {**common, 'profiles': ['maintenance-only'], 'user': 'postgres', 'network_mode': 'none',
            'environment': environment, 'volumes': restored_mounts + ['repository:/backup:ro',
                'recovery-spool:/var/spool/pgbackrest', config_mount],
            'command': ['postgres', '-c', 'listen_addresses=', '-c', 'archive_mode=off']},
        'read-db': {**common, 'user': 'postgres', 'networks': ['private'], 'profiles': reader_profile,
            'environment': {'PGDATA': PGDATA}, 'volumes': restored_mounts,
            'command': ['postgres', '-c', 'archive_mode=off']},
    }
    for name in ('reader', 'ingest'):
        services[name] = {**common, 'user': 'postgres', 'networks': ['private'], 'profiles': reader_profile,
            'environment': {'PGPASSWORD': umami_password, 'PGCONNECT_TIMEOUT': '3'},
            'entrypoint': ['psql'], 'command': ['-X', '-qAt', '-h', 'read-db', '-U', 'umami', '-d', 'umami', '-v', 'ON_ERROR_STOP=1', '-c', READER_SQL if name == 'reader' else INGEST_SQL]}
    plan = {'services': services, 'networks': {'private': {'internal': True}},
            'volumes': {name: {} for name in ('database', 'repository', 'socket', 'spool', 'recovery-socket', 'recovery-spool')}}
    plan['volumes']['recovery'] = {'name': recovery_volume}
    (output / 'compose.json').write_text(json.dumps(plan, indent=2) + '\n')
    os.chmod(output / 'compose.json', 0o600)
    (output / 'reader.key').unlink()


def confirm_destination(project, name, image, volume, container, *, absent_before_acquisition):
    """Authorize destruction only after fresh actual volume AND stopped-container inspection."""
    if (absent_before_acquisition is not True or not isinstance(project, str)
            or not re.fullmatch(re.escape(PROJECT_PREFIX) + r'[a-f0-9]{12}', project)
            or not isinstance(name, str) or not re.fullmatch(re.escape(RECOVERY_PREFIX) + r'[a-f0-9]{32}', name)
            or not isinstance(volume, dict) or volume.get('Name') != name
            or volume.get('Driver') != 'local' or volume.get('Scope') != 'local'
            or volume.get('Options') not in (None, {})
            or not isinstance(volume.get('Labels'), dict)
            or volume['Labels'].get('com.docker.compose.project') != project
            or volume['Labels'].get('com.docker.compose.volume') != 'recovery'
            or not isinstance(container, dict) or container.get('image') != image
            or not isinstance(container.get('labels'), dict)
            or container['labels'].get('com.docker.compose.project') != project
            or container['labels'].get('com.docker.compose.service') != 'restore'
            or not isinstance(container.get('state'), dict)
            or container['state'].get('status') != 'created' or container['state'].get('running') is not False
            or type(container['state'].get('pid')) is not int or container['state']['pid'] != 0):
        raise ValueError('unconfirmed_recovery_ownership')
    mounts = container.get('mounts')
    if not isinstance(mounts, list) or not 2 <= len(mounts) <= 8 or any(not isinstance(mount, dict) for mount in mounts):
        raise ValueError('unconfirmed_recovery_mounts')
    data = [mount for mount in mounts if mount.get('Destination') == '/var/lib/postgresql']
    repo = [mount for mount in mounts if mount.get('Destination') == '/backup']
    if (len(data) != 1 or data[0].get('Type') != 'volume' or data[0].get('Name') != name or data[0].get('RW') is not True
            or len(repo) != 1 or repo[0].get('Type') != 'volume' or repo[0].get('Name') != project + '_repository'
            or repo[0].get('RW') is not False
            or any(mount.get('Destination') not in ('/var/lib/postgresql', '/backup', '/var/run/postgresql', '/config/pgbackrest.conf') for mount in mounts)):
        raise ValueError('unconfirmed_recovery_mounts')
    return {'fresh_owned_volume': True, 'actual_restore_mount_confirmed': True, 'repository_read_only': True}


def deletion_sql(manifest):
    """Only a small synthetic event manifest is supported, never production erasure authority."""
    if (not isinstance(manifest, dict) or set(manifest) != {'schema', 'scope', 'event_ids'}
            or type(manifest['schema']) is not int or manifest['schema'] != 1
            or manifest['scope'] != 'synthetic_only' or not isinstance(manifest['event_ids'], list)
            or not 1 <= len(manifest['event_ids']) <= 10):
        raise ValueError('synthetic_manifest_shape')
    ids = manifest['event_ids']
    if any(not isinstance(value, str) or str(uuid.UUID(value)) != value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('synthetic_manifest_ids')
    literals = ','.join("'" + value + "'::uuid" for value in ids)
    return f"""BEGIN;
SET LOCAL statement_timeout='1s';
SET LOCAL lock_timeout='250ms';
SET LOCAL idle_in_transaction_session_timeout='2s';
DO $$ BEGIN IF current_database()<>'umami' OR current_user<>'umami' THEN
RAISE EXCEPTION 'dedicated synthetic database required'; END IF; END $$;
DELETE FROM event_data WHERE website_id='{SITE}' AND website_event_id IN ({literals});
DELETE FROM revenue WHERE website_id='{SITE}' AND event_id IN ({literals});
DELETE FROM website_event WHERE website_id='{SITE}' AND event_id IN ({literals});
SELECT json_build_object('remaining', count(*)) FROM website_event WHERE website_id='{SITE}' AND event_id IN ({literals});
COMMIT;
"""


def restore_gate(execute, manifest, open_readers, record):
    """Actual SQL maintenance is the sole path to the caller's reader/ingest transition."""
    import subprocess
    import retention
    replay = deletion_sql(manifest)  # Validate before any SQL or reader operation.
    report = {'schema': 1, 'scope': 'synthetic_sql_recovery_only', 'state': 'running',
              'reader_gate': 'closed', 'production_deletion_authority': 'unknown',
              'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()}
    record(dict(report))
    try:
        encoded = execute(replay, timeout=retention.BATCH_SECONDS)
        if not isinstance(encoded, str) or len(encoded.encode()) > 1024:
            raise ValueError('replay_result')
        result = json.loads(encoded)
        if not isinstance(result, dict) or set(result) != {'remaining'} or type(result['remaining']) is not int or result['remaining'] != 0:
            raise ValueError('replay_incomplete')
        report['replay'] = 'passed_synthetic_only'
        report['retention'] = retention.drain(execute)  # NEW database-clock cutoff, never backup cutoff.
        record(dict(report))
        if report['retention']['state'] != 'complete':
            raise RuntimeError('current_retention_incomplete')
        # Repeat against current predicates after TTL; the replay itself is idempotent.
        checked = json.loads(execute(replay, timeout=retention.BATCH_SECONDS))
        if (not isinstance(checked, dict) or set(checked) != {'remaining'}
                or type(checked['remaining']) is not int or checked['remaining'] != 0):
            raise RuntimeError('replay_recheck_failed')
        report['reader_gate'] = 'transitioning_after_replay_and_current_ttl'
        record(dict(report))
        open_readers()
        report.update(state='passed', reader_gate='opened_after_replay_and_current_ttl')
        record(dict(report))
        return report
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        report['state'] = 'failed'
        record(dict(report))
        raise RuntimeError('synthetic_recovery_gate_failed') from None


CACHE_LOCK = ROOT / 'infra/observability/umami/recovery-cache.lock.json'
FOUNDATION_INPUTS = tuple('infra/production/database/' + name for name in
                          ('Dockerfile', 'init-production-databases.sh', 'restore-entrypoint.sh', 'pgbackrest.conf'))


def validate_cache(raw):
    """Bind the existing local cache to unchanged reviewed foundation inputs, never a mutable tag alone."""
    if (not isinstance(raw, dict) or set(raw) != {'schema', 'image', 'cache_owner', 'source', 'architecture', 'inputs'}
            or type(raw['schema']) is not int or raw['schema'] != 1
            or not isinstance(raw['image'], str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', raw['image'])
            or not isinstance(raw['cache_owner'], str)
            or not re.fullmatch(r'inside-platform-production-smoke-cache-[a-z0-9-]+-foundation:local', raw['cache_owner'])
            or not isinstance(raw['source'], str) or not re.fullmatch(r'[a-f0-9]{40}', raw['source'])
            or raw['architecture'] != 'arm64' or not isinstance(raw['inputs'], dict)
            or set(raw['inputs']) != set(FOUNDATION_INPUTS)):
        raise ValueError('foundation_cache_identity')
    for path, expected in raw['inputs'].items():
        if expected != hashlib.sha256((ROOT / path).read_bytes()).hexdigest():
            raise ValueError('foundation_cache_source_changed')
    return raw


def _backup_record(encoded):
    if not isinstance(encoded, str) or len(encoded.encode()) > 65536:
        raise ValueError('backup_info_size')
    rows = json.loads(encoded)
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('backup_info_shape')
    stanza = rows[0]
    status = stanza.get('status')
    backups = stanza.get('backup')
    if (stanza.get('name') != 'production' or stanza.get('cipher') != 'aes-256-cbc'
            or not isinstance(status, dict) or type(status.get('code')) is not int or status['code'] != 0
            or not isinstance(backups, list) or len(backups) != 1 or not isinstance(backups[0], dict)):
        raise ValueError('backup_info_incomplete')
    backup = backups[0]
    label, times = backup.get('label'), backup.get('timestamp')
    if (not isinstance(label, str) or not re.fullmatch(r'[0-9]{8}-[0-9]{6}F', label)
            or backup.get('type') != 'full' or backup.get('error', False) is not False
            or not isinstance(times, dict) or set(times) != {'start', 'stop'}
            or any(type(value) is not int or not 0 < value <= 2**53 - 1 for value in times.values())
            or times['stop'] < times['start']):
        raise ValueError('backup_info_record')
    return backup


def backup_label(encoded):
    return _backup_record(encoded)['label']


def backup_proof(encoded):
    """Project only the chosen full backup identity and inclusion, never raw info/annotations."""
    backup = _backup_record(encoded)
    databases = backup.get('database-ref')
    if (not isinstance(databases, list) or not 2 <= len(databases) <= 16
            or any(not isinstance(row, dict) or not isinstance(row.get('name'), str)
                   or type(row.get('oid')) is not int or row['oid'] <= 0 for row in databases)
            or not {'inside', 'umami'} <= {row['name'] for row in databases}):
        raise ValueError('backup_database_inclusion')
    return {'label': backup['label'], 'cipher': 'aes-256-cbc',
            'started_at_epoch': backup['timestamp']['start'], 'finished_at_epoch': backup['timestamp']['stop'],
            'both_databases_in_manifest': True}


# These are synthetic SQL actors, not the Umami application or a production ingestion boundary.
READER_SQL = f"""BEGIN READ ONLY;
SET LOCAL statement_timeout='1s';
SELECT json_build_object('reader_rows', count(*), 'blocked_rows', count(*) FILTER
(WHERE created_at IS NULL OR created_at < transaction_timestamp()-INTERVAL '365 days' OR event_id='{DELETE_EVENT}'))
FROM public.website_event WHERE website_id='{SITE}';
COMMIT;"""
INGEST_SQL = f"""BEGIN;
SET LOCAL statement_timeout='1s';
INSERT INTO public.website_event(event_id,website_id,session_id,visit_id,url_path,event_type,event_name)
SELECT '{INGEST_EVENT}',website_id,session_id,visit_id,'/synthetic/restore',2,'recovery_ingest_probe'
FROM public.website_event WHERE website_id='{SITE}' AND event_name='ttl_recent'
ON CONFLICT(event_id) DO NOTHING;
SELECT json_build_object('ingest_rows', count(*)) FROM public.website_event
WHERE website_id='{SITE}' AND event_id='{INGEST_EVENT}';
COMMIT;"""
