"""Freeze the local Linux Docker socket, context, daemon and storage identity."""
import json
import os
from pathlib import Path
import stat


def identify(command):
    if any(os.environ.get(key) for key in ('DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')):
        raise RuntimeError('Docker endpoint overrides unsupported for Linux admission')
    context = command(['docker', 'context', 'show']).strip()
    endpoint = command(['docker', 'context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']).strip()
    if not endpoint.startswith('unix:///'):
        raise RuntimeError('Linux pilot requires a local Unix Docker socket')
    path = Path(endpoint[len('unix://'):])
    info = path.stat()
    if not stat.S_ISSOCK(info.st_mode):
        raise RuntimeError('Linux Docker endpoint is not a socket')
    daemon = json.loads(command(['docker', '--context', context, 'info', '--format', '{{json .}}']))
    if (not isinstance(daemon, dict) or not isinstance(daemon.get('ID'), str) or not daemon['ID']
            or not isinstance(daemon.get('DockerRootDir'), str)
            or not Path(daemon['DockerRootDir']).is_absolute()
            or not Path(daemon['DockerRootDir']).is_dir()):
        raise RuntimeError('Linux daemon/storage identity unsupported')
    return {'platform': 'linux', 'context': context, 'endpoint': endpoint, 'daemon_id': daemon['ID'],
            'storage': daemon['DockerRootDir'], 'socket_device': info.st_dev, 'socket_inode': info.st_ino}
