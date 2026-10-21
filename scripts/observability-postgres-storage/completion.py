"""One current PG challenge: synchronous ingest ACK, owned authenticated flush, whole S+T+G."""
import http.client
import json
import math
import sys
import time
import frame
import pg_ownership
import queries
import record


def remaining(deadline,cap=10):
    now=time.monotonic()
    if type(deadline) not in (int,float) or not math.isfinite(deadline) or deadline-now>10:raise ValueError('storage')
    value=min(cap,deadline-now)
    if value<=0:raise TimeoutError()
    return value


def _close(resources):
    primary,tb=sys.exc_info()[1:];first=None;first_tb=None
    for resource in reversed(resources):
        try:resource.close()
        except BaseException as error:
            if primary is None and first is None:first,first_tb=error,sys.exc_info()[2]
            elif primary is not None:BaseException.__traceback__.__set__(primary,tb)
            elif error is first:BaseException.__traceback__.__set__(first,first_tb)
    if primary is not None:BaseException.__traceback__.__set__(primary,tb)
    elif first is not None:raise BaseException.with_traceback(first,first_tb)


def _body(response,cap,*,json_type=False):
    if response.status!=200:raise ValueError('storage')
    headers=response.getheaders()
    def selected(name):return [value for key,value in headers if key.lower()==name]
    lengths=selected('content-length');transfers=selected('transfer-encoding');encodings=selected('content-encoding')
    if (len(lengths)>1 or len(transfers)>1 or len(encodings)>1 or lengths and transfers
            or encodings and encodings[0].lower()!='identity'
            or transfers and transfers[0].lower()!='chunked'):raise ValueError('storage')
    if lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>8 or int(lengths[0])>cap):raise ValueError('storage')
    if json_type:
        types=selected('content-type')
        if len(types)!=1:raise ValueError('storage')
        media=[part.strip().lower() for part in types[0].split(';')]
        if media not in (['application/json'],['application/json','charset=utf-8'],['application/json','charset="utf-8"']):raise ValueError('storage')
    raw=response.read(cap+1)
    if len(raw)>cap or lengths and len(raw)!=int(lengths[0]):raise ValueError('storage')
    return raw


def _ingest(source,body,deadline):
    resources=[]
    with queries._completion_deadline(remaining(deadline,4)):
        try:
            source.verify_storage(deadline);source.targets.metrics_private(deadline)
            connection=http.client.HTTPConnection('127.0.0.1',14318,timeout=remaining(deadline,4));resources.append(connection)
            connection.request('POST','/v1/metrics',body=body,headers={'Content-Type':'application/json'})
            response=connection.getresponse();resources.append(response)
            raw=_body(response,1024,json_type=True)
            if record.decode(raw)!={}:raise ValueError('storage')
            source.verify_storage(deadline);source.targets.metrics_private(deadline);remaining(deadline)
        finally:_close(resources)
    remaining(deadline)


def _flush(source,deadline):
    resources=[]
    with queries._completion_deadline(remaining(deadline,2)):
        try:
            source.verify_storage(deadline);target=source.targets.flush_target(deadline)
            key=pg_ownership.secret(source.targets.output)
            connection=http.client.HTTPConnection(target[0],8428,timeout=remaining(deadline,2));resources.append(connection)
            connection.connect()
            if connection.sock is None or connection.sock.getsockname()[0]!=target[1]:raise ValueError('ownership')
            connection.request('POST','/internal/force_flush',body=('authKey='+key).encode('ascii'),headers={'Content-Type':'application/x-www-form-urlencoded'})
            response=connection.getresponse();resources.append(response)
            if _body(response,1)!=b'':raise ValueError('storage')
            source.verify_storage(deadline)
            if source.targets.flush_target(deadline)!=target:raise ValueError('ownership')
            remaining(deadline)
        finally:_close(resources)
    remaining(deadline)


def process(source,value,kind):
    # Only the fixed existing challenge producer can create a packet, never caller-supplied JSON/URL.
    import privacy
    value=frame.validate(value)
    if type(kind) is not str or kind not in privacy.KINDS:raise ValueError('storage')
    deadline=min(source.end,time.monotonic()+10)
    body=json.dumps(privacy.challenge(value,kind),separators=(',',':'),allow_nan=False).encode()
    if len(body)>4096:raise ValueError('malformed')
    _ingest(source,body,deadline)
    _flush(source,deadline)
    result=queries.protocol_read(source.token,source.verify_storage,value,deadline=deadline)
    remaining(deadline)
    if result['freshness']!='fresh':raise ValueError('storage')
    return result
