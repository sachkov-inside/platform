"""Fixed unsafe Telegram OTLP challenges. Not a sanitizer, collector, SDK or runtime model."""
import base64
import json
import struct

SENTINEL = 'TELEGRAM_RUNTIME_PRIVACY_SENTINEL_1566'
TRACE_IDS = {'json':('e'*30+'81','f'*30+'83','f'*30+'85'), 'protobuf':('e'*30+'82','f'*30+'84','f'*30+'86')}
OPERATIONS = (('receipt','completed'), ('authorization','accepted'), ('attempt','completed'), ('sendMessage','delivered'), (SENTINEL,SENTINEL), (True,'completed'), ('receipt',False))
HEALTH = (('http.server.active_requests',0,True), ('telemetry.trace.dropped',0,False), ('telemetry.trace.export.failures',0,False), ('telemetry.metric.export.failures',0,False), ('telemetry.trace.sampling.ratio',1,True))
HTTP = (('POST','/integrations/platform/v1/communications','completed'), (False, SENTINEL, 42))
PRIVATE_KEYS = ('authorization','cookie','baggage','tracestate','traceparent','botToken','chatId','telegramUserId','accountRef','telegramIdentityRef','eventId','intakeId','linkRevision','providerMessageId','provider.request_id','http.request.body','http.response.body','url.full','exception.message','exception.stacktrace','db.statement','db.query.parameters','dependency.name','email.lane','tracking.operation','waitlist.operation','messaging.system')


def _case(index):
    # Independent wire encoders consume these fixed protocol vectors, never a collector projection.
    return (
        ('receipt','completed',1,'bbbbbbbbbbbbbbbb',200),
        ('authorization','accepted',3,'0000000000000001',200),
        ('attempt','completed',1,'0000000000000001',200),
        ('sendMessage','delivered',3,'0000000000000003',200),
        (None,None,2,None,200),
        (SENTINEL,SENTINEL,1,'0000000000000001',200),
        (True,42,1,'0000000000000001',200),
        ('authorization','unavailable',3,'0000000000000001',999),
        ('sendMessage','transport_unknown',3,'0000000000000003',200),
        (None,None,2,None,'200'),
    )[index]


def _trace(transport,index):
    return TRACE_IDS[transport][1 if index == 4 else 2 if index == 9 else 0]


def _release(transport):
    return '0.1566.1' if transport == 'json' else '0.1566.2'


def _value(value):
    if type(value) is bool: return {'boolValue':value}
    if type(value) is int: return {'intValue':str(value)}
    return {'stringValue':value}


def _attrs(keys,values):
    return [{'key':key,'value':_value(value)} for key,value in zip(keys,values)]


def _private_json():
    return _attrs(PRIVATE_KEYS,[SENTINEL]*len(PRIVATE_KEYS))+[
        {'key':'array.private','value':{'arrayValue':{'values':[_value(SENTINEL),_value(True),_value(7)]}}},
        {'key':'map.private','value':{'kvlistValue':{'values':_attrs(['nested'],[SENTINEL])}}},
        {'key':'binary.private','value':{'bytesValue':base64.b64encode(SENTINEL.encode()).decode()}},
    ]


