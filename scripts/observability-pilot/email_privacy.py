"""Fixed email external corpus and full-storage verdicts. Never an SDK/runtime proof."""
import datetime
import json
import math
import re
import struct
from collector_privacy import SENTINEL

TRACE_IDS={'json':'d'*31+'7','protobuf':'d'*31+'8'}
ADVERSARIAL_IDS={'json':'d'*31+'9','protobuf':'d'*31+'a'}
RELEASES={'json':'a'*40,'protobuf':'b'*40}
OPERATIONS=(('publishMaterial','publish','emailMaterial',4),('receiveMaterial','receive','emailMaterial',5),
 ('dispatchMaterial','dispatch','emailMaterial',1),('publishSubscription','publish','emailSubscription',4),
 ('receiveSubscription','receive','emailSubscription',5),('dispatchSubscription','dispatch','emailSubscription',1),
 ('publishResult','publish','emailResult',4),('receiveResult','receive','emailResult',5),('projectResult','project','emailResult',1))
PAIRS=tuple((op,out) for op,_,_,_ in OPERATIONS for out in ('completed','failed'))+tuple(('smtpSend',out) for out in ('sent','not_sent','failed','unknown'))
METRICS=('inside.email.operations','inside.email.duration')
UNSAFE=('user.email','email','recipient','address','subject','email.subject','body','email.body',
 'authorization','credentials','password','smtp.password','Message-ID','smtp.message_id','provider.reply',
 'provider.request_id','operationId','attemptRef','deliveryRef','commandRevision','url.full',
 'exception.message','exception.stacktrace','db.statement','db.query.text','db.query.parameters','db.connection_string')
UUID='11111111-2222-4333-8444-555555555555'
DEST='inside.notifications.email.v1'
RESULT='inside.results.email.v1'
MAX_RESPONSE_BYTES=1_048_576
MAX_QUERY_STATS_INTEGER=2**63-1
MAX_QUERY_EXECUTION_MILLISECONDS=MAX_QUERY_STATS_INTEGER//1_000_000


def _attr(key,value):
    wire={'boolValue':value} if type(value) is bool else {'intValue':str(value)} if type(value) is int else {'stringValue':value}
    return {'key':key,'value':wire}


def _unsafe():
    return [_attr(k,SENTINEL) for k in UNSAFE]+[_attr('messaging.message.id',UUID),_attr('pgboss.job.retry_count',7),_attr('messaging.batch.message_count',2)]


def _logical(lane,op,destination):
    return {'messaging.system':'rabbitmq','messaging.destination.name':destination,'messaging.operation.name':op,**({'email.lane':lane} if lane is not None else {})}


# Worked fixed malformed ingress -> expected collector result, in ordered current OTTL policy.
ADVERSARIAL=(
 (_logical('emailResult','dispatch',RESULT),_logical('emailResult','_OTHER',RESULT)),
 (_logical('emailMaterial','project',DEST),_logical('emailMaterial','_OTHER',DEST)),
 (_logical('emailMaterial','publish',RESULT),_logical('emailMaterial','publish','_OTHER')),
 (_logical('emailSubscription','receive',SENTINEL),_logical('emailSubscription','receive','_OTHER')),
 (_logical(True,'publish',DEST),_logical('_OTHER','publish','_OTHER')),
 (_logical(None,'publish',DEST),{**_logical(None,'publish','_OTHER'),'messaging.message.id':UUID,'pgboss.job.retry_count':'7','messaging.batch.message_count':'2'}),
 ({'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':SENTINEL},{'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':'_OTHER'}),
 ({'dependency.name':'smtp','dependency.operation':True,'dependency.outcome':'unknown'},{'dependency.name':'smtp','dependency.operation':'_OTHER','dependency.outcome':'unknown'}))


def _span(index,attrs,now_ns,trace_id,kind,status,parent):
    return {'traceId':trace_id,'spanId':f'{index:016x}','parentSpanId':f'{parent:016x}' if type(parent) is int else parent,
      'name':SENTINEL,'kind':kind,'flags':1,'startTimeUnixNano':str(now_ns),'endTimeUnixNano':str(now_ns+1_000_000),
      'traceState':'private='+SENTINEL,'attributes':[_attr(k,v) for k,v in attrs.items()]+_unsafe(),
      'events':[{'timeUnixNano':str(now_ns),'name':SENTINEL,'attributes':[_attr('private',SENTINEL)]}],
      'status':{'code':status,'message':SENTINEL}}


