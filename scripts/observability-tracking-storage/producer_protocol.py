"""Bounded private producer IPC, validated before public module-map projection."""
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-sdk-storage'))
import diagnostics
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
EMITTER_SECONDS=30
CHILD_BYTES=1_048_576

def capture(*, argv=None, environment=None, budget=EMITTER_SECONDS, diagnostic=None):
    """Own the single native Node child and its in-process HTTP listener until reaped.

    No new process group: the existing outside supervisor also owns this child on
    interruption/SIGKILL of the Python worker. The emitter launches no subprocess.
    """
    if not 0 < budget <= EMITTER_SECONDS:
        raise ValueError('closed emitter budget')
    if diagnostic is not None: diagnostic.start('capture')
    child = None
    try:
        child = subprocess.Popen(argv or ['node', str(HERE / 'producer.mjs')], cwd=ROOT,
                                 env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert child.stdout is not None
        deadline = time.monotonic() + budget
        data = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                if not selector.select(remaining):
                    raise TimeoutError()
                part = os.read(child.stdout.fileno(), min(65536, CHILD_BYTES+1-len(data)))
                if not part:
                    break
                data.extend(part)
                if len(data) > CHILD_BYTES:
                    if diagnostic is not None: diagnostic.fail('protocol_cap')
                    raise ValueError()
        if child.wait(timeout=max(.001, deadline-time.monotonic())) != 0:
            if diagnostic is not None: diagnostic.fail('native_exit')
            raise RuntimeError()
        if diagnostic is not None: diagnostic.start('protocol_decode')
        try:
            value = source_status.decode_json(bytes(data))
        except Exception:
            if diagnostic is not None: diagnostic.fail('protocol_decode')
            raise
        if diagnostic is not None: diagnostic.observed(True)
        return value
    except BaseException as error:
        if diagnostic is not None:
            diagnostic.fail('interrupted' if isinstance(error, KeyboardInterrupt) else
                            'deadline' if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)) else
                            'transport' if isinstance(error, OSError) else 'unknown')
        raise
    finally:
        if child is not None:
            try:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill()
                child.wait(timeout=2)
            finally:
                if child.stdout is not None:
                    child.stdout.close()



REQUIRED = {
    'apps/backend/dist/entrypoints/api/create-api-application.js',
    'apps/backend/dist/modules/communications/communications.module.js',
    'apps/backend/dist/modules/communications/facets/tracking-visits/tracking-visits.js',
    'apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js',
    'apps/backend/dist/infrastructure/observability/technical-telemetry.js',
    'apps/backend/dist/infrastructure/prisma/prisma-adapter.js',
    'apps/backend/dist/migrations/index.js',
}


class WitnessRefusal(ValueError):
    """The original owning message with a constructor-owned read-only category."""
    __slots__ = ('_reason',)
    def __init__(self, reason):
        messages = {
            'witness_header': 'invalid tracking producer witness',
            'witness_group': 'invalid tracking module group',
            'witness_row': 'invalid tracking module row',
            'witness_path': 'invalid tracking module witness',
            'witness_digest': 'invalid tracking module witness',
            'witness_duplicate': 'duplicate tracking module witness',
            'witness_required': 'production tracking module witness missing',
        }
        if type(reason) is not str or reason not in diagnostics.TRACKING_WITNESS_REASONS:
            raise ValueError('closed tracking witness reason')
        object.__setattr__(self, '_reason', reason)
        super().__init__(messages[reason])

    @property
    def reason(self):
        return self._reason

    def __setattr__(self, name, value):
        if name in ('reason', '_reason'):
            raise AttributeError('read-only tracking witness reason')
        super().__setattr__(name, value)


def witness_reason(error):
    if type(error) is WitnessRefusal:
        try:
            reason = error.reason
        except AttributeError:
            return 'witness_refusal'
        if type(reason) is str and reason in diagnostics.TRACKING_WITNESS_REASONS:
            return reason
    return 'witness_refusal'


def witness(value):
    keys = {'schema','trace_id','root_id','provider_requests','business','persisted_carrier','native_timer','sdk_shutdown','runtime_module_groups'}
    if (type(value) is not dict or set(value) != keys or type(value['schema']) is not int or value['schema'] != 1
            or type(value['provider_requests']) is not int or value['provider_requests'] != 2
            or any(value[key] != 'passed' for key in ('business','persisted_carrier','native_timer','sdk_shutdown'))
            or type(value['trace_id']) is not str or re.fullmatch(r'[0-9a-f]{32}',value['trace_id']) is None or value['trace_id'] == '0'*32
            or type(value['root_id']) is not str or re.fullmatch(r'[0-9a-f]{16}',value['root_id']) is None or value['root_id'] == '0'*16
            or type(value['runtime_module_groups']) is not list or not 1 <= len(value['runtime_module_groups']) <= 8):
        raise WitnessRefusal('witness_header')
    seen={}
    for group in value['runtime_module_groups']:
        if type(group) is not list or not 1 <= len(group) <= 512: raise WitnessRefusal('witness_group')
        for row in group:
            if type(row) is not dict or set(row) != {'path','sha256'}: raise WitnessRefusal('witness_row')
            name,digest=row['path'],row['sha256']
            if (type(name) is not str or not 1 <= len(name) <= 512 or name.startswith('/') or '..' in name.split('/')
                    or (not name.startswith(('apps/backend/dist/','node_modules/','packages/','docs/contracts/dist/'))
                        and name != 'docs/contracts/notifications-v1/schema.json')
                    or any(marker in name for marker in ('private_tracking_token','private-tracking-storage-provider-secret','tracking-storage.example.test'))
                    or any(ord(char) < 32 or ord(char)==127 for char in name)):
                raise WitnessRefusal('witness_path')
            if type(digest) is not str or re.fullmatch(r'[0-9a-f]{64}',digest) is None:
                raise WitnessRefusal('witness_digest')
            if name in seen: raise WitnessRefusal('witness_duplicate')
            seen[name]=digest
    if not REQUIRED <= set(seen): raise WitnessRefusal('witness_required')
    # No IDs, tokens, paths or producer fields enter curated evidence except validated module paths/hashes.
    return {'trace_id':value['trace_id'],'root_id':value['root_id'],'runtime_modules':seen}
