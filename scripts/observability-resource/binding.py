"""Exact-source inputs and finite bounded public artifacts; private inputs are never collected."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).parent
MAX_BYTES = 1_048_576
ARTIFACTS = ('evidence.json','cleanup.json','worker-outcome.json','recovery.json','container-states.json',
             'readiness.json','storage-host.json','storage-vm.json','monitor-failure.json',
             'resource-source.json','resource-proof.json','resource-current.json','resource-images.json')


def inputs():
    core = ROOT / 'scripts/observability-pilot'
    config = ROOT / 'infra/observability/pilot'
    return tuple(sorted(set((*SCRIPTS.glob('*.py'), *SCRIPTS.glob('*.mjs'), *core.glob('*.py'),
        *(config / name for name in ('inputs.lock.json','probe.lock.json','config.alloy','privacy-policy.json','Caddyfile','vmauth.routes.json')),
        ROOT / 'infra/observability/resource/profile.json', ROOT / 'scripts/observability-resource.test.mjs',
        ROOT / 'scripts/observability-umami/process-owner.mjs', ROOT / 'scripts/process-group-signal.mjs',
        ROOT / 'scripts/heavy-check.sh', ROOT / 'scripts/production-runtime-configuration.sh',
        ROOT / 'scripts/production-compose-smoke.sh', ROOT / 'compose.production.yaml',
        ROOT / 'scripts/fixtures/production-runtime/compose.smoke.yaml',
        ROOT / 'scripts/fixtures/production-runtime/compose.database-smoke.yaml',
        ROOT / 'infra/production/database/Dockerfile', ROOT / 'infra/production/database/init-production-databases.sh',
        ROOT / 'apps/backend/Dockerfile', ROOT / 'apps/backend/src/infrastructure/observability/technical-telemetry.ts',
        ROOT / 'apps/backend/src/infrastructure/observability/technical-telemetry-runtime.ts',
        ROOT / 'apps/backend/src/config/platform-config.ts', ROOT / 'packages/runtime-identity/index.mjs',
        ROOT / 'pnpm-lock.yaml', ROOT / '.node-version', ROOT / '.github/workflows/ci.yml'))))


def write(path, value):
    encoded = json.dumps(value, indent=2, allow_nan=False) + '\n'
    if len(encoded.encode()) > MAX_BYTES:
        raise ValueError('public_artifact_budget')
    path.write_text(encoded)


def source(commit, tree):
    return {'schema':1,'commit':commit,'tree':tree,
            'inputs':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs()},
            'scope':'short proposed synthetic API SDK-only comparison; full resource acceptance pending'}
