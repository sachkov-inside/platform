"""Bounded child-only Engine read; no socket or privileged cgroup mount enters a container."""
import http.client
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import measurements
import profile as resource_profile

MAX_BYTES = 1_048_576
SOCKET_SECONDS = 1


def fetch(endpoint, container):
    if not endpoint.startswith('unix:///') or not re.fullmatch(r'[a-f0-9]{64}', container):
        raise ValueError('closed_engine_read')
    started = time.monotonic()
    connection = http.client.HTTPConnection('localhost', timeout=SOCKET_SECONDS)
    connection.sock = socket.socket(socket.AF_UNIX)
    connection.sock.settimeout(SOCKET_SECONDS)
    try:
        connection.sock.connect(endpoint[len('unix://'):])
        connection.request('GET', '/v1.51/containers/' + container + '/stats?stream=false&one-shot=true', headers={'Connection':'close'})
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError('engine_status')
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError('engine_size')
        return {'counters': measurements.engine(json.loads(body)), 'started': started, 'finished': time.monotonic()}
    finally:
        connection.close()


def main(output, ids):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-pilot'))
    import pilot
    owner = json.loads((output / 'owner.json').read_text())
    worker = json.loads((output / 'worker.json').read_text())
    if (not isinstance(owner,dict) or not isinstance(worker,dict)
            or owner.get('cwd')!=str(resource_profile.ROOT) or not isinstance(owner.get('project'),str)
            or not re.fullmatch(re.escape(resource_profile.PROJECT_PREFIX)+r'[0-9a-f]{12}',owner['project'])
            or worker.get('pid')!=os.getppid() or worker.get('group')!=os.getppid() or os.getpgrp()!=os.getppid()):
        raise RuntimeError('engine_child_requires_registered_worker')
    # Current identity must match the recorded one before any Engine access.
    pilot.restore_daemon(owner)
    if not isinstance(ids, list) or not 1 <= len(ids) <= 12 or any(not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{64}',value) for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('engine_container_set')
    endpoint = pilot.FROZEN_DOCKER_ENDPOINT
    result = {}
    for container in ids:
        try:
            result[container] = fetch(endpoint, container)
        except (OSError, ValueError, RuntimeError, http.client.HTTPException):
            result[container] = measurements.engine({})
    pilot.assert_docker_identity()
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]), json.loads(sys.argv[2]))
    except (OSError, ValueError, RuntimeError, http.client.HTTPException):
        print('resource-engine: failed', file=sys.stderr)
        sys.exit(1)
