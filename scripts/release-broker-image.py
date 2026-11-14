#!/usr/bin/env python3
"""Read an immutable broker identity from the exact, bounded release runtime archive."""
import gzip
import io
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

MEMBERS = {'compose.production.yaml', 'bin/deploy-release', 'caddy/maintenance.caddy', 'caddy/platform.caddy'}


def main():
    if len(sys.argv) != 3:
        raise ValueError('expected runtime archive and sha256 digest')
    archive = Path(sys.argv[1])
    if archive.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('runtime archive exceeds size limit')
    digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != sys.argv[2]:
        raise ValueError('runtime archive digest mismatch')
    compose = None
    names = set()
    # Bound decompression before tarfile parses even PAX/GNU headers.
    expanded = bytearray()
    with gzip.open(archive, 'rb') as compressed:
        while chunk := compressed.read(64 * 1024):
            expanded.extend(chunk)
            if len(expanded) > 16 * 1024 * 1024:
                raise ValueError('expanded runtime archive exceeds size limit')
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r|') as source:
        for item in source:
            if item.name not in MEMBERS or item.name in names or len(names) >= 4:
                raise ValueError('unexpected runtime archive members')
            if not item.isfile() or item.size > 2 * 1024 * 1024 or item.issparse():
                raise ValueError('invalid runtime archive member')
            names.add(item.name)
            if item.name == 'compose.production.yaml':
                compose = source.extractfile(item).read()
        if names != MEMBERS:
            raise ValueError('unexpected runtime archive members')
    with tempfile.TemporaryDirectory(prefix='inside-release-broker-') as directory:
        path = Path(directory) / 'compose.production.yaml'
        path.write_bytes(compose)
        result = subprocess.run(['docker', 'compose', '--project-name', 'inside-release', '--file', str(path),
                                 'config', '--no-interpolate', '--no-env-resolution', '--no-consistency', '--format', 'json'],
                                check=True, capture_output=True, text=True, timeout=30)
    config = json.loads(result.stdout)
    services = config['services']
    image = None if 'rabbitmq' not in services else services['rabbitmq'].get('image')
    if 'rabbitmq' in services and (not isinstance(image, str) or not re.fullmatch(r'[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}', image)):
        raise ValueError('expected immutable broker image')
    print(json.dumps(image))


if __name__ == '__main__':
    main()
