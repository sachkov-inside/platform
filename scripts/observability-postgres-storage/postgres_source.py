#!/usr/bin/env python3
"""Prepared isolated ordinary-role PG server source; native privacy completion prerequisite remains open."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import time

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'observability-pilot'))
sys.path.insert(0,str(HERE.parent/'observability-tracking-storage'))
import pilot
import ci
import pg_ownership as ownership
import source_status_query
import record
import scenario
import privacy

SCOPE=record.SCOPE
ARTIFACTS=('evidence.json','cleanup.json','worker-outcome.json','recovery.json','postgres-source-cleanup.json',
           'collector-logging.json','postgres-source-logging.json')


def source_inputs():
    paths=ci.read_command(['git','-C',str(pilot.ROOT),'ls-files']).splitlines()
    prefixes=('apps/backend/src/','apps/backend/prisma/','packages/','docs/contracts/','patches/',
        'scripts/observability-pilot/','scripts/observability-sdk-storage/','scripts/observability-tracking-storage/',
        'scripts/observability-postgres-storage/','infra/observability/pilot/','.github/actions/setup-platform/')
    fixed=('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.node-version',
        'apps/backend/tsconfig.json','apps/backend/tsconfig.build.json','apps/backend/prisma.config.ts',
        'apps/backend/test/support/proof-dependencies.ts','scripts/heavy-check.sh',
        'scripts/observability-postgres-storage.test.mjs','scripts/observability-umami/process-owner.mjs',
        'scripts/process-group-signal.mjs','docs/runbooks/observability-pilot.md',
        '.github/workflows/observability-sdk-storage.yml','.github/workflows/observability-tracking-storage.yml',
        'scripts/observability-sdk-storage.test.mjs','scripts/observability-tracking-storage.test.mjs')
    return tuple(pilot.ROOT/name for name in sorted(paths) if name.startswith(prefixes)
                 or name.endswith('/package.json') or name.startswith('tsconfig') or name in fixed)


def oracle_owner():
    spec=importlib.util.spec_from_file_location('postgres_source_full_oracle',HERE/'oracle.py')
    if spec is None or spec.loader is None:raise ValueError('storage')
    owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)
    return owner


def worker(output):
    owner=json.loads((output/'owner.json').read_text())
    if owner['supervisor_pid']!=os.getppid():raise ValueError('ownership')
    compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
    source=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    result=record.report(source);started=time.monotonic();driver=None
    try:
        with pilot.worker_storage_guard(owner,compose,output):
            pilot.install_plugin(output);pilot.command(compose+['config','--quiet'])
            pilot.command(compose+['up','-d'],timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
            expected=ownership.plan(output)
            if json.loads((output/'compose.json').read_text())!=expected:raise ValueError('ownership')
            driver=scenario.Scenario(None,compose,None,oracle_owner())
            # The same decreasing read closure is retained for construction AND subsequent sampler checks.
            driver.clock_deadline=time.monotonic()+pilot.QUERY_TIMEOUT_SECONDS
            driver.targets=ownership.Targets(output,compose,expected,driver.read)
            for service in ('alloy','postgres'):pilot.verify_trace_store_logging(output,compose,service=service)
            driver.targets.metrics_private(driver.clock_deadline)
            pilot.await_otlp_ready(output=output)
            driver.token=source_status_query._read_private_token(output)
            pilot.await_fact(lambda:pilot.request('/metrics/api/v1/query?query=1',token=driver.token),
                             lambda row:row[0]==200,output=output,probe='postgres_source_query_ready')
            def ready():
                deadline=time.monotonic()+3;driver.verify_pg(deadline)
                try:driver.read(['docker','exec',driver.targets.targets['postgres']['id'],'pg_isready','-U','tracking','-d','tracking'])
                except Exception:return False
                return True
            pilot.await_fact(ready,lambda value:value,output=output,probe='postgres_source_pg_ready')
            result['cases']=driver.run(privacy.run)
            result.update(state='passed',phase='complete',reason='none')
    except BaseException as error:
        result['state']='failed';result['phase']=driver.phase if driver is not None else 'acquisition'
        result['reason']='query_timeout' if isinstance(error,TimeoutError) else (
            'ownership' if result['phase']=='acquisition' else 'storage' if result['phase']=='privacy' else 'query_refused')
        if driver is not None:result['cases']=driver.cases
        raise
    finally:
        result['duration_seconds']=time.monotonic()-started
        record.persist(output,result)


def cleanup_proof(output):
    if not (output/'owner.json').exists():return
    owner=json.loads((output/'owner.json').read_text());pilot.restore_daemon(owner)
    proof=ownership.verify_pg_absence(output,owner['project'])
    pilot.write_json(output/'postgres-source-cleanup.json',proof)
    if proof!={'outcome':'passed','containers':8,'volumes':5,'networks':2}:raise ValueError('cleanup')


def collect(output,metadata,destination):
    source=record.receipt(metadata)
    current=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    if source!=current:record.refuse()
    projected=record.read(output,source)
    ci.collect(output,metadata,destination,artifacts=ARTIFACTS)
    record.write(destination,projected)


def admission(metadata):
    """Create the PG-owned strict receipt privately through the unchanged shared producer."""
    previous=os.umask(0o077)
    primary=None;tb=None
    try:return ci.admission(metadata,inputs=source_inputs(),scope=SCOPE)
    except BaseException as error:
        primary,tb=error,sys.exc_info()[2]
        raise
    finally:
        try:os.umask(previous)
        except BaseException:
            if primary is None:raise
        finally:
            if primary is not None:BaseException.__traceback__.__set__(primary,tb)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('admission','run','worker','recover','collect'))
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--metadata',type=Path);parser.add_argument('--public',type=Path)
    args=parser.parse_args();output=args.output.resolve()
    if args.action=='admission':return admission(args.metadata)
    if args.action=='run':
        if sys.platform!='linux':raise ValueError('ownership')
        primary=None;tb=None
        try:
            pilot.run(output,prepare_inputs=ownership.prepare,worker_script=Path(__file__).resolve(),
                ports=(18427,14318,13000,15432),services=ownership.SERVICES,scope=SCOPE,
                missing=['PG native role/reset/restart/freshness acceptance','pinned end-to-end processing/insertion privacy completion proof',
                         'resource/cost acceptance','production and seven days'])
        except BaseException as error:primary,tb=error,sys.exc_info()[2];raise
        finally:
            try:
                if (output/'cleanup.json').exists():cleanup_proof(output)
            except BaseException:
                if primary is None:raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,tb)
    elif args.action=='worker':worker(output)
    elif args.action=='recover':ci.recover(output,services=ownership.SERVICES);cleanup_proof(output)
    else:collect(output,args.metadata,args.public)
    return 0


def cli():
    def interrupted(_signum,_frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try:return main()
    except KeyboardInterrupt:return 130
    except Exception:
        print('postgres-source: closed boundary failure; inspect curated outcomes',file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(cli())
