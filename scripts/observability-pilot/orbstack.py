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

GIB = 1024**3
STOP_MARGIN_BYTES = 256 * 1024**2
MINIMUM_FREE_BYTES = 16 * GIB
FLOOR_BYTES = 10 * GIB
GROWTH_BYTES = 4 * GIB


class VmBudget:
    """The probe's statfs identity and available blocks belong to the daemon filesystem."""
    def __init__(self):
        self.identity = None
        self.initial_free = None
        self.last_at = None

    def accept(self, line, *, now):
        values = line.split()
        if len(values) != 5 or len(line) > 256:
            raise RuntimeError('invalid VM filesystem sample')
        fsid, block, total, available, kind = values
        if not all(value.isdecimal() for value in (block, total, available)):
            raise RuntimeError('invalid VM filesystem counters')
        block, total, available = map(int, (block, total, available))
        if not 0 < block <= GIB or not 0 <= available <= total or total * block <= 0:
            raise RuntimeError('invalid VM filesystem bounds')
        identity = (fsid, block, total, kind)
        free = available * block
        if self.identity is None:
            if free < MINIMUM_FREE_BYTES:
                raise RuntimeError('VM filesystem requires 16 GiB free')
            self.identity, self.initial_free = identity, free
        elif identity != self.identity:
            raise RuntimeError('VM filesystem identity changed')
        assert_budget(self.initial_free, free)
        self.last_at = now
        return {'filesystem_id': fsid, 'filesystem_type': kind, 'block_bytes': block,
                'total_bytes': block * total, 'free_bytes': free}

    def assert_fresh(self, *, now):
        if self.last_at is None or now - self.last_at > PROBE_HEARTBEAT_TIMEOUT_SECONDS:
            raise RuntimeError('VM filesystem heartbeat lost')


def assert_budget(initial, free):
    if free <= FLOOR_BYTES + STOP_MARGIN_BYTES or initial - free >= GROWTH_BYTES - STOP_MARGIN_BYTES:
        raise RuntimeError('pilot storage budget exceeded')


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
            'command':['-c', 'while :; do stat -f -c "%i %S %b %a %T" /probe || exit; sleep 0.25; done'],
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
    token = json.loads(read('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/busybox:pull', 32768))['token']
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


class ProbeStream:
    def __init__(self, descriptor):
        self.descriptor = descriptor
        self.pending = b''

    def sample(self):
        import select
        import time
        deadline = time.monotonic() + PROBE_HEARTBEAT_TIMEOUT_SECONDS
        while b'\n' not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.descriptor], [], [], remaining)[0]:
                raise RuntimeError('VM filesystem heartbeat lost')
            chunk = os.read(self.descriptor, 257)
            if not chunk:
                raise RuntimeError('VM filesystem probe stream closed')
            self.pending += chunk
            end = self.pending.find(b'\n')
            if end > 256 or end < 0 and len(self.pending) > 256:
                raise RuntimeError('VM filesystem sample oversized')
        line, self.pending = self.pending.split(b'\n', 1)
        return line.decode('ascii')


HOST_SAMPLE_INTERVAL_SECONDS = .25
IDENTITY_SAMPLE_INTERVAL_SECONDS = 1
MONITOR_JOIN_SECONDS = PROBE_HEARTBEAT_TIMEOUT_SECONDS + 1
PROBE_SHUTDOWN_SECONDS = 2
IDENTITY_COMMAND_TIMEOUT_SECONDS = .5


@contextmanager
def sampled_budget(sample, accept, *, interval=HOST_SAMPLE_INTERVAL_SECONDS):
    """Every missing/invalid sample fails closed in the foreground owner."""
    accept(sample())
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
                failure.append(type(error).__name__)
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
    with sampled_budget(sample, accept), sampled_budget(identity_sample, identity_accept,
                                                       interval=IDENTITY_SAMPLE_INTERVAL_SECONDS):
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
    command(['docker', '--context', 'orbstack', 'pull', '--platform', 'linux/arm64', lock['image']],
            timeout=PROBE_BOOTSTRAP_TIMEOUT_SECONDS)
    command(compose + ['up', '-d', '--no-deps', 'storage-probe'], timeout=PROBE_BOOTSTRAP_TIMEOUT_SECONDS)
    process = subprocess.Popen(docker_args(compose + ['logs', '--no-log-prefix', '--no-color', '--follow', 'storage-probe']),
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    first = None
    latest = [None]
    try:
        stream = ProbeStream(process.stdout.fileno())
        budget = VmBudget()
        first = budget.accept(stream.sample(), now=time.monotonic())
        latest[0] = first
        # Private output, fixed numeric projection, no raw collector/container errors.
        (output / 'storage-vm.json').write_text(json.dumps(first) + '\n')
        def accept(line):
            latest[0] = budget.accept(line, now=time.monotonic())
        with sampled_budget(stream.sample, accept):
            yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=PROBE_SHUTDOWN_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=PROBE_SHUTDOWN_SECONDS)
        process.stdout.close()
        if first is not None:
            (output / 'storage-vm.json').write_text(json.dumps({'admission':first,'latest':latest[0]})+'\n')
