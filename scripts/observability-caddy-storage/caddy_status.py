"""Whole pinned Caddy query observations; never a production availability claim."""
from decimal import Decimal,InvalidOperation
import json
import math
from pathlib import Path
import re
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status

MAX_NUMBER=2**53-1
MAX_BODY_BYTES=1_048_576
MAX_ROWS=1000
MAX_OUTPUT_BYTES=131_072
MAX_AGE_SECONDS=10
MAX_GROUPS=64
BUCKETS=('0.005','0.01','0.025','0.05','0.1','0.25','0.5','1','2.5','5','10','+Inf')
METHODS=('GET','HEAD','PUT','POST','DELETE','CONNECT','OPTIONS','TRACE','PATCH','OTHER')
PREFIX='caddy_http_'
DURATION=PREFIX+'request_duration_seconds_'
TOTAL=PREFIX+'requests_total'
ERRORS=PREFIX+'request_errors_total'
FLIGHT=PREFIX+'requests_in_flight'
NAMES=('up',TOTAL,ERRORS,FLIGHT,DURATION+'bucket',DURATION+'sum',DURATION+'count')
PARTIAL_REASONS=('partial_missing_total','partial_missing_errors','partial_missing_flight',
    'partial_no_duration_groups','partial_missing_bucket','partial_missing_sum','partial_missing_count',
    'partial_count_sum','partial_timestamps')
NOT_COVERED=['production-caddy','host','tcp','tls','http3','pre-route-parse','raw-errors']


def refuse():
    raise ValueError('closed Caddy observation refused')


def number(value):
    if type(value) is not str or len(value)>128 or re.fullmatch(r'(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?',value) is None: refuse()
    try: result=Decimal(value)
    except InvalidOperation: refuse()
    if not result.is_finite() or not 0<=result<=MAX_NUMBER: refuse()
    return result


def clock(value):
    if type(value) not in (int,float,Decimal) or not math.isfinite(value) or not 0<=value<=MAX_NUMBER: refuse()
    return Decimal(str(value))


def record(state,reason='none',age=None,observation=None,comparison=None):
    return {'schema':1,'scope':'isolated-pilot-caddy','partition':'srv0/subroute','state':state,'reason':reason,
            'sample_age_seconds':None if age is None else float(age),'observation':observation,'comparison':comparison,
            'transport':{'canonical':'unrun','mcp':'unrun'},'not_covered':NOT_COVERED.copy()}


def unavailable(reason):
    if reason not in ('credentials','timeout','transport','http_error','interrupted'): refuse()
    return record('query_unavailable',reason)


def _identity(metric,timestamps):
    if type(metric) is not dict or any(type(v) is not str for v in metric.values()): refuse()
    labels=metric.copy()
    if timestamps:
        name=labels.pop('source_metric',None)
        if type(name) is not str or labels.pop('__name__',name)!=name: refuse()
        labels['__name__']=name
    name=labels.get('__name__')
    if name not in NAMES or labels.get('job')!='platform-caddy' or labels.get('instance')!='pilot': refuse()
    keys={'__name__','job','instance'}
    if name!='up':
        keys|={'server','handler'}
        if labels.get('server')!='srv0' or labels.get('handler')!='subroute': refuse()
        if name.startswith(DURATION):
            keys|={'method','code'}
            if labels.get('method') not in METHODS or re.fullmatch('[1-5][0-9]{2}',labels.get('code','')) is None: refuse()
            if name==DURATION+'bucket':
                keys.add('le')
                if labels.get('le') not in BUCKETS: refuse()
    if set(labels)!=keys: refuse()
    return tuple(sorted(labels.items()))


