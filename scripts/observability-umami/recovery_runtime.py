"""Supervised synthetic PG18/pgBackRest recovery, never a production backup command."""
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess

import recovery
import runtime

pilot = runtime.pilot
ROOT = recovery.ROOT
SCRIPTS = recovery.SCRIPTS
BINDING_INPUTS = (*recovery.FOUNDATION_INPUTS,
    'infra/observability/umami/recovery-cache.lock.json', 'infra/observability/umami/inputs.lock.json',
    'infra/observability/umami/schema-fixture.sql',
    'scripts/observability-umami/recovery.py', 'scripts/observability-umami/recovery_runtime.py',
    'scripts/observability-umami/prepare.py', 'scripts/observability-umami/runtime.py',
    'scripts/observability-umami/retention.py', 'scripts/observability-umami/retention.sql',
    'scripts/observability-umami/retention-corpus.sql', 'scripts/observability-umami/retention-proof.sql',
    'scripts/observability-umami/retention_fixture.py',
    'scripts/observability-pilot/pilot.py', 'scripts/observability-pilot/orbstack.py',
    'scripts/observability-pilot/daemon.py', 'scripts/observability-pilot/storage_policy.py',
    'infra/observability/pilot/probe.lock.json')
IMAGE_INSPECT = '{"id":{{json .Id}},"architecture":{{json .Architecture}},"os":{{json .Os}}}'


def prepare_bound_inputs(output):
    cache = recovery.validate_cache(json.loads(recovery.CACHE_LOCK.read_text()))
    recovery.prepare_inputs(output, foundation_image=cache['image'])
    pilot.write_json(output / 'recovery-inputs.json', {
        'schema': 1, 'foundation_source': cache['source'], 'foundation_image': cache['image'],
        'inputs': {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in BINDING_INPUTS},
        'private_compose_sha256': _expected_supervised_compose_hash(output),
        'configuration_sha256': hashlib.sha256((output / 'pgbackrest.conf').read_bytes()).hexdigest(),
        'initial_roles_sha256': hashlib.sha256((output / 'init.sql').read_bytes()).hexdigest()})


def _expected_supervised_compose_hash(output):
    """Predict only the public supervisor's exact Mac addition; never normalize worker input."""
    identity = pilot.FROZEN_DOCKER_IDENTITY
    if identity is None or identity.get('platform') == 'linux':
        return hashlib.sha256((output / 'compose.json').read_bytes()).hexdigest()
    pilot.validate_recorded_daemon_identity(identity, linux=False)
    plan = json.loads((output / 'compose.json').read_text())
    if 'storage-probe' in plan['services']:
        raise ValueError('unexpected_prepared_storage_probe')
    lock = json.loads((pilot.CONFIG / 'probe.lock.json').read_text())
    plan['services']['storage-probe'] = pilot.orbstack.probe_service(lock, identity['storage'])
    # Use the SAME owning serializer as pilot.run. The private expected copy is
    # removed before preparation returns; only its digest survives.
    expected = output / 'expected-compose.private.json'
    expected.touch(mode=0o600, exist_ok=False)
    try:
        pilot.write_json(expected, plan)
        return hashlib.sha256(expected.read_bytes()).hexdigest()
    finally:
        expected.unlink()


