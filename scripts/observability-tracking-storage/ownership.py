"""Tracking adds exactly one owned PostgreSQL container/volume to unchanged Core7."""
import json
import re
import subprocess
import time

import pilot
import source_status
import source_status_scenario

SERVICES = (*pilot.SERVICES, 'postgres')
PG_IMAGE = 'ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
# The init-only Unix server is not the final TCP endpoint used by our clients.
PG_READY_COMMAND=('pg_isready','-h','127.0.0.1','-p','5432','-t','1','-U','tracking','-d','tracking')


def plan(output):
    auth = (output/'auth.json').stat()
    images = json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images']
    result = pilot.compose_plan(pilot.CONFIG, output, images, credential_owner=(auth.st_uid,auth.st_gid))
    # Declared container limits sum to4GiB/2CPU after adding512MiB/.1CPU PG.
    # This is no measurement of the host producer, application headroom or production capacity.
    # PostgreSQL's standard entrypoint owns initial volume permissions and drops to its packaged database user.
    result['services']['postgres'] = {'image':PG_IMAGE,'mem_limit':'512m','cpus':.1,'pids_limit':128,
        'security_opt':['no-new-privileges:true'],'networks':['pilot','ingress'],
        'ports':['127.0.0.1:15432:5432'],'volumes':['postgres:/var/lib/postgresql'],
        'environment':{'POSTGRES_USER':'tracking','POSTGRES_PASSWORD':'tracking_fixture','POSTGRES_DB':'tracking',
                       'PGDATA':'/var/lib/postgresql/18/docker'},
        'command':['postgres','-c','log_statement=none','-c','log_min_messages=panic','-c','log_min_error_statement=panic'],
        'logging':{'driver':'none'}}
    result['volumes']['postgres'] = {}
    return result


def prepare(output):
    pilot.prepare(output)
    pilot.write_json(output/'compose.json',plan(output))


class TrackingTargets(source_status_scenario.OwnedTargets):
    def __init__(self, output, compose, expected, read):
        if expected != plan(output): raise RuntimeError('tracking storage plan mismatch')
        core = {**expected,'services':{key:value for key,value in expected['services'].items() if key != 'postgres'},
                'volumes':{key:value for key,value in expected['volumes'].items() if key != 'postgres'}}
        # The original strict Core7 verifier and its7/4/2 absence witness remain unchanged.
        super().__init__(output,compose,core,read)
        self.plan = expected
        cid = read(compose+['ps','-q','postgres']).strip()
        if not re.fullmatch(r'[0-9a-f]{64}',cid) or cid in {target['id'] for target in self.targets.values()}:
            raise RuntimeError('tracking PostgreSQL ownership unproved')
        target = self.inspect('postgres',cid)
        networks = self.targets['gateway']['networks']
        if target['networks'] != networks: raise RuntimeError('tracking PostgreSQL networks unproved')
        self.targets['postgres'] = target
        pilot.write_json(output/'tracking-pg-owned.json',{'project':self.project,'container':cid,
            'volume':self.project+'_postgres','networks':sorted(networks.values())})

    def postgres(self):
        target = self.targets['postgres']
        current = self.read(self.compose+['ps','-q','postgres']).strip()
        if current != target['id'] or self.inspect('postgres',current) != target:
            raise RuntimeError('tracking PostgreSQL ownership changed')
        return current


def verify_pg_absence(output, project):
    """Core recovery already checks the other7 containers/4 volumes and both network identities."""
    failed = {'outcome':'unproved'}
    try:
        path = output/'tracking-pg-owned.json'
        if path.is_symlink() or path.stat().st_size > 4096: return failed
        value = source_status.decode_json(path.read_bytes())
        if (type(value) is not dict or set(value) != {'project','container','volume','networks'}
                or value['project'] != project or re.fullmatch(r'inside-observability-pilot-[0-9a-f]{12}',project) is None
                or type(value['container']) is not str or re.fullmatch(r'[0-9a-f]{64}',value['container']) is None
                or value['volume'] != project+'_postgres' or type(value['networks']) is not list
                or len(value['networks']) != 2 or len(set(value['networks'])) != 2
                or any(type(v) is not str or re.fullmatch(r'[0-9a-f]{64}',v) is None for v in value['networks'])): return failed
        core_path=output/'source-freshness-owned.json'
        if core_path.is_symlink() or core_path.stat().st_size > 65536: return failed
        core_owner=source_status.decode_json(core_path.read_bytes())
        if (type(core_owner) is not dict or set(core_owner) != {'project','containers','volumes','networks'}
                or any(type(core_owner[key]) is not list or len(core_owner[key]) != count for key,count in (('containers',7),('volumes',4),('networks',2)))
                or core_owner.get('project') != project or set(core_owner.get('networks',[])) != set(value['networks'])
                or value['container'] in core_owner.get('containers',[]) or value['volume'] in core_owner.get('volumes',[])): return failed
        deadline = time.monotonic()+10
        for kind,identity in (('container',value['container']),('volume',value['volume'])):
            pilot.assert_docker_identity(deadline=deadline)
            remaining=deadline-time.monotonic()
            if remaining <= 0: return failed
            try: pilot.command(['docker',kind,'inspect',identity],timeout=remaining)
            except subprocess.CalledProcessError as error:
                expected = ('Error response from daemon: No such container: '+identity if kind=='container' else
                            'Error response from daemon: get '+identity+': no such volume')
                if error.returncode != 1 or (error.stdout or '').strip() not in ('','[]') or (error.stderr or '').strip() != expected: return failed
            else: return failed
        core = json.loads((output/'cleanup.json').read_text()).get('source_freshness')
        if core != {'outcome':'passed','containers':7,'volumes':4,'networks':2}: return failed
        return {'outcome':'passed','containers':8,'volumes':5,'networks':2}
    except (OSError,ValueError,KeyError,TypeError,RuntimeError,subprocess.SubprocessError): return failed