def _stats(value):
    if (type(value) is not dict or set(value)!={'seriesFetched','executionTimeMsec'}
            or type(value['seriesFetched']) is not str or re.fullmatch(r'(?:0|[1-9][0-9]{0,18})',value['seriesFetched']) is None
            or int(value['seriesFetched'])>2**63-1 or type(value['executionTimeMsec']) is not int
            or not 0<=value['executionTimeMsec']<=(2**63-1)//1_000_000): refuse()


def _vector(raw,evaluated,timestamps=False):
    body=source_status.decode_json(raw)
    if (type(body) is not dict or set(body) not in ({'status','data'},{'status','data','stats'}) or body['status']!='success'
            or type(body['data']) is not dict or set(body['data'])!={'resultType','result'} or body['data']['resultType']!='vector'
            or type(body['data']['result']) is not list): refuse()
    if 'stats' in body:_stats(body['stats'])
    rows={}
    for row in body['data']['result']:
        if type(row) is not dict or set(row)!={'metric','value'}: refuse()
        key=_identity(row['metric'],timestamps);point=row['value']
        if type(point) is not list or len(point)!=2 or clock(point[0])!=evaluated or key in rows: refuse()
        value=number(point[1]);name=dict(key)['__name__']
        if timestamps:
            if value>evaluated: refuse()
        elif name=='up':
            if value not in (0,1): refuse()
        elif name!=DURATION+'sum' and value!=value.to_integral_value(): refuse()
        rows[key]=value
    return rows


def acquire(values,timestamps,*,evaluated_at,completed_at):
    evaluated,completed=clock(evaluated_at),clock(completed_at)
    if evaluated!=evaluated.to_integral_value() or completed<evaluated: refuse()
    rows,stamps=_vector(values,evaluated),_vector(timestamps,evaluated,True)
    if rows.keys()!=stamps.keys(): refuse()
    return rows,stamps


def _observation(rows):
    return _observation_result(rows)[0]


def _observation_result(rows,*,diagnose=False):
    simple={};groups={}
    for key,value in rows.items():
        labels=dict(key);name=labels['__name__']
        if name in (TOTAL,ERRORS,FLIGHT): simple[name]=int(value)
        elif name.startswith(DURATION):
            identity=(labels['method'],int(labels['code']))
            group=groups.setdefault(identity,{})
            group[labels.get('le',name.removeprefix(DURATION))]=value
    if len(groups)>MAX_GROUPS: refuse()
    if ERRORS in simple and TOTAL in simple and simple[ERRORS]>simple[TOTAL]:refuse()
    if TOTAL in simple and sum(group.get('count',0) for group in groups.values())>simple[TOTAL]:refuse()
    complete=True;duration=[];missing_bucket=missing_sum=missing_count=False
    for (method,code),group in sorted(groups.items()):
        visible=[group[bound] for bound in BUCKETS if bound in group]
        if any(a>b for a,b in zip(visible,visible[1:])):refuse()
        if 'count' in group:
            if (any(value>group['count'] for value in visible)
                    or '+Inf' in group and group['+Inf']!=group['count']
                    or group['count']==0 and group.get('sum',0)!=0):refuse()
        if set(group)!=set((*BUCKETS,'sum','count')):
            complete=False
            if diagnose is True:
                missing_bucket=missing_bucket or any(bound not in group for bound in BUCKETS)
                missing_sum=missing_sum or 'sum' not in group
                missing_count=missing_count or 'count' not in group
            continue
        buckets=[int(group[bound]) for bound in BUCKETS];count=int(group['count'])
        if any(a>b for a,b in zip(buckets,buckets[1:])) or buckets[-1]!=count: refuse()
        duration.append({'method':method,'code':code,'count':count,'sum_seconds':float(group['sum']),'buckets':buckets})
    if set(simple)!={TOTAL,ERRORS,FLIGHT} or not groups or not complete:
        reason=None
        if diagnose is True:
            if TOTAL not in simple:reason='partial_missing_total'
            elif ERRORS not in simple:reason='partial_missing_errors'
            elif FLIGHT not in simple:reason='partial_missing_flight'
            elif not groups:reason='partial_no_duration_groups'
            elif missing_bucket:reason='partial_missing_bucket'
            elif missing_sum:reason='partial_missing_sum'
            elif missing_count:reason='partial_missing_count'
        return None,reason
    if simple[ERRORS]>simple[TOTAL] or sum(g['count'] for g in duration)>simple[TOTAL]: refuse()
    if sum(g['count'] for g in duration)!=simple[TOTAL]:return None,'partial_count_sum' if diagnose is True else None
    return {'requests_total':simple[TOTAL],'request_errors_total':simple[ERRORS],'in_flight':simple[FLIGHT],'duration':duration},None


def evaluate(values,timestamps,*,evaluated_at,completed_at,previous=None,completion_clock=None,diagnose=False):
    try:
        rows,stamps=acquire(values,timestamps,evaluated_at=evaluated_at,completed_at=completed_at)
        # Validate every group even when availability is missing/down.
        partial_reason=None
        if diagnose is True:observed,partial_reason=_observation_result(rows,diagnose=True)
        else:observed=_observation(rows)
        completed=clock(completed_at)
        if completion_clock is not None:
            final=clock(completion_clock())
            if final<completed:refuse()
            completed=final
        up=tuple(sorted({'__name__':'up','job':'platform-caddy','instance':'pilot'}.items()))
        if up not in rows:result=record('missing')
        else:
            age=completed-stamps[up]
            if age>MAX_AGE_SECONDS:result=record('stale',age=age)
            elif rows[up]==0:result=record('down',age=age)
            elif any(completed-stamp>MAX_AGE_SECONDS for stamp in stamps.values()):result=record('stale',age=age)
            elif observed is None or len(set(stamps.values()))!=1:
                reason='unseeded' if len(rows)==1 else 'partial'
                if diagnose is True and reason=='partial':
                    if observed is not None:partial_reason='partial_timestamps'
                    if type(partial_reason) is str and partial_reason in PARTIAL_REASONS:reason=partial_reason
                result=record('incomplete',reason,age)
            else:result=record('observed',age=age,observation=observed)
        if previous is not None:
            # Prior acquisitions are validated afresh; never trust a projected caller-created baseline.
            if type(previous) is not dict or set(previous)!={'values','timestamps','evaluated_at','completed_at'} or clock(previous['completed_at'])>clock(evaluated_at):refuse()
            old,old_stamps=acquire(**previous);_observation(old)
            for key in rows.keys()&old.keys():
                if stamps[key]==old_stamps[key] and rows[key]!=old[key]:refuse()
            if result['state']=='observed':
                baseline_observed=(old.get(up)==1 and len(set(old_stamps.values()))==1
                    and all(clock(previous['completed_at'])-stamp<=MAX_AGE_SECONDS for stamp in old_stamps.values()))
                result['comparison']=(compare(rows,stamps,old,old_stamps) if baseline_observed else
                    {'state':'incomplete','requests_delta':None,'errors_delta':None,'duration':[]})
        if len(json.dumps(result).encode())>MAX_OUTPUT_BYTES:refuse()
        return result
    except (ValueError,TypeError,KeyError,InvalidOperation,OverflowError):
        return record('malformed','raw_contract')


def compare(rows,stamps,old,old_stamps):
    incomplete={'state':'incomplete','requests_delta':None,'errors_delta':None,'duration':[]}
    if rows.keys()!=old.keys() or _observation(old) is None:return incomplete
    if any(stamps[key]<=old_stamps[key] for key in rows):return incomplete
    counters=[key for key in rows if dict(key)['__name__'] not in ('up',FLIGHT)]
    if any(rows[key]<old[key] for key in counters):return {**incomplete,'state':'reset_observed'}
    if any(stamps[key]-old_stamps[key]>MAX_AGE_SECONDS for key in rows):return incomplete
    delta={key:rows[key]-old[key] for key in counters}
    observation=_observation({**delta,**{key:rows[key] for key in rows if dict(key)['__name__'] in ('up',FLIGHT)}})
    if observation is None:return incomplete
    return {'state':'observed','requests_delta':observation['requests_total'],'errors_delta':observation['request_errors_total'],
            'duration':[{'method':g['method'],'code':g['code'],'count_delta':g['count'],'sum_seconds_delta':g['sum_seconds'],'bucket_deltas':g['buckets']} for g in observation['duration']]}