def exercise(output, compose, project, *, execute=runtime.invoke):
    """One owned corpus. All Docker I/O crosses the existing identity/deadline adapter."""
    report = {'schema': 1, 'scope': 'owned_synthetic_sql_pg18_recovery_only', 'state': 'running',
              'stage': 'cache_admission', 'reader_gate': 'closed', 'production_deletion_authority': 'unknown'}
    def record():
        pilot.write_json(output / 'recovery-proof.json', report)
    def record_operation(value):
        report['operation'] = value
        record()
    record()
    try:
        cache = recovery.validate_cache(json.loads(recovery.CACHE_LOCK.read_text()))
        binding = json.loads((output / 'recovery-inputs.json').read_text())
        if (not isinstance(binding, dict) or binding.get('schema') != 1
                or binding.get('foundation_source') != cache['source'] or binding.get('foundation_image') != cache['image']
                or binding.get('inputs') != {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in BINDING_INPUTS}
                or binding.get('private_compose_sha256') != hashlib.sha256((output / 'compose.json').read_bytes()).hexdigest()
                or binding.get('configuration_sha256') != hashlib.sha256((output / 'pgbackrest.conf').read_bytes()).hexdigest()
                or binding.get('initial_roles_sha256') != hashlib.sha256((output / 'init.sql').read_bytes()).hexdigest()):
            raise ValueError('recovery_prepared_inputs_changed')
        for reference in (cache['image'], cache['cache_owner']):
            actual = json.loads(execute(['docker'], ['image', 'inspect', reference, '--format', IMAGE_INSPECT]))
            if actual != {'id': cache['image'], 'architecture': cache['architecture'], 'os': 'linux'}:
                raise RuntimeError('recovery_cache_unavailable_or_changed')
        report['stage'] = 'fresh_destination'
        record()
        plan = json.loads((output / 'compose.json').read_text())
        name = plan['volumes']['recovery']['name']
        if not isinstance(name, str) or not re.fullmatch(re.escape(recovery.RECOVERY_PREFIX) + r'[a-f0-9]{32}', name):
            raise ValueError('invalid_recovery_volume_name')
        if execute(['docker'], ['volume', 'ls', '--filter', 'name=' + name, '--format', '{{.Name}}']).strip():
            raise RuntimeError('recovery_destination_already_exists')
        report['stage'] = 'repository_initialize'
        record()
        _one_shot(compose, project, 'repo-init', execute, record=record_operation)
        report['stage'] = 'source_database'
        record()
        execute(compose, ['up', '-d', '--no-deps', 'db'])
        _await_sql(compose, 'db', execute=execute, tcp=True)
        cluster = _cluster(_sql(compose, 'db', CLUSTER_SQL, execute=execute, role='pilot_bootstrap', database='postgres'))
        report['postgres_version_num'] = cluster['version_num']
        record()
        if cluster['version_num'] != 180004 or cluster['archive_mode'] != 'on':
            raise RuntimeError('unexpected_source_database_version_or_archiving')
        return _database_corpus(output, compose, project, plan, cluster, report, record, execute, record_operation)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        report['state'] = 'failed'
        record()
        raise RuntimeError('owned_recovery_failed; inspect curated recovery-proof.json') from None


CONTAINER_INSPECT = ('{"image":{{json .Image}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},'
    '"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},'
    '"state":{"status":{{json .State.Status}},"running":{{json .State.Running}},"pid":{{json .State.Pid}},"exit_code":{{json .State.ExitCode}}}}')
OPERATION_SECONDS = 90
STOP_SECONDS = 10
SQL_READY_SECONDS = 60
SQL_POLL_SECONDS = .25


def _inspect_service(compose, project, service, execute, *, progress=None):
    if progress is not None:
        progress('identity')
    identity = execute(compose, ['ps', '--all', '-q', service]).strip()
    if progress is not None:
        lines = identity.splitlines()
        progress('identity', {'count': 'none' if not lines else 'one' if len(lines) == 1 else 'multiple',
            'single_width': len(identity) if len(lines) == 1 and len(identity) <= runtime.FIXTURE_BYTES else None,
            'single_hex': bool(re.fullmatch(r'[a-f0-9]+', identity)) if len(lines) == 1 else None})
    if not re.fullmatch(r'[a-f0-9]{64}', identity):
        raise ValueError('owned_service_identity')
    if progress is not None:
        progress('inspect')
    actual = json.loads(execute(['docker'], ['inspect', identity, '--format', CONTAINER_INSPECT]))
    if (not isinstance(actual, dict) or not isinstance(actual.get('labels'), dict)
            or actual['labels'].get('com.docker.compose.project') != project
            or actual['labels'].get('com.docker.compose.service') != service
            or not isinstance(actual.get('state'), dict)):
        raise ValueError('owned_service_inspection')
    return actual


