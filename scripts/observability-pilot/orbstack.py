"""Fail-closed OrbStack storage boundaries for the disposable pilot, not a disk quota."""

from contextlib import contextmanager
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
import shutil
import stat

from storage_policy import (GIB, STOP_MARGIN_BYTES, MINIMUM_FREE_BYTES,
                            GROWTH_BYTES, assert_budget)


class VmIdentityChanged(RuntimeError):
    """A validated rejected sample exposes only field names and numerical counters."""
    def __init__(self, changed_fields, previous, rejected):
        super().__init__('VM filesystem identity changed')
        self.changed_fields = changed_fields
        self.previous_counters = previous
        self.rejected_counters = rejected


class VmBudget:
    """The probe's statfs identity and available blocks belong to the daemon filesystem."""
    def __init__(self):
        self.identity = None
        self.initial_free = None
        self.initial_unavailable = None
        self.last_at = None
        self.latest_counters = None

    def accept(self, line, *, now):
        values = line.split()
        if len(values) != 5 or len(line) > 256:
            raise RuntimeError('invalid VM filesystem sample')
        fsid, block, total, available, kind = values
        if not all(value.isdecimal() for value in (block, total, available)):
            raise RuntimeError('invalid VM filesystem counters')
        block, total, available = map(int, (block, total, available))
        if not 0 < block <= GIB or not 0 <= available <= total or not 0 < total * block <= 2**64 - 1:
            raise RuntimeError('invalid VM filesystem bounds')
        # statfs f_blocks is a capacity counter; it does not identify a filesystem.
        identity = (fsid, block, kind)
        free = available * block
        unavailable = (total - available) * block
        counters = {'block_bytes':block, 'total_bytes':block * total, 'free_bytes':free}
        if self.identity is None:
            if free < MINIMUM_FREE_BYTES:
                raise RuntimeError('VM filesystem requires 16 GiB free')
            self.identity, self.initial_free = identity, free
            self.initial_unavailable = unavailable
        elif identity != self.identity:
            changed = [name for name, before, after in zip(
                ('filesystem_id', 'block_bytes', 'filesystem_type'), self.identity, identity)
                if before != after]
            raise VmIdentityChanged(changed, self.latest_counters, counters)
        assert_budget(self.initial_free, free)
        if unavailable - self.initial_unavailable >= GROWTH_BYTES - STOP_MARGIN_BYTES:
            raise RuntimeError('pilot storage budget exceeded')
        self.last_at = now
        self.latest_counters = counters
        return {'filesystem_id': fsid, 'filesystem_type': kind, 'block_bytes': block,
                'total_bytes': block * total, 'free_bytes': free,
                'initial_unavailable_bytes':self.initial_unavailable, 'unavailable_bytes':unavailable}

    def assert_fresh(self, *, now):
        if self.last_at is None or now - self.last_at > PROBE_HEARTBEAT_TIMEOUT_SECONDS:
            raise RuntimeError('VM filesystem heartbeat lost')


def backing_identity(open_files):
    paths = {line[1:] for line in open_files.splitlines()
             if line.startswith('n/') and line.endswith('/data.img.raw')}
    if len(paths) != 1:
        raise RuntimeError('unique open OrbStack backing file not identified')
    path = Path(paths.pop()).resolve(strict=True)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError('OrbStack backing file must be regular')
    return {'path': str(path), 'device': info.st_dev, 'inode': info.st_ino}


def assert_backing(identity):
    path = Path(identity['path'])
    info = path.stat()
    if (str(path.resolve(strict=True)), info.st_dev, info.st_ino) != (identity['path'], identity['device'], identity['inode']):
        raise RuntimeError('OrbStack backing file identity changed')
    return info


PROBE_COMPRESSED_LIMIT_BYTES = 2 * 1024**2
PROBE_UNPACKED_LIMIT_BYTES = 4 * 1024**2
BOOTSTRAP_GROWTH_LIMIT_BYTES = 32 * 1024**2
PROBE_SAMPLE_INTERVAL_SECONDS = .25
PROBE_HEARTBEAT_TIMEOUT_SECONDS = 3
PROBE_COMMAND_TIMEOUT_SECONDS = 10
PROBE_BOOTSTRAP_TIMEOUT_SECONDS = 60


