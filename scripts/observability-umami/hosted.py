"""Exact-source admission/recovery and strict public evidence for the Umami pilot."""
import argparse
from pathlib import Path
import sys
import subprocess

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/observability-pilot'))
import ci
import runtime

ARTIFACTS = ('evidence.json', 'cleanup.json', 'worker-outcome.json', 'recovery.json',
             'container-states.json', 'readiness.json', 'storage-host.json', 'storage-vm.json',
             'monitor-failure.json', 'umami-proof.json', 'umami-retention.json')


def source_inputs():
    return tuple(sorted(runtime.SCRIPTS.glob('*.py'))) + tuple(sorted(runtime.SCRIPTS.glob('*.mjs'))) + tuple(sorted(runtime.SCRIPTS.glob('*.sql'))) + tuple(sorted((runtime.SCRIPTS/'fixtures'/'foundation-2.57.0').iterdir())) + (
        ROOT / 'scripts/observability-pilot/pilot.py', ROOT / 'scripts/observability-pilot/native_cpu.py', ROOT / 'scripts/observability-pilot/ci.py',
        ROOT / 'scripts/observability-pilot/daemon.py', ROOT / 'scripts/observability-pilot/orbstack.py',
        ROOT / 'scripts/observability-pilot/storage_policy.py', ROOT / 'scripts/observability-pilot/collector_privacy.py', ROOT / 'infra/observability/pilot/probe.lock.json',
        ROOT / 'infra/production/database/Dockerfile', ROOT / 'infra/production/database/init-production-databases.sh',
        ROOT / 'infra/production/database/restore-entrypoint.sh', ROOT / 'infra/production/database/pgbackrest.conf',
        ROOT / 'infra/production/database/libpq-version.c', ROOT / 'infra/production/database/versions.json',
        runtime.CONFIG / 'recovery-cache.lock.json', runtime.CONFIG / 'inputs.lock.json', runtime.CONFIG / 'mcp/package.json', runtime.CONFIG / 'mcp/package-lock.json', runtime.CONFIG / 'schema-fixture.sql',
        ROOT / '.github/workflows/observability-umami.yml', ROOT / '.node-version',
        ROOT / 'scripts/observability-umami-startup.pg.test.mjs', ROOT / 'scripts/observability-umami-retention.pg.test.mjs', ROOT / 'scripts/observability-umami.test.mjs', ROOT / 'scripts/observability-umami-process.test.mjs',
        ROOT / 'scripts/process-group-signal.mjs',
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('admission', 'recover', 'collect'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--public', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'admission':
        return ci.admission(args.metadata, inputs=source_inputs(), scope='synthetic Umami Linux API/MCP compatibility; no production or full resource acceptance')
    if args.action == 'recover':
        ci.recover(args.output, project_prefix=runtime.PROJECT_PREFIX, services=runtime.SERVICES)
    else:
        ci.collect(args.output, args.metadata, args.public, artifacts=ARTIFACTS)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('observability-umami-hosted: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
