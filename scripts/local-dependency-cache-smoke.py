"""A native BuildKit cache discriminator; run only with an authorized local build slot."""
import argparse
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_web', type=Path, help='Preserved pre-fix Web Dockerfile bytes')
    args = parser.parse_args()
    dockerfiles = [ROOT / 'apps/backend/Dockerfile', args.baseline_web,
                  ROOT / 'apps/web/Dockerfile']
    fixtures = [dependency_fixture(path.read_text()) for path in dockerfiles]
    bases = [fixture[0].split(' AS ')[0].removeprefix('FROM ') for fixture in fixtures]
    assert len(set(bases)) == 1 and '@sha256:' in bases[0], 'Immutable base mismatch'
    # Do not acquire a missing base. The coordinator must provide an existing immutable local base.
    available = subprocess.run(['docker', 'image', 'inspect', bases[0]],
                               stdout=subprocess.DEVNULL, check=False)
    if available.returncode != 0:
        return available.returncode
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
            command = [sys.executable, str(ROOT / 'scripts/local-build-context-smoke.py'),
                       str(context), str(context / ('output-' + label))]
            native = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, check=False)
            sys.stdout.write(native.stdout)
            sys.stderr.write(native.stderr)
            if native.returncode != 0:
                return native.returncode
            assert (context / ('output-' + label) / 'dependency-marker').read_text() == 'dependency-executed'
            observations.append(marker_cached(native.stderr))
        assert observations == [False, False, True], (
            'Expected cold backend, split baseline Web, then shared fixed Web: ' + str(observations))
        print('BuildKit dependency marker: backend executed; baseline Web duplicated; fixed Web reused.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
