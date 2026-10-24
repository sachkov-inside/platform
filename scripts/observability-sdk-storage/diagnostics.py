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


TRACKING_GATE06_DETAILS = {
    'missing_mandatory':'trace_gate_06_missing_mandatory',
    'unexpected_key':'trace_gate_06_unexpected_key',
    'expected_value':'trace_gate_06_expected_value',
    'optional_value':'trace_gate_06_optional_value',
}


def _valid_detail(scope,gate,detail):
    return detail is None or (scope=='tracking' and gate=='trace_gate_06'
        and type(detail) is str and detail in TRACKING_GATE06_DETAILS)


class TraceGateRefusal(ValueError):
    """An empty ValueError with a constructor-owned semantic predicate identifier."""
    __slots__ = ('_scope','_reason','_detail','_temporal')
    def __init__(self, scope, reason, *, detail=None):
        if (type(scope) is not str or scope not in TRACE_GATES or type(reason) is not str
                or reason not in TRACE_GATES[scope] or not _valid_detail(scope,reason,detail)):
            raise ValueError('closed trace predicate reason')
        object.__setattr__(self,'_scope',scope)
        object.__setattr__(self,'_reason',reason)
        object.__setattr__(self,'_detail',detail)
        object.__setattr__(self,'_temporal',None)
        super().__init__()

    @property
    def scope(self):return self._scope
    @property
    def reason(self):return self._reason
    @property
    def detail(self):return self._detail
    @property
    def diagnostic_reason(self):return self._reason if self._detail is None else TRACKING_GATE06_DETAILS[self._detail]
    def __setattr__(self,name,value):
        if name in ('scope','reason','detail','diagnostic_reason','temporal','_scope','_reason','_detail','_temporal'):raise AttributeError('read-only trace reason')
        super().__setattr__(name,value)


class TraceOracleRefusal(OracleRefusal):
    """Fixed original RuntimeError message, never caller-provided native details."""
    __slots__ = ('_scope','_reason','_detail','_temporal')
    def __init__(self,scope,reason,*,detail=None):
        admitted=TraceGateRefusal(scope,reason,detail=detail)
        object.__setattr__(self,'_scope',admitted.scope)
        object.__setattr__(self,'_reason',admitted.reason)
        object.__setattr__(self,'_detail',admitted.detail)
        object.__setattr__(self,'_temporal',None)
        RuntimeError.__init__(self,TRACE_MESSAGES[scope])

    @property
    def scope(self):return self._scope
    @property
    def reason(self):return self._reason
    @property
    def detail(self):return self._detail
    @property
    def diagnostic_reason(self):return self._reason if self._detail is None else TRACKING_GATE06_DETAILS[self._detail]
    def __setattr__(self,name,value):
        if name in ('scope','reason','detail','diagnostic_reason','temporal','_scope','_reason','_detail','_temporal'):raise AttributeError('read-only trace reason')
        super().__setattr__(name,value)


def _trace_metadata(error,scope):
    # Exact known types only: no foreign properties, formatting, args or delegation.
    if type(error) not in (TraceGateRefusal,TraceOracleRefusal):return None
    if type(scope) is not str or scope not in TRACE_GATES:return None
    try:
        owner=object.__getattribute__(error,'_scope')
        gate=object.__getattribute__(error,'_reason')
        detail=object.__getattribute__(error,'_detail')
    except AttributeError:return None
    if (type(owner) is str and owner==scope and type(gate) is str and gate in TRACE_GATES[scope]
            and _valid_detail(owner,gate,detail)):return gate,detail
    return None


def _trace_reason(error,scope):
    metadata=_trace_metadata(error,scope)
    return None if metadata is None else metadata[0]



TEMPORAL_FIELDS = ('row_role','parent_role','comparison','gap_band')
TEMPORAL_VALUES = (('provider','identity','postgresql'),
                   ('root','delivery','provider','identity','postgresql'),
                   ('start','end','both'),('lt_1ms','ge_1ms'))


def _temporal_tuple(value):
    if (type(value) is tuple and len(value)==4
            and all(type(item) is str and item in allowed for item,allowed in zip(value,TEMPORAL_VALUES))):
        return value
    return None


def _trace_temporal(error,scope):
    if scope not in ('tracking','waitlist') or _trace_metadata(error,scope)!=('trace_gate_17',None):return None
    try:value=object.__getattribute__(error,'_temporal')
    except AttributeError:return None
    return _temporal_tuple(value)


def _interval_temporal(row_role,parent_role,start,end,parent_start,parent_end):
    if (type(row_role) is not str or row_role not in TEMPORAL_VALUES[0]
            or type(parent_role) is not str or parent_role not in TEMPORAL_VALUES[1]
            or any(type(item) is not int for item in (start,end,parent_start,parent_end))):return None
    before=start<parent_start;after=end>parent_end
    if not before and not after:return None
    comparison='both' if before and after else 'start' if before else 'end'
    gap=max(parent_start-start,end-parent_end)
    return row_role,parent_role,comparison,'lt_1ms' if gap<1000000 else 'ge_1ms'


def temporal_refusal(primary,row_role,parent_role,start,end,parent_start,parent_end):
    """Enrich only an already-created gate17 refusal, never its acceptance predicate."""
    if type(primary) is not TraceGateRefusal:return primary
    traceback=BaseException.__traceback__.__get__(primary)
    try:
        scope=object.__getattribute__(primary,'_scope')
        if scope in ('tracking','waitlist') and _trace_metadata(primary,scope)==('trace_gate_17',None):
            value=_temporal_tuple(_interval_temporal(row_role,parent_role,start,end,parent_start,parent_end))
            object.__setattr__(primary,'_temporal',value)
    except BaseException:
        object.__setattr__(primary,'_temporal',None)
        BaseException.__traceback__.__set__(primary,traceback)
    return primary