def probe_service(lock, storage):
    if not Path(storage).is_absolute() or storage == '/' or '..' in Path(storage).parts:
        raise RuntimeError('probe requires absolute daemon storage path')
    if (not 0 < lock['compressed_bytes'] <= PROBE_COMPRESSED_LIMIT_BYTES
            or not 0 < lock['unpacked_bytes'] <= PROBE_UNPACKED_LIMIT_BYTES
            or lock['manifest']['platform']['architecture'] != 'arm64'
            or lock['image'] != 'docker.io/library/busybox@' + lock['manifest']['digest']):
        raise RuntimeError('probe bootstrap metadata exceeds bounded contract')
    return {'image': lock['image'], 'platform':'linux/arm64', 'pull_policy':'never',
            'entrypoint':['/bin/sh'],
            'command':['-c', f'while :; do sleep {PROBE_SAMPLE_INTERVAL_SECONDS}; done'],
            'user':'65534:65534', 'network_mode':'none', 'read_only':True,
            'cap_drop':['ALL'], 'security_opt':['no-new-privileges:true'],
            'mem_limit':'16m', 'cpus':.05, 'pids_limit':8,
            'volumes':[{'type':'bind','source':storage,'target':'/probe','read_only':True,
                        'bind':{'create_host_path':False}}],
            'logging':{'driver':'json-file','options':{'max-size':'64k','max-file':'1'}}}


def identify(command, *, home):
    """Only the local OrbStack socket and its open backing image are supported."""
    import json
    if any(os.environ.get(key) for key in ('DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')):
        raise RuntimeError('Docker endpoint overrides unsupported for OrbStack admission')
    expected = 'unix://' + str(home / '.orbstack/run/docker.sock')
    context = command(['docker', 'context', 'show']).strip()
    endpoint = command(['docker', 'context', 'inspect', 'orbstack', '--format', '{{.Endpoints.docker.Host}}']).strip()
    if context != 'orbstack' or endpoint != expected:
        raise RuntimeError('local OrbStack context/socket not identified')
    info = json.loads(command(['docker', '--context', 'orbstack', 'info', '--format', '{{json .}}']))
    if not isinstance(info, dict) or not isinstance(info.get('ID'), str) or not info['ID'] or info.get('DockerRootDir') != '/var/lib/docker':
        raise RuntimeError('OrbStack daemon/storage identity unsupported')
    socket = (home / '.orbstack/run/docker.sock').stat()
    if not stat.S_ISSOCK(socket.st_mode):
        raise RuntimeError('OrbStack endpoint must be a local socket')
    backing = backing_identity(command(['lsof', '-n', '-a', '-c', 'OrbStack Helper', '-Fpcn']))
    return {'context':'orbstack', 'endpoint':endpoint, 'daemon_id':info['ID'],
            'storage':info['DockerRootDir'], 'backing':backing,
            'socket_device':socket.st_dev, 'socket_inode':socket.st_ino}


def host_snapshot(identity, paths):
    info = assert_backing(identity['backing'])
    disks = {}
    for path in [Path(identity['backing']['path']), *paths]:
        path = path.resolve(strict=True)
        device = path.stat().st_dev
        usage = shutil.disk_usage(path)
        disks[str(device)] = {'total_bytes':usage.total, 'free_bytes':usage.free}
    return {'filesystems':disks, 'allocated_image_bytes':info.st_blocks * 512}


def check_host(initial, current, *, bootstrap=False):
    if initial['filesystems'].keys() != current['filesystems'].keys():
        raise RuntimeError('host filesystem identity changed')
    for device, values in current['filesystems'].items():
        before = initial['filesystems'][device]
        if before['total_bytes'] != values['total_bytes']:
            raise RuntimeError('host filesystem identity changed')
        assert_budget(before['free_bytes'], values['free_bytes'])
        if bootstrap and before['free_bytes'] - values['free_bytes'] >= BOOTSTRAP_GROWTH_LIMIT_BYTES:
            raise RuntimeError('probe bootstrap host growth budget exceeded')
    allocated = current['allocated_image_bytes'] - initial['allocated_image_bytes']
    if allocated >= (BOOTSTRAP_GROWTH_LIMIT_BYTES if bootstrap else GROWTH_BYTES - STOP_MARGIN_BYTES):
        raise RuntimeError('OrbStack allocated image growth budget exceeded')


REGISTRY_AUTH_RESPONSE_LIMIT_BYTES = 32768
REGISTRY_TOKEN_LIMIT_BYTES = 16384


def registry_token(value):
    token = value.get('token') if isinstance(value, dict) else None
    if not isinstance(token, str) or not 0 < len(token) <= REGISTRY_TOKEN_LIMIT_BYTES or any(not 33 <= ord(char) <= 126 for char in token):
        raise RuntimeError('invalid registry authentication token')
    return token


