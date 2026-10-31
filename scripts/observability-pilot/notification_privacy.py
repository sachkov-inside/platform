"""Closed external notifications corpus and verdicts; never an application SDK/gateway."""
import json
import math
import struct
from collector_privacy import SENTINEL

SERVICE = 'platform-notifications-worker'
DESTINATION = 'inside.events.materials.v1'
OPERATIONS = ('publish','receive','audience')
OUTCOMES = ('completed','failed')
METRICS = ('inside.notification.operations','inside.notification.duration')
TRACE_IDS = {'json':'c'*31+'1','protobuf':'c'*31+'2'}
RELEASES = {'json':'a'*40,'protobuf':'b'*40}
CASES = tuple((operation,outcome) for operation in OPERATIONS for outcome in OUTCOMES)
PARENT = 'd'*16
METRIC_QUERY = '{__name__=~"inside[.]notification[.].+"}'


def _attr(key,value):
    return {'key':key,'value':{'stringValue':value}}


def _resource(transport):
    return {'attributes':[_attr('service.name',SERVICE),_attr('deployment.environment.name','isolated-pilot'),
        _attr('service.version',RELEASES[transport]),_attr('authorization',SENTINEL)]}


def _json(now):
    spans = []
    for index,(operation,outcome) in enumerate((*CASES,(SENTINEL,SENTINEL))):
        known = operation in OPERATIONS
        attrs = [_attr('messaging.system','rabbitmq'),_attr('messaging.destination.name',DESTINATION if known else SENTINEL),
            _attr('messaging.operation.name',operation),_attr('user.email',SENTINEL),_attr('db.statement',SENTINEL)]
        if outcome != 'completed':
            attrs.append(_attr('error.type','notification_operation_failed' if known else SENTINEL))
        spans.append({'traceId':TRACE_IDS['json'],'spanId':f'{index+1:016x}','parentSpanId':PARENT,
            'name':operation+' materials','kind':{'publish':4,'receive':5}.get(operation,1),
            'startTimeUnixNano':str(now),'endTimeUnixNano':str(now+1_000_000),
            'attributes':attrs,'status':{'code':0 if outcome == 'completed' else 2,'message':SENTINEL},
            'links':[{'traceId':'f'*32,'spanId':'f'*16,'traceState':'private='+SENTINEL,
                      'attributes':[_attr('private',SENTINEL)]}]})
    points = []
    for operation,outcome in (*CASES,(SENTINEL,SENTINEL),(None,None),(True,42)):
        attrs = [_attr('account.id',SENTINEL),_attr('http.route','/private/'+SENTINEL)]
        if type(operation) is bool:
            attrs += [{'key':'operation','value':{'boolValue':operation}},
                      {'key':'outcome','value':{'intValue':str(outcome)}}]
        elif operation is not None:
            attrs += [_attr('operation',operation),_attr('outcome',outcome)]
        points.append({'timeUnixNano':str(now),'attributes':attrs})
    metrics = [
        {'name':METRICS[0],'sum':{'aggregationTemporality':2,'isMonotonic':True,
            'dataPoints':[{**point,'asInt':'1'} for point in points]}},
        {'name':METRICS[1],'unit':'s','histogram':{'aggregationTemporality':2,
            'dataPoints':[{**point,'count':'1','sum':.25,'bucketCounts':['1','0'],
                           'explicitBounds':[1.0]} for point in points]}},
    ]
    return {'traces':{'resourceSpans':[{'resource':_resource('json'),'scopeSpans':[{
        'scope':{'name':'inside-notification'},'spans':spans}]}]},
        'metrics':{'resourceMetrics':[{'resource':_resource('json'),'scopeMetrics':[{
            'scope':{'name':'inside-http'},'metrics':metrics}]}]}}


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


def _kv(key,value):
    return _text(1,key)+_field(2,_text(1,value))