def _require_stopped(actual):
    state = actual['state']
    if (state.get('status') not in ('exited', 'created') or state.get('running') is not False
            or type(state.get('pid')) is not int or state['pid'] != 0):
        raise RuntimeError('postmaster_not_confirmed_stopped')


def _one_shot(compose, project, service, execute, *, already_created=False, record=None):
    diagnostic = {'schema': 1, 'service': service if service in recovery.SERVICES else 'unknown',
        'step': 'start' if already_created else 'up', 'outcome': 'running', 'error': None,
        'returncode': None, 'identity': None, 'container_exit_code': None}
    def publish():
        if record is not None:
            record(dict(diagnostic))
    def progress(step, shape=None):
        diagnostic['step'] = step
        diagnostic['returncode'] = 0 if shape is not None else None
        if shape is not None:
            diagnostic['identity'] = shape
        publish()
    publish()
    try:
        execute(compose, ['start', service] if already_created else ['up', '-d', '--no-deps', service])
        progress('wait')
        execute(compose, ['wait', service], timeout=OPERATION_SECONDS)
        actual = _inspect_service(compose, project, service, execute, progress=progress)
        diagnostic['returncode'] = 0
        progress('state')
        _require_stopped(actual)
        progress('exit')
        code = actual['state'].get('exit_code')
        diagnostic['container_exit_code'] = code if type(code) is int and 0 <= code <= 255 else None
        if actual['state'].get('status') != 'exited' or type(code) is not int or code != 0:
            raise RuntimeError('owned_operation_failed')
        diagnostic.update(outcome='passed', returncode=0)
        publish()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        code = getattr(error, 'returncode', None)
        diagnostic['returncode'] = code if type(code) is int and -128 <= code <= 255 else None
        if isinstance(error, (subprocess.TimeoutExpired, TimeoutError)):
            category = 'timeout'
        elif isinstance(error, (runtime.FixtureCommandFailed, subprocess.CalledProcessError)):
            category = 'command_failed'
        elif isinstance(error, json.JSONDecodeError):
            category = 'invalid_inspect_json'
        elif isinstance(error, ValueError):
            category = 'invalid_identity' if diagnostic['step'] == 'identity' else 'inspection_mismatch'
        elif diagnostic['step'] == 'state':
            category = 'invalid_state'
        elif diagnostic['step'] == 'exit':
            category = 'invalid_exit_code'
        else:
            category = 'io_failure' if isinstance(error, OSError) else 'runtime_failure'
        diagnostic.update(outcome='failed', error=category)
        publish()
        raise


def _sql(compose, service, payload, *, execute, role='umami', database='umami', timeout=12):
    return execute(compose, ['exec', '-T', service, 'psql', '-X', '-qAt', '-U', role,
                   '-d', database, '-v', 'ON_ERROR_STOP=1'], payload=payload, timeout=timeout)


def _await_sql(compose, service, *, execute, tcp=False):
    import time
    deadline = time.monotonic() + SQL_READY_SECONDS
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('recovered_database_readiness_deadline')
        args = ['exec', '-T', service, 'pg_isready', '-t', '1', '-U', 'pilot_bootstrap', '-d', 'postgres']
        if tcp:
            args += ['-h', '127.0.0.1']
        try:
            execute(compose, args, timeout=min(12, remaining))
            if not tcp:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError('recovered_database_readiness_deadline')
                recovery_state = json.loads(_sql(compose, service,
                    "SELECT json_build_object('recovery_ended',NOT pg_is_in_recovery());",
                    execute=execute, role='pilot_bootstrap', database='postgres', timeout=min(12, remaining)))
                if (not isinstance(recovery_state, dict) or set(recovery_state) != {'recovery_ended'}
                        or type(recovery_state['recovery_ended']) is not bool):
                    raise ValueError('recovery_readiness_shape')
                if not recovery_state['recovery_ended']:
                    time.sleep(min(SQL_POLL_SECONDS, max(0, deadline - time.monotonic())))
                    continue
            return
        except runtime.FixtureCommandFailed:
            time.sleep(min(SQL_POLL_SECONDS, max(0, deadline - time.monotonic())))


