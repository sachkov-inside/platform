#!/usr/bin/env python3
"""Isolated ordinary-role PG source with scope-bound completion and cleanup evidence."""
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
NATIVE_MISSING=('PG native role/reset/restart/freshness acceptance','pinned end-to-end processing/insertion privacy completion proof')
PENDING_MISSING=('resource/cost acceptance','production and seven days')
ARTIFACTS=('evidence.json','cleanup.json','worker-outcome.json','recovery.json','postgres-source-cleanup.json',
           'collector-logging.json','postgres-source-logging.json','postgres-upload.json','postgres-visibility.json')


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
            pilot.install_horizon(output)
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
                try:driver.read(['docker','exec',driver.targets.targets['postgres']['id'],*ownership.PG_READY_COMMAND])
                except Exception:return False
                return True
            pilot.await_fact(ready,lambda value:value,output=output,probe='postgres_source_pg_ready')
            result['cases']=driver.run(privacy.run)
            result.update(state='passed',phase='complete',reason='none')
    except BaseException as error:
        result['state']='failed';result['phase']=driver.phase if driver is not None else 'acquisition'
        result['reason']='query_timeout' if isinstance(error,TimeoutError) else (
            'ownership' if result['phase']=='acquisition' else 'storage' if result['phase']=='privacy' else 'query_refused')
        if (not isinstance(error,TimeoutError) and driver is not None
                and result['phase'] in ('baseline_first_stored_oracle','baseline_second_stored_oracle','restart_unavailable_read')
                and type(driver.oracle_failure_reason) is str and driver.oracle_failure_reason in record.ORACLE_REASONS):
            result['reason']=driver.oracle_failure_reason
        if driver is not None:result['cases']=driver.cases
        raise
    finally:
        result['duration_seconds']=time.monotonic()-started
        record.persist(output,result)
        if driver is not None and driver.upload_operation is not None:
            record.persist_upload(output,driver.upload_operation)
        if driver is not None:record.persist_visibility(output,{'schema':1,'source':source,'rows':driver.visibility,'overflow':driver.visibility_overflow},source)


def cleanup_proof(output):
    if not (output/'owner.json').exists():return
    owner=json.loads((output/'owner.json').read_text());pilot.restore_daemon(owner)
    proof=ownership.verify_pg_absence(output,owner['project'])
    pilot.write_json(output/'postgres-source-cleanup.json',proof)
    if proof!={'outcome':'passed','containers':9,'volumes':5,'networks':2}:raise ValueError('cleanup')
    return proof


def complete_evidence(output,evidence,cleanup):
    """Only completed native PG facts and this run's successful cleanup resolve PG limits."""
    source=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    result=record.read(output,source)
    if (result['state']!='passed' or type(evidence) is not dict or evidence.get('source')!=source
            or evidence.get('scope')!=SCOPE or type(evidence.get('worker_exit_code')) is not int
            or evidence['worker_exit_code']!=0 or cleanup!={'outcome':'passed','containers':9,'volumes':5,'networks':2}):record.refuse()
    shared=evidence.get('cleanup');missing=evidence.get('missing')
    if (type(shared) is not dict or any(shared.get(key)!='passed' for key in ('diagnostics','down','residue'))
            or type(shared.get('source_freshness')) is not dict or shared['source_freshness'].get('outcome')!='passed'
            or type(missing) is not list or any(type(item) is not str for item in missing)
            or any(missing.count(item)!=1 for item in (*NATIVE_MISSING,*PENDING_MISSING))):record.refuse()
    updated={**evidence,'status':'passed: isolated PostgreSQL source/privacy; resource/production acceptance pending',
        'missing':[item for item in missing if item not in NATIVE_MISSING]}
    pilot.write_json(output/'evidence.json',updated)


def collect(output,metadata,destination):
    source=record.receipt(metadata)
    current=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    if source!=current:record.refuse()
    projected=record.read(output,source)
    if (output/'postgres-upload.json').exists():record.upload_operation(record._read(output,'postgres-upload.json',1024))
    if (output/'postgres-visibility.json').exists():record.visibility(record._read(output,'postgres-visibility.json',16384),source)
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
        primary=None;tb=None;cleanup=None
        try:
            evidence=pilot.run(output,prepare_inputs=ownership.prepare,worker_script=Path(__file__).resolve(),
                ports=(18427,14318,13000,15432),services=ownership.SERVICES,scope=SCOPE,
                missing=[*NATIVE_MISSING,*PENDING_MISSING])
        except BaseException as error:primary,tb=error,sys.exc_info()[2];raise
        finally:
            try:
                if (output/'cleanup.json').exists():cleanup=cleanup_proof(output)
            except BaseException:
                if primary is None:raise
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,tb)
        complete_evidence(output,evidence,cleanup)
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
