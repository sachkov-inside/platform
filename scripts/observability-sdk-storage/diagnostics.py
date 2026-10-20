"""Closed diagnostics for the SDK, tracking and waitlist storage owners only."""
import os
from pathlib import Path
import stat
import subprocess
import sys
import json
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'observability-pilot'))
import source_status


class ResponseDecode(source_status.InvalidResponse):
    """Malformed bounded response, retaining ValueError compatibility."""


class OracleRefusal(RuntimeError):
    """The original constant oracle message with a fixed owning reason."""
    def __init__(self, message, reason):
        if reason not in ('response_decode', 'oracle_refusal'):
            raise ValueError('closed oracle diagnostic reason')
        super().__init__(message)
        self.reason = reason

# Permanent scope+gate identifiers. Never renumber when source lines move.
TRACE_CODES = ('trace_decode', 'trace_gate_01', 'trace_gate_02', 'trace_gate_03',
               'trace_gate_04', 'trace_gate_05', 'trace_gate_06', 'trace_gate_07',
               'trace_gate_08', 'trace_gate_09', 'trace_gate_10', 'trace_gate_11',
               'trace_gate_12', 'trace_gate_13', 'trace_gate_14', 'trace_gate_15',
               'trace_gate_16', 'trace_gate_17', 'trace_gate_18', 'trace_gate_19', 'trace_gate_20')
TRACE_GATES = {'sdk': TRACE_CODES[:13], 'tracking': TRACE_CODES, 'waitlist': TRACE_CODES}
TRACE_MESSAGES = {'sdk':'SDK storage trace contract failed',
                  'tracking':'Tracking storage trace contract failed',
                  'waitlist':'Waitlist storage trace contract failed'}
WAITLIST_STORAGE_PHASES = ('metric_query','metric_validation','trace_query','trace_validation',
                           'reconciliation','visibility','complete')


class TraceGateRefusal(ValueError):
    """An empty ValueError with a constructor-owned semantic predicate identifier."""
    __slots__ = ('_scope','_reason')
    def __init__(self, scope, reason):
        if (type(scope) is not str or scope not in TRACE_GATES or type(reason) is not str
                or reason not in TRACE_GATES[scope]):
            raise ValueError('closed trace predicate reason')
        object.__setattr__(self,'_scope',scope)
        object.__setattr__(self,'_reason',reason)
        super().__init__()

    @property
    def scope(self):return self._scope
    @property
    def reason(self):return self._reason
    def __setattr__(self,name,value):
        if name in ('scope','reason','_scope','_reason'):raise AttributeError('read-only trace reason')
        super().__setattr__(name,value)


class TraceOracleRefusal(OracleRefusal):
    """Fixed original RuntimeError message, never caller-provided native details."""
    __slots__ = ('_scope','_reason')
    def __init__(self,scope,reason):
        admitted=TraceGateRefusal(scope,reason)
        object.__setattr__(self,'_scope',admitted.scope)
        object.__setattr__(self,'_reason',admitted.reason)
        RuntimeError.__init__(self,TRACE_MESSAGES[scope])

    @property
    def scope(self):return self._scope
    @property
    def reason(self):return self._reason
    def __setattr__(self,name,value):
        if name in ('scope','reason','_scope','_reason'):raise AttributeError('read-only trace reason')
        super().__setattr__(name,value)


def _trace_reason(error,scope):
    # No foreign properties, formatting, args or exception delegation.
    if type(error) not in (TraceGateRefusal,TraceOracleRefusal):return None
    if type(scope) is not str or scope not in TRACE_GATES:return None
    try:owner,reason=error.scope,error.reason
    except AttributeError:return None
    if type(owner) is str and owner==scope and type(reason) is str and reason in TRACE_GATES[scope]:return reason
    return None


def trace_refusal(error,*,scope):
    reason=_trace_reason(error,scope)
    if reason is not None:return TraceOracleRefusal(scope,reason)
    if type(error) is ResponseDecode:return OracleRefusal(TRACE_MESSAGES[scope],'response_decode')
    if scope=='waitlist':return RuntimeError(TRACE_MESSAGES[scope])
    return OracleRefusal(TRACE_MESSAGES[scope],'oracle_refusal')


NAME = 'storage-diagnostic.json'
MAX_BYTES = 2048
MAX_ATTEMPTS = 1024
FIELDS = ('schema', 'scope', 'phase', 'outcome', 'reason', 'attempts', 'attempts_saturated')
TRACKING_WITNESS_REASONS = ('witness_header', 'witness_group', 'witness_row', 'witness_path',
                            'witness_digest', 'witness_duplicate', 'witness_required')
FAILURES = {
    'unknown': (), 'acquisition': (), 'ownership': (),
    'capture': ('transport', 'deadline', 'native_exit', 'protocol_cap'),
    'protocol_decode': ('protocol_decode',), 'witness': ('witness_refusal', *TRACKING_WITNESS_REASONS),
    'module_projection': ('module_projection',), 'module_write': ('write_failure',),
    'metric_query': ('transport', 'deadline', 'response_decode'),
    'metric_validation': ('response_decode', 'oracle_refusal'),
    'trace_query': ('transport', 'deadline', 'response_decode'),
    'trace_validation': ('response_decode', 'oracle_refusal', *TRACE_CODES),
    'reconciliation': ('oracle_refusal',), 'visibility': ('deadline',), 'complete': (),
}


