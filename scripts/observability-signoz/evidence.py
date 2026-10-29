"""Closed public projection. Raw private files are never copied to artifacts."""
import json
import math
import os
import re
import stat

import lifecycle
import observer
import agent_probe

FACTS = frozenset(('bootstrap', 'viewer_identity', 'fixed_read', 'admin_read_denied',
                  'revoke_denied', 'retained_400', 'trace_log_correlation', 'native_mcp', 'finite_gateway',
                  'isolated_client','direct_bypass_denied','unix_gateway'))
PHASES = frozenset(('acquire', 'native_create', 'PG_keeper', 'CH', 'migrations',
                    'collector_server', 'postgres_counts', 'native_MCP', 'functional'))
REASONS = frozenset(('command_failed', 'command_deadline', 'global_deadline', 'init_failed','unhealthy_final_roles',
                     'init_deadline', 'storage_monitor_failed', 'worker_interrupted_or_storage',
                     'incomplete_functional_witness', 'migration_counts_unavailable', 'functional_failure')) | frozenset(lifecycle.ImageAdmissionReason)


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


def outcome(value,profile_id=lifecycle.BASELINE_PROFILE):
    require(type(value) is dict and value.get('profile_id')==profile_id)
    require(type(value) is dict and value.get('runtime_limit_seconds') == 600)
    code = value.get('worker_exit'); require(type(code) is int and -128 <= code <= 255)
    require(value.get('capacity_acceptance') is False and value.get('full_workload') is False)
    clean = value.get('cleanup'); require(type(clean) is dict)
    require(value.get('passed') is not True or code==0 and clean.get('passed') is True and number(value['worker_seconds'])<=600)
    return {'available': True, 'profile_id':profile_id, 'passed': boolean(value['passed']), 'worker_exit': code,
            'worker_seconds': number(value['worker_seconds'], 720), 'runtime_limit_seconds': 600,
            'cleanup_passed': boolean(clean['passed'])}


def cleanup(value):
    require(type(value) is dict)
    operations = value.get('failed_operations')
    require(type(operations) is list and len(operations) <= 32
            and all(k in ('discovery', 'container', 'network', 'volume', 'residue') for k in operations))
    require(value.get('passed') is (not operations))
    return {'available': True, 'passed': boolean(value['passed']), 'failed_operations': operations,
            'exact_containers': integer(value['exact_containers'], len(lifecycle.SERVICES)),
            'exact_volumes': integer(value['exact_volumes'], len(lifecycle.VOLUMES)), 'exact_networks': integer(value['exact_networks'], 1)}


def states(value):
    require(type(value) is dict and set(value) <= set(lifecycle.SERVICES))
    result = {}
    for role, row in value.items():
        require(type(row) is dict and set(row) == {'exit_code', 'running', 'oom_killed', 'restart_count'})
        result[role] = {'exit_code': integer(row['exit_code'], 255), 'running': boolean(row['running']),
                        'oom_killed': boolean(row['oom_killed']), 'restart_count': integer(row['restart_count'], 1000000)}
    return {'available': True, 'healthy':lifecycle.healthy_states(result), 'roles': result}


def failure(value):
    require(type(value) is dict)
    return {'available': True, 'phase': value.get('phase') if value.get('phase') in PHASES else 'unavailable',
            'reason': value.get('reason') if type(value.get('reason')) is str and value['reason'] in REASONS else 'unclassified_failure',
            'native_failure_capture_unavailable': value.get('native_failure_capture_unavailable') is not False}


def inside_failures(output):
    stages={'entry','bootstrap','bootstrap_key','bootstrap_identity','bootstrap_roles','bootstrap_fixed_read',
            'bootstrap_read_response','bootstrap_read_deadline','bootstrap_read_decode','bootstrap_read_object',
            'bootstrap_read_envelope','bootstrap_read_type','bootstrap_read_warning','bootstrap_read_results',
            'bootstrap_read_query','bootstrap_read_columns','bootstrap_read_rows','bootstrap_read_number',
            'bootstrap_read_number_range','bootstrap_read_count_nonzero',
            'mcp_wire_admission','mcp_wire_request','mcp_wire_headers','mcp_wire_read','mcp_wire_status',
            'mcp_wire_size','mcp_inventory_size','mcp_wire_deadline','mcp_wire_decode','mcp_wire_close','mcp_rpc_object',
            'mcp_rpc_version','mcp_rpc_id','mcp_rpc_error','mcp_rpc_result','mcp_rpc_is_error',
            'mcp_initialize_version','mcp_inventory_cursor','mcp_inventory_tools','mcp_inventory_count','mcp_inventory_query_tool',
            'mcp_ready','mcp_initialize','mcp_inventory','ingest','retained_metrics',
            'trace_log','mcp_read','finite_gateway','viewer_admin_denial','viewer_revoke','viewer_revoked_denial'}
    categories={'ControlFailure','RuntimeError','TimeoutError','ConnectionRefusedError','ConnectionResetError',
                'RemoteDisconnected','JSONDecodeError','OSError','BrokenPipeError','ValueError'}
    transports={'none','mcp_http','query_v5','register','session','roles','reader_identity','revoke','service_account_setup'}
    result=[]
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path=directory/'inside-failure.json'
        if not path.exists():continue
        row=read(path);require(type(row) is dict and set(row)=={'inside_failed','stage','category','http_status','transport'}
            and type(row['inside_failed']) is int and row['inside_failed']==1)
        result.append({'stage':row['stage'] if type(row['stage']) is str and row['stage'] in stages else 'unavailable',
            'category':row['category'] if type(row['category']) is str and row['category'] in categories else 'unavailable',
            'transport':row['transport'] if type(row['transport']) is str and row['transport'] in transports else 'unavailable',
            'http_status':integer(row['http_status'],599)})
    return {'available':bool(result),'samples':result}