def verify_probe(lock):
    """Read bounded publisher objects before asking Docker to acquire the pinned manifest."""
    import gzip
    import hashlib
    import io
    import json
    import urllib.request
    probe_service(lock, '/var/lib/docker')
    registry = 'https://registry-1.docker.io/v2/library/busybox/'
    def read(url, limit, headers=None):
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}),
                                    timeout=PROBE_COMMAND_TIMEOUT_SECONDS) as response:
            content = response.read(limit + 1)
        if len(content) > limit:
            raise RuntimeError('probe publisher object exceeds bootstrap limit')
        return content
    token = registry_token(json.loads(read('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/busybox:pull', REGISTRY_AUTH_RESPONSE_LIMIT_BYTES)))
    headers = {'Authorization':'Bearer '+token, 'Accept':'application/vnd.oci.image.manifest.v1+json'}
    def blob(kind, descriptor):
        size = descriptor['size']
        if type(size) is not int or not 0 < size <= PROBE_COMPRESSED_LIMIT_BYTES:
            raise RuntimeError('probe publisher descriptor exceeds bootstrap limit')
        content = read(registry+kind+'/'+descriptor['digest'], size, headers)
        if len(content) != size or 'sha256:'+hashlib.sha256(content).hexdigest() != descriptor['digest']:
            raise RuntimeError('probe publisher size/digest mismatch')
        return content
    manifest = json.loads(blob('manifests', lock['manifest']))
    if manifest['layers'] != [{k:v for k,v in layer.items() if k not in ('unpacked_bytes','unpacked_digest')} for layer in lock['layers']] or manifest['config'] != lock['config']:
        raise RuntimeError('probe publisher manifest changed')
    if len(manifest['layers']) != 1:
        raise RuntimeError('probe bootstrap requires one bounded layer')
    config = json.loads(blob('blobs', manifest['config']))
    if config.get('architecture') != 'arm64' or config.get('os') != 'linux':
        raise RuntimeError('probe publisher platform mismatch')
    compressed = blob('blobs', manifest['layers'][0])
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        unpacked = stream.read(PROBE_UNPACKED_LIMIT_BYTES + 1)
    layer = lock['layers'][0]
    digest = 'sha256:'+hashlib.sha256(unpacked).hexdigest()
    if (len(compressed) != lock['compressed_bytes'] or len(unpacked) != lock['unpacked_bytes']
            or len(unpacked) > PROBE_UNPACKED_LIMIT_BYTES or digest != layer['unpacked_digest']
            or config.get('rootfs',{}).get('diff_ids') != [digest]):
        raise RuntimeError('probe unpacked payload exceeds pinned bootstrap contract')


PROBE_REQUEST_TIMEOUT_SECONDS = 1


def fresh_sample(compose, command):
    """One fresh stat process per unpredictable challenge; never consume historical logs."""
    import secrets
    nonce = secrets.token_hex(16)
    started = time.monotonic()
    raw = command(compose + ['exec', '-T', 'storage-probe', '/bin/sh', '-c',
                             'printf "%s " "$1"; exec stat -f -c "%i %S %b %a %T" /probe',
                             'probe', nonce], timeout=PROBE_REQUEST_TIMEOUT_SECONDS)
    elapsed = time.monotonic() - started
    if not 0 <= elapsed <= PROBE_REQUEST_TIMEOUT_SECONDS or len(raw) > 256:
        raise RuntimeError('VM filesystem response exceeded freshness bound')
    response = raw.strip().split(' ', 1)
    if len(response) != 2 or response[0] != nonce:
        raise RuntimeError('VM filesystem freshness challenge mismatch')
    return response[1]


HOST_SAMPLE_INTERVAL_SECONDS = .25
IDENTITY_SAMPLE_INTERVAL_SECONDS = 1
MONITOR_JOIN_SECONDS = PROBE_HEARTBEAT_TIMEOUT_SECONDS + 1
IDENTITY_COMMAND_TIMEOUT_SECONDS = .5


def monitor_failure(source, error):
    """The only public representation of a sampling exception is fixed categories."""
    if source not in ('host', 'identity', 'vm'):
        raise ValueError('unknown storage monitor source')
    if isinstance(error, subprocess.TimeoutExpired):
        category, reason = 'TimeoutExpired', 'command_timeout'
    elif isinstance(error, subprocess.CalledProcessError):
        category, reason = 'CalledProcessError', 'command_failed'
    elif isinstance(error, OSError):
        category, reason = 'OSError', 'filesystem_unavailable'
    elif isinstance(error, ValueError):
        category, reason = 'ValueError', 'invalid_sample'
    else:
        category = 'RuntimeError'
        reason = {'OrbStack daemon/socket/backing identity changed':'identity_changed',
                  'OrbStack backing file identity changed':'identity_changed',
                  'host filesystem identity changed':'identity_changed',
                  'VM filesystem identity changed':'identity_changed',
                  'pilot storage budget exceeded':'storage_budget_exceeded',
                  'probe bootstrap host growth budget exceeded':'bootstrap_budget_exceeded',
                  'OrbStack allocated image growth budget exceeded':'allocated_image_budget_exceeded'
                  }.get(str(error), 'invalid_sample')
    result = {'source':source, 'exception_class':category, 'reason':reason}
    if source == 'vm' and isinstance(error, VmIdentityChanged):
        result.update({'changed_fields':error.changed_fields,
                       'previous_counters':error.previous_counters,
                       'rejected_counters':error.rejected_counters})
    return result


