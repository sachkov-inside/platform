"""One bounded fixed HTTP body hold; its socket dies with the existing owned process tree."""
import http.client
import os
from pathlib import Path
import select
import sys
import time
import caddy_status as status
import native_cpu
import source_status_query

SECONDS=8
RESPONSE_BYTES=16384


def refuse():raise ValueError('closed Caddy held request refused')


def _query_one(raw):
    value=status.source_status.decode_json(raw)
    if (type(value) is not dict or set(value) not in ({'status','data'},{'status','data','stats'})
            or value['status']!='success' or type(value['data']) is not dict
            or set(value['data'])!={'resultType','result'}):refuse()
    if 'stats' in value:status._stats(value['stats'])
    data=value['data']
    if data['resultType']=='vector':
        rows=data['result']
        if (type(rows) is not list or len(rows)!=1 or type(rows[0]) is not dict
                or set(rows[0])!={'metric','value'} or rows[0]['metric']!={}):refuse()
        point=rows[0]['value']
    elif data['resultType']=='scalar':point=data['result']
    else:refuse()
    if type(point) is not list or len(point)!=2 or status.number(point[1])!=1:refuse()
    status.clock(point[0])


def child(token,*,_connection=None):
    """Private executable entry. No endpoints, queries or credentials are accepted in argv."""
    if not source_status_query.valid_token(token):refuse()
    connection=_connection or http.client.HTTPConnection('127.0.0.1',18427,timeout=SECONDS)
    deadline=time.monotonic()+SECONDS
    try:
        with source_status_query._deadline(SECONDS):
            connection.putrequest('POST','/metrics/api/v1/query')
            connection.putheader('Authorization','Bearer '+token)
            connection.putheader('Content-Type','application/x-www-form-urlencoded')
            connection.putheader('Content-Length','7')
            connection.putheader('Connection','close')
            connection.endheaders(b'query=')
            os.write(1,b'R')
            command=b''
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError()
                ready,_,_=select.select([0],[],[],remaining)
                if not ready:raise TimeoutError()
                chunk=os.read(0,2-len(command))
                if not chunk:break
                command+=chunk
                if command!=b'F':refuse()
            if command!=b'F':refuse()
            connection.sock.settimeout(max(.001,deadline-time.monotonic()))
            connection.send(b'1')
            with connection.getresponse() as response:
                lengths=response.headers.get_all('Content-Length',[])
                if (response.status!=200 or len(lengths)>1 or lengths and response.headers.get('Transfer-Encoding')
                        or lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>5)):refuse()
                raw=response.read(RESPONSE_BYTES+1)
                if len(raw)>RESPONSE_BYTES or lengths and int(lengths[0])!=len(raw):refuse()
                _query_one(raw)
            if time.monotonic()>=deadline:raise TimeoutError()
            os.write(1,b'D')
    finally:connection.close()


class Held:
    def __init__(self,token,*,_fixture=None):
        if not source_status_query.valid_token(token):refuse()
        self._argv=[sys.executable,'-B',str(Path(__file__).resolve())]
        self._environment={'PATH':os.environ.get('PATH',''),'CADDY_HOLD_TOKEN':token}
        if _fixture is not None:self._argv,self._environment=_fixture
        self.started_at=self.finished_at=None
        self._owner=None;self._process=None;self._done=False

    def _remaining(self):
        remaining=self._deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        return remaining

    def __enter__(self):
        self._deadline=time.monotonic()+SECONDS
        self._owner=native_cpu.measured_process(self._argv,self._environment)
        try:
            self._process,_=self._owner.__enter__()
            ready,_,_=select.select([self._process.stdout],[],[],self._remaining())
            if not ready:raise TimeoutError()
            if os.read(self._process.stdout.fileno(),2)!=b'R':refuse()
            self.started_at=time.time()
            self.assert_holding()
            return self
        except BaseException:
            if self._process is not None:self._owner.__exit__(*sys.exc_info())
            raise

    def assert_holding(self):
        self._remaining()
        if self._done or self._process.poll() is not None:refuse()
        ready,_,_=select.select([self._process.stdout],[],[],0)
        if ready:refuse()  # Any additional byte or premature EOF violates R -> F -> D.

    def finish(self):
        self.assert_holding()
        self.finished_at=time.time()
        self._process.stdin.write(b'F');self._process.stdin.flush();self._process.stdin.close()
        payload=b''
        while True:
            ready,_,_=select.select([self._process.stdout],[],[],self._remaining())
            if not ready:raise TimeoutError()
            chunk=os.read(self._process.stdout.fileno(),2-len(payload))
            if not chunk:break
            payload+=chunk
            if payload!=b'D':refuse()
        if payload!=b'D':refuse()
        self._done=True

    def __exit__(self,*error):
        return self._owner.__exit__(*error)


if __name__=='__main__':
    try:
        if len(sys.argv)!=1:refuse()
        child(os.environ.get('CADDY_HOLD_TOKEN'))
    except BaseException:
        sys.exit(1)
