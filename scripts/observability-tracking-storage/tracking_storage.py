#!/usr/bin/env python3
"""One genuine API/PG/timer tracking success through pinned disposable Alloy/VM/VT."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import urllib.parse

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'observability-pilot'))
sys.path.insert(0,str(HERE.parent/'observability-sdk-storage'))
import pilot
import ci
import sdk_storage
import source_status_query
import ownership
import producer_protocol
import api_progress
import producer_phase
import unexpected_keys
import tracking_oracle
import diagnostics

SCOPE='One genuine production API/PG carrier/real timer/API-owned SDK tracking success through pinned storage; no retry/crash or capacity acceptance'
ARTIFACTS=('evidence.json','cleanup.json','worker-outcome.json','tracking-storage.json','runtime-modules.json','recovery.json','tracking-cleanup.json',diagnostics.NAME,api_progress.NAME,producer_phase.NAME,unexpected_keys.NAME)
STORAGE_SECONDS=60


def source_inputs():
    selected=set(sdk_storage.source_inputs())
    paths=ci.read_command(['git','-C',str(pilot.ROOT),'ls-files']).splitlines()
    selected.update(pilot.ROOT/name for name in paths if name.startswith('scripts/observability-tracking-storage/') or name in (
        'scripts/observability-tracking-storage.test.mjs','.github/workflows/observability-tracking-storage.yml',
        'apps/backend/test/support/proof-dependencies.ts','scripts/observability-umami/process-owner.mjs',
        'scripts/process-group-signal.mjs'))
    return tuple(sorted(selected))


def trace_response(compose,targets,trace_id,*,budget):
    with source_status_query._deadline(budget):
        if re.fullmatch(r'[0-9a-f]{32}',trace_id) is None: raise ValueError()
        deadline=time.monotonic()+budget
        pilot.assert_docker_identity(deadline=deadline)
        target=targets.targets['gateway']
        current=pilot.command(compose+['ps','-q','gateway'],timeout=max(.001,deadline-time.monotonic())).strip()
        if current != target['id'] or targets.inspect('gateway',current) != target: raise RuntimeError()
        query=urllib.parse.urlencode({'query':'trace_id:="'+trace_id+'"','limit':69,'timeout':'2s'})
        url='http://traces:10428/select/logsql/query?'+query
        raw=pilot.command(['docker','exec',current,'sh','-euc',
            "set -o pipefail; wget -q -T 3 -O - '"+url+"' | head -c 1048577"],timeout=max(.001,deadline-time.monotonic()))
        if len(raw.encode()) > 1048576: raise diagnostics.ResponseDecode()
        return raw


def producer_observation(output, *, environment, diagnostic, observation=None):
    source=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    unexpected_keys.bind_source(observation,source)
    with api_progress.OwnedProgress(output,scope='tracking',source=source) as progress:
        with producer_phase.OwnedTrackingPhase(output,source=source) as phase:
            wire=producer_protocol.capture(environment=phase.environment(progress.environment(environment)),diagnostic=diagnostic)
    diagnostic.start('witness')
    try:
        observed=producer_protocol.witness(wire)
    except Exception as error:
        diagnostic.fail(producer_protocol.witness_reason(error) if isinstance(error,(ValueError,TypeError,KeyError)) else 'unknown'); raise
    diagnostic.start('module_projection')
    try:
        module_artifact={'schema':1,'sha256':observed['runtime_modules']}
        if len((json.dumps(module_artifact,indent=2)+'\n').encode()) > ci.PUBLIC_ARTIFACT_MAX_BYTES: raise ValueError()
    except Exception:
        diagnostic.fail('module_projection'); raise
    diagnostic.start('module_write')
    try:
        pilot.write_json(output/'runtime-modules.json',module_artifact)
    except Exception:
        diagnostic.fail('write_failure'); raise
    diagnostic.observed(True)
    return observed


def stored_metrics_and_traces(*, token, compose, targets, observed, result, diagnostic, observation=None):
    """The tracking owner's unchanged full raw gates, reconciliation and visibility budget."""
    deadline=time.monotonic()+STORAGE_SECONDS
    attempts=0; metrics=traces=None
    while time.monotonic()<deadline:
        attempts+=1
        result['stage']='stored_metrics'
        diagnostic.start('metric_query')
        diagnostic.attempt()
        try:
            raw_metrics=sdk_storage.metric_response(token,budget=min(10,max(.001,deadline-time.monotonic())))
        except Exception as error:
            diagnostic.fail(diagnostics.query_reason(error)); raise
        diagnostic.start('metric_validation')
        try:
            metrics=tracking_oracle.metrics(raw_metrics)
        except Exception as error:
            diagnostic.fail(diagnostics.oracle_reason(error)); raise
        diagnostic.observed(metrics)
        result['metrics_state']='passed' if metrics is not None else 'pending'
        result['stage']='stored_traces'
        diagnostic.start('trace_query')
        try:
            raw_traces=trace_response(compose,targets,observed['trace_id'],budget=min(10,max(.001,deadline-time.monotonic())))
        except Exception as error:
            diagnostic.fail(diagnostics.query_reason(error)); raise
        diagnostic.start('trace_validation')
        try:
            traces=tracking_oracle.traces(raw_traces,trace_id=observed['trace_id'],root_id=observed['root_id'],observation=observation)
        except Exception as error:
            diagnostic.fail(diagnostics.oracle_reason(error,scope='tracking')); raise
        diagnostic.observed(traces)
        result['traces_state']='passed' if traces is not None else 'pending'
        if metrics is not None and traces is not None:
            diagnostic.start('reconciliation')
            if all(metrics['dependency_counts']['postgresql:'+operation] == count for operation,count in traces['postgresql_counts'].items()):
                diagnostic.observed(True); break
            if any(metrics['dependency_counts']['postgresql:'+operation] < count for operation,count in traces['postgresql_counts'].items()):
                diagnostic.fail('oracle_refusal'); raise RuntimeError()
            diagnostic.observed(None)
        time.sleep(pilot.POLL_INTERVAL_SECONDS)
    else:
        diagnostic.start('visibility'); diagnostic.fail('deadline'); raise TimeoutError()
    if metrics is None or traces is None:
        diagnostic.start('visibility'); diagnostic.fail('deadline'); raise TimeoutError()
    return metrics, traces, attempts


