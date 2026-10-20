"""Strict complete native storage verdicts for the fixed Telegram privacy corpus, not a sanitizer."""
import datetime
from decimal import Decimal
import json
import math
import re

# Independent expected protocol facts. This module never imports a challenge encoder.
_MAX_BYTES = 1_048_576
_SENTINEL = 'TELEGRAM_RUNTIME_PRIVACY_SENTINEL_1566'
_OPERATIONS = (('receipt','completed'), ('authorization','accepted'), ('attempt','completed'), ('sendMessage','delivered'), ('_OTHER','_OTHER'), ('_OTHER','completed'), ('receipt','_OTHER'))
_HTTP = (('POST','/integrations/platform/v1/communications','completed'), ('_OTHER','_OTHER','_OTHER'))
_HEALTH = {'http.server.active_requests':0,'telemetry.trace.dropped':0,'telemetry.trace.export.failures':0,'telemetry.metric.export.failures':0,'telemetry.trace.sampling.ratio':1}


def _unique(pairs):
    result = {}
    for key,value in pairs:
        if key in result: raise ValueError()
        result[key] = value
    return result


def _constant(_value):
    raise ValueError()


def _decode(raw):
    if type(raw) is not str or len(raw.encode('utf-8',errors='strict')) > _MAX_BYTES or _SENTINEL in raw:
        raise ValueError()
    value = json.loads(raw,object_pairs_hook=_unique,parse_float=Decimal,parse_constant=_constant)
    if _SENTINEL in json.dumps(value,default=str): raise ValueError()
    return value


def _source(transport):
    if transport not in ('json','protobuf'): raise ValueError()
    return '0.1566.1' if transport == 'json' else '0.1566.2'