def _refuse():
    raise ValueError('closed storage diagnostic contract failed')


def unknown(scope):
    return validate({'schema':1, 'scope':scope, 'phase':'unknown', 'outcome':'unknown',
                     'reason':'unknown', 'attempts':0, 'attempts_saturated':False}, scope=scope)


def validate(value, *, scope):
    if (scope not in ('sdk', 'tracking', 'waitlist') or type(value) is not dict or set(value) != set(FIELDS)
            or type(value['schema']) is not int or value['schema'] != 1
            or type(value['scope']) is not str or value['scope'] != scope
            or any(type(value[key]) is not str for key in ('phase', 'outcome', 'reason'))
            or value['phase'] not in FAILURES
            or value['outcome'] not in ('unknown','running','pending','passed','failed','interrupted')
            or type(value['attempts']) is not int or not 0 <= value['attempts'] <= MAX_ATTEMPTS
            or type(value['attempts_saturated']) is not bool
            or value['attempts_saturated'] and value['attempts'] != MAX_ATTEMPTS):
        _refuse()
    phase, outcome, reason = (value[key] for key in ('phase','outcome','reason'))
    if reason in TRACKING_WITNESS_REASONS and scope != 'tracking': _refuse()
    if reason in TRACE_CODES and (phase != 'trace_validation' or reason not in TRACE_GATES[scope]): _refuse()
    if scope == 'waitlist' and phase not in ('unknown', 'capture', 'protocol_decode', *WAITLIST_STORAGE_PHASES): _refuse()
    if outcome == 'unknown':
        if phase != 'unknown' or reason != 'unknown' or value['attempts'] or value['attempts_saturated']: _refuse()
    elif outcome == 'failed':
        if reason not in (*FAILURES[phase], 'unknown'): _refuse()
    elif outcome == 'interrupted':
        if reason != 'interrupted': _refuse()
    elif reason != 'none' or phase == 'unknown': _refuse()
    if (phase == 'complete' and outcome not in ('passed','failed','interrupted')
            or outcome == 'pending' and phase not in ('metric_validation','trace_validation','reconciliation')):
        _refuse()
    return {key:value[key] for key in FIELDS}


def read(path, *, scope):
    if not path.exists() and not path.is_symlink():
        return unknown(scope)
    try:
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_size > MAX_BYTES: _refuse()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): _refuse()
            raw = stream.read(MAX_BYTES+1)
        if len(raw) > MAX_BYTES: _refuse()
        return validate(source_status.decode_json(raw), scope=scope)
    except (ValueError, TypeError, RecursionError, UnicodeError, OverflowError):
        _refuse()


def write(path, value, *, scope):
    canonical = validate(value, scope=scope)
    encoded = (json.dumps(canonical, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n').encode()
    if len(encoded) > MAX_BYTES or path.is_symlink(): _refuse()
    temporary = path.with_name('.storage-diagnostic.new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(encoded)
        os.replace(temporary, path)
    finally:
        if temporary.is_file() and not temporary.is_symlink(): temporary.unlink()


class Diagnostic:
    """One first-failure snapshot, independent of resource cleanup outcomes."""
    def __init__(self, scope):
        self._value = unknown(scope)

    def _set(self, **fields):
        if self._value['outcome'] not in ('failed', 'interrupted'):
            self._value = validate({**self._value, **fields}, scope=self._value['scope'])

    def start(self, phase):
        self._set(phase=phase, outcome='passed' if phase == 'complete' else 'running', reason='none')

    def observed(self, value):
        self._set(outcome='pending' if value is None else 'passed', reason='none')

    def attempt(self):
        count = self._value['attempts']
        self._set(attempts=min(count+1, MAX_ATTEMPTS),
                  attempts_saturated=self._value['attempts_saturated'] or count == MAX_ATTEMPTS)

    def fail(self, reason):
        self._set(outcome='interrupted' if reason == 'interrupted' else 'failed', reason=reason)

    def snapshot(self):
        return validate(self._value, scope=self._value['scope'])

    def persist(self, path):
        primary_failure = sys.exc_info()[0] is not None
        try:
            write(path, self.snapshot(), scope=self._value['scope'])
        except (OSError, ValueError):
            if not primary_failure: raise


class QueryReadFailure(RuntimeError):
    """Known transport status failure, preserving the original RuntimeError message."""


def query_reason(error):
    if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)): return 'deadline'
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError): return 'deadline'
    if isinstance(error, (ResponseDecode, UnicodeError)): return 'response_decode'
    if isinstance(error, (OSError, subprocess.SubprocessError, QueryReadFailure)): return 'transport'
    return 'unknown'


def oracle_reason(error, *, scope=None):
    if type(error) is TraceOracleRefusal:
        return _trace_reason(error,scope) or 'unknown'
    if type(error) is OracleRefusal:
        try:reason=error.reason
        except AttributeError:return 'unknown'
        if type(reason) is str and reason in ('response_decode','oracle_refusal'):return reason
    return 'unknown'