def inner_command(value):
    """Optional closed numeric evidence; malformed context never invents zeros."""
    try:
        fields={'command_class','timeout_seconds','elapsed_seconds','native_exit','alive_before_reap'}
        require(type(value) is dict and set(value) in (fields,fields|{'disk_helper_stage'}))
        require(type(value['command_class']) is str and value['command_class'] in lifecycle.RAW_COMMAND_CLASSES)
        timeout=number(value['timeout_seconds'],690);require(timeout>0)
        elapsed=number(value['elapsed_seconds'],690)
        code=value['native_exit'];require(code is None or type(code) is int and -128<=code<=255)
        alive=boolean(value['alive_before_reap']);require(alive==(code is None))
        result={'available':True,'command_class':value['command_class'],'timeout_seconds':timeout,
                'elapsed_seconds':elapsed,'native_exit':code,'alive_before_reap':alive}
        if 'disk_helper_stage' in value:
            require(value['command_class']=='disk_exec')
            stage=value['disk_helper_stage']
            result['disk_helper_stage']=stage if type(stage) is str and stage in lifecycle.DISK_HELPER_STAGES else 'unknown'
        return result
    except Exception:return {'available':False}


def storage_monitor(value):
    require(type(value) is dict and type(value.get('monitor_failed')) is bool)
    failed=value['monitor_failed'];rows=value.get('failure')
    require(type(rows) is list and len(rows)<=1 and bool(rows)==failed)
    first=None;command={'available':False}
    if failed:
        row=rows[0];require(type(row) is dict)
        stage=row.get('stage');reason=row.get('reason')
        first={'stage':stage if type(stage) is str and stage in lifecycle.StorageMonitorStage else 'unknown',
               'reason':reason if type(reason) is str and reason in lifecycle.StorageMonitorReason else 'unknown'}
        command=inner_command(row.get('inner_command'))
    finalization=value.get('finalization_stage')
    require(type(finalization) is str and finalization in ('complete','cancel_children','monitor_join','monitor_not_reaped'))
    return {'available':True,'failed':failed,'first_failure':first,'first_inner_command':command,
            'monitor_reaped':boolean(value.get('monitor_reaped')),'finalization_stage':finalization}


def images(value):
    require(type(value) is dict and set(value) == set(lifecycle.SERVICES))
    lock = lifecycle.verify_packet(); rows = {r['repository'].split('/')[-1]: r for r in lock['images']}
    proofs=lifecycle.image_proof.load(lifecycle.CONFIG/'oci',lock)
    result = {}
    for role, row in value.items():
        require(type(row) is dict); pin = rows[lifecycle.ROLE_IMAGES[role]]
        config = proofs[pin['pinned']].config_digest
        require(row.get('reference') == pin['pinned'] and row.get('architecture') == 'amd64'
                and row.get('child_manifest') == pin['linux_amd64_manifest']
                and row.get('runtime_reference') == lifecycle.image_proof.runtime_reference(pin)
                and row.get('config_digest') == config)
        require(type(row.get('image_descriptor_available')) is bool)
        container=row.get('container_descriptor_available')
        require(container is None or type(container) is bool)
        require(row.get('relation') in ('config_id','child_id'))
        expected=config if row['relation']=='config_id' else pin['linux_amd64_manifest']
        require(row.get('image_id')==row.get('selected_image_id')==expected)
        if row['relation']=='child_id':require(row['image_descriptor_available'] and container is not False)
        row={**row,'container_descriptor_available':container}
        result[role] = {k: row[k] for k in ('reference','runtime_reference','config_digest','relation',
            'image_descriptor_available','container_descriptor_available','architecture','child_manifest','image_id','selected_image_id')}
    return {'available': True, 'container_bindings_complete':all(type(r['container_descriptor_available']) is bool for r in result.values()),'roles': result}