def _expect(encoded, expected):
    if not isinstance(encoded, str) or len(encoded.encode()) > runtime.FIXTURE_BYTES:
        raise ValueError('recovery_proof_size')
    actual = json.loads(encoded)
    if (not isinstance(actual, dict) or set(actual) != set(expected)
            or any(type(actual[key]) is not type(value) or actual[key] != value for key, value in expected.items())):
        raise ValueError('recovery_proof_mismatch')
    return expected


def _data_mount(actual, name):
    mounts = actual.get('mounts')
    if not isinstance(mounts, list):
        raise ValueError('recovery_database_mount')
    data = [mount for mount in mounts if isinstance(mount, dict) and mount.get('Destination') == '/var/lib/postgresql']
    if len(data) != 1 or data[0].get('Name') != name or data[0].get('Type') != 'volume' or data[0].get('RW') is not True:
        raise ValueError('recovery_database_mount')


def open_sql_actors(compose, project, name, *, execute=runtime.invoke, record=None):
    """Stop and observe the offline postmaster before starting its private successor."""
    execute(compose, ['stop', '--timeout', str(STOP_SECONDS), 'recovered'])
    _require_stopped(_inspect_service(compose, project, 'recovered', execute))
    execute(compose, ['create', '--no-deps', 'read-db'])
    actual = _inspect_service(compose, project, 'read-db', execute)
    _require_stopped(actual)
    _data_mount(actual, name)
    if actual.get('ports') not in (None, {}) or actual.get('network') != project + '_private':
        raise ValueError('reader_database_not_private')
    execute(compose, ['start', 'read-db'])
    _await_sql(compose, 'read-db', execute=execute, tcp=True)
    _one_shot(compose, project, 'reader', execute, record=record)
    reader = execute(compose, ['logs', '--no-log-prefix', 'reader'])
    _expect(reader, {'reader_rows': 2, 'blocked_rows': 0})
    _one_shot(compose, project, 'ingest', execute, record=record)
    ingest = execute(compose, ['logs', '--no-log-prefix', 'ingest'])
    _expect(ingest, {'ingest_rows': 1})


CLUSTER_SQL = """SELECT json_build_object('version_num',current_setting('server_version_num')::int,
'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
'archive_mode',current_setting('archive_mode'),'archive_command',current_setting('archive_command'));"""


def _cluster(encoded):
    raw = json.loads(encoded)
    if (not isinstance(raw, dict) or set(raw) != {'version_num', 'system_identifier', 'archive_mode', 'archive_command'}
            or type(raw['version_num']) is not int or not 100000 <= raw['version_num'] < 1000000
            or not isinstance(raw['system_identifier'], str) or not re.fullmatch(r'[1-9][0-9]{0,19}', raw['system_identifier'])
            or raw['archive_mode'] not in ('on', 'off')
            or raw['archive_command'] != 'pgbackrest --stanza=production archive-push %p'):
        raise ValueError('unexpected_cluster_metadata')
    return raw


ROLE_SQL = """SELECT json_build_object(
'bounded_role', NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolcanlogin,
'connection_limit',rolconnlimit,'statement_timeout',current_setting('statement_timeout'),
'idle_timeout',current_setting('idle_in_transaction_session_timeout'),
'platform_connect_denied',NOT has_database_privilege(current_user,'inside','CONNECT'),
'logto_connect_denied',NOT has_database_privilege(current_user,'logto','CONNECT'),
'no_role_membership',NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid),
'own_database',current_database()='umami' AND current_user='umami' AND
 (SELECT datdba=pg_roles.oid FROM pg_database WHERE datname=current_database()))
FROM pg_roles WHERE rolname=current_user;"""
ROLE_EXPECTED = {'bounded_role': True, 'connection_limit': 8, 'statement_timeout': '5s', 'idle_timeout': '10s',
                 'platform_connect_denied': True, 'logto_connect_denied': True, 'no_role_membership': True, 'own_database': True}
