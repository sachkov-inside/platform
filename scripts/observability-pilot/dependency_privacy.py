"""Fixed external dependency challenges and full-storage verdicts, not an SDK or sanitizer."""
import json
import math
import struct
from collector_privacy import SENTINEL

OPERATIONS = ('delete','find','initUpload')
OUTCOMES = ('completed','failed')
TRACE_IDS = {'json':'d'*31+'3','protobuf':'d'*31+'4'}
RELEASES = {'json':'a'*40,'protobuf':'b'*40}
CASES = tuple((operation,outcome) for operation in OPERATIONS for outcome in OUTCOMES)
REGISTERED = tuple(('kinescope',op,out) for op,out in CASES) + tuple(
    ('postgresql',op,out) for op in ('query','acquire','material-slug-lock') for out in OUTCOMES) + tuple(
    ('tbank',op,out) for op in ('Init','GetState','CheckOrder','Charge','Cancel','AddCard','GetAddCardState') for out in OUTCOMES) + tuple(('logto','jwks',out) for out in OUTCOMES) + tuple(('telegram',op,out) for op in ('community.set','community.status') for out in OUTCOMES)
POOL = {'available':1,'total':2,'idle':1,'waiting':3,'registry_overflow':0}
METRICS = ('inside.dependency.operations','inside.dependency.duration')


def _json(now_ns, batch=None):
    def attr(key, value):
        return {'key':key,'value':{'stringValue':value}}
    resource = {'attributes':[attr('service.name','platform-api'),
        attr('deployment.environment.name','isolated-pilot'),attr('service.version','a'*40),
        attr('authorization',SENTINEL)]}
    cases = [(op,out,dep) for dep,op,out in REGISTERED]
    cases += [(SENTINEL,SENTINEL,SENTINEL),(True,42,False),(None,None,None)]
    spans, points = [], []
    for index,(operation,outcome,dependency) in enumerate(cases):
        known = index < len(REGISTERED)
        def dimensions(keys):
            result = []
            for key,value in zip(keys,(dependency,operation,outcome)):
                if value is None:
                    continue
                wire = ({'boolValue':value} if type(value) is bool else
                        {'intValue':str(value)} if type(value) is int else {'stringValue':value})
                result.append({'key':key,'value':wire})
            return result
        unsafe = [attr(key,SENTINEL) for key in ('url.full','provider.request_id','http.request.body',
            'http.response.body','authorization','user.email','exception.message','exception.stacktrace','db.statement','db.query.text','db.query.parameters','db.connection_string','db.response.status_code','TerminalKey','Token','PaymentId','OrderId','RebillId','Amount','operationId','accountRef','telegramIdentityRef','linkRef','correlationRef','entitlementRevision','access','groupUrl')]
        spans.append({'traceId':TRACE_IDS['json'],'spanId':f'{index+1:016x}','parentSpanId':'b'*16,
            'name':SENTINEL,'kind':1 if operation=='material-slug-lock' else 3,'startTimeUnixNano':str(now_ns),'endTimeUnixNano':str(now_ns+1_000_000),
            'traceState':'private='+SENTINEL,
            'attributes':dimensions(('dependency.name','dependency.operation','dependency.outcome'))+
                [attr('http.request.method', 'GET' if dependency=='logto' else 'POST' if dependency in ('tbank','telegram') else {'delete':'DELETE','find':'GET','initUpload':'POST'}.get(operation,SENTINEL)),
                 {'key':'http.response.status_code','value':{'intValue':'200' if index < 6 or dependency=='logto' else '999'}}]+unsafe,
            'events':[{'timeUnixNano':str(now_ns),'name':SENTINEL,'attributes':unsafe}],
            'status':{'code':0 if known and outcome=='completed' else 2,'message':SENTINEL}})
        points.append({'timeUnixNano':str(now_ns),
            'attributes':dimensions(('dependency','operation','outcome'))+unsafe+
                [{'key':'http.response.status_code','value':{'intValue':'200'}}]})
    metrics = [
        {'name':METRICS[0],'sum':{'aggregationTemporality':2,'isMonotonic':True,
            'dataPoints':[{**point,'asInt':'1'} for point in points]}},
        {'name':METRICS[1],'unit':'s','histogram':{'aggregationTemporality':2,
            'dataPoints':[{**point,'count':'1','sum':.25,'bucketCounts':['1','0'],
                          'explicitBounds':[1.0]} for point in points]}},
        {'name':'inside.dependency.private','gauge':{'dataPoints':[{**points[0],'asInt':'1'}]}},
    ]
    for name,value in POOL.items():
        metrics.append({'name':'inside.postgresql.pool.'+name,'gauge':{'dataPoints':[
            {'timeUnixNano':str(now_ns),'asInt':str(value),'attributes':unsafe}]}})
    if batch is not None:
        # Two fixed disjoint halves preserve every challenge without raising wire budgets.
        selected = slice(0,18) if batch == 0 else slice(18,None)
        spans = spans[selected]
        metrics[0]['sum']['dataPoints'] = metrics[0]['sum']['dataPoints'][selected]
        metrics[1]['histogram']['dataPoints'] = metrics[1]['histogram']['dataPoints'][selected]
        if batch == 1:
            metrics = metrics[:2]
    return {'traces':{'resourceSpans':[{'resource':resource,'scopeSpans':[{
                'scope':{'name':SENTINEL,'version':SENTINEL,'attributes':[attr('private',SENTINEL)]},'spans':spans}]}]},
            'metrics':{'resourceMetrics':[{'resource':resource,'scopeMetrics':[{
                'scope':{'name':SENTINEL,'version':SENTINEL},'metrics':metrics}]}]}}