def _resource(transport):
    return {'attributes':[_attr('service.name','platform-notifications-worker'),_attr('deployment.environment.name','isolated-pilot'),
      _attr('service.version',RELEASES[transport]),_attr('authorization',SENTINEL)]}


def _traces(transport,spans):
    return {'resourceSpans':[{'resource':_resource(transport),'scopeSpans':[{'scope':{'name':SENTINEL,'version':SENTINEL,'attributes':[_attr('private',SENTINEL)]},'spans':spans}]}]}


def trace_payloads(transport,now_ns):
    if transport not in RELEASES or type(now_ns) is not int or not 0<now_ns<2**63-1_000_000:raise ValueError('invalid fixed corpus input')
    spans=[]
    for index,(_,op,lane,kind) in enumerate(OPERATIONS):
        for outcome in ('completed','failed'):
            attrs=_logical(lane,op,RESULT if lane=='emailResult' else DEST)
            if outcome=='failed':attrs['error.type']='email_operation_failed'
            # Completed and failed nodes retain their own path through publish -> receive -> dispatch/project.
            ordinal=len(spans)+1
            parent='b'*16 if ordinal==1 else 1 if ordinal==2 else ordinal-2
            spans.append(_span(ordinal,attrs,now_ns,TRACE_IDS[transport],kind,0 if outcome=='completed' else 2,parent))
    smtp=[_span(19+i,{'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':out},now_ns,TRACE_IDS[transport],3,0 if out=='sent' else 2,5) for i,out in enumerate(('sent','not_sent','failed','unknown'))]
    hostile=[_span(i+1,attrs,now_ns,ADVERSARIAL_IDS[transport],3 if i>=6 else 1,2,'b'*16) for i,(attrs,_) in enumerate(ADVERSARIAL)]
    values=[('logical',_traces(transport,spans)),('smtp',_traces(transport,smtp)),('adversarial',_traces(transport,hostile))]
    return tuple((partition,_bounded(body,transport,'traces')) for partition,body in values)


FALLBACKS=((SENTINEL,SENTINEL),(None,None),(True,42),('publishMaterial','sent'),('smtpSend','completed'),('dispatchResult','completed'))


def metric_payload(transport,now_ns,stage=0):
    if transport not in RELEASES or type(now_ns) is not int or not 0<now_ns<2**63 or type(stage) is not int or not 0<=stage<=6:raise ValueError('invalid fixed corpus input')
    pairs=PAIRS if stage==0 else (FALLBACKS[stage-1],)
    marker=stage or 1
    points=[{'timeUnixNano':str(now_ns),'attributes':[_attr(k,v) for k,v in zip(('operation','outcome'),pair) if v is not None]+_unsafe()} for pair in pairs]
    metrics=[{'name':METRICS[0],'sum':{'aggregationTemporality':2,'isMonotonic':True,'dataPoints':[{**p,'asInt':str(marker)} for p in points]}},
      {'name':METRICS[1],'unit':'s','histogram':{'aggregationTemporality':2,'dataPoints':[{**p,'count':str(marker),'sum':marker*.25,'bucketCounts':[str(marker),'0'],'explicitBounds':[1.0]} for p in points]}}]
    body={'resourceMetrics':[{'resource':_resource(transport),'scopeMetrics':[{'scope':{'name':SENTINEL,'version':SENTINEL,'attributes':[_attr('private',SENTINEL)]},'metrics':metrics}]}]}
    return _bounded(body,transport,'metrics')


def _bounded(body,transport,signal):
    if transport=='protobuf':
        result=_encode(body,signal)
        if len(result)>65_536:raise ValueError('fixed email protobuf too large')
        return result
    if len(json.dumps(body).encode())>262_144:raise ValueError('fixed email JSON too large')
    return body


def _varint(number):
    result=bytearray()
    while number>=128:
        result.append((number&127)|128);number>>=7
    return bytes(result)+bytes([number])


def _field(number,value):
    return _varint(number*8+2)+_varint(len(value))+value


def _text(number,value):
    return _field(number,value.encode())


def _attribute(attr):
    value=attr['value']
    encoded=(_text(1,value['stringValue']) if 'stringValue' in value else b'\x10'+bytes([value['boolValue']]) if 'boolValue' in value else b'\x18'+_varint(int(value['intValue'])))
    return _text(1,attr['key'])+_field(2,encoded)