def storage(value):
    require(type(value) is dict and type(value.get('host')) is dict and type(value.get('vm')) is dict)
    host = value['host']['filesystems']; require(type(host) is dict and 1 <= len(host) <= 3)
    rows = [{'total_bytes': integer(v['total_bytes']), 'free_bytes': integer(v['free_bytes'])} for v in host.values()]
    require(all(0 <= r['free_bytes'] <= r['total_bytes'] and r['total_bytes'] > 0 for r in rows))
    vm = {k: integer(value['vm'][k]) for k in ('fsid', 'device', 'block', 'blocks', 'available', 'files', 'free_files')}
    require(vm['block'] > 0 and 0 <= vm['available'] <= vm['blocks'])
    return {'available': True, 'host_filesystems': rows, 'vm': vm}


def isolation(value):
    require(type(value) is dict and set(value)=={'schema','network_mode','namespace_inode','host_namespace_inode','backend_namespace_inode','socket_identity'})
    require(value['schema']==1 and type(value['schema']) is int and value['network_mode']=='none')
    namespaces={k:integer(value[k]) for k in ('namespace_inode','host_namespace_inode','backend_namespace_inode')}
    require(all(v>0 for v in namespaces.values()) and len(set(namespaces.values()))==3)
    identity=value['socket_identity'];require(type(identity) is dict and set(identity)==agent_probe.IDENTITY_FIELDS)
    identity={k:integer(v) for k,v in identity.items()}
    require(identity['inode']>0 and identity['links']==1 and identity['mode']==0o600)
    return {'available':True,'network_mode':'none',**namespaces,'socket_identity':identity}


def agent(value):
    require(type(value) is dict and set(value)==agent_probe.RESULT_FIELDS)
    require(type(value['nonce']) is str and re.fullmatch('[a-f0-9]{32}',value['nonce']) is not None)
    numbers={k:integer(v) for k,v in value.items() if k!='nonce'}
    require(numbers['schema']==1 and numbers['reads']==4 and numbers['gateway_denials']==9
        and numbers['backend_denials']==sum(len(v) for v in agent_probe.ENDPOINTS.values())
        and numbers['filesystem_isolated']==1 and numbers['namespace_inode']>0 and numbers['socket_inode']>0
        and sum(numbers[k] for k in ('dns_noname','dns_unavailable','dns_resolved'))==1)
    return {'available':True,**numbers}


def identities(output):
    result = []
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path = directory / 'identity.json'
        if not path.exists(): continue
        row = read(path); require(type(row) is dict)
        result.append({k: digest(row[k]) for k in ('cli_sha256', 'compose_sha256', 'daemon_sha256', 'endpoint_sha256')})
    return {'available': bool(result), 'samples': result}


def operation_fields(row):
    pair=(row.get('operation'),row.get('argument_category'))
    require(all(type(v) is str for v in pair) and pair in lifecycle.NATIVE_OPERATIONS)
    return dict(zip(('operation','argument_category'),pair))


def native_operations(output):
    result=[]
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path=directory/'native-operation.json'
        if not path.exists():continue
        row=read(path);require(type(row) is dict and set(row)=={'operation','argument_category','status'})
        require(type(row['status']) is str and row['status'] in ('started','succeeded','failed'))
        result.append({**operation_fields(row),'status':row['status']})
    return {'available':bool(result),'samples':result}


def native_failures(output):
    result = []
    for directory in sorted(output.glob('engine-*'))[:32]:
        require(directory.is_dir() and not directory.is_symlink())
        path = directory / 'failure.json'
        if not path.exists(): continue
        row = read(path); require(type(row) is dict)
        code = row.get('native_exit'); require(code is None or type(code) is int and -128 <= code <= 255)
        item = {'native_exit': code, 'alive_before_reap': boolean(row['alive_before_reap'])}
        item.update(operation_fields(row))
        require(type(row.get('stderr_category')) is str and row['stderr_category'] in lifecycle.STDERR_CATEGORIES)
        item['stderr_category']=row['stderr_category']
        for stream in ('stdout', 'stderr'):
            item[stream + '_bytes'] = integer(row[stream + '_bytes'], lifecycle.OUTPUT_LIMIT + 65536)
            item[stream + '_retained_bytes'] = integer(row[stream + '_retained_bytes'], 32768)
            item[stream + '_sha256'] = digest('sha256:' + row[stream + '_sha256'])
        result.append(item)
    return {'available': bool(result), 'samples': result}