def _integer(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127)|128)
        value >>= 7
    return bytes(result)+bytes([value])


def _field(number,value):
    return _integer(number*8+2)+_integer(len(value))+value


def _text(number,value):
    return _field(number,value.encode())


def _attribute(attribute):
    key,value = attribute['key'],attribute['value']
    if 'stringValue' in value:
        encoded = _text(1,value['stringValue'])
    elif 'boolValue' in value:
        encoded = b'\x10'+bytes([value['boolValue']])
    else:
        encoded = b'\x18'+_integer(int(value['intValue']))
    return _text(1,key)+_field(2,encoded)


def _protobuf(now_ns, batch=None):
    """Literal proto v1.5 field encoding of this fixed corpus; no arbitrary serialization API."""
    body = _json(now_ns, batch)
    resource = body['traces']['resourceSpans'][0]['resource']
    resource['attributes'][2]['value']['stringValue']=RELEASES['protobuf']
    encoded_resource = b''.join(_field(1,_attribute(attr)) for attr in resource['attributes'])
    scope = _text(1,SENTINEL)+_text(2,SENTINEL)+_field(3,_attribute({'key':'private','value':{'stringValue':SENTINEL}}))
    spans = []
    for span in body['traces']['resourceSpans'][0]['scopeSpans'][0]['spans']:
        event = span['events'][0]
        encoded_event = b'\x09'+struct.pack('<Q',now_ns)+_text(2,event['name'])+b''.join(_field(3,_attribute(attr)) for attr in event['attributes'])
        encoded = (_field(1,bytes.fromhex(TRACE_IDS['protobuf']))+_field(2,bytes.fromhex(span['spanId']))+
            _text(3,span['traceState'])+_field(4,bytes.fromhex(span['parentSpanId']))+_text(5,span['name'])+
            b'\x30'+bytes([span['kind']])+b'\x39'+struct.pack('<Q',now_ns)+b'\x41'+struct.pack('<Q',now_ns+1_000_000)+
            b''.join(_field(9,_attribute(attr)) for attr in span['attributes'])+_field(11,encoded_event)+
            _field(15,_text(2,SENTINEL)+b'\x18'+bytes([span['status']['code']])))
        spans.append(_field(2,encoded))
    traces = _field(1,_field(1,encoded_resource)+_field(2,_field(1,scope)+b''.join(spans)))
    encoded_metrics = []
    for metric in body['metrics']['resourceMetrics'][0]['scopeMetrics'][0]['metrics']:
        if 'sum' in metric:
            points = b''.join(_field(1,b''.join(_field(7,_attribute(attr)) for attr in point['attributes'])+
                b'\x19'+struct.pack('<Q',now_ns)+b'\x31'+struct.pack('<q',1)) for point in metric['sum']['dataPoints'])
            data = _field(7,points+b'\x10\x02\x18\x01')
        elif 'histogram' in metric:
            points = b''.join(_field(1,b''.join(_field(9,_attribute(attr)) for attr in point['attributes'])+
                b'\x19'+struct.pack('<Q',now_ns)+b'\x21'+struct.pack('<Q',1)+b'\x29'+struct.pack('<d',.25)+
                _field(6,struct.pack('<QQ',1,0))+_field(7,struct.pack('<d',1.0))) for point in metric['histogram']['dataPoints'])
            data = _text(3,'s')+_field(9,points+b'\x10\x02')
        else:
            point = metric['gauge']['dataPoints'][0]
            data = _field(5,_field(1,b''.join(_field(7,_attribute(attr)) for attr in point['attributes'])+
                b'\x19'+struct.pack('<Q',now_ns)+b'\x31'+struct.pack('<q',int(point['asInt']))))
        encoded_metrics.append(_field(2,_text(1,metric['name'])+data))
    metrics = _field(1,_field(1,encoded_resource)+_field(2,_field(1,scope)+b''.join(encoded_metrics)))
    return {'traces':traces,'metrics':metrics}


