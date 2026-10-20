#!/usr/bin/env python3
"""Opt-in native Caddy metrics through the current owned disposable Core; production NOT_COVERED."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import artifact
import collection
import evidence
import native_asset
import native_fault
import overlay
import owned
import pilot
import ci
import scenario
import source_status_query

SCOPE='Isolated native Caddy srv0/subroute HTTP metrics and strict canonical/VM MCP reads; production Caddy NOT_COVERED; no capacity acceptance'


def source_inputs():
    paths=ci.read_command(['git','-C',str(pilot.ROOT),'ls-files']).splitlines()
    prefixes=('infra/observability/pilot/','scripts/observability-pilot/','scripts/observability-caddy-storage/','scripts/heavy-check/')
    exact={'.github/workflows/observability-caddy-storage.yml','.github/workflows/ci.yml','.github/workflows/ci-gate-recovery.yml',
           'scripts/observability-caddy-storage.test.mjs','scripts/observability-umami/process-owner.mjs',
           'scripts/process-group-signal.mjs','scripts/process-group-signal.d.mts','scripts/heavy-check.sh',
           'scripts/ci-coverage-plan.mjs','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.node-version','.npmrc',
           'docs/runbooks/observability-caddy-pilot.md','docs/runbooks/observability-pilot.md'}
    return tuple(pilot.ROOT/path for path in sorted(paths) if path.startswith(prefixes) or path in exact
        or '/' not in path and path.startswith('tsconfig') and path.endswith('.json'))


def mode():
    value=os.environ.get('CADDY_PILOT_CASE','baseline')
    if value not in native_fault.MODES:artifact.refuse()
    return value


def worker(output):
    owner=native_fault.owner(output)
    if (type(owner) is not dict or set(owner)!={'project','cwd','supervisor_pid','docker_storage','orbstack','daemon','cleanup'}
            or type(owner['supervisor_pid']) is not int or owner['supervisor_pid']!=os.getppid()
            or owner['cwd']!=str(pilot.ROOT) or type(owner['project']) is not str
            or re.fullmatch(r'inside-observability-pilot-[0-9a-f]{12}',owner['project']) is None):artifact.refuse()
    compose=['docker','compose','-p',owner['project'],'-f',str(output/'compose.json')]
    run=evidence.Run();experiment=None
    def persist():artifact.write_run(output,run.snapshot())
    def progress(kind,value):
        if kind=='phase':run.start(value)
        elif kind=='case':run.pass_case(value)
        elif kind=='failure':run.fail(value)
        else:artifact.refuse()
        persist()
    def ownership_checkpoint(role,gate):
        run.start(evidence.ownership_phase(role,gate))
        if gate in evidence.OWNERSHIP_IO:persist()
    persist()
    try:
        with pilot.worker_storage_guard(owner,compose,output):
            overlay.verify(output)  # Exact current source bytes and authority BEFORE Compose acquisition.
            pilot.install_plugin(output)
            pilot.command(compose+['config','--quiet'])
            pilot.command(compose+['up','-d'],timeout=pilot.ACQUISITION_TIMEOUT_SECONDS)
            progress('phase','ownership')
            def read(argv):
                pilot.assert_docker_identity()
                return pilot.command(argv,timeout=10)
            ownership_checkpoint(None,'plan')
            targets=owned.Targets(output,compose,overlay.plan(output),read,ownership_checkpoint=ownership_checkpoint)
            progress('case','logging')
            progress('phase','identity')
            targets.caddy_identity()
            progress('case','identity')
            native_fault.inject(mode(),owner)
            token=source_status_query._read_private_token(output)
            with native_asset.executable(output) as executable:
                experiment=scenario.Scenario(targets,token,executable,progress)
                try:
                    report=experiment.run()
                    artifact.write(output,report)
                except BaseException as error:
                    experiment.failed(error);raise
            run.finish();persist()
            outcome=json.loads((output/'evidence.json').read_text())
            outcome['status']='passed: isolated native Caddy metrics and query scope only'
            pilot.write_json(output/'evidence.json',outcome)
    except BaseException as error:
        original_traceback=sys.exc_info()[2]
        try:
            phase=run.snapshot()['phase']
            if isinstance(error,KeyboardInterrupt):reason='interrupted'
            elif phase in evidence.OWNERSHIP_PHASES:
                if type(error) in (owned.core.ScenarioFailed,ValueError):reason='contract'
                elif type(error) in (subprocess.CalledProcessError,FileNotFoundError,PermissionError,OSError):reason='transport'
                elif type(error) in (subprocess.TimeoutExpired,TimeoutError):reason='timeout'
                else:reason='unknown'
            else:reason='timeout' if isinstance(error,TimeoutError) else 'contract' if isinstance(error,ValueError) else 'unknown'
            run.fail(reason);persist()
        except BaseException:
            pass  # A terminal metadata refusal cannot replace the active primary or traceback.
        BaseException.with_traceback(error,original_traceback)
        raise
    else:persist()


def verify_cleanup(output):
    if not (output/'owner.json').exists():return
    value=native_fault.cleanup(output)
    typed=value.get('source_freshness') if type(value) is dict else None
    if (type(value) is not dict or value.get('down')!='passed' or value.get('residue')!='passed'
            or type(typed) is not dict or set(typed)!={'outcome','containers','volumes','networks'} or typed['outcome']!='passed'
            or any(type(typed[key]) is not int or typed[key]!=count for key,count in (('containers',7),('volumes',4),('networks',2)))):
        raise RuntimeError('Caddy typed resource absence unproved')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('admission','run','worker','recover','collect','verify-fault'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--metadata',type=Path)
    parser.add_argument('--public',type=Path)
    parser.add_argument('--case',choices=native_fault.MODES[1:])
    parser.add_argument('--exit-code',type=int)
    args=parser.parse_args(argv);output=args.output.resolve()
    if args.action not in ('collect','verify-fault') and sys.platform!='linux':
        raise RuntimeError('native Caddy pilot requires the owned Linux runner')
    if args.action=='admission':return ci.admission(args.metadata,inputs=source_inputs(),scope=SCOPE+'; case='+mode())
    if args.action=='run':
        mode()
        pilot.run(output,prepare_inputs=overlay.prepare,worker_script=Path(__file__).resolve(),scope=SCOPE,
            missing=['production Caddy','TCP/TLS/HTTP3 and pre-route parsing','resource/cost/capacity acceptance','seven days'])
        verify_cleanup(output)
    elif args.action=='worker':worker(output)
    elif args.action=='recover':
        ci.recover(output)
        verify_cleanup(output)
    elif args.action=='verify-fault':native_fault.verify(output,args.case,command_exit=args.exit_code)
    else:collection.collect(output,args.metadata,args.public)
    return 0


def cli():
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    try:return main()
    except KeyboardInterrupt:return 130
    except Exception:
        print('caddy-storage: closed boundary failure; inspect curated outcomes',file=sys.stderr)
        return 1


if __name__=='__main__':sys.exit(cli())