def retain_monitor_failure(output, failure):
    """Retain only the first fixed-category failure, never exception payloads."""
    import json
    try:
        descriptor = os.open(output/'monitor-failure.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(failure, stream)
        stream.write('\n')


@contextmanager
def sampled_budget(sample, accept, *, interval=HOST_SAMPLE_INTERVAL_SECONDS, output=None, source=None):
    """Every missing/invalid sample fails closed in the foreground owner."""
    def retain(error):
        failure = monitor_failure(source or 'host', error)
        status = failure['exception_class']
        if output is not None:
            try:
                retain_monitor_failure(output, failure)
            except OSError:
                # Retention cannot replace the sampling failure or escape a monitor thread.
                status += '; evidence retention unavailable: OSError'
        return status
    try:
        accept(sample())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        raise RuntimeError('storage monitor failed: ' + retain(error)) from None
    stop = threading.Event()
    previous = signal.getsignal(signal.SIGUSR1)
    failure = []
    def interrupt(_signum, _frame):
        raise RuntimeError('storage monitor failed: ' + (failure[0] if failure else 'unknown'))
    def monitor():
        while not stop.wait(interval):
            try:
                accept(sample())
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                failure.append(retain(error))
                if not stop.is_set():
                    os.kill(os.getpid(), signal.SIGUSR1)
                break
    signal.signal(signal.SIGUSR1, interrupt)
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=MONITOR_JOIN_SECONDS)
        signal.signal(signal.SIGUSR1, previous)
        if thread.is_alive():
            raise RuntimeError('storage monitor did not stop within shutdown budget')


@contextmanager
def host_budget(identity, output, command):
    paths = [output, Path(__file__).resolve().parents[2]]
    initial = host_snapshot(identity, paths)
    latest = [initial]
    for disk in initial['filesystems'].values():
        if disk['free_bytes'] < MINIMUM_FREE_BYTES:
            raise RuntimeError('host filesystem requires 16 GiB free')
    def sample():
        return host_snapshot(identity, paths)
    def accept(current):
        # VM admission marker is written only after first verified VM sample.
        check_host(initial, current, bootstrap=not (output / 'storage-vm.json').exists())
        latest[0] = current
    def identity_sample():
        return identify(lambda args: command(args, timeout=IDENTITY_COMMAND_TIMEOUT_SECONDS), home=Path.home())
    def identity_accept(current):
        if current != identity:
            raise RuntimeError('OrbStack daemon/socket/backing identity changed')
    # Slow daemon metadata reads never pause the independent 250ms host disk checks.
    with sampled_budget(sample, accept, output=output, source='host'), sampled_budget(identity_sample, identity_accept,
                        interval=IDENTITY_SAMPLE_INTERVAL_SECONDS, output=output, source='identity'):
        import json
        (output / 'storage-host.json').write_text(json.dumps({'admission':initial})+'\n')
        try:
            yield initial
        finally:
            (output / 'storage-host.json').write_text(json.dumps({'admission':initial,'latest':latest[0]})+'\n')



@contextmanager
def vm_budget(compose, lock, command, output, *, docker_args):
    """Bootstrap is a limited preflight, before admitting the full pilot workload."""
    import json
    verify_probe(lock)
    command(['docker', 'pull', '--platform', 'linux/arm64', lock['image']],
            timeout=PROBE_BOOTSTRAP_TIMEOUT_SECONDS)
    command(compose + ['up', '-d', '--no-deps', 'storage-probe'], timeout=PROBE_BOOTSTRAP_TIMEOUT_SECONDS)
    budget = VmBudget()
    started = time.monotonic()
    first = budget.accept(fresh_sample(compose, command), now=time.monotonic())
    latest = [first]
    measurements = {'requests':1, 'request_wall_seconds':time.monotonic()-started,
                    'cpu_seconds':None, 'cpu_measurement':'unavailable: concurrent children; isolated measurement pending'}
    (output / 'storage-vm.json').write_text(json.dumps({'admission':first}) + '\n')
    def sample():
        started = time.monotonic()
        result = fresh_sample(compose, command)
        measurements['requests'] += 1
        measurements['request_wall_seconds'] += time.monotonic() - started
        return result
    def accept(line):
        latest[0] = budget.accept(line, now=time.monotonic())
    try:
        with sampled_budget(sample, accept, interval=PROBE_SAMPLE_INTERVAL_SECONDS, output=output, source='vm'):
            yield
    finally:
        (output / 'storage-vm.json').write_text(json.dumps({'admission':first,'latest':latest[0],
                    'verification_requests':measurements,
                    'scope':'fresh-stat verification overhead; not workload resource acceptance'})+'\n')