def payloads(transport,now_ns):
    return {'json':_json,'protobuf':_protobuf}[transport](now_ns)


def payload_batches(transport,now_ns):
    """Exactly two fixed, disjoint ingest batches; no challenge field is dropped."""
    batches = tuple({'json':_json,'protobuf':_protobuf}[transport](now_ns,batch) for batch in (0,1))
    for batch in batches:
        for body in batch.values():
            if (isinstance(body,bytes) and len(body)>=65536) or (isinstance(body,dict) and len(json.dumps(body).encode())>1_048_576):
                raise RuntimeError('fixed dependency batch exceeds original wire budget')
    return batches


def _unique(pairs):
    result = {}
    for key,value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key]=value
    return result


def stored_traces(raw,transport):
    """Require full stored rows before a public projection can hide private fields."""
    try:
        if not isinstance(raw,str) or len(raw.encode())>1_048_576 or SENTINEL in raw:
            raise ValueError('unsafe response')
        rows = [json.loads(line,object_pairs_hook=_unique) for line in raw.splitlines() if line.strip()]
        if SENTINEL in json.dumps(rows):
            raise ValueError('unsafe decoded response')
        if len(rows)<len(REGISTERED)+3:
            return None
        if len(rows)!=len(REGISTERED)+3 or any(not isinstance(row,dict) or not all(isinstance(value,str) for value in row.values()) for row in rows):
            raise ValueError('invalid rows')
        by_id = {row['span_id']:row for row in rows}
        if set(by_id)!={f'{index:016x}' for index in range(1,len(REGISTERED)+4)}:
            raise ValueError('lost identities')
        for index,(dependency,operation,outcome) in enumerate((*REGISTERED,('_OTHER','_OTHER','_OTHER'),('_OTHER','_OTHER','_OTHER'),(None,None,None))):
            row = by_id[f'{index+1:016x}']
            attributes = {'span_attr:http.request.method':'GET' if dependency=='logto' else 'POST' if dependency in ('tbank','telegram') else {'delete':'DELETE','find':'GET','initUpload':'POST'}.get(operation,'_OTHER')}
            if index < len(REGISTERED)+2:
                attributes.update({'span_attr:dependency.name':dependency,
                    'span_attr:dependency.operation':operation,'span_attr:dependency.outcome':outcome})
            if index < 6 or dependency=='logto':
                attributes['span_attr:http.response.status_code']='200'
            expected = {'trace_id':TRACE_IDS[transport],'parent_span_id':'b'*16,
                'resource_attr:service.name':'platform-api','resource_attr:deployment.environment.name':'isolated-pilot',
                'resource_attr:service.version':RELEASES[transport],'scope_name':'inside-collector',
                'name':(dependency+' '+operation if index<len(REGISTERED)+2 else 'operation'),
                'kind':'1' if operation=='material-slug-lock' else '3','status_code':'0' if index<len(REGISTERED) and outcome=='completed' else '2',**attributes}
            if any(row.get(key)!=value for key,value in expected.items()):
                raise ValueError('lost registered field')
            if {key for key in row if key.startswith('span_attr:')}!=set(attributes):
                raise ValueError('extra span field')
            if ({key for key in row if key.startswith('resource_attr:')} !=
                    {'resource_attr:service.name','resource_attr:deployment.environment.name','resource_attr:service.version'} or
                    any(key.startswith(('scope_attr:','event:','link:')) for key in row) or
                    any(row.get(key,'')!='' for key in ('status_message','trace_state','scope_version'))):
                raise ValueError('extra resource/scope/error field')
        return {'transport':transport,'stored_spans':35,'registered_completions':32,
            'causality':'passed','fallback':'passed','privacy':'passed'}
    except (ValueError,KeyError,TypeError):
        raise RuntimeError('dependency full-storage contract failed; raw response withheld') from None


