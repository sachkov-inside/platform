"""The finite owned Caddy request corpus. No caller-selected URL, body, query or headers."""
import http.client
import time
import request_hold
import source_status_query

SENTINEL='private-caddy-sentinel'
CASES={'http_get':('GET',200),'http_post':('POST',200),'unauthorized':('GET',401),
       'fallback':('GET',403),'body_limit':('POST',413),'upstream_error':('GET',502),'privacy':('POST',200),
       'recovery':('GET',(200,502))}


class ReadinessUnavailable(ConnectionError):
    def __init__(self,phase):
        if phase not in ('refused','eof','reset'):request_hold.refuse()
        self.phase=phase
        super().__init__('closed Caddy readiness transport')


class _ReadinessResponse(http.client.HTTPResponse):
    def __init__(self,*args,**kwargs):
        self._received=False
        super().__init__(*args,**kwargs)

    def _read_status(self):
        # Peek does not consume bytes or replace the standard status/header parser.
        # Once even an interim/status prefix was observed, transport failure is fatal.
        try:prefix=self.fp.peek(1)
        except ConnectionResetError as error:
            if type(error) is not ConnectionResetError or self._received:raise
            raise ReadinessUnavailable('reset') from None
        if prefix:self._received=True
        try:return super()._read_status()
        except http.client.RemoteDisconnected as error:
            if type(error) is not http.client.RemoteDisconnected or self._received:raise
            raise ReadinessUnavailable('eof') from None


def _response(connection,case,method,path,body,headers):
    if case!='recovery':
        connection.request(method,path,body=body,headers=headers)
        return connection.getresponse()
    original=connection.response_class
    connection.response_class=_ReadinessResponse
    try:
        try:connection.request(method,path,body=body,headers=headers)
        except ConnectionRefusedError as error:
            if type(error) is not ConnectionRefusedError:raise
            raise ReadinessUnavailable('refused') from None
        return connection.getresponse()
    finally:connection.response_class=original


def perform(case,token,*,_connection=None):
    if case not in CASES or not source_status_query.valid_token(token):request_hold.refuse()
    method,expected=CASES[case]
    path='/metrics/api/v1/query'+('?query=1' if method=='GET' else '')
    body=b'query=1' if method=='POST' else None
    headers={'Authorization':'Bearer '+token,'Connection':'close'}
    if body is not None:headers['Content-Type']='application/x-www-form-urlencoded'
    if case=='unauthorized':headers['Authorization']='Bearer '+SENTINEL
    if case=='fallback':path='/'+SENTINEL+'?private='+SENTINEL
    if case=='body_limit':body=b'query=1&padding='+b'x'*(65537-len(b'query=1&padding='))
    if case=='privacy':
        body=b'query=1%20%23'+SENTINEL.encode()  # A MetricsQL comment keeps the body canary inside the admitted query key.
        headers.update({'Host':SENTINEL+'.invalid','Cookie':'private='+SENTINEL,'X-Private':SENTINEL,
            'traceparent':'00-'+'0a'*16+'-'+'0b'*8+'-01','tracestate':'private='+SENTINEL,'baggage':'private='+SENTINEL})
    connection=_connection or http.client.HTTPConnection('127.0.0.1',18427,timeout=10)
    started=time.time()
    try:
        with source_status_query._deadline(10):
            with _response(connection,case,method,path,body,headers) as response:
                accepted=expected if type(expected) is tuple else (expected,)
                code=response.status
                lengths=response.headers.get_all('Content-Length',[])
                if (code not in accepted or len(lengths)>1 or lengths and response.headers.get('Transfer-Encoding')
                        or lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>5)):request_hold.refuse()
                raw=response.read(request_hold.RESPONSE_BYTES+1)
                if len(raw)>request_hold.RESPONSE_BYTES or lengths and int(lengths[0])!=len(raw):request_hold.refuse()
                if code==200:request_hold._query_one(raw)
            completed=time.time()
            if not 0<=completed-started<10:request_hold.refuse()
            return {'started':started,'completed':completed,'method':method,'code':code}
    finally:connection.close()