PLATFORM_SQL = "SELECT json_build_object('platform_rows',count(*),'platform_untouched',bool_and(value='synthetic-1566-preserved')) FROM public.recovery_probe;"
PLATFORM_EXPECTED = {'platform_rows': 1, 'platform_untouched': True}
RESTORED_EVENT_SQL = f"""SELECT json_build_object('deleted_event_reappeared',
 (SELECT count(*) FROM public.website_event WHERE website_id='{recovery.SITE}' AND event_id='{recovery.DELETE_EVENT}'),
 'expired_events_reappeared',(SELECT count(*) FROM public.website_event WHERE website_id='{recovery.SITE}' AND event_name IN ('ttl_expired','ttl_null')));"""


def _no_readers(compose, execute):
    if execute(compose, ['ps', '--all', '-q', 'read-db', 'reader', 'ingest']).strip():
        raise RuntimeError('readers_or_ingestion_exist_before_gate')


def _database_corpus(output, compose, project, plan, source, report, record, execute, record_operation):
    import retention_fixture
    def stage(value):
        report['stage'] = value
        record()
    def sql(service, payload, *, role='umami', database='umami', timeout=12):
        return _sql(compose, service, payload, execute=execute, role=role, database=database, timeout=timeout)
    stage('source_setup')
    version = execute(compose, ['exec', '-T', 'db', 'pgbackrest', 'version']).strip()
    if version != 'pgBackRest 2.57.0':
        raise ValueError('unexpected_pgbackrest_version')
    sql('db', (output / 'init.sql').read_text() + """
REVOKE CONNECT ON DATABASE inside FROM PUBLIC;
GRANT CONNECT ON DATABASE inside TO platform;
REVOKE CONNECT ON DATABASE logto FROM PUBLIC;
GRANT CONNECT ON DATABASE logto TO logto_owner;
REVOKE CONNECT ON DATABASE umami FROM PUBLIC;
GRANT CONNECT ON DATABASE umami TO umami;
""", role='pilot_bootstrap', database='postgres')
    sql('db', """CREATE TABLE public.recovery_probe(value text NOT NULL);
ALTER TABLE public.recovery_probe OWNER TO platform;
INSERT INTO public.recovery_probe VALUES('synthetic-1566-preserved');""", role='pilot_bootstrap', database='inside')
    _expect(sql('db', PLATFORM_SQL, role='platform', database='inside'), PLATFORM_EXPECTED)
    report['role_isolation'] = _expect(sql('db', ROLE_SQL), ROLE_EXPECTED)
    sql('db', (ROOT / 'infra/observability/umami/schema-fixture.sql').read_text(), timeout=OPERATION_SECONDS)
    sql('db', f"INSERT INTO public.website(website_id,name,domain) VALUES('{recovery.SITE}','synthetic','fixture.invalid');")
    source_cutoff = retention_fixture.seed_result(sql('db', retention_fixture.seed_sql(recovery.SITE)))
    sql('db', f"""INSERT INTO public.website_event(event_id,website_id,session_id,visit_id,url_path,event_type,event_name)
SELECT '{recovery.DELETE_EVENT}',website_id,session_id,visit_id,'/synthetic/delete',2,'recovery_delete_probe'
FROM public.website_event WHERE website_id='{recovery.SITE}' AND event_name='ttl_recent';""")
    report.update(pgbackrest_version='2.57.0', source_fixture_cutoff=source_cutoff,
                  source_system_identifier_sha256=hashlib.sha256(source['system_identifier'].encode()).hexdigest())
    stage('encrypted_backup')
    for backup_command in ('stanza-create', 'check'):
        execute(compose, ['exec', '-T', '--user', 'postgres', 'db', 'pgbackrest', '--stanza=production', backup_command], timeout=OPERATION_SECONDS)
    _one_shot(compose, project, 'backup', execute, record=record_operation)
    info_args = ['exec', '-T', '--user', 'postgres', 'db', 'pgbackrest', '--stanza=production', '--output=json']
    label = recovery.backup_label(execute(compose, [*info_args, 'info']))
    backup = recovery.backup_proof(execute(compose, [*info_args, '--set=' + label, 'info']))
    if backup['label'] != label:
        raise ValueError('backup_selection_changed')
    report['backup'] = backup
    # This input is outside the database backup and intentionally created AFTER it.
    manifest = {'schema': 1, 'scope': 'synthetic_only', 'event_ids': [recovery.DELETE_EVENT]}
    pilot.write_json(output / 'current-deletions.json', manifest)
    stage('source_stop')
    execute(compose, ['stop', '--timeout', str(STOP_SECONDS), 'db'])
    _require_stopped(_inspect_service(compose, project, 'db', execute))
    _no_readers(compose, execute)
    stage('restore_destination')
    # Freeze the selected full label into private Compose input before container creation.
    plan['services']['restore']['command'].insert(0, '--set=' + label)
    pilot.write_json(output / 'compose.json', plan)
    report['selected_compose_sha256'] = hashlib.sha256((output / 'compose.json').read_bytes()).hexdigest()
    execute(compose, ['create', '--no-deps', 'restore'])
    name = plan['volumes']['recovery']['name']
    volume = json.loads(execute(['docker'], ['volume', 'inspect', name, '--format', '{{json .}}']))
    restore = _inspect_service(compose, project, 'restore', execute)
    if restore.get('network') != 'none' or restore.get('ports') not in (None, {}):
        raise ValueError('restore_not_offline')
    report['destination'] = recovery.confirm_destination(project, name, plan['services']['db']['image'], volume, restore,
                                                         absent_before_acquisition=True)
    stage('offline_restore')
    _one_shot(compose, project, 'restore', execute, already_created=True, record=record_operation)
    execute(compose, ['create', '--no-deps', 'recovered'])
    offline = _inspect_service(compose, project, 'recovered', execute)
    _require_stopped(offline)
    _data_mount(offline, name)
    if offline.get('network') != 'none' or offline.get('ports') not in (None, {}):
        raise ValueError('recovered_postmaster_not_offline')
    execute(compose, ['start', 'recovered'])
    _await_sql(compose, 'recovered', execute=execute)
    _expect(sql('recovered', "SELECT json_build_object('recovery_ended',NOT pg_is_in_recovery());",
                role='pilot_bootstrap', database='postgres'), {'recovery_ended': True})
    restored = _cluster(sql('recovered', CLUSTER_SQL, role='pilot_bootstrap', database='postgres'))
    if (restored['system_identifier'] != source['system_identifier'] or restored['version_num'] != 180004
            or restored['archive_mode'] != 'off'):
        raise ValueError('restored_lineage_or_archive_mode')
    report['restored_platform'] = _expect(sql('recovered', PLATFORM_SQL, role='platform', database='inside'), PLATFORM_EXPECTED)
    _expect(sql('recovered', ROLE_SQL), ROLE_EXPECTED)
    report['backup_data_reappeared'] = _expect(sql('recovered', RESTORED_EVENT_SQL),
        {'deleted_event_reappeared': 1, 'expired_events_reappeared': 502})
    _no_readers(compose, execute)
    stage('maintenance_failure_gate')
    # Real SQL failure must not create/start either external SQL actor.
    def fail_sql(_payload, *, timeout):
        return sql('recovered', "BEGIN; SET LOCAL statement_timeout='1s'; SELECT 1/0; COMMIT;", timeout=timeout)
    def forbidden_transition():
        raise RuntimeError('negative_gate_opened')
    failed_gate = []
    try:
        recovery.restore_gate(fail_sql, manifest, forbidden_transition, failed_gate.append)
    except RuntimeError:
        if not failed_gate or failed_gate[-1]['state'] != 'failed' or failed_gate[-1]['reader_gate'] != 'closed':
            raise RuntimeError('negative_gate_not_closed') from None
    else:
        raise RuntimeError('negative_gate_did_not_fail')
    _no_readers(compose, execute)
    report['maintenance_failure_kept_actors_absent'] = True
    stage('current_replay_and_ttl')
    def maintenance(payload, *, timeout):
        return sql('recovered', payload, timeout=timeout)
    def open_readers():
        # Existing retention proof, with the former boundary now expired at CURRENT cutoff.
        expected = {**retention_fixture.EXPECTED, 'boundary_event_rows': 0}
        _expect(maintenance(retention_fixture.proof_sql(), timeout=12), expected)
        _no_readers(compose, execute)
        report['reader_gate'] = 'transitioning_after_replay_and_current_ttl'
        record()
        open_sql_actors(compose, project, name, execute=execute, record=record_operation)
    def record_gate(value):
        report['maintenance'] = value
        report['reader_gate'] = value['reader_gate']
        record()
    current = json.loads((output / 'current-deletions.json').read_text())
    if current != manifest:
        raise ValueError('synthetic_deletion_input_changed')
    recovery.restore_gate(maintenance, current, open_readers, record_gate)
    report.update(state='passed', stage='completed', both_databases_restored=True,
                  sql_reader_and_ingest='passed_after_gate', original_source_volume_used_for_restore=False)
    record()
    return report