def stored_metrics(response):
    if response[0]!=200:
        return None
    expected = {(release,dependency,operation,outcome,name,le) for release in RELEASES.values()
        for dependency,operation,outcome in (*REGISTERED,('_OTHER','_OTHER','_OTHER'))
        for name,le in ((METRICS[0],None),(METRICS[1]+'_count',None),(METRICS[1]+'_sum',None),
                       (METRICS[1]+'_bucket','1'),(METRICS[1]+'_bucket','+Inf'))}
    try:
        if not isinstance(response[1],str) or len(response[1].encode())>1_048_576:
            raise ValueError('oversize response')
        body = json.loads(response[1],object_pairs_hook=_unique)
        if SENTINEL in json.dumps(body) or body['status']!='success' or body['data']['resultType']!='vector':
            raise ValueError('unsafe metric response')
        rows=body['data']['result']
        if not isinstance(rows,list) or len(rows)>1000:
            raise ValueError('invalid bounded vector')
        seen=set(); pool_seen=set()
        for row in rows:
            labels=row['metric']
            if not isinstance(labels,dict) or not isinstance(labels.get('__name__'),str):
                raise ValueError('invalid metric')
            if labels['__name__'].startswith('inside.postgresql.pool.'):
                name=labels['__name__'].removeprefix('inside.postgresql.pool.')
                fixed={'service.name':'platform-api','deployment.environment.name':'isolated-pilot','scope.name':'inside-collector'}
                key=(labels.get('service.version'),name)
                if (name not in POOL or key[0] not in RELEASES.values() or key in pool_seen or
                    any(labels.get(k)!=v for k,v in fixed.items()) or
                    set(labels)-{'__name__','service.name','deployment.environment.name','service.version','scope.name','scope.version'} or
                    labels.get('scope.version','') not in ('','unknown')):
                    raise ValueError('invalid pool dimensions')
                value=row['value']
                if (not isinstance(value,list) or len(value)!=2 or type(value[0]) not in (int,float) or
                    not math.isfinite(value[0]) or not isinstance(value[1],str) or float(value[1])!=POOL[name]):
                    raise ValueError('invalid pool point')
                pool_seen.add(key)
                continue
            if not labels['__name__'].startswith('inside.dependency.'):
                continue
            fixed={'service.name':'platform-api','deployment.environment.name':'isolated-pilot','scope.name':'inside-collector'}
            if (any(labels.get(k)!=v for k,v in fixed.items()) or
                    set(labels)-{'__name__','service.name','deployment.environment.name','service.version',
                                 'scope.name','scope.version','dependency','operation','outcome','le'} or
                    labels.get('scope.version','') not in ('','unknown')):
                raise ValueError('unexpected dimensions')
            key=(labels['service.version'],labels['dependency'],labels['operation'],labels['outcome'],labels['__name__'],labels.get('le'))
            if key not in expected or key in seen:
                raise ValueError('unknown or duplicate series')
            value=row['value']
            if (not isinstance(value,list) or len(value)!=2 or not isinstance(value[1],str) or
                    type(value[0]) not in (int,float) or not math.isfinite(value[0])):
                raise ValueError('invalid sample')
            number=float(value[1])
            if not math.isfinite(number) or number!=(.25 if labels['__name__'].endswith('_sum') else 1):
                raise ValueError('lost value')
            seen.add(key)
        if seen!=expected or pool_seen!={(release,name) for release in RELEASES.values() for name in POOL}:
            return None
        return {'stored_series':340,'metric_labelsets':66,'pool_series':10,'privacy':'passed'}
    except (ValueError,KeyError,TypeError):
        raise RuntimeError('dependency metric contract failed; raw response withheld') from None
