"""Independent full raw VM vector gate; never imports the source encoder or uses a positive selector."""
from decimal import Decimal
import json
import re
from pg_oracle_reasons import ORACLE_BASE_REASONS,ORACLE_JOIN_REASONS,ORACLE_REASONS

_MAX=9007199254740991
_FIXED={'service.name':'inside-postgresql-source','deployment.environment.name':'isolated-pilot',
        'service.version':'0.1566.3','scope.name':'inside-collector'}
_NAMES={'inside.postgresql.server.'+name for name in ('backends','waiting_locks','deadlocks_since_reset',
        'postmaster_start_time_microseconds','statistics_reset_time_microseconds','sample_time_microseconds','available')}


_VECTOR_REASONS={
    'values':dict(zip(('decode','envelope','row','labels','number'),ORACLE_REASONS[1:6])),
    'timestamps':dict(zip(('decode','envelope','row','labels','number'),ORACLE_REASONS[6:11]))}
_FIELDS=('freshness','reason','points','age_seconds','continuity','count_complete')


class _Malformed(ValueError):
    __slots__=('_group',)
    def __init__(self,group):
        if type(group) is not str or group not in (*_VECTOR_REASONS['values'],*ORACLE_BASE_REASONS):raise ValueError('malformed')
        object.__setattr__(self,'_group',group)
        super().__init__('malformed')
    def __setattr__(self,name,value):
        if name=='_group':raise AttributeError('read-only oracle reason')
        super().__setattr__(name,value)


def _report_snapshot(value):
    if type(value) not in (dict,_DiagnosticReport):return None
    pairs=tuple(dict.items(value))
    if len(pairs)!=6 or any(type(key) is not str for key,_ in pairs):return None
    if {key for key,_ in pairs}!=set(_FIELDS):return None
    row=tuple(dict.__getitem__(value,key) for key in _FIELDS)
    if (type(row[0]) is not str or row[0] not in ('malformed','stale','unavailable')
            or type(row[1]) is not str or row[1] not in ORACLE_REASONS or type(row[2]) is not int or not 0<=row[2]<=7
            or not (row[3] is None or type(row[3]) in (int,float) and 0<=row[3]<=600)
            or type(row[4]) is not str or row[4] not in ('unknown','ownership_changed')
            or type(row[5]) is not bool or row[5]):return None
    return row


class _DiagnosticReport(dict):
    __slots__=('_snapshot',)
    def __init__(self,value):
        snapshot=_report_snapshot(value)
        if snapshot is None:raise ValueError('malformed')
        super().__init__(value)
        object.__setattr__(self,'_snapshot',snapshot)
    def __setattr__(self,name,value):raise AttributeError('read-only oracle reason')


def diagnostic_reason(value):
    # Exact owning type before any inspection; hostile subclasses/foreign getters stay untouched.
    if type(value) is not _DiagnosticReport:return None
    try:snapshot=object.__getattribute__(value,'_snapshot')
    except AttributeError:return None
    current=_report_snapshot(value)
    if (current is None or type(snapshot) is not tuple or len(snapshot)!=6
            or any(type(a) is not type(b) for a,b in zip(current,snapshot)) or current!=snapshot):return None
    return current[1]


def _diagnosed(report,enabled,reason):
    if not enabled:return report
    return _DiagnosticReport({**report,'reason':reason})


def _refuse(*_):raise _Malformed('decode')


def _reject(group):raise _Malformed(group)



def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:_refuse()
        result[key]=value
    return result


def _number(value):
    if type(value) is not str or len(value)>32 or re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?',value) is None:_reject('number')
    result=Decimal(value)
    if not result.is_finite() or not 0<=result<=_MAX:_reject('number')
    return result