def _copy_temporal(primary,error,scope):
    # Optional exact-type finite projection only; preserve both owned primary tracebacks.
    if type(error) not in (TraceGateRefusal,TraceOracleRefusal):return
    primary_tb=BaseException.__traceback__.__get__(primary)
    error_tb=BaseException.__traceback__.__get__(error)
    try:object.__setattr__(primary,'_temporal',_temporal_tuple(_trace_temporal(error,scope)))
    except BaseException:
        object.__setattr__(primary,'_temporal',None)
        BaseException.__traceback__.__set__(primary,primary_tb)
        BaseException.__traceback__.__set__(error,error_tb)


def _diagnostic_temporal(value,error):
    # This bounded optional leaf owns no I/O or primary failure operations.
    primary,traceback=sys.exc_info()[1:]
    try:
        temporal=_trace_temporal(error,value['scope'])
        if temporal is not None:
            return validate({**value,'temporal':dict(zip(TEMPORAL_FIELDS,temporal))},scope=value['scope'])
    except BaseException:
        if primary is not None:BaseException.__traceback__.__set__(primary,traceback)
    return value


def trace_refusal(error,*,scope):
    metadata=_trace_metadata(error,scope)
    if metadata is not None:
        primary=TraceOracleRefusal(scope,metadata[0],detail=metadata[1])
        _copy_temporal(primary,error,scope)
        return primary
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
    'trace_validation': ('response_decode', 'oracle_refusal', *TRACE_CODES, *TRACKING_GATE06_DETAILS.values()),
    'reconciliation': ('oracle_refusal',), 'visibility': ('deadline',), 'complete': (),
}


def _refuse():
    raise ValueError('closed storage diagnostic contract failed')


def unknown(scope):
    return validate({'schema':1, 'scope':scope, 'phase':'unknown', 'outcome':'unknown',
                     'reason':'unknown', 'attempts':0, 'attempts_saturated':False}, scope=scope)


def validate(value, *, scope):
    if (scope not in ('sdk', 'tracking', 'waitlist') or type(value) is not dict or set(value) not in (set(FIELDS),{*FIELDS,'temporal'})
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
    if reason in TRACKING_GATE06_DETAILS.values() and (scope!='tracking' or phase!='trace_validation' or outcome!='failed'): _refuse()
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
    canonical={key:value[key] for key in FIELDS}
    if 'temporal' in value:
        temporal=value['temporal']
        if (scope not in ('tracking','waitlist') or (phase,outcome,reason)!=('trace_validation','failed','trace_gate_17')
                or type(temporal) is not dict or set(temporal)!=set(TEMPORAL_FIELDS)
                or _temporal_tuple(tuple(temporal[key] for key in TEMPORAL_FIELDS)) is None):_refuse()
        canonical['temporal']={key:temporal[key] for key in TEMPORAL_FIELDS}
    return canonical


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
    if len(encoded) > MAX_BYTES or path.is_symlink() or path.exists() and not path.is_file(): _refuse()
    temporary = path.with_name('.storage-diagnostic.new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    created=pin=stream=None;committed=False;failure=traceback=None
    try:
        info=os.fstat(descriptor);created=(info.st_dev,info.st_ino)
        pin=os.dup(descriptor)
        held=os.fstat(pin)
        if (held.st_dev,held.st_ino)!=created:_refuse()
        stream=os.fdopen(descriptor,'wb');descriptor=None
        stream.write(encoded);stream.flush()
        writer=stream;stream=None
        writer.close()
        os.replace(temporary, path);committed=True
    except BaseException as error:
        failure=error;traceback=sys.exc_info()[2]
    finally:
        try:
            live=pin if pin is not None else descriptor
            if not committed and created is not None and live is not None:
                held=os.fstat(live)
                try:info=temporary.lstat()
                except FileNotFoundError:info=None
                if (info is not None and stat.S_ISREG(info.st_mode)
                        and (held.st_dev,held.st_ino)==created==(info.st_dev,info.st_ino)):temporary.unlink()
        except BaseException as error:
            if failure is None:failure=error;traceback=sys.exc_info()[2]
        if stream is not None:
            try:stream.close()
            except BaseException as error:
                if failure is None:failure=error;traceback=sys.exc_info()[2]
        for owned in (descriptor,pin):
            if owned is not None:
                try:os.close(owned)
                except BaseException as error:
                    if failure is None:failure=error;traceback=sys.exc_info()[2]
    if failure is not None:raise BaseException.with_traceback(failure,traceback)


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

    def fail(self, reason, *, trace_error=None):
        if self._value['outcome'] in ('failed','interrupted'):return
        self._set(outcome='interrupted' if reason == 'interrupted' else 'failed', reason=reason)
        if (self._value['scope'] in ('tracking','waitlist') and self._value['phase']=='trace_validation'
                and self._value['outcome']=='failed' and self._value['reason']=='trace_gate_17'):
            self._value=_diagnostic_temporal(self._value,trace_error)


    def snapshot(self):
        return validate(self._value, scope=self._value['scope'])

    def persist(self, path):
        primary,primary_tb=sys.exc_info()[1:]
        try:
            write(path, self.snapshot(), scope=self._value['scope'])
        except BaseException:
            if primary is None:raise
            BaseException.with_traceback(primary,primary_tb)


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
        metadata=_trace_metadata(error,scope)
        if metadata is None:return 'unknown'
        gate,detail=metadata
        return gate if detail is None else TRACKING_GATE06_DETAILS[detail]
    if type(error) is OracleRefusal:
        try:reason=error.reason
        except AttributeError:return 'unknown'
        if type(reason) is str and reason in ('response_decode','oracle_refusal'):return reason
    return 'unknown'
