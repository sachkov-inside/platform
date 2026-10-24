"""Small closed acquisition outcomes, with no command, error, image or credential text."""
import json
import math
import os
import re
import stat
import time

NAME = 'resource-acquisition.json'
MAX_BYTES = 4096
MAX_ELAPSED_MS = 1_500_000
STAGES = ('preflight', 'daemon_identity', 'backend_build', 'foundation_build',
          'preload_grafana', 'preload_alloy', 'preload_metrics', 'preload_logs',
          'preload_traces', 'preload_vmauth', 'preload_gateway', 'backend_inspect',
          'foundation_inspect', 'manifest_validate', 'manifest_write', 'complete')
BOUNDARIES = ('validation', 'identity_probe', 'child_spawn', 'child_wait', 'inspection', 'cleanup', 'publication')
OUTCOMES = ('started', 'passed', 'refused', 'command_exit', 'command_deadline',
            'storage_guard_stop', 'storage_guard_floor', 'storage_guard_growth',
            'storage_guard_floor_growth', 'storage_guard_read_failure',
            'interrupted', 'cleanup_failed', 'io_failure', 'unknown_failure')
COUNTERS = {'builds': 2, 'pulls': 7, 'inspections': 2}
FIELDS = {'schema', 'source', 'stage', 'boundary', 'outcome', 'exit_code', 'elapsed_ms',
          'elapsed_saturated', 'cleanup', 'acceptance'} | {
              kind + '_' + suffix for kind in COUNTERS for suffix in ('attempted', 'completed')}


def decode_json(encoded):
    def unique_fields(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('resource_duplicate_metadata_key')
            value[key] = item
        return value
    def nonfinite(_value):
        raise ValueError('resource_nonfinite_metadata')
    return json.loads(encoded, object_pairs_hook=unique_fields, parse_constant=nonfinite)


def validate(value, source):
    if (not isinstance(value, dict) or set(value) != FIELDS
            or not isinstance(source, str) or not re.fullmatch(r'[a-f0-9]{40}', source)
            or type(value['schema']) is not int or value['schema'] != 1 or value['source'] != source
            or value['stage'] not in STAGES or value['boundary'] not in BOUNDARIES
            or value['outcome'] not in OUTCOMES or value['cleanup'] not in ('not_needed', 'passed', 'failed')
            or value['acceptance'] != 'pending' or type(value['elapsed_saturated']) is not bool
            or type(value['elapsed_ms']) is not int or not 0 <= value['elapsed_ms'] <= MAX_ELAPSED_MS
            or (value['elapsed_saturated'] and value['elapsed_ms'] != MAX_ELAPSED_MS)
            or (value['exit_code'] is not None and
                (type(value['exit_code']) is not int or not -255 <= value['exit_code'] <= 255))):
        raise ValueError('resource_acquisition_contract')
    for kind, maximum in COUNTERS.items():
        attempted, completed = value[kind+'_attempted'], value[kind+'_completed']
        if (type(attempted) is not int or type(completed) is not int
                or not 0 <= completed <= attempted <= maximum):
            raise ValueError('resource_acquisition_counts')
    return {key: value[key] for key in sorted(FIELDS)}


def read(path, source):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError('resource_acquisition_file')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('resource_acquisition_file')
        encoded = stream.read(MAX_BYTES+1)
    if len(encoded) > MAX_BYTES:
        raise ValueError('resource_acquisition_file')
    return validate(decode_json(encoded), source)


def write(path, value, source):
    encoded = (json.dumps(validate(value, source), sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n').encode()
    if len(encoded) > MAX_BYTES:
        raise ValueError('resource_acquisition_size')
    temporary = path.with_name('.resource-acquisition.new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(encoded)
        os.replace(temporary, path)
    finally:
        if temporary.is_file() and not temporary.is_symlink():
            temporary.unlink()


class Recorder:
    def __init__(self, metadata, source, *, clock=time.monotonic):
        if metadata.is_symlink() or not metadata.is_dir():
            raise ValueError('resource_acquisition_metadata')
        self.path = metadata / NAME
        if self.path.exists() or self.path.is_symlink():
            raise ValueError('resource_acquisition_new_record')
        self.clock = clock
        self.started = clock()
        self.failed = False
        self.value = {'schema': 1, 'source': source, 'stage': 'preflight', 'boundary': 'validation',
                      'outcome': 'started', 'exit_code': None, 'elapsed_ms': 0,
                      'elapsed_saturated': False, 'cleanup': 'not_needed', 'acceptance': 'pending',
                      **{kind+'_'+suffix: 0 for kind in COUNTERS for suffix in ('attempted', 'completed')}}
        self.publish()

    def publish(self):
        elapsed = (self.clock()-self.started)*1000
        if not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError('resource_acquisition_clock')
        self.value.update(elapsed_ms=min(MAX_ELAPSED_MS, int(elapsed)), elapsed_saturated=elapsed > MAX_ELAPSED_MS)
        write(self.path, self.value, self.value['source'])

    def start(self, stage, boundary, *, kind=None):
        if self.failed:
            return
        self.value.update(stage=stage, boundary=boundary, outcome='started', exit_code=None)
        if kind is not None:
            self.value[kind+'_attempted'] += 1
            self.value['cleanup'] = 'not_needed'
        self.publish()

    def passed(self, *, kind=None):
        if self.failed:
            return
        if kind is not None:
            self.value[kind+'_completed'] += 1
        self.value['outcome'] = 'passed'
        self.publish()

    def fail(self, outcome, exit_code=None):
        if not self.failed:
            self.failed = True
            self.value['outcome'] = outcome
            self.value['exit_code'] = exit_code if type(exit_code) is int and -255 <= exit_code <= 255 else None
        # A diagnostic write failure must not replace the original acquisition failure.
        try:
            self.publish()
        except (OSError, ValueError):
            pass

    def storage_stop(self, reason=None):
        # Signal observation only marks memory; outer failure handling publishes it.
        if not self.failed:
            self.failed = True
            outcomes = {'floor':'storage_guard_floor', 'growth':'storage_guard_growth',
                        'floor_growth':'storage_guard_floor_growth', 'read_failure':'storage_guard_read_failure'}
            self.value['outcome'] = outcomes.get(reason, 'storage_guard_stop') if isinstance(reason, str) else 'storage_guard_stop'
            self.value['exit_code'] = None

    def cleanup_result(self, succeeded):
        if self.value['cleanup'] != 'failed':
            self.value['cleanup'] = 'passed' if succeeded else 'failed'
        if not succeeded:
            self.fail('cleanup_failed')
        else:
            try:
                self.publish()
            except (OSError, ValueError):
                pass