def _timestamp_matches(value,now_ns):
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z',value)
    if match is None: return False
    seconds = int(datetime.datetime.strptime(match[1],'%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc).timestamp())
    return seconds*1_000_000_000+int((match[2] or '').ljust(9,'0')) == now_ns


def _expected_span(index,transport,now_ns):
    table = (
        ('waitlist receipt','1','0','bbbbbbbbbbbbbbbb',{'telegram.operation':'receipt','telegram.outcome':'completed'}),
        ('platform waitlist.confirm','3','0','0000000000000001',{'telegram.operation':'authorization','telegram.outcome':'accepted','http.response.status_code':'200'}),
        ('waitlist attempt','1','0','0000000000000001',{'telegram.operation':'attempt','telegram.outcome':'completed'}),
        ('telegram sendMessage','3','0','0000000000000003',{'telegram.operation':'sendMessage','telegram.outcome':'delivered'}),
        ('POST /integrations/platform/v1/communications','2','0',None,{'http.request.method':'POST','http.route':'/integrations/platform/v1/communications','http.request.outcome':'completed','http.response.status_code':'200'}),
        ('telegram _OTHER','1','2','0000000000000001',{'telegram.operation':'_OTHER','telegram.outcome':'_OTHER'}),
        ('telegram _OTHER','1','2','0000000000000001',{'telegram.operation':'_OTHER','telegram.outcome':'_OTHER'}),
        ('platform waitlist.confirm','3','2','0000000000000001',{'telegram.operation':'authorization','telegram.outcome':'unavailable'}),
        ('telegram sendMessage','3','2','0000000000000003',{'telegram.operation':'sendMessage','telegram.outcome':'transport_unknown'}),
        ('_OTHER _OTHER','2','2',None,{'http.request.method':'_OTHER','http.route':'_OTHER','http.request.outcome':'_OTHER'}),
    )
    name,kind,status,parent,attrs = table[index]
    suffix = (('83' if index == 4 else '85') if transport == 'json' else ('84' if index == 4 else '86')) if index in (4,9) else ('81' if transport == 'json' else '82')
    trace = ('f' if index in (4,9) else 'e')*30+suffix
    expected = {'trace_id':trace,'span_id':f'{index+1:016x}','resource_attr:service.name':'inside-telegram',
                'resource_attr:deployment.environment.name':'isolated-pilot','resource_attr:service.version':_source(transport),
                'scope_name':'inside-collector','name':name,'kind':kind,'status_code':status,
                'start_time_unix_nano':str(now_ns),'end_time_unix_nano':str(now_ns+1_000_000),'duration':'1000000',
                '_msg':'-','_stream':'{name='+json.dumps(name)+',resource_attr:service.name="inside-telegram"}',
                **{'span_attr:'+key:value for key,value in attrs.items()}}
    if parent is not None: expected['parent_span_id'] = parent
    return expected,parent


def traces(raw,transport,now_ns):
    """Every present row is checked before an incomplete response can be pending."""
    try:
        _source(transport)
        if type(now_ns) is not int or not 0 < now_ns < 2**63-1_000_000: raise ValueError()
        if type(raw) is not str or len(raw.encode('utf-8',errors='strict')) > _MAX_BYTES: raise ValueError()
        rows = [_decode(line) for line in raw.splitlines() if line.strip()]
        if len(rows) > 10: raise ValueError()
        seen,streams,names = set(),{},{}
        for row in rows:
            if type(row) is not dict or not all(type(value) is str for value in row.values()): raise ValueError()
            span = row.get('span_id')
            if type(span) is not str or re.fullmatch(r'[0-9a-f]{16}',span) is None: raise ValueError()
            index = int(span,16)-1
            if index not in range(10) or span in seen: raise ValueError()
            seen.add(span)
            expected,parent = _expected_span(index,transport,now_ns)
            optional = {'scope_version':'','trace_state':'','status_message':'','flags':'0','dropped_attributes_count':'0','dropped_events_count':'0','dropped_links_count':'0'}
            if parent is None: optional['parent_span_id']=''
            required = set(expected)|{'_time','_stream_id'}
            if not required <= set(row) or set(row)-required-set(optional): raise ValueError()
            if any(row[key] != value for key,value in expected.items()) or any(row[key] != optional[key] for key in set(row)&set(optional)): raise ValueError()
            if not _timestamp_matches(row['_time'],now_ns) or re.fullmatch(r'0{16}[0-9a-f]{32}',row['_stream_id']) is None: raise ValueError()
            name,stream = row['name'],row['_stream_id']
            if name in streams and streams[name] != stream or stream in names and names[stream] != name: raise ValueError()
            streams[name],names[stream] = stream,name
        if len(seen) != 10: return None
        return {'transport':transport,'stored_spans':10,'privacy':'passed','causality':'passed'}
    except (ValueError,KeyError,TypeError,UnicodeError,ArithmeticError,RecursionError):
        raise RuntimeError('Telegram runtime stored trace contract failed') from None


def _expected_metrics():
    expected = {}
    for prefix,counter,labels in ([('inside.telegram.duration','inside.telegram.operations',{'operation':op,'outcome':outcome}) for op,outcome in _OPERATIONS]+[('http.server.request.duration','http.server.request.count',dict(zip(('http.request.method','http.route','http.request.outcome'),values))) for values in _HTTP]):
        for name,value in [(counter,Decimal(1)),(prefix+'_count',Decimal(1)),(prefix+'_sum',Decimal('.25'))]:
            expected[(name,tuple(sorted(labels.items())))] = value
        for bound in ('1','+Inf'):
            expected[(prefix+'_bucket',tuple(sorted({**labels,'le':bound}.items())))] = Decimal(1)
    for name,value in _HEALTH.items(): expected[(name,())] = Decimal(value)
    return expected


def metrics(raw,transport):
    """Closed whole-vector schema; no filtering/projection before unknown rows are rejected."""
    try:
        release = _source(transport)
        body = _decode(raw)
        if type(body) is not dict or set(body) not in ({'status','data'},{'status','data','stats'}) or body['status'] != 'success': raise ValueError()
        if 'stats' in body:
            stats = body['stats']
            if type(stats) is not dict or set(stats) != {'seriesFetched','executionTimeMsec'}: raise ValueError()
            count,elapsed = stats['seriesFetched'],stats['executionTimeMsec']
            if type(count) is not str or re.fullmatch(r'0|[1-9][0-9]{0,18}',count) is None or int(count) > 2**63-1 or type(elapsed) is not int or not 0 <= elapsed <= (2**63-1)//1_000_000: raise ValueError()
        data = body['data']
        if type(data) is not dict or set(data) != {'resultType','result'} or data['resultType'] != 'vector': raise ValueError()
        rows = data['result']
        if type(rows) is not list or len(rows) > 50: raise ValueError()
        common = {'service.name':'inside-telegram','deployment.environment.name':'isolated-pilot','service.version':release,'scope.name':'inside-collector'}
        expected,seen = _expected_metrics(),set()
        for row in rows:
            if type(row) is not dict or set(row) != {'metric','value'}: raise ValueError()
            labels,sample = row['metric'],row['value']
            if type(labels) is not dict or not all(type(value) is str for value in labels.values()): raise ValueError()
            if any(labels.get(key) != value for key,value in common.items()) or labels.get('scope.version','') not in ('','unknown'): raise ValueError()
            if type(sample) is not list or len(sample) != 2 or type(sample[0]) not in (int,float,Decimal) or not math.isfinite(sample[0]) or sample[0] <= 0: raise ValueError()
            if type(sample[1]) is not str or re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?',sample[1]) is None: raise ValueError()
            value = Decimal(sample[1])
            dimensions = tuple(sorted((key,value) for key,value in labels.items() if key not in {'__name__',*common,'scope.version'}))
            identity = (labels.get('__name__'),dimensions)
            if identity not in expected or identity in seen or value != expected[identity]: raise ValueError()
            seen.add(identity)
        if seen != set(expected): return None
        return {'transport':transport,'metric_series':50,'privacy':'passed','aggregation':'passed'}
    except (ValueError,KeyError,TypeError,UnicodeError,ArithmeticError,RecursionError):
        raise RuntimeError('Telegram runtime stored metric contract failed') from None