def _json(now_ns):
    unsafe = _private_json()
    resource = {'attributes':_attrs(['service.name','deployment.environment.name','service.version'],['inside-telegram','isolated-pilot',_release('json')])+unsafe}
    scope = {'name':SENTINEL,'version':SENTINEL,'attributes':unsafe}
    exemplar = {'timeUnixNano':str(now_ns),'asInt':'1','spanId':'f'*16,'traceId':'f'*32,'filteredAttributes':unsafe[:1]}
    spans = []
    for index in range(10):
        operation,outcome,kind,parent,status = _case(index)
        attrs = (_attrs(['telegram.operation','telegram.outcome'],[operation,outcome]) if operation is not None else _attrs(['http.request.method','http.route','http.request.outcome'],HTTP[0 if index == 4 else 1]))
        attrs += _attrs(['http.response.status_code'],[status])+unsafe
        spans.append({'traceId':_trace('json',index),'spanId':f'{index+1:016x}',**({'parentSpanId':parent} if parent else {}),
            'name':SENTINEL,'kind':kind,'startTimeUnixNano':str(now_ns),'endTimeUnixNano':str(now_ns+1_000_000),
            'traceState':'private='+SENTINEL,'attributes':attrs,'status':{'code':2 if index >= 5 else 0,'message':SENTINEL},
            'events':[{'timeUnixNano':str(now_ns),'name':SENTINEL,'attributes':unsafe}],
            'links':[{'traceId':'a'*32,'spanId':'a'*16,'traceState':SENTINEL,'attributes':unsafe}]})
    def pair(counter,duration,keys,values):
        points = [{'timeUnixNano':str(now_ns),'attributes':_attrs(keys,value)+unsafe,'exemplars':[exemplar]} for value in values]
        return [{'name':counter,'description':SENTINEL,'unit':SENTINEL,'sum':{'aggregationTemporality':2,'isMonotonic':True,'dataPoints':[{**point,'asInt':'1'} for point in points]}},
                {'name':duration,'description':SENTINEL,'unit':SENTINEL,'histogram':{'aggregationTemporality':2,'dataPoints':[{**point,'count':'1','sum':.25,'bucketCounts':['1','0'],'explicitBounds':[1.0]} for point in points]}}]
    metrics = pair('inside.telegram.operations','inside.telegram.duration',['operation','outcome'],OPERATIONS)
    metrics += pair('http.server.request.count','http.server.request.duration',['http.request.method','http.route','http.request.outcome'],HTTP)
    for name,value,gauge in (*HEALTH,('inside.dependency.operations',1,True),('inside.telegram.private',1,True)):
        data = {'dataPoints':[{'timeUnixNano':str(now_ns),'attributes':unsafe,'asInt':str(value),'exemplars':[exemplar]}]}
        if not gauge: data.update({'aggregationTemporality':2,'isMonotonic':True})
        metrics.append({'name':name,'description':SENTINEL,'unit':SENTINEL,('gauge' if gauge else 'sum'):data})
    return {'traces':{'resourceSpans':[{'schemaUrl':SENTINEL,'resource':resource,'scopeSpans':[{'schemaUrl':SENTINEL,'scope':scope,'spans':spans}]}]},
            'metrics':{'resourceMetrics':[{'schemaUrl':SENTINEL,'resource':resource,'scopeMetrics':[{'schemaUrl':SENTINEL,'scope':scope,'metrics':metrics}]}]}}


def _integer(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127)|128); value >>= 7
    return bytes(result)+bytes([value])


def _message(number,value):
    return _integer(number*8+2)+_integer(len(value))+value


def _text(number,value):
    return _message(number,value.encode())


def _attribute(key,value):
    return _text(1,key)+_message(2,value)


def _dimension_wire(key,value):
    # Only the fixed string/bool/int challenge vectors are encoded here.
    encoded = b'\x10'+bytes([value]) if type(value) is bool else b'\x18'+_integer(value) if type(value) is int else _text(1,value)
    return _attribute(key,encoded)


def _private_wire():
    return [_attribute(key,_text(1,SENTINEL)) for key in PRIVATE_KEYS]+[
        _attribute('array.private',_message(5,_message(1,_text(1,SENTINEL))+_message(1,b'\x10\x01')+_message(1,b'\x18\x07'))),
        _attribute('map.private',_message(6,_message(1,_attribute('nested',_text(1,SENTINEL))))),
        _attribute('binary.private',_message(7,SENTINEL.encode())),
    ]


