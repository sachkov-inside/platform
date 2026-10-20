"""Exact-source inputs and finite bounded public artifacts; private inputs are never collected."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).parent
MAX_BYTES = 1_048_576
ARTIFACTS = ('evidence.json','cleanup.json','worker-outcome.json','recovery.json','container-states.json',
             'readiness.json','storage-host.json','storage-vm.json','monitor-failure.json',
             'resource-sdk-diagnostics.json','startup-client.json','resource-source.json','resource-proof.json','resource-current.json','resource-images.json')


def inputs():
    # Conservative tracked compilation/build closure. COPY source, workspace install,
    # generated Prisma and contracts can all change the actual backend payload.
    names = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z', '--',
        'apps/backend', 'packages', 'docs/contracts', 'scripts', 'infra', 'patches',
        ':(top,glob)*.json', ':(top,glob)*.yaml', ':(top,glob)*.yml',
        'apps/web/package.json', 'apps/telegram/package.json', '.node-version', '.npmrc', '.dockerignore',
        '.github/actions/setup-platform', '.github/workflows/ci.yml', '.github/workflows/observability-resource.yml'],
        check=True, capture_output=True, timeout=10).stdout.decode().split('\0')
    return tuple(sorted(set(ROOT / name for name in names if name) |
        set(SCRIPTS.glob('*.py')) | set(SCRIPTS.glob('*.mjs')) |
        {ROOT / '.github/workflows/observability-resource.yml'}))


def write(path, value):
    encoded = json.dumps(value, indent=2, allow_nan=False) + '\n'
    if len(encoded.encode()) > MAX_BYTES:
        raise ValueError('public_artifact_budget')
    path.write_text(encoded)


def source(commit, tree):
    return {'schema':1,'commit':commit,'tree':tree,
            'inputs':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs()},
            'scope':'short proposed synthetic API SDK-only comparison; full resource acceptance pending'}
