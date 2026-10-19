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
                   'PGBACKREST_PG1_PATH': PGDATA, 'PGBACKREST_CONFIG': '/config/pgbackrest.conf',
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
            'entrypoint': ['sh', '-ec'], 'command': ['install -d -o postgres -g postgres -m 700 /backup /var/spool/pgbackrest; install -d -o postgres -g postgres -m 3777 /var/run/postgresql; pgbackrest version'],
            'volumes': ['repository:/backup', 'spool:/var/spool/pgbackrest', 'socket:/var/run/postgresql']},
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
            'environment': {'PGDATA': PGDATA}, 'volumes': restored_mounts,
            'command': ['postgres', '-c', 'listen_addresses=', '-c', 'archive_mode=off']},
        'read-db': {**common, 'user': 'postgres', 'networks': ['private'], 'profiles': reader_profile,
            'environment': {'PGDATA': PGDATA}, 'volumes': restored_mounts,
            'command': ['postgres', '-c', 'archive_mode=off']},
    }
    for name in ('reader', 'ingest'):
        services[name] = {**common, 'user': 'postgres', 'networks': ['private'], 'profiles': reader_profile,
            'environment': {'PGPASSWORD': umami_password, 'PGCONNECT_TIMEOUT': '3'},
            'entrypoint': ['psql'], 'command': ['-X', '-qAt', '-h', 'read-db', '-U', 'umami', '-d', 'umami', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1']}
    plan = {'services': services, 'networks': {'private': {'internal': True}},
            'volumes': {name: {} for name in ('database', 'repository', 'socket', 'spool', 'recovery-socket')}}
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
            or container.get('state') != {'status': 'created', 'running': False, 'pid': 0}):
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