def _protobuf(now_ns):
    """Direct proto v1.5 fields; never calls the JSON encoder or serializes JSON output."""
    unsafe = _private_wire()
    resource = b''.join(_message(1,_dimension_wire(key,value)) for key,value in [('service.name','inside-telegram'),('deployment.environment.name','isolated-pilot'),('service.version',_release('protobuf'))])+b''.join(_message(1,attr) for attr in unsafe)
    scope = _text(1,SENTINEL)+_text(2,SENTINEL)+b''.join(_message(3,attr) for attr in unsafe)
    spans = []
    for index in range(10):
        operation,outcome,kind,parent,status = _case(index)
        dimensions = (list(zip(['telegram.operation','telegram.outcome'],[operation,outcome])) if operation is not None else list(zip(['http.request.method','http.route','http.request.outcome'],HTTP[0 if index == 4 else 1])))
        dimensions += [('http.response.status_code',status)]
        attrs = [_dimension_wire(key,value) for key,value in dimensions]+unsafe
        event = b'\x09'+struct.pack('<Q',now_ns)+_text(2,SENTINEL)+b''.join(_message(3,attr) for attr in unsafe)
        link = _message(1,bytes.fromhex('a'*32))+_message(2,bytes.fromhex('a'*16))+_text(3,SENTINEL)+b''.join(_message(4,attr) for attr in unsafe)
        span = (_message(1,bytes.fromhex(_trace('protobuf',index)))+_message(2,bytes.fromhex(f'{index+1:016x}'))+_text(3,'private='+SENTINEL)+
                (_message(4,bytes.fromhex(parent)) if parent else b'')+_text(5,SENTINEL)+b'\x30'+bytes([kind])+
                b'\x39'+struct.pack('<Q',now_ns)+b'\x41'+struct.pack('<Q',now_ns+1_000_000)+b''.join(_message(9,attr) for attr in attrs)+
                _message(11,event)+_message(13,link)+_message(15,_text(2,SENTINEL)+b'\x18'+bytes([2 if index >= 5 else 0])))
        spans.append(_message(2,span))
    traces = _message(1,_message(1,resource)+_message(2,_message(1,scope)+b''.join(spans)+_text(3,SENTINEL))+_text(3,SENTINEL))
    exemplar = b'\x11'+struct.pack('<Q',now_ns)+b'\x31'+struct.pack('<q',1)+_message(4,bytes.fromhex('f'*16))+_message(5,bytes.fromhex('f'*32))+b''.join(_message(7,attr) for attr in unsafe[:1])
    def point(keys,values,histogram=False,value=1):
        attrs = [_dimension_wire(key,item) for key,item in zip(keys,values)]+unsafe
        return (b'\x19'+struct.pack('<Q',now_ns)+b''.join(_message(9 if histogram else 7,attr) for attr in attrs)+
                (_message(8,exemplar)+b'\x21'+struct.pack('<Q',1)+b'\x29'+struct.pack('<d',.25)+_message(6,struct.pack('<QQ',1,0))+_message(7,struct.pack('<d',1.0)) if histogram else _message(5,exemplar)+b'\x31'+struct.pack('<q',value)))
    metrics = []
    for counter,duration,keys,values in [('inside.telegram.operations','inside.telegram.duration',['operation','outcome'],OPERATIONS),('http.server.request.count','http.server.request.duration',['http.request.method','http.route','http.request.outcome'],HTTP)]:
        metrics.append(_text(1,counter)+_text(2,SENTINEL)+_text(3,SENTINEL)+_message(7,b''.join(_message(1,point(keys,value)) for value in values)+b'\x10\x02\x18\x01'))
        metrics.append(_text(1,duration)+_text(2,SENTINEL)+_text(3,SENTINEL)+_message(9,b''.join(_message(1,point(keys,value,True)) for value in values)+b'\x10\x02'))
    for name,value,gauge in (*HEALTH,('inside.dependency.operations',1,True),('inside.telegram.private',1,True)):
        metrics.append(_text(1,name)+_text(2,SENTINEL)+_text(3,SENTINEL)+_message(5 if gauge else 7,_message(1,point([],[],value=value))+(b'' if gauge else b'\x10\x02\x18\x01')))
    metrics = _message(1,_message(1,resource)+_message(2,_message(1,scope)+b''.join(_message(2,metric) for metric in metrics)+_text(3,SENTINEL))+_text(3,SENTINEL))
    return {'traces':traces,'metrics':metrics}


def payloads(transport,now_ns):
    if transport not in ('json','protobuf') or type(now_ns) is not int or not 0 < now_ns < 2**63-1_000_000:
        raise ValueError('unknown fixed challenge source')
    result = _json(now_ns) if transport == 'json' else _protobuf(now_ns)
    for body in result.values():
        if type(body) is bytes and len(body) >= 65536 or type(body) is dict and len(json.dumps(body).encode()) > 1_048_576:
            raise RuntimeError('fixed Telegram challenge exceeds its original wire budget')
    return result