def _encode(body,signal):
    """Only these fixed traces/counter/histogram inputs, OTLP proto1.5 field numbers."""
    resource=body['resourceSpans' if signal=='traces' else 'resourceMetrics'][0]
    encoded_resource=b''.join(_field(1,_attribute(a)) for a in resource['resource']['attributes'])
    group=resource['scopeSpans' if signal=='traces' else 'scopeMetrics'][0]
    scope=group['scope']
    encoded_scope=_text(1,scope['name'])+_text(2,scope['version'])+b''.join(_field(3,_attribute(a)) for a in scope['attributes'])
    values=[]
    if signal=='traces':
        for s in group['spans']:
            e=s['events'][0]
            event=b'\x09'+struct.pack('<Q',int(e['timeUnixNano']))+_text(2,e['name'])+b''.join(_field(3,_attribute(a)) for a in e['attributes'])
            value=(_field(1,bytes.fromhex(s['traceId']))+_field(2,bytes.fromhex(s['spanId']))+_text(3,s['traceState'])+
              _field(4,bytes.fromhex(s['parentSpanId']))+_text(5,s['name'])+b'\x30'+_varint(s['kind'])+
              b'\x39'+struct.pack('<Q',int(s['startTimeUnixNano']))+b'\x41'+struct.pack('<Q',int(s['endTimeUnixNano']))+
              b''.join(_field(9,_attribute(a)) for a in s['attributes'])+_field(11,event)+
              _field(15,_text(2,s['status']['message'])+b'\x18'+_varint(s['status']['code']))+b'\x85\x01'+struct.pack('<I',s['flags']))
            values.append(_field(2,value))
    else:
        for metric in group['metrics']:
            histogram='histogram' in metric;data=metric['histogram' if histogram else 'sum'];points=[]
            for p in data['dataPoints']:
                attrs=b''.join(_field(9 if histogram else 7,_attribute(a)) for a in p['attributes'])
                point=attrs+b'\x19'+struct.pack('<Q',int(p['timeUnixNano']))
                if histogram:
                    point+=b'\x21'+struct.pack('<Q',int(p['count']))+b'\x29'+struct.pack('<d',p['sum'])+_field(6,struct.pack('<QQ',*map(int,p['bucketCounts'])))+_field(7,struct.pack('<d',*p['explicitBounds']))
                else:point+=b'\x31'+struct.pack('<q',int(p['asInt']))
                points.append(_field(1,point))
            encoded=b''.join(points)+b'\x10\x02'+(b'' if histogram else b'\x18\x01')
            values.append(_field(2,_text(1,metric['name'])+(_text(3,'s') if histogram else b'')+_field(9 if histogram else 7,encoded)))
    return _field(1,_field(1,encoded_resource)+_field(2,_field(1,encoded_scope)+b''.join(values)))


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate field')
        result[key]=value
    return result


def _invalid_constant(_):
    raise ValueError('nonfinite JSON')


def _load(raw):
    if type(raw) is not str or len(raw.encode('utf-8',errors='strict'))>MAX_RESPONSE_BYTES or SENTINEL in raw:raise ValueError('unsafe bounded response')
    value=json.loads(raw,object_pairs_hook=_unique,parse_constant=_invalid_constant)
    if SENTINEL in json.dumps(value):raise ValueError('unsafe decoded response')
    return value


def _trace_cases(adversarial):
    if adversarial:
        return [(expected,3 if i>=6 else 1,2,'b'*16) for i,(_,expected) in enumerate(ADVERSARIAL)]
    rows=[]
    for _,op,lane,kind in OPERATIONS:
        for out in ('completed','failed'):
            attrs=_logical(lane,op,RESULT if lane=='emailResult' else DEST)
            if out=='failed':attrs['error.type']='email_operation_failed'
            ordinal=len(rows)+1
            parent='b'*16 if ordinal==1 else f'{1 if ordinal==2 else ordinal-2:016x}'
            rows.append((attrs,kind,0 if out=='completed' else 2,parent))
    return rows+[({'dependency.name':'smtp','dependency.operation':'send','dependency.outcome':out},3,0 if out=='sent' else 2,f'{5:016x}') for out in ('sent','not_sent','failed','unknown')]