def _protobuf(now):
    """Independent literal schema v1.5 encoding; no JSON conversion or general OTLP serializer."""
    resource = b''.join(_field(1,_kv(key,value)) for key,value in
        (('service.name',SERVICE),('deployment.environment.name','isolated-pilot'),
         ('service.version',RELEASES['protobuf']),('authorization',SENTINEL)))
    spans = []
    for index,(operation,outcome) in enumerate((*CASES,(SENTINEL,SENTINEL))):
        known = operation in OPERATIONS
        attributes = [('messaging.system','rabbitmq'),('messaging.destination.name',DESTINATION if known else SENTINEL),
            ('messaging.operation.name',operation),('user.email',SENTINEL),('db.statement',SENTINEL)]
        if outcome != 'completed':
            attributes.append(('error.type','notification_operation_failed' if known else SENTINEL))
        link = (_field(1,bytes.fromhex('f'*32))+_field(2,bytes.fromhex('f'*16))+
                _text(3,'private='+SENTINEL)+_field(4,_kv('private',SENTINEL)))
        span = (_field(1,bytes.fromhex(TRACE_IDS['protobuf']))+_field(2,(index+1).to_bytes(8,'big'))+
            _field(4,bytes.fromhex(PARENT))+_text(5,operation+' materials')+
            b'\x30'+bytes([{'publish':4,'receive':5}.get(operation,1)])+
            b'\x39'+struct.pack('<Q',now)+b'\x41'+struct.pack('<Q',now+1_000_000)+
            b''.join(_field(9,_kv(key,value)) for key,value in attributes)+_field(13,link)+
            _field(15,_text(2,SENTINEL)+b'\x18'+bytes([0 if outcome == 'completed' else 2])))
        spans.append(_field(2,span))
    trace = _field(1,_field(1,resource)+_field(2,_field(1,_text(1,'inside-notification'))+b''.join(spans)))
    sums, histograms = [], []
    for operation,outcome in (*CASES,(SENTINEL,SENTINEL),(None,None),(True,42)):
        attrs = [('account.id',SENTINEL),('http.route','/private/'+SENTINEL)]
        typed = b''
        if type(operation) is bool:
            typed = _field(2,b'\x10\x01')
        elif operation is not None:
            attrs += [('operation',operation),('outcome',outcome)]
        typed_attrs = ((_text(1,'operation')+typed, _text(1,'outcome')+_field(2,b'\x18\x2a')) if typed else ())
        # NumberDataPoint attributes7/time3/sfixed64 value6; Histogram attributes9/count4/sum5/packed6/7.
        sums.append(_field(1,b''.join(_field(7,_kv(k,v)) for k,v in attrs)+b''.join(_field(7,value) for value in typed_attrs)+
            b'\x19'+struct.pack('<Q',now)+b'\x31'+struct.pack('<q',1)))
        histograms.append(_field(1,b''.join(_field(9,_kv(k,v)) for k,v in attrs)+b''.join(_field(9,value) for value in typed_attrs)+
            b'\x19'+struct.pack('<Q',now)+b'\x21'+struct.pack('<Q',1)+b'\x29'+struct.pack('<d',.25)+
            _field(6,struct.pack('<QQ',1,0))+_field(7,struct.pack('<d',1.0))))
    metrics = (_field(2,_text(1,METRICS[0])+_field(7,b''.join(sums)+b'\x10\x02\x18\x01'))+
               _field(2,_text(1,METRICS[1])+_text(3,'s')+_field(9,b''.join(histograms)+b'\x10\x02')))
    metric = _field(1,_field(1,resource)+_field(2,_field(1,_text(1,'inside-http'))+metrics))
    return {'traces':trace,'metrics':metric}


def payloads(transport,now_ns):
    return {'json':_json,'protobuf':_protobuf}[transport](now_ns)


def _unique(pairs):
    result = {}
    for key,value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key]=value
    return result