def run_worker(output):
    owner = json.loads((output / 'owner.json').read_text())
    if (not isinstance(owner, dict) or owner.get('supervisor_pid') != os.getppid()
            or owner.get('cwd') != str(ROOT) or not isinstance(owner.get('project'), str)
            or not re.fullmatch(re.escape(recovery.PROJECT_PREFIX) + r'[a-f0-9]{12}', owner['project'])):
        raise RuntimeError('recovery_worker_requires_registered_supervisor')
    compose = ['docker', 'compose', '-p', owner['project'], '-f', str(output / 'compose.json')]
    with pilot.worker_storage_guard(owner, compose, output):
        proof = exercise(output, compose, owner['project'])
        evidence = json.loads((output / 'evidence.json').read_text())
        evidence.update({'recovery': proof, 'status': 'synthetic SQL PG18 recovery passed; full acceptance pending'})
        pilot.write_json(output / 'evidence.json', evidence)


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('run', 'worker', 'recover'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    # Explicit service targets still control acquisition. Enrol all profiles for
    # supervisor cleanup/recovery, including a failure midway through maintenance.
    previous = os.environ.get('COMPOSE_PROFILES')
    os.environ['COMPOSE_PROFILES'] = 'maintenance-only,readers-after-replay'
    prepared_here = False
    def prepare_owned(path):
        nonlocal prepared_here
        prepare_bound_inputs(path)
        prepared_here = True
    try:
        if args.action == 'worker':
            run_worker(output)
        elif args.action == 'recover':
            runtime.core_ci.recover(output, project_prefix=recovery.PROJECT_PREFIX, services=recovery.SERVICES)
        else:
            pilot.run(output, prepare_inputs=prepare_owned, worker_script=Path(__file__).resolve(), ports=(),
                project_prefix=recovery.PROJECT_PREFIX, services=recovery.SERVICES,
                scope='owned synthetic PG18/pgBackRest POSIX backup and SQL recovery gate only',
                missing=['production deletion authority', 'scheduled next-day retention', 'Umami application/native MCP restore',
                         'production pgBackRest upgrade #1579', 'production S3 recovery', 'resource acceptance and seven days'])
    finally:
        if prepared_here:
            (output / 'init.sql').unlink(missing_ok=True)
        if previous is None:
            os.environ.pop('COMPOSE_PROFILES', None)
        else:
            os.environ['COMPOSE_PROFILES'] = previous


if __name__ == '__main__':
    import signal
    import sys
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt('owned recovery interrupted')
    signal.signal(signal.SIGTERM, interrupt)
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        # Commands, SQL, environment and pgBackRest stderr may contain private input.
        print('observability-umami-recovery: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
