"""Closed public projection. Raw private files are never copied to artifacts."""
import json
import math
import os
import re
import stat

import lifecycle
import observer

FACTS = frozenset(('bootstrap', 'viewer_identity', 'fixed_read', 'admin_read_denied',
                  'revoke_denied', 'retained_400', 'trace_log_correlation', 'native_mcp', 'finite_gateway'))
PHASES = frozenset(('acquire', 'native_create', 'PG_keeper', 'CH', 'migrations',
                    'collector_server', 'postgres_counts', 'native_MCP', 'functional'))
REASONS = frozenset(('command_failed', 'command_deadline', 'global_deadline', 'init_failed',
                     'init_deadline', 'storage_monitor_failed', 'worker_interrupted_or_storage',
                     'incomplete_functional_witness', 'migration_counts_unavailable', 'functional_failure'))
ROLE_IMAGES = {'volume-init': 'python', 'disk': 'python', 'histogram-init': 'python',
               'keeper': 'clickhouse-keeper', 'postgres': 'postgres', 'clickhouse': 'clickhouse-server',
               'migrator': 'signoz-otel-collector', 'collector': 'signoz-otel-collector',
               'server': 'signoz', 'mcp': 'signoz-mcp-server'}


def require(ok):
    if not ok: raise ValueError('closed_public_contract')


def number(value, maximum=2**64-1):
    require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum)
    return value


def integer(value, maximum=2**64-1):
    require(type(value) is int and 0 <= value <= maximum)
    return value


def boolean(value):
    require(type(value) is bool)
    return value


def digest(value):
    require(type(value) is str and re.fullmatch('sha256:[a-f0-9]{64}', value) is not None)
    return value


def read(path):
    # NOFOLLOW plus fstat closes the symlink/stat/open gap. Existing private receipts
    # must belong to this uid and have no group/other access or extra hardlinks.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        native = os.fstat(stream.fileno())
        require(stat.S_ISREG(native.st_mode) and native.st_uid == os.getuid()
                and native.st_nlink == 1 and native.st_mode & 0o077 == 0 and native.st_size <= 1048576)
        raw = stream.read(1048577); require(len(raw) <= 1048576)
    return json.loads(raw, object_pairs_hook=observer.unique)


def functional(value):
    require(type(value) is dict and all(type(value.get(k)) is int and value[k] == 1 for k in FACTS))
    require(value.get('empty_fixture_span_count') == 0 and type(value['empty_fixture_span_count']) is int)
    require(type(value.get('full_workload_acceptance')) is int and value['full_workload_acceptance'] == 0
            and type(value.get('capacity_acceptance')) is int and value['capacity_acceptance'] == 0)
    return {'available': True, **{k: 1 for k in sorted(FACTS)}, 'query_seconds': number(value['query_seconds'], 10)}


def postgres(value):
    require(type(value) is dict and type(value.get('available')) is bool)
    if not value['available']: return {'available': False}
    result = observer.decode(json.dumps(value.get('counts')).encode())
    require(result['available'])
    return result


def outcome(value):
    require(type(value) is dict and value.get('runtime_limit_seconds') == 600)
    code = value.get('worker_exit'); require(type(code) is int and -128 <= code <= 255)
    require(value.get('capacity_acceptance') is False and value.get('full_workload') is False)
    clean = value.get('cleanup'); require(type(clean) is dict)
    return {'available': True, 'passed': boolean(value['passed']), 'worker_exit': code,
            'worker_seconds': number(value['worker_seconds'], 720), 'runtime_limit_seconds': 600,
            'cleanup_passed': boolean(clean['passed'])}


def cleanup(value):
    require(type(value) is dict)
    operations = value.get('failed_operations')
    require(type(operations) is list and len(operations) <= 32
            and all(k in ('discovery', 'container', 'network', 'volume', 'residue') for k in operations))
    return {'available': True, 'passed': boolean(value['passed']), 'failed_operations': operations,
            'exact_containers': integer(value['exact_containers'], 10),
            'exact_volumes': integer(value['exact_volumes'], 6), 'exact_networks': integer(value['exact_networks'], 1)}


def states(value):
    require(type(value) is dict and set(value) <= set(lifecycle.SERVICES))
    result = {}
    for role, row in value.items():
        require(type(row) is dict and set(row) == {'exit_code', 'running', 'oom_killed', 'restart_count'})
        result[role] = {'exit_code': integer(row['exit_code'], 255), 'running': boolean(row['running']),
                        'oom_killed': boolean(row['oom_killed']), 'restart_count': integer(row['restart_count'], 1000000)}
    return {'available': True, 'roles': result}


def failure(value):
    require(type(value) is dict)
    return {'available': True, 'phase': value.get('phase') if value.get('phase') in PHASES else 'unavailable',
            'reason': value.get('reason') if value.get('reason') in REASONS else 'unclassified_failure',
            'native_failure_capture_unavailable': value.get('native_failure_capture_unavailable') is not False}