def stored_traces(raw,transport):
    """Full VT rows first, before MCP/Jaeger can project fields away. Partial rows are pending."""
    try:
        if not isinstance(raw,str) or len(raw.encode())>1_048_576 or SENTINEL in raw:
            raise ValueError('unsafe response')
        rows = [json.loads(line,object_pairs_hook=_unique) for line in raw.splitlines() if line.strip()]
        if SENTINEL in json.dumps(rows):
            raise ValueError('unsafe decoded response')
        if len(rows)<7:
            return None
        if len(rows)!=7 or any(not isinstance(row,dict) or not all(isinstance(v,str) for v in row.values()) for row in rows):
            raise ValueError('invalid rows')
        by_id = {row['span_id']:row for row in rows}
        if set(by_id)!={f'{index:016x}' for index in range(1,8)}:
            raise ValueError('incomplete identities')
        for index,(operation,outcome) in enumerate((*CASES,('_OTHER','_OTHER'))):
            row = by_id[f'{index+1:016x}']
            destination = DESTINATION if index<6 else '_OTHER'
            attributes = {'span_attr:messaging.system':'rabbitmq','span_attr:messaging.destination.name':destination,
                          'span_attr:messaging.operation.name':operation}
            if outcome != 'completed':
                attributes['span_attr:error.type']='notification_operation_failed' if index<6 else '_OTHER'
            expected = {'trace_id':TRACE_IDS[transport],'parent_span_id':PARENT,
                'resource_attr:service.name':SERVICE,'resource_attr:deployment.environment.name':'isolated-pilot',
                'resource_attr:service.version':RELEASES[transport],'scope_name':'inside-collector',
                'name':operation+' '+destination,
                'kind':str({'publish':4,'receive':5}.get(operation,1)),
                'status_code':'0' if outcome == 'completed' else '2',
                'link:link_trace_id:0':'f'*32,'link:link_span_id:0':'f'*16, **attributes}
            if any(row.get(key)!=value for key,value in expected.items()):
                raise ValueError('lost registered field')
            if {key for key in row if key.startswith('span_attr:')}!=set(attributes):
                raise ValueError('extra span field')
            if ({key for key in row if key.startswith('resource_attr:')} !=
                    {'resource_attr:service.name','resource_attr:deployment.environment.name','resource_attr:service.version'} or
                    any(key.startswith(('scope_attr:','event:')) for key in row) or
                    any(row.get(key,'')!='' for key in ('status_message','trace_state','scope_version'))):
                raise ValueError('extra resource/scope/error field')
            if ({key for key in row if key.startswith(('link:link_trace_id:','link:link_span_id:'))} !=
                    {'link:link_trace_id:0','link:link_span_id:0'} or
                    any(key.startswith(('link:link_attr:','link:link_trace_state:')) for key in row)):
                raise ValueError('lost or unsafe links')
        return {'transport':transport,'stored_spans':7,'registered_completions':6,
                'causality':'passed','fallback':'passed','privacy':'passed'}
    except (ValueError,KeyError,TypeError):
        raise RuntimeError('notification full-storage contract failed; raw response withheld') from None