def _vector(raw,evaluated_at,*,timestamps=False):
    if type(raw) is not str or len(raw.encode('utf-8',errors='strict'))>65536 or raw.startswith('\ufeff'):_reject('decode')
    body=json.loads(raw,object_pairs_hook=_unique,parse_float=Decimal,parse_constant=_refuse)
    if (type(body) is not dict or set(body) not in ({'status','data'},{'status','data','stats'})
            or body['status']!='success'):_reject('envelope')
    if 'stats' in body:
        stats=body['stats']
        if (type(stats) is not dict or set(stats)!={'seriesFetched','executionTimeMsec'}
                or type(stats['seriesFetched']) is not str or re.fullmatch(r'0|[1-9][0-9]{0,18}',stats['seriesFetched']) is None
                or int(stats['seriesFetched'])>2**63-1 or type(stats['executionTimeMsec']) is not int
                or not 0<=stats['executionTimeMsec']<=(2**63-1)//1_000_000):_reject('envelope')
    data=body['data']
    if (type(data) is not dict or set(data)!={'resultType','result'} or data['resultType']!='vector'
            or type(data['result']) is not list or len(data['result'])>16):_reject('envelope')
    values={};labels={}
    for row in data['result']:
        if type(row) is not dict or set(row)!={'metric','value'}:_reject('row')
        metric,sample=row['metric'],row['value']
        if (type(metric) is not dict or any(type(v) is not str for v in metric.values())
                or type(sample) is not list or len(sample)!=2 or type(sample[0]) not in (int,float,Decimal)
                or Decimal(str(sample[0]))!=evaluated_at or any(metric.get(k)!=v for k,v in _FIXED.items())
                or metric.get('scope.version','') not in ('','unknown')):_reject('row')
        allowed={'__name__',*_FIXED,'scope.version'}
        if timestamps:
            name=metric.get('source_metric');allowed.add('source_metric')
            if metric.get('__name__',name)!=name:_reject('labels')
        else:name=metric.get('__name__')
        if name not in _NAMES or name in values or set(metric)-allowed:_reject('labels')
        number=_number(sample[1])
        if not timestamps and (number!=int(number) or name.endswith('.available') and number not in (0,1)):_reject('number')
        if not timestamps and name.endswith(('.backends','.waiting_locks')) and number>1_000_000:_reject('number')
        values[name]=number
        labels[name]={k:v for k,v in metric.items() if k not in ('__name__','source_metric')}
    return values,labels


def _report(freshness,reason,points=0,age=None,continuity='unknown'):
    return {'freshness':freshness,'reason':reason,'points':points,'age_seconds':age,
            'continuity':continuity,'count_complete':False}


def _present_sample(values,completed_us):
    sample=values.get('inside.postgresql.server.sample_time_microseconds')
    for suffix in ('sample_time_microseconds','postmaster_start_time_microseconds','statistics_reset_time_microseconds'):
        value=values.get('inside.postgresql.server.'+suffix)
        if value is not None and (not 0<value<=completed_us or sample is not None and value>sample):_reject('oracle_identity')
    return sample


def _refine_join_reason(labels,time_labels,stamps,completed_us):
    # Only exact parser-owned shapes may contribute a post-rejection category.
    coarse='oracle_join'
    if (type(labels) is not dict or type(time_labels) is not dict or type(stamps) is not dict
            or type(completed_us) is not int or not 0<completed_us<=_MAX):return coarse
    for mapping in (labels,time_labels,stamps):
        if len(mapping)>7 or any(type(key) is not str or key not in _NAMES for key in mapping):return coarse
    presence,scope,zero,future=ORACLE_JOIN_REASONS
    if set(labels)!=set(time_labels):return presence
    for mapping in (labels,time_labels):
        for value in mapping.values():
            if type(value) is not dict or len(value) not in (4,5):return coarse
            if any(type(key) is not str or type(item) is not str for key,item in value.items()):return coarse
            if set(value) not in (set(_FIXED),{*_FIXED,'scope.version'}):return coarse
            if any(value[key]!=item for key,item in _FIXED.items()):return coarse
            if value.get('scope.version','') not in ('','unknown'):return coarse
    if labels!=time_labels:return scope
    if set(stamps)!=set(labels):return coarse
    limit=Decimal(completed_us)/1_000_000
    for stamp in stamps.values():
        if type(stamp) is not Decimal or not stamp.is_finite() or not 0<=stamp<=_MAX:return coarse
        if stamp==0:return zero
        if stamp>limit:return future
    return coarse


def evaluate(raw_values,raw_timestamps,*,evaluated_at,completed_us,expected,owner_current=True,diagnose=False):
    if type(diagnose) is not bool:raise ValueError('malformed')
    stage='input'
    try:
        if (type(evaluated_at) is not int or evaluated_at<=0 or type(completed_us) is not int
                or not 0<completed_us<=_MAX or type(owner_current) is not bool):_reject('oracle_input')
        stage='values';values,labels=_vector(raw_values,evaluated_at)
        stage='timestamps';stamps,time_labels=_vector(raw_timestamps,evaluated_at,timestamps=True)
        stage='verdict'
        if labels!=time_labels or any(not 0<stamp<=Decimal(completed_us)/1_000_000 for stamp in stamps.values()):_reject('oracle_join')
        # Check every present retained identity/cohort before missing, ownership or zero projection.
        sample=_present_sample(values,completed_us)
        retained={name:stamp for name,stamp in stamps.items() if name!='inside.postgresql.server.available'}
        if len(set(retained.values()))>1:_reject('oracle_cohort')
        if sample is not None and any(stamp!=Decimal(int(sample)//1000)/1000 for stamp in retained.values()):_reject('oracle_cohort')
        available=values.get('inside.postgresql.server.available')
        if available==0 and retained and stamps['inside.postgresql.server.available']<next(iter(retained.values())):_reject('oracle_availability_order')
        if not owner_current:return _diagnosed(_report('unavailable','ownership',len(values),continuity='ownership_changed'),diagnose,'oracle_unavailable')
        if available==0:
            failure_age=Decimal(completed_us)/1_000_000-stamps['inside.postgresql.server.available']
            if failure_age>10:return _diagnosed(_report('stale','stale',len(values),min(float(failure_age),600)),diagnose,'oracle_stale')
            return _diagnosed(_report('unavailable','connection',len(values)),diagnose,'oracle_unavailable')
        if set(values)!=_NAMES or set(stamps)!=_NAMES:return _report('missing','storage',len(values))
        sample=values['inside.postgresql.server.sample_time_microseconds']
        if sample<=0 or sample>completed_us+2_000_000 or any(stamp<=0 for stamp in stamps.values()):_reject('oracle_complete_time')
        stored_stamp=Decimal(int(sample)//1000)/1000
        if set(stamps.values())!={stored_stamp}:_reject('oracle_complete_time')
        for suffix in ('postmaster_start_time_microseconds','statistics_reset_time_microseconds'):
            if not 0<values['inside.postgresql.server.'+suffix]<=sample:_reject('oracle_complete_identity')
        age=Decimal(completed_us)/1_000_000-sample/1_000_000
        if age<0:_reject('oracle_age')
        if age>10:return _diagnosed(_report('stale','stale',7,min(float(age),600)),diagnose,'oracle_stale')
        if type(expected) is not dict or set(expected)!={'sample_us','postmaster_us','stats_reset_us','connected_backends','waiting_locks','deadlocks'}:_reject('oracle_expected')
        wanted={'inside.postgresql.server.backends':expected['connected_backends'],
                'inside.postgresql.server.waiting_locks':expected['waiting_locks'],
                'inside.postgresql.server.deadlocks_since_reset':expected['deadlocks'],
                'inside.postgresql.server.postmaster_start_time_microseconds':expected['postmaster_us'],
                'inside.postgresql.server.statistics_reset_time_microseconds':expected['stats_reset_us'],
                'inside.postgresql.server.sample_time_microseconds':expected['sample_us'],'inside.postgresql.server.available':1}
        if any(type(v) is not int or not 0<=v<=_MAX for v in expected.values()):_reject('oracle_expected')
        if values!=wanted:
            # A prior complete admitted frame may remain pending while fixed publication settles.
            if sample<expected['sample_us']:return _report('missing','storage',7,float(age))
            _reject('oracle_value_mismatch')
        return _report('fresh','none',7,float(age))
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError) as error:
        reason='oracle_malformed_unknown'
        if type(error) is _Malformed:
            try:group=object.__getattribute__(error,'_group')
            except AttributeError:group=None
            if type(group) is str:
                if stage in _VECTOR_REASONS:reason=_VECTOR_REASONS[stage].get(group,reason)
                elif group in ORACLE_BASE_REASONS:reason=group
                if diagnose and stage=='verdict' and group=='oracle_join':
                    traceback=BaseException.__traceback__.__get__(error)
                    try:
                        refined=_refine_join_reason(labels,time_labels,stamps,completed_us)
                        if type(refined) is str and refined in ORACLE_JOIN_REASONS:reason=refined
                    except BaseException:pass
                    finally:BaseException.__traceback__.__set__(error,traceback)
        elif stage in _VECTOR_REASONS and type(error) in (json.JSONDecodeError,UnicodeEncodeError,RecursionError):
            reason=_VECTOR_REASONS[stage]['decode']
        return _diagnosed(_report('malformed','malformed'),diagnose,reason)


def evaluate_protocol(raw_values,raw_timestamps,raw_global,*,evaluated_at,completed_us,expected):
    """Full protocol-only seven-family vector; clean rows alone do not prove pipeline completion."""
    try:
        # Validate even a poisoned last global row before returning ordinary pending/health.
        global_values,global_labels=_vector(raw_global,evaluated_at)
        _present_sample(global_values,completed_us)
        values,labels=_vector(raw_values,evaluated_at)
        ordinary=evaluate(raw_values,raw_timestamps,evaluated_at=evaluated_at,completed_us=completed_us,expected=expected)
        if ordinary['freshness']!='fresh':return ordinary
        if any(global_values[name]!=values[name] or global_labels[name]!=labels[name] for name in global_values):_refuse()
        if set(global_values)!=_NAMES:return _report('missing','storage',len(global_values))
        if global_values!=values or global_labels!=labels:_refuse()
        return ordinary
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        return _report('malformed','malformed')
