"""A native BuildKit cache discriminator; run only with an authorized local build slot."""
import argparse
import importlib
import math
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
run_owned = importlib.import_module("local-build-context-smoke").run_owned
CONTEXT = "desktop-linux"


def dependency_fixture(dockerfile):
    """Retain the real base/environment/COPY ancestry, replacing expensive RUN work."""
    prefix = dockerfile.split('FROM dependencies AS development', 1)[0]
    instructions = [line.strip() for line in re.sub(r'\\\n\s*', ' ', prefix).splitlines()
                    if line.strip() and not line.strip().startswith('#')]
    result = []
    for instruction in instructions:
        if instruction.startswith('RUN mkdir /corepack'):
            result.append('RUN mkdir /corepack && chown node:node /corepack')
        elif instruction.startswith('RUN --mount='):
            assert 'pnpm install --frozen-lockfile' in instruction
            # Same environment and copied inputs; no pnpm/network/cache-mount mutation.
            result.append('RUN test "$COREPACK_HOME" = /corepack '
                          '&& printf dependency-executed > /workspace/dependency-marker')
        else:
            if instruction.startswith('RUN '):
                assert instruction == 'RUN chown node:node /workspace', 'Unexpected fixture RUN'
            result.append(instruction)
    result.insert(1, 'COPY cache-nonce /cache-nonce')
    result.extend(['FROM scratch AS proof',
                   'COPY --from=dependencies /workspace/dependency-marker /dependency-marker'])
    return result


def marker_cached(log):
    header = re.search(r'^(#\d+) .*RUN test "\$COREPACK_HOME" = /corepack.*$', log, re.M)
    assert header, 'Missing dependency marker RUN'
    return re.search(r'^' + re.escape(header[1]) + r' CACHED$', log, re.M) is not None


def capture_owned(command, budget, label):
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        status = run_owned(command, budget, stdout=stdout.fileno(), stderr=stderr.fileno(), label=label)
        stdout.seek(0)
        stderr.seek(0)
        output, error = stdout.read().decode(), stderr.read().decode()
    sys.stderr.write(error)
    return status, output, error


def local_base_preflight(base):
    budget = float(os.environ.get('LOCAL_DEPENDENCY_PREFLIGHT_TIMEOUT_SECONDS', '5'))
    if not math.isfinite(budget) or not 0 < budget <= 5:
        raise ValueError('Dependency metadata budget must be positive and at most 5 seconds')
    docker = ['docker', '--context', CONTEXT]
    status, endpoint, _ = capture_owned(docker + ['context', 'inspect', CONTEXT,
                                                '--format', '{{.Endpoints.docker.Host}}'], budget,
                                        'Dependency context preflight')
    if status:
        return status
    if not endpoint.strip().startswith('unix://'):
        raise ValueError('Dependency fixture requires a local Unix-socket Engine')
    status, builder, _ = capture_owned(docker + ['buildx', 'inspect', CONTEXT], budget,
                                       'Dependency builder preflight')
    if status:
        return status
    if (re.findall(r'^Driver:\s*(\S+)\s*$', builder, re.M) != ['docker'] or
            re.findall(r'^Endpoint:\s*(\S+)\s*$', builder, re.M) != [CONTEXT]):
        raise ValueError('Dependency fixture requires one Engine-backed builder for the same context')
    status, _, _ = capture_owned(docker + ['image', 'inspect', base], budget,
                                 'Dependency immutable-base preflight')
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_web', type=Path, help='Preserved pre-fix Web Dockerfile bytes')
    args = parser.parse_args()
    dockerfiles = [ROOT / 'apps/backend/Dockerfile', args.baseline_web,
                  ROOT / 'apps/web/Dockerfile']
    fixtures = [dependency_fixture(path.read_text()) for path in dockerfiles]
    bases = [fixture[0].split(' AS ')[0].removeprefix('FROM ') for fixture in fixtures]
    assert len(set(bases)) == 1 and '@sha256:' in bases[0], 'Immutable base mismatch'
    # No fallback/acquisition here: a distinct grant must provide the exact pinned base first.
    status = local_base_preflight(bases[0])
    if status:
        return status
    with tempfile.TemporaryDirectory(prefix='platform-dependency-cache-') as directory:
        context = Path(directory)
        (context / 'cache-nonce').write_text(context.name)
        # Synthetic bytes in the exact real COPY paths keep this fixture tiny and private-free.
        for instructions in fixtures:
            for instruction in instructions:
                if not instruction.startswith('COPY --chown='):
                    continue
                for source in shlex.split(instruction)[2:-1]:
                    path = context / source
                    if path.suffix or path.name == 'pnpm-lock.yaml':
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text('dependency input fixture\n')
                    else:
                        path.mkdir(parents=True, exist_ok=True)
                        (path / 'fixture.txt').write_text('dependency input fixture\n')
        observations = []
        for label, instructions in zip(['backend', 'baseline-web', 'fixed-web'], fixtures):
            (context / 'Dockerfile').write_text('\n'.join(instructions) + '\n')
            command = ['docker', '--context', CONTEXT, 'buildx', 'build', '--builder', CONTEXT,
                       '--network=none', '--pull=false', '--progress=plain', '--output',
                       'type=local,dest=' + str(context / ('output-' + label)), str(context)]
            status, output, error = capture_owned(command, 60, 'Dependency marker build')
            sys.stdout.write(output)
            if status:
                return status
            assert (context / ('output-' + label) / 'dependency-marker').read_text() == 'dependency-executed'
            observations.append(marker_cached(error))
        assert observations == [False, False, True], (
            'Expected cold backend, split baseline Web, then shared fixed Web: ' + str(observations))
        print('BuildKit dependency marker: backend executed; baseline Web duplicated; fixed Web reused.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