def stored_metrics(response):
    """Pinned VM defaults preserve dots and histogram suffixes; no arbitrary metric labels survive."""
    if response[0]!=200:
        return None
    expected = {(release,operation,outcome,name,le) for release in RELEASES.values()
        for operation,outcome in (*CASES,('_OTHER','_OTHER')) for name,le in
        ((METRICS[0],None),(METRICS[1]+'_count',None),(METRICS[1]+'_sum',None),
         (METRICS[1]+'_bucket','1'),(METRICS[1]+'_bucket','+Inf'))}
    try:
        if len(response[1].encode())>1_048_576:
            raise ValueError('oversize response')
        body = json.loads(response[1],object_pairs_hook=_unique)
        if SENTINEL in json.dumps(body) or body['status']!='success' or body['data']['resultType']!='vector':
            raise ValueError('unsafe metric response')
        rows = body['data']['result']
        if not isinstance(rows,list) or len(rows)>1000:
            raise ValueError('invalid bounded vector')
        seen = set()
        for row in rows:
            labels = row['metric']
            if not isinstance(labels,dict) or not isinstance(labels.get('__name__'),str):
                raise ValueError('invalid metric')
            if not labels['__name__'].startswith('inside.notification.'):
                continue
            fixed = {'service.name':SERVICE,'deployment.environment.name':'isolated-pilot','scope.name':'inside-collector'}
            if (any(labels.get(k)!=v for k,v in fixed.items()) or
                    set(labels)-{'__name__','service.name','deployment.environment.name','service.version',
                                 'scope.name','scope.version','operation','outcome','le'} or
                    labels.get('scope.version','') not in ('','unknown')):
                raise ValueError('unexpected metric dimensions')
            key = (labels['service.version'],labels['operation'],labels['outcome'],labels['__name__'],labels.get('le'))
            if key not in expected or key in seen:
                raise ValueError('unknown or duplicate series')
            value = row['value']
            if (not isinstance(value,list) or len(value)!=2 or not isinstance(value[1],str) or
                    type(value[0]) not in (int,float) or not math.isfinite(value[0])):
                raise ValueError('invalid sample')
            number = float(value[1])
            if not math.isfinite(number) or number!=(.25 if labels['__name__'].endswith('_sum') else 1):
                raise ValueError('lost counter/histogram value')
            seen.add(key)
        if seen!=expected:
            return None
        return {'stored_series':70,'metric_labelsets':14,'privacy':'passed'}
    except (ValueError,KeyError,TypeError):
        raise RuntimeError('notification metric contract failed; raw response withheld') from None


def _mcp_body(result):
    """Pinned native tools return one JSON TextContent body; other formats are unproved."""
    if not isinstance(result,dict) or result.get('isError'):
        raise ValueError('invalid MCP result')
    content=result.get('content')
    if (not isinstance(content,list) or len(content)!=1 or not isinstance(content[0],dict) or
            content[0].get('type','text')!='text' or not isinstance(content[0].get('text'),str) or
            len(content[0]['text'].encode())>1_048_576):
        raise ValueError('unproved MCP format')
    body=json.loads(content[0]['text'],object_pairs_hook=_unique)
    if SENTINEL in json.dumps(body):
        raise ValueError('unsafe MCP data')
    return body


def mcp_metrics(result):
    try:
        if stored_metrics((200,json.dumps(_mcp_body(result)))) is None:
            raise ValueError('incomplete MCP metrics')
    except (ValueError,KeyError,TypeError,RuntimeError):
        raise RuntimeError('notification native MCP metric proof failed; raw response withheld') from None


def mcp_trace(result,transport):
    try:
        body=_mcp_body(result)
        candidates=body['data']
        if (not isinstance(candidates,list) or len(candidates)!=1 or candidates[0]['traceID']!=TRACE_IDS[transport] or
                SERVICE not in json.dumps(candidates[0])):
            raise ValueError('missing MCP trace')
        if not isinstance(candidates[0]['spans'],list) or any(not isinstance(span,dict) for span in candidates[0]['spans']):
            raise ValueError('invalid MCP spans')
        spans = {span['spanID']:span for span in candidates[0]['spans']}
        if set(spans)!={f'{index:016x}' for index in range(1,8)} or len(candidates[0]['spans'])!=7:
            raise ValueError('incomplete MCP trace')
        for index,(operation,_outcome) in enumerate((*CASES,('_OTHER','_OTHER'))):
            span = spans[f'{index+1:016x}']
            expected_name=operation+' '+(DESTINATION if index<6 else '_OTHER')
            references=span.get('references',[])
            if not isinstance(references,list) or any(not isinstance(reference,dict) for reference in references):
                raise ValueError('invalid MCP references')
            if (span.get('operationName')!=expected_name or
                    not {PARENT,'f'*16}.issubset({reference.get('spanID') for reference in references})):
                raise ValueError('lost MCP causality')
    except (ValueError,KeyError,TypeError):
        raise RuntimeError('notification native MCP trace proof failed; raw response withheld') from None