def inside_failures(output):
    stages={'entry','bootstrap','mcp_ready','mcp_initialize','mcp_inventory','ingest','retained_metrics',
            'trace_log','mcp_read','finite_gateway','viewer_admin_denial','viewer_revoke','viewer_revoked_denial'}
    categories={'ControlFailure','RuntimeError','TimeoutError','ConnectionRefusedError','ConnectionResetError',
                'RemoteDisconnected','JSONDecodeError','OSError','BrokenPipeError','ValueError'}
    transports={'none','query_v5','register','session','roles','reader_identity','revoke','service_account_setup'}
    result=[]
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path=directory/'inside-failure.json'
        if not path.exists():continue
        row=read(path);require(type(row) is dict and row.get('inside_failed')==1)
        result.append({'stage':row.get('stage') if row.get('stage') in stages else 'unavailable',
            'category':row.get('category') if row.get('category') in categories else 'unavailable',
            'transport':row.get('transport') if row.get('transport') in transports else 'unavailable',
            'http_status':integer(row['http_status'],599)})
    return {'available':bool(result),'samples':result}


def images(value):
    require(type(value) is dict and set(value) == set(lifecycle.SERVICES))
    lock = lifecycle.verify_packet(); rows = {r['repository'].split('/')[-1]: r for r in lock['images']}
    result = {}
    for role, row in value.items():
        require(type(row) is dict); pin = rows[ROLE_IMAGES[role]]
        config = lock['image_config_metadata'][pin['repository']]['amd64']['config_digest']
        allowed = {pin['pinned'].split('@')[1], pin['linux_amd64_manifest'], config}
        require(row.get('reference') == pin['pinned'] and row.get('architecture') == 'amd64'
                and row.get('child_manifest') == pin['linux_amd64_manifest'])
        require(row.get('image_id') in allowed and row.get('selected_image_id') in allowed)
        result[role] = {k: row[k] for k in ('reference', 'architecture', 'child_manifest', 'image_id', 'selected_image_id')}
    return {'available': True, 'roles': result}


def storage(value):
    require(type(value) is dict and type(value.get('host')) is dict and type(value.get('vm')) is dict)
    host = value['host']['filesystems']; require(type(host) is dict and 1 <= len(host) <= 3)
    rows = [{'total_bytes': integer(v['total_bytes']), 'free_bytes': integer(v['free_bytes'])} for v in host.values()]
    require(all(0 <= r['free_bytes'] <= r['total_bytes'] and r['total_bytes'] > 0 for r in rows))
    vm = {k: integer(value['vm'][k]) for k in ('fsid', 'device', 'block', 'blocks', 'available', 'files', 'free_files')}
    require(vm['block'] > 0 and 0 <= vm['available'] <= vm['blocks'])
    return {'available': True, 'host_filesystems': rows, 'vm': vm}


def identities(output):
    result = []
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path = directory / 'identity.json'
        if not path.exists(): continue
        row = read(path); require(type(row) is dict)
        result.append({k: digest(row[k]) for k in ('cli_sha256', 'compose_sha256', 'daemon_sha256', 'endpoint_sha256')})
    return {'available': bool(result), 'samples': result}


def native_failures(output):
    result = []
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path = directory / 'failure.json'
        if not path.exists(): continue
        row = read(path); require(type(row) is dict)
        code = row.get('native_exit'); require(code is None or type(code) is int and -128 <= code <= 255)
        item = {'native_exit': code, 'alive_before_reap': boolean(row['alive_before_reap'])}
        for stream in ('stdout', 'stderr'):
            item[stream + '_bytes'] = integer(row[stream + '_bytes'], lifecycle.OUTPUT_LIMIT + 65536)
            item[stream + '_retained_bytes'] = integer(row[stream + '_retained_bytes'], 32768)
            item[stream + '_sha256'] = digest('sha256:' + row[stream + '_sha256'])
        result.append(item)
    return {'available': bool(result), 'samples': result}


def collect(output, destination, verify_source):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {'schema': 1, 'passed': False, 'functional_only': True, 'capacity_acceptance': False,
              'aggregate_cpu_limit': 2, 'aggregate_memory_bytes': 4 * 1024**3,
              'runtime_limit_seconds': 600, 'cleanup_limit_seconds': 90}
    safe_root = output.is_dir() and not output.is_symlink()
    contracts = {'outcome': outcome, 'cleanup': cleanup, 'functional': functional, 'postgres': postgres,
                 'states': states, 'failure': failure, 'images': images, 'disk-admission': storage,
                 'recovery-cleanup':cleanup,'recovery-states':states}
    for name, project in contracts.items():
        try:
            require(safe_root); report[name] = project(read(output / (name + '.json')))
        except Exception: report[name] = {'available': False}
    try:
        require(safe_root); source = read(output / 'source.json'); verify_source(source)
        report['source'] = {'available': True, 'binding': source}
    except Exception: report['source'] = {'available': False}
    for name, project in (('native_identity', identities), ('native_failures', native_failures),('inside_failures',inside_failures)):
        try:
            require(safe_root); report[name] = project(output)
        except Exception: report[name] = {'available': False}
    report['passed'] = all(report[k]['available'] for k in ('source', 'outcome', 'cleanup', 'functional', 'postgres', 'states', 'images', 'disk-admission', 'native_identity')) and (
        report['outcome'].get('passed') is True and report['cleanup'].get('passed') is True
        and report['postgres'].get('counts', {}).get('applied_migrations', 0) > 0)
    lifecycle.private_json(destination / 'witness.json', report)
    return report['passed']