def resource_profile(value,source,owner,plan,profile_id):
    profile=lifecycle.plan_profile(plan,profile_id)
    require(type(value) is dict and set(value)=={'schema','profile_id','inspection_stage','source_sha','source_tree','roles'})
    require(type(value['schema']) is int and value['schema']==1)
    require(type(value['inspection_stage']) is str and value['inspection_stage'] in ('admission','final'))
    require(value['profile_id']==source['profile_id']==owner['profile_id']==profile_id)
    require(all(type(value[k]) is str and re.fullmatch('[a-f0-9]{40}',value[k]) for k in ('source_sha','source_tree')))
    require(value['source_sha']==owner['source_sha']==source['commit'] and value['source_tree']==owner['source_tree']==source['tree'])
    roles=value['roles'];require(type(roles) is dict and set(roles)==set(lifecycle.SERVICES))
    for role,(cpu,memory) in profile['budgets'].items():
        row=roles[role];require(type(row) is dict and set(row)=={'memory_bytes','memory_swap_bytes','nano_cpus','pids_limit'})
        require(all(type(v) is int for v in row.values()))
        require(row=={'memory_bytes':memory*1024**2,'memory_swap_bytes':memory*1024**2,
                      'nano_cpus':round(cpu*10**9),'pids_limit':128})
    observed=sum(row['memory_bytes'] for row in roles.values())
    require(observed==profile['aggregate_memory_bytes'])
    return {'available':True,**value,'observed_aggregate_memory_bytes':observed,
            'configured_aggregate_memory_bytes':profile['aggregate_memory_bytes'],
            'experimental_ceiling_memory_bytes':profile['experimental_ceiling_bytes']}


def collect(output, destination, verify_source, *, profile_id=lifecycle.BASELINE_PROFILE):
    profile=lifecycle.resource_profile(profile_id)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {'schema': 2, 'profile_id':profile_id, 'passed': False, 'functional_only': True, 'capacity_acceptance': False,
              'aggregate_cpu_limit': 2, 'aggregate_memory_bytes':profile['aggregate_memory_bytes'],
              'experimental_ceiling_memory_bytes':profile['experimental_ceiling_bytes'],
              'runtime_limit_seconds': 600, 'cleanup_limit_seconds': 90}
    safe_root = output.is_dir() and not output.is_symlink()
    contracts = {'outcome': lambda value:outcome(value,profile_id), 'cleanup': cleanup, 'functional': functional, 'postgres': postgres,
                 'states': states, 'failure': failure, 'images': images, 'disk-admission': storage,
                 'recovery-cleanup':cleanup,'recovery-states':states,'isolation':isolation,'agent':agent}
    for name, project in contracts.items():
        try:
            require(safe_root); report[name] = project(read(output / (name + '.json')))
        except Exception: report[name] = {'available': False}
    report['failure']['absent']=safe_root and not (output/'failure.json').exists() and not (output/'failure.json').is_symlink()
    try:
        require(safe_root);report['storage_monitor']=storage_monitor(read(output/'disk-last.json'))
    except Exception:report['storage_monitor']={'available':False}
    try:
        require(safe_root); source = read(output / 'source.json'); verify_source(source)
        report['source'] = {'available': True, 'binding': source}
    except Exception: report['source'] = {'available': False}
    try:
        require(safe_root and report['source']['available'])
        owner=read(output/'owner.json');plan=read(output/'compose.json')
        require(owner['plan_sha256']==lifecycle.digest(output/'compose.json'))
        report['resource_profile']=resource_profile(read(output/'resource-profile.json'),report['source']['binding'],owner,plan,profile_id)
    except Exception:report['resource_profile']={'available':False}
    for name, project in (('native_identity', identities), ('native_failures', native_failures),('native_operations',native_operations),('inside_failures',inside_failures)):
        try:
            require(safe_root); report[name] = project(output)
        except Exception: report[name] = {'available': False}
    report['passed'] = all(report[k]['available'] for k in ('source', 'resource_profile', 'outcome', 'cleanup', 'functional', 'postgres', 'states', 'images', 'disk-admission', 'native_identity','isolation','agent')) and (
        report['outcome'].get('passed') is True and report['cleanup'].get('passed') is True
        and report['resource_profile'].get('inspection_stage')=='final'
        and report['images'].get('container_bindings_complete') is True
        and report['cleanup'].get('exact_containers')==len(lifecycle.SERVICES)
        and report['cleanup'].get('exact_volumes')==len(lifecycle.VOLUMES)
        and report['cleanup'].get('exact_networks')==1
        and report['failure'].get('absent') is True
        and report['states'].get('healthy') is True
        and report['agent']['namespace_inode']==report['isolation']['namespace_inode']
        and report['agent']['socket_inode']==report['isolation']['socket_identity']['inode']
        and report['agent']['socket_device']==report['isolation']['socket_identity']['device']
        and report['postgres'].get('counts', {}).get('applied_migrations', 0) > 0)
    lifecycle.private_json(destination / 'witness.json', report)
    return report['passed']
