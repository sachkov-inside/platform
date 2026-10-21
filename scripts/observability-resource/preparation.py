"""Private, append-only receipts for the two resource-preparation images.

Preparation owns retirement. Runtime only releases its named retention after recovery.
The caller supplies the frozen Docker adapter and a fresh identity probe.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import threading
from acquisition import decode_json

LABEL = 'dev.inside.resource-preparation'
MAX_BYTES = 1024 * 1024


def docker_command(args):
    import pilot
    pilot.assert_docker_identity()
    return pilot.command(['docker', *args], timeout=15)


def current_identity():
    import pilot
    if pilot.FROZEN_DOCKER_IDENTITY is None:
        raise ValueError('preparation_frozen_daemon_required')
    if pilot.FROZEN_DOCKER_IDENTITY.get('platform') == 'linux':
        return pilot.daemon.identify(pilot.command)
    return pilot.orbstack.identify(pilot.command, home=Path.home())


def recover_stage(images):
    """Bind a later recovery to the recorded daemon before allowing any mutation."""
    import pilot
    stage = open_stage(images)
    identity = (pilot.daemon.identify(pilot.command) if pilot.platform.system() == 'Linux'
        else pilot.orbstack.identify(pilot.command, home=Path.home()))
    if identity != stage.receipt['daemon']:
        raise ValueError('preparation_daemon_changed')
    pilot.FROZEN_DOCKER_ENDPOINT = identity['endpoint']
    pilot.FROZEN_DOCKER_IDENTITY = identity
    return stage


def image_id(value):
    return isinstance(value, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', value) is not None


def write_once(path, value):
    raw = (json.dumps(value, sort_keys=True, allow_nan=False) + '\n').encode()
    if len(raw) > MAX_BYTES:
        raise ValueError('preparation_receipt_size')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('preparation_private_receipt_required')
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('preparation_receipt_size')
    return decode_json(raw)


def directory(images):
    images = Path(images).absolute()
    return images.with_name(images.name + '.preparation')


def consumer_key(consumer):
    if not isinstance(consumer, str) or not consumer or len(consumer) > 1024:
        raise ValueError('preparation_named_consumer_required')
    return hashlib.sha256(consumer.encode()).hexdigest()


class Stage:
    def __init__(self, path, receipt, docker, identify):
        self.path, self.receipt = path, receipt
        self.docker, self.identify = docker, identify
        self._use_mutex = threading.RLock()
        self._use_descriptor = None

    @contextmanager
    def in_use(self):
        """One active producer/runtime; retention registration remains available separately."""
        with self._use_mutex:
            if self._use_descriptor is not None:
                yield
                return
            with self.locked():
                descriptor = os.open(self.path / 'use.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    os.close(descriptor)
                    raise ValueError('preparation_lock_required')
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                self._use_descriptor = descriptor
                yield
            finally:
                self._use_descriptor = None
                os.close(descriptor)

    def iidfile(self, role):
        if role not in ('backend', 'foundation'):
            raise ValueError('preparation_build_role')
        return self.path / (role + '.iid')

    @contextmanager
    def locked(self):
        info = self.path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('preparation_private_directory_required')
        descriptor = os.open(self.path / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError('preparation_lock_required')
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            if self.identify() != self.receipt['daemon']:
                raise ValueError('preparation_daemon_changed')
            yield
        finally:
            os.close(descriptor)

    def capture(self):
        with self.locked():
            self._capture()

    def _capture(self):
        # Labels are inherited by FROM descendants. Only this producer's fixed build-result
        # files may establish ownership, including later recovery after an uncatchable kill.
        for role in ('backend', 'foundation'):
            iidfile = self.iidfile(role)
            if not iidfile.exists() and not iidfile.is_symlink():
                continue
            descriptor = os.open(iidfile, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                    raise ValueError('preparation_build_result')
                value = stream.read(256).decode().strip()
            if not image_id(value):
                raise ValueError('preparation_build_result')
            path = self.path / ('image-' + value[7:] + '.json')
            if not path.exists():
                write_once(path, {'id': value})

    def retain(self, consumer, purpose):
        key = consumer_key(consumer)
        if not isinstance(purpose, str) or not purpose or len(purpose) > 256:
            raise ValueError('preparation_retention_purpose_required')
        with self.locked():
            if (self.path / 'retirement-started.json').exists():
                raise ValueError('preparation_already_released')
            write_once(self.path / ('retain-' + key + '.json'), {'consumer': consumer, 'purpose': purpose})

    def require_consumer(self, consumer):
        key = consumer_key(consumer)
        with self.locked():
            value = read(self.path / ('retain-' + key + '.json'))
            if (not isinstance(value, dict) or set(value) != {'consumer', 'purpose'}
                    or value['consumer'] != consumer or not isinstance(value['purpose'], str)
                    or (self.path / ('release-' + key + '.json')).exists()
                    or (self.path / 'retirement-started.json').exists()):
                raise ValueError('preparation_consumer_not_retained')

    def _pending(self):
        pending = []
        for path in self.path.glob('retain-*.json'):
            lease = read(path)
            if (not isinstance(lease, dict) or set(lease) != {'consumer', 'purpose'}
                    or not isinstance(lease['purpose'], str) or not 0 < len(lease['purpose']) <= 256
                    or path.name != 'retain-' + consumer_key(lease['consumer']) + '.json'):
                raise ValueError('preparation_consumer_receipt')
            released = path.with_name(path.name.replace('retain-', 'release-', 1))
            if released.exists() or released.is_symlink():
                if read(released) != {'consumer': lease['consumer']}:
                    raise ValueError('preparation_consumer_receipt')
            else:
                pending.append(lease['consumer'])
        return pending

    def release(self, consumer, *, cleanup_ok):
        try:
            with self.in_use():
                return self._release(consumer, cleanup_ok=cleanup_ok)
        except BaseException:
            try:
                self._record({'state': 'retained', 'reason': 'retirement_failed', 'retired': []})
            except BaseException:
                pass
            raise

    def _release(self, consumer, *, cleanup_ok):
        key = consumer_key(consumer)
        with self.locked():
            lease = read(self.path / ('retain-' + key + '.json'))
            if not isinstance(lease, dict) or lease.get('consumer') != consumer:
                raise ValueError('preparation_consumer_not_retained')
            if cleanup_ok is not True:
                return self._record({'state': 'retained', 'reason': 'recovery_required', 'retired': []})
            released = self.path / ('release-' + key + '.json')
            if not released.exists():
                write_once(released, {'consumer': consumer})
            pending = self._pending()
            if pending:
                return self._record({'state': 'retained', 'reason': 'named_consumer', 'retired': []})
            marker = self.path / 'retirement-started.json'
            if not marker.exists():
                write_once(marker, {'source': self.receipt['source']})
            self._capture()
            present = set(self.docker(['image', 'ls', '--quiet', '--no-trunc']).split())
            if any(not image_id(value) for value in present):
                raise ValueError('preparation_image_ids')
            result = {'state': 'retired', 'reason': 'last_consumer_released', 'retired': [], 'protected': []}
            owned = set()
            for path in sorted(self.path.glob('image-*.json')):
                value = read(path)
                if not isinstance(value, dict) or set(value) != {'id'} or not image_id(value['id']):
                    raise ValueError('preparation_image_receipt')
                image = value['id']
                owned.add(image)
                if image not in present:
                    continue
                raw = self.docker(['image', 'inspect', image])
                if len(raw.encode()) > MAX_BYTES:
                    raise ValueError('preparation_image_inspection')
                inspection = decode_json(raw)
                if (not isinstance(inspection, list) or len(inspection) != 1
                        or not isinstance(inspection[0], dict)):
                    raise ValueError('preparation_image_inspection')
                row = inspection[0]
                tags, digests = row.get('RepoTags'), row.get('RepoDigests')
                config = row.get('Config')
                labels = config.get('Labels') if isinstance(config, dict) else None
                if (row.get('Id') != image or not isinstance(tags, list) or not all(isinstance(x, str) for x in tags)
                        or not isinstance(digests, list) or not all(isinstance(x, str) for x in digests)
                        or not isinstance(labels, dict)):
                    raise ValueError('preparation_image_inspection')
                repositories = [tag.rsplit(':', 1)[0] for tag in self.receipt['tags']]
                foreign_digest = any(not any(value.startswith(repo + '@sha256:') for repo in repositories) for value in digests)
                if (image in self.receipt['preexisting'] or labels.get(LABEL) != self.receipt['token']
                        or foreign_digest or set(tags) - set(self.receipt['tags'])
                        or self.docker(['container', 'ls', '--all', '--quiet', '--filter', 'ancestor=' + image]).strip()):
                    result['protected'].append(image)
                    continue
                # Never force: the daemon also rejects a concurrently acquired container reference
                # or multiple repository references. Delete by immutable ID, never a mutable tag.
                if self.identify() != self.receipt['daemon']:
                    raise ValueError('preparation_daemon_changed')
                self.docker(['image', 'rm', '--no-prune', image])
                result['retired'].append(image)
            unknown = set()
            for tag in self.receipt['tags']:
                ids = self.docker(['image', 'ls', '--quiet', '--no-trunc', '--filter', 'reference=' + tag]).split()
                if len(ids) > 1 or any(not image_id(value) for value in ids):
                    raise ValueError('preparation_image_ids')
                unknown.update(set(ids) - owned)
            result['protected'].extend(sorted(unknown))
            if result['protected']:
                result['state'] = 'retained'
                result['reason'] = 'build_result_unavailable' if unknown else 'protected_reference'
            return self._record(result)

    def _record(self, value):
        write_once(self.path / ('outcome-' + secrets.token_hex(16) + '.json'), value)
        return value


def begin(images, source, owner, daemon, consumer, *, docker=docker_command, identify=current_identity):
    if (not isinstance(source, str) or re.fullmatch(r'[a-f0-9]{40}', source) is None
            or not isinstance(owner, str)
            or re.fullmatch(r'inside-platform-production-smoke-cache-[a-z0-9][a-z0-9-]{0,80}', owner) is None
            or not isinstance(daemon, dict) or not daemon):
        raise ValueError('preparation_owner_source')
    preexisting = sorted(set(docker(['image', 'ls', '--quiet', '--no-trunc']).split()))
    if len(preexisting) > 4096 or any(not image_id(value) for value in preexisting):
        raise ValueError('preparation_image_ids')
    tags = [owner + '-backend:v1', owner + '-foundation:local']
    for tag in tags:
        if docker(['image', 'ls', '--quiet', '--no-trunc', '--filter', 'reference=' + tag]).strip():
            raise ValueError('preparation_tag_already_exists')
    path = directory(images)
    path.mkdir(mode=0o700)
    receipt = {'schema': 1, 'source': source, 'owner': owner, 'daemon': daemon,
        'token': secrets.token_hex(32), 'preexisting': preexisting,
        'tags': tags}
    write_once(path / 'receipt.json', receipt)
    stage = Stage(path, receipt, docker, identify)
    stage.retain(consumer, 'next resource runtime')
    return stage


@contextmanager
def acquire(images, source, owner, daemon, consumer, *, docker=docker_command, identify=current_identity):
    stage = begin(images, source, owner, daemon, consumer, docker=docker, identify=identify)
    with stage.in_use():
        stage.require_consumer(consumer)
        try:
            yield stage
            stage.capture()
        except BaseException as primary:
            try:
                stage.capture()
                stage.release(consumer, cleanup_ok=True)
            except BaseException as cleanup_error:
                # Keep the original build failure/interruption and a recoverable immutable owner receipt.
                primary.add_note('Preparation retirement incomplete: ' + type(cleanup_error).__name__)
            raise


def open_stage(images, *, docker=docker_command, identify=current_identity):
    path = directory(images)
    receipt = read(path / 'receipt.json')
    if (not isinstance(receipt, dict) or set(receipt) != {'schema', 'source', 'owner', 'daemon', 'token', 'preexisting', 'tags'}
            or type(receipt['schema']) is not int or receipt['schema'] != 1
            or not isinstance(receipt['source'], str) or re.fullmatch(r'[a-f0-9]{40}', receipt['source']) is None
            or not isinstance(receipt['owner'], str)
            or re.fullmatch(r'inside-platform-production-smoke-cache-[a-z0-9][a-z0-9-]{0,80}', receipt['owner']) is None
            or not isinstance(receipt['token'], str) or re.fullmatch(r'[a-f0-9]{64}', receipt['token']) is None
            or not isinstance(receipt['preexisting'], list) or not all(image_id(x) for x in receipt['preexisting'])
            or not isinstance(receipt['daemon'], dict) or not receipt['daemon']
            or receipt['tags'] != [receipt['owner'] + '-backend:v1', receipt['owner'] + '-foundation:local']):
        raise ValueError('preparation_receipt_contract')
    return Stage(path, receipt, docker, identify)