def worker(output):
    with unexpected_keys.create(output) as observation:
        owner=json.loads((output/'owner.json').read_text())
        if owner['supervisor_pid'] != os.getppid(): raise RuntimeError()
        compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
        result={'state':'incomplete','scope':SCOPE,'stage':'acquisition'}
        started=time.monotonic()
        diagnostic=diagnostics.Diagnostic('tracking')
        diagnostic.start('acquisition')
        try:
            with pilot.worker_storage_guard(owner,compose,output):
                pilot.install_plugin(output)
                pilot.command(compose+['config','--quiet'])
                pilot.command(compose+['up','-d'],timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
                expected=ownership.plan(output)
                if json.loads((output/'compose.json').read_text()) != expected: raise RuntimeError()
                result['stage']='ownership'
                diagnostic.start('ownership')
                targets=ownership.TrackingTargets(output,compose,expected,pilot.command)
                pilot.verify_trace_store_logging(output,compose)
                for role in ('alloy','postgres'):
                    if pilot.command(['docker','inspect','--format','{{.HostConfig.LogConfig.Type}}',targets.targets[role]['id']]).strip() != 'none': raise RuntimeError()
                pilot.await_otlp_ready(output=output)
                token=source_status_query._read_private_token(output)
                pilot.await_fact(lambda:pilot.request('/metrics/api/v1/query?query=1',token=token),lambda row:row[0]==200,output=output,probe='tracking_storage_query_ready')
                def pg_ready():
                    pilot.assert_docker_identity()
                    try:
                        pilot.command(['docker','exec',targets.postgres(),'pg_isready','-U','tracking','-d','tracking'],timeout=3)
                        return True
                    except Exception:
                        return False
                pilot.await_fact(pg_ready,lambda ready:ready,output=output,probe='tracking_postgresql_ready')
                result['stage']='producer'
                # No ambient exporter/header/client-certificate credentials or process bootstrap options.
                environment={key:os.environ[key] for key in ('PATH','HOME') if key in os.environ}
                environment.update({'INSIDE_OTEL_ENABLED':'true','INSIDE_OTEL_ENDPOINT':'http://127.0.0.1:14318','INSIDE_OTEL_SAMPLE_RATIO':'1'})
                observed=producer_observation(output,environment=environment,diagnostic=diagnostic,observation=observation)
                metrics,traces,attempts=stored_metrics_and_traces(token=token,compose=compose,targets=targets,
                    observed=observed,result=result,diagnostic=diagnostic,observation=observation)
                result.update({'state':'passed','stage':'complete','native_api_request':True,'provider_requests':2,
                    'persisted_carrier':'passed','native_timer':'passed','api_owned_sdk_shutdown':'passed',
                    'metrics':metrics,'traces':traces,'attempts':attempts,'containers':8,'volumes':5,'networks':2})
                evidence=json.loads((output/'evidence.json').read_text());evidence['status']='passed: one genuine API tracking success composition only'
                pilot.write_json(output/'evidence.json',evidence)
                diagnostic.start('complete')
        except BaseException as error:
            diagnostic.fail('interrupted' if isinstance(error,KeyboardInterrupt) else 'unknown')
            raise
        finally:
            result['duration_seconds']=time.monotonic()-started
            try:
                pilot.write_json(output/'tracking-storage.json',result)
            finally:
                diagnostic.persist(output/diagnostics.NAME)


def cleanup_proof(output):
    if not (output/'owner.json').exists(): return
    owner=json.loads((output/'owner.json').read_text())
    pilot.restore_daemon(owner)
    proof=ownership.verify_pg_absence(output,owner['project'])
    pilot.write_json(output/'tracking-cleanup.json',proof)
    if proof['outcome'] != 'passed': raise RuntimeError()


def collect(output, metadata, destination):
    projected = diagnostics.read(output/diagnostics.NAME, scope='tracking')
    source=ci.read_command(['git','-C',str(pilot.ROOT),'rev-parse','HEAD'])
    if producer_phase.source_from_metadata(metadata)!=source:
        raise ValueError('closed tracking phase refused')
    phase=api_progress.read(output/api_progress.NAME,scope='tracking',source=source)
    producer_observation=producer_phase.load_for_collection(output,source=source)
    unexpected=producer_phase.read_unexpected_keys(output/unexpected_keys.NAME,source=source)
    if unexpected['state']=='observed' and (projected['phase'],projected['outcome'],projected['reason'])!=('trace_validation','failed','trace_gate_06_unexpected_key'):
        raise ValueError(unexpected_keys.MESSAGE) from None
    ci.collect(output, metadata, destination, artifacts=tuple(name for name in ARTIFACTS if name not in (diagnostics.NAME,api_progress.NAME,producer_phase.NAME,unexpected_keys.NAME)))
    diagnostics.write(destination/diagnostics.NAME, projected, scope='tracking')
    api_progress.write(destination/api_progress.NAME,phase,scope='tracking',source=source)
    producer_phase.write(destination/producer_phase.NAME,producer_observation,source=source)
    producer_phase.write_unexpected_keys(destination/unexpected_keys.NAME,unexpected,source=source)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('admission','run','worker','recover','collect'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--metadata',type=Path)
    parser.add_argument('--public',type=Path)
    args=parser.parse_args();output=args.output.resolve()
    if args.action=='admission': return ci.admission(args.metadata,inputs=source_inputs(),scope=SCOPE)
    if args.action=='run':
        # Mac storage-probe adds another service: this independent hosted scope is Linux only.
        if sys.platform != 'linux': raise RuntimeError()
        try:
            pilot.run(output,prepare_inputs=ownership.prepare,worker_script=Path(__file__).resolve(),
                ports=(18427,14318,13000,15432),services=ownership.SERVICES,scope=SCOPE,
                missing=['tracking failures/retries/crash/rootless/OFF/503 through storage','other production verticals','resource/cost acceptance','production and seven days'])
        finally:
            if (output/'cleanup.json').exists(): cleanup_proof(output)
    elif args.action=='worker': worker(output)
    elif args.action=='recover':
        ci.recover(output,services=ownership.SERVICES)
        cleanup_proof(output)
    else: collect(output,args.metadata,args.public)
    return 0


def cli():
    def interrupted(_signum,_frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try: return main()
    except KeyboardInterrupt: return 130
    except Exception:
        print('tracking-storage: closed boundary failure; inspect curated outcomes',file=sys.stderr)
        return 1


if __name__=='__main__': sys.exit(cli())