def _timestamp_matches(value,now_ns):
    # VT's RFC3339Nano UTC value must represent precisely the protobuf START time.
    match=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z',value)
    if not match:return False
    seconds=int(datetime.datetime.strptime(match[1],'%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc).timestamp())
    return seconds*1_000_000_000+int((match[2] or '').ljust(9,'0'))==now_ns


def stored_traces(raw,transport,now_ns,*,adversarial=False):
    """Validate all columns of every observed row before permitting partial/pending."""
    try:
        if transport not in RELEASES or type(now_ns) is not int or type(adversarial) is not bool:raise ValueError('unknown fixed trace')
        if type(raw) is not str or len(raw.encode('utf-8',errors='strict'))>MAX_RESPONSE_BYTES:raise ValueError('oversize')
        rows=[_load(line) for line in raw.splitlines() if line.strip()]
        cases=_trace_cases(adversarial)
        if len(rows)>len(cases):raise ValueError('extra rows')
        seen=set();streams={};stream_names={}
        optional={'scope_version':'','trace_state':'','status_message':'','dropped_attributes_count':'0','dropped_events_count':'0','dropped_links_count':'0'}
        for row in rows:
            if type(row) is not dict or not all(type(v) is str for v in row.values()):raise ValueError('non-string column')
            span=row.get('span_id')
            if type(span) is not str or re.fullmatch(r'[0-9a-f]{16}',span) is None:raise ValueError('span identity')
            index=int(span,16)-1
            if index not in range(len(cases)) or span in seen:raise ValueError('unknown or duplicate identity')
            seen.add(span)
            attrs,kind,status,parent=cases[index]
            name=attrs['dependency.name']+' '+attrs['dependency.operation'] if 'dependency.name' in attrs else attrs['messaging.operation.name']+' '+attrs['messaging.destination.name']
            expected={'trace_id':(ADVERSARIAL_IDS if adversarial else TRACE_IDS)[transport],'span_id':span,
              'parent_span_id':parent,'name':name,'kind':str(kind),'status_code':str(status),'flags':'1',
              'start_time_unix_nano':str(now_ns),'end_time_unix_nano':str(now_ns+1_000_000),'duration':'1000000',
              'scope_name':'inside-collector','resource_attr:service.name':'platform-notifications-worker',
              'resource_attr:deployment.environment.name':'isolated-pilot','resource_attr:service.version':RELEASES[transport],
              '_msg':'-','_stream':'{name='+json.dumps(name)+',resource_attr:service.name="platform-notifications-worker"}',
              **{'span_attr:'+k:str(v) for k,v in attrs.items()}}
            required=set(expected)|{'_time','_stream_id'}
            if not required<=set(row) or set(row)-required-set(optional):raise ValueError('unknown or missing column')
            if any(row[k]!=v for k,v in expected.items()) or any(row[k]!=optional[k] for k in set(row)&set(optional)):raise ValueError('lost fixed field')
            if not _timestamp_matches(row['_time'],now_ns) or re.fullmatch(r'0{16}[0-9a-f]{32}',row['_stream_id']) is None:raise ValueError('invalid storage metadata')
            sid=row['_stream_id']
            if name in streams and streams[name]!=sid or sid in stream_names and stream_names[sid]!=name:raise ValueError('contradictory stream identity')
            streams[name]=sid;stream_names[sid]=name
        if len(seen)!=len(cases):return None
        return {'transport':transport,'partition':'adversarial' if adversarial else 'known','stored_spans':len(cases),
          'internal_edges_preserved':0 if adversarial else 21,'incoming_anchor_preserved':8 if adversarial else 1,'privacy':'passed'}
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        raise RuntimeError('email full-storage contract failed; raw response withheld') from None


def stored_metrics(response,stages):
    """Inspect the complete bounded vector, owning every email series; never positive-filter."""
    try:
        if type(stages) is not dict or set(stages)!=set(RELEASES) or any(type(n) is not int or not 0<=n<=6 for n in stages.values()):raise ValueError('unknown stage')
        if type(response) not in (tuple,list) or len(response)!=2 or type(response[0]) is not int:raise ValueError('invalid response')
        if response[0]!=200:return None
        body=_load(response[1])
        if type(body) is not dict or set(body) not in ({'status','data'},{'status','data','stats'}) or body['status']!='success':raise ValueError('invalid response envelope')
        if 'stats' in body:
            stats=body['stats']
            # VM1.154 emits atomic.Int64 seriesFetched as text and duration milliseconds as int64.
            if (type(stats) is not dict or set(stats)!={'seriesFetched','executionTimeMsec'} or
                type(stats['seriesFetched']) is not str or re.fullmatch(r'(?:0|[1-9][0-9]{0,18})',stats['seriesFetched']) is None or
                int(stats['seriesFetched'])>MAX_QUERY_STATS_INTEGER or type(stats['executionTimeMsec']) is not int or
                not 0<=stats['executionTimeMsec']<=MAX_QUERY_EXECUTION_MILLISECONDS):raise ValueError('invalid query stats')
        data=body['data']
        if type(data) is not dict or set(data)!={'resultType','result'} or data['resultType']!='vector':raise ValueError('invalid vector envelope')
        rows=data['result']
        if type(rows) is not list or len(rows)>1000:raise ValueError('unbounded vector')
        expected={}
        for transport,release in RELEASES.items():
            for operation,outcome in PAIRS+((('_OTHER','_OTHER'),) if stages[transport] else ()):
                marker=stages[transport] if operation=='_OTHER' else 1
                for name,le in ((METRICS[0],None),(METRICS[1]+'_count',None),(METRICS[1]+'_sum',None),(METRICS[1]+'_bucket','1'),(METRICS[1]+'_bucket','+Inf')):
                    expected[(release,operation,outcome,name,le)]=(marker,transport)
        seen=set();current=True
        for row in rows:
            if type(row) is not dict or set(row)!={'metric','value'}:raise ValueError('unexpected row shape')
            labels=row['metric'];value=row['value']
            if type(labels) is not dict or not labels or any(type(k) is not str or type(v) is not str for k,v in labels.items()) or '__name__' not in labels:raise ValueError('invalid labels')
            if (type(value) is not list or len(value)!=2 or type(value[0]) not in (int,float) or not math.isfinite(value[0]) or not 0<=value[0]<=2**53 or
                type(value[1]) is not str or re.fullmatch(r'(?:0|[1-9][0-9]*)(?:\.[0-9]+)?',value[1]) is None):raise ValueError('invalid sample')
            number=float(value[1])
            if not math.isfinite(number):raise ValueError('nonfinite sample')
            if not labels['__name__'].startswith('inside.email'):continue
            fixed={'service.name':'platform-notifications-worker','deployment.environment.name':'isolated-pilot','scope.name':'inside-collector'}
            required=set(fixed)|{'__name__','service.version','operation','outcome'}
            bucket=labels['__name__']==METRICS[1]+'_bucket'
            if bucket:required.add('le')
            if not required<=set(labels) or set(labels)-required-{'scope.version'} or labels.get('scope.version','') not in ('','unknown') or any(labels[k]!=v for k,v in fixed.items()):raise ValueError('unknown dimensions')
            key=(labels['service.version'],labels['operation'],labels['outcome'],labels['__name__'],labels.get('le'))
            if key not in expected or key in seen:raise ValueError('unknown or duplicate email series')
            marker,_=expected[key]
            divisor=4 if labels['__name__'].endswith('_sum') else 1
            observed=number*divisor
            if labels['operation']=='_OTHER':
                # Old fixed markers are safely pending while storage catches up, never a pass.
                if not observed.is_integer() or not 1<=observed<=marker:raise ValueError('contradictory fallback marker')
                current=current and observed==marker
            elif observed!=1:raise ValueError('lost fixed metric')
            seen.add(key)
        if seen!=set(expected) or not current:return None
        return {'stored_series':len(expected),'metric_labelsets':len(expected)//5,'fallback_stages':dict(stages),'privacy':'passed'}
    except (ValueError,KeyError,TypeError,UnicodeError,OverflowError,RecursionError):
        raise RuntimeError('email metric contract failed; raw response withheld') from None


def stored_metric_corpus(response,stages):
    """Both owners receive the identical, complete raw vector; legacy reader is unchanged."""
    import dependency_privacy
    email=stored_metrics(response,stages)
    legacy=dependency_privacy.stored_metrics(response)
    if email is None or legacy is None:return None
    return {'legacy':legacy,'email':email}


def metric_timestamp(now_ns,previous_ns):
    """Pinned VM PushSample quantizes to milliseconds. Never manufacture a future sample."""
    if (type(now_ns) is not int or type(previous_ns) is not int or
        not 0<now_ns<2**63 or not 0<=previous_ns<now_ns or now_ns//1_000_000<=previous_ns//1_000_000):
        raise RuntimeError('email metric timestamp precision contract failed')
    return now_ns
