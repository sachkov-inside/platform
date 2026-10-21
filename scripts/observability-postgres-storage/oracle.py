"""Independent full raw VM vector gate; never imports the source encoder or uses a positive selector."""
from decimal import Decimal
import json
import re

_MAX=9007199254740991
_FIXED={'service.name':'inside-postgresql-source','deployment.environment.name':'isolated-pilot',
        'service.version':'0.1566.3','scope.name':'inside-collector'}
_NAMES={'inside.postgresql.server.'+name for name in ('backends','waiting_locks','deadlocks_since_reset',
        'postmaster_start_time_microseconds','statistics_reset_time_microseconds','sample_time_microseconds','available')}


def _refuse(*_):raise ValueError('malformed')


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:_refuse()
        result[key]=value
    return result


def _number(value):
    if type(value) is not str or len(value)>32 or re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?',value) is None:_refuse()
    result=Decimal(value)
    if not result.is_finite() or not 0<=result<=_MAX:_refuse()
    return result


def _vector(raw,evaluated_at,*,timestamps=False):
    if type(raw) is not str or len(raw.encode('utf-8',errors='strict'))>65536 or raw.startswith('\ufeff'):_refuse()
    body=json.loads(raw,object_pairs_hook=_unique,parse_float=Decimal,parse_constant=_refuse)
    if (type(body) is not dict or set(body) not in ({'status','data'},{'status','data','stats'})
            or body['status']!='success'):_refuse()
    if 'stats' in body:
        stats=body['stats']
        if (type(stats) is not dict or set(stats)!={'seriesFetched','executionTimeMsec'}
                or type(stats['seriesFetched']) is not str or re.fullmatch(r'0|[1-9][0-9]{0,18}',stats['seriesFetched']) is None
                or int(stats['seriesFetched'])>2**63-1 or type(stats['executionTimeMsec']) is not int
                or not 0<=stats['executionTimeMsec']<=(2**63-1)//1_000_000):_refuse()
    data=body['data']
    if (type(data) is not dict or set(data)!={'resultType','result'} or data['resultType']!='vector'
            or type(data['result']) is not list or len(data['result'])>16):_refuse()
    values={};labels={}
    for row in data['result']:
        if type(row) is not dict or set(row)!={'metric','value'}:_refuse()
        metric,sample=row['metric'],row['value']
        if (type(metric) is not dict or any(type(v) is not str for v in metric.values())
                or type(sample) is not list or len(sample)!=2 or type(sample[0]) not in (int,float,Decimal)
                or Decimal(str(sample[0]))!=evaluated_at or any(metric.get(k)!=v for k,v in _FIXED.items())
                or metric.get('scope.version','') not in ('','unknown')):_refuse()
        allowed={'__name__',*_FIXED,'scope.version'}
        if timestamps:
            name=metric.get('source_metric');allowed.add('source_metric')
            if metric.get('__name__',name)!=name:_refuse()
        else:name=metric.get('__name__')
        if name not in _NAMES or name in values or set(metric)-allowed:_refuse()
        number=_number(sample[1])
        if not timestamps and (number!=int(number) or name.endswith('.available') and number not in (0,1)):_refuse()
        if not timestamps and name.endswith(('.backends','.waiting_locks')) and number>1_000_000:_refuse()
        values[name]=number
        labels[name]={k:v for k,v in metric.items() if k not in ('__name__','source_metric')}
    return values,labels


def _report(freshness,reason,points=0,age=None,continuity='unknown'):
    return {'freshness':freshness,'reason':reason,'points':points,'age_seconds':age,
            'continuity':continuity,'count_complete':False}


def evaluate(raw_values,raw_timestamps,*,evaluated_at,completed_us,expected,owner_current=True):
    try:
        if (type(evaluated_at) is not int or evaluated_at<=0 or type(completed_us) is not int
                or not 0<completed_us<=_MAX or type(owner_current) is not bool):_refuse()
        values,labels=_vector(raw_values,evaluated_at);stamps,time_labels=_vector(raw_timestamps,evaluated_at,timestamps=True)
        if labels!=time_labels or any(not 0<stamp<=Decimal(completed_us)/1_000_000 for stamp in stamps.values()):_refuse()
        if not owner_current:return _report('unavailable','ownership',len(values),continuity='ownership_changed')
        available=values.get('inside.postgresql.server.available')
        if available==0:return _report('unavailable','connection',len(values))
        if set(values)!=_NAMES or set(stamps)!=_NAMES:return _report('missing','storage',len(values))
        sample=values['inside.postgresql.server.sample_time_microseconds']
        if sample<=0 or sample>completed_us+2_000_000 or any(stamp<=0 for stamp in stamps.values()):_refuse()
        stored_stamp=Decimal(int(sample)//1000)/1000
        if set(stamps.values())!={stored_stamp}:_refuse()
        for suffix in ('postmaster_start_time_microseconds','statistics_reset_time_microseconds'):
            if not 0<values['inside.postgresql.server.'+suffix]<=sample:_refuse()
        age=Decimal(completed_us)/1_000_000-sample/1_000_000
        if age<0:_refuse()
        if age>10:return _report('stale','stale',7,min(float(age),600))
        if type(expected) is not dict or set(expected)!={'sample_us','postmaster_us','stats_reset_us','connected_backends','waiting_locks','deadlocks'}:_refuse()
        wanted={'inside.postgresql.server.backends':expected['connected_backends'],
                'inside.postgresql.server.waiting_locks':expected['waiting_locks'],
                'inside.postgresql.server.deadlocks_since_reset':expected['deadlocks'],
                'inside.postgresql.server.postmaster_start_time_microseconds':expected['postmaster_us'],
                'inside.postgresql.server.statistics_reset_time_microseconds':expected['stats_reset_us'],
                'inside.postgresql.server.sample_time_microseconds':expected['sample_us'],'inside.postgresql.server.available':1}
        if any(type(v) is not int or not 0<=v<=_MAX for v in expected.values()):_refuse()
        if values!=wanted:
            # A prior complete admitted frame may remain pending while fixed publication settles.
            if sample<expected['sample_us']:return _report('missing','storage',7,float(age))
            _refuse()
        return _report('fresh','none',7,float(age))
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        return _report('malformed','malformed')


def evaluate_protocol(raw_values,raw_timestamps,raw_global,*,evaluated_at,completed_us,expected):
    """Full protocol-only seven-family vector; clean rows alone do not prove pipeline completion."""
    try:
        # Validate even a poisoned last global row before returning ordinary pending/health.
        global_values,global_labels=_vector(raw_global,evaluated_at)
        values,labels=_vector(raw_values,evaluated_at)
        ordinary=evaluate(raw_values,raw_timestamps,evaluated_at=evaluated_at,completed_us=completed_us,expected=expected)
        if ordinary['freshness']!='fresh':return ordinary
        if set(global_values)!=_NAMES:return _report('missing','storage',len(global_values))
        if global_values!=values or global_labels!=labels:_refuse()
        return ordinary
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        return _report('malformed','malformed')
