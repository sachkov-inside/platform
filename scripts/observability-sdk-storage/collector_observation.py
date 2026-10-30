"""Passive SDK-local Alloy observations, never acceptance or a causal verdict.

Only the existing admitted Unix daemon and OwnedTargets Alloy instance are read.
The observer starts AFTER producer launch. Its four scheduled reads (0/.5/1/1.5s)
plus optional terminal read share a fixed 3s lifetime; missed ticks are skipped.
One aggregate acquisition is limited to 1s/1MiB per response. A separate owned
process makes even a blocked transport disposable without extending the producer.
Private raw Engine/readiness values never cross the projection/file boundary.
"""
import http.client
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time

import emitter_phase

NAME = 'sdk-collector-observation.json'
MAX_BYTES = 8192
ENGINE_BYTES = 1_048_576
UINT = 2**63 - 1
COUNTERS = ('cpu_total_ns', 'cpu_periods', 'cpu_throttled_periods', 'cpu_throttled_ns',
            'memory_charged_bytes', 'memory_limit_bytes')
CFS = COUNTERS[:4]
UNKNOWN = dict.fromkeys(COUNTERS)


def refuse(*_):
    raise ValueError('closed SDK collector observation refused') from None


def uint(value):
    return type(value) is int and 0 <= value <= UINT


def counters(raw):
    def at(*keys):
        value = raw
        for key in keys:
            value = value.get(key) if type(value) is dict else None
        return value if uint(value) else None
    return dict(zip(COUNTERS, (at('cpu_stats','cpu_usage','total_usage'),
        at('cpu_stats','throttling_data','periods'), at('cpu_stats','throttling_data','throttled_periods'),
        at('cpu_stats','throttling_data','throttled_time'), at('memory_stats','usage'), at('memory_stats','limit'))))


def decode_engine(raw):
    if type(raw) is not bytes or len(raw) > ENGINE_BYTES: refuse()
    value = emitter_phase._decode(raw)
    if type(value) is not dict: refuse()
    pending=[value]
    while pending:
        item=pending.pop()
        if type(item) is float and not math.isfinite(item):refuse()
        if type(item) is dict:pending.extend(item.values())
        elif type(item) is list:pending.extend(item)
    return value


def sample(slot, start, end, values=None, state=None, status='ok'):
    return dict(slot=slot, start_ms=start, end_ms=end, status=status,
                counters=dict(UNKNOWN if values is None else values),
                state=dict(running=None, restarts=None, oom=None, status=None) if state is None else state)


def deltas(samples, close):
    unknown = dict(status='unknown', **dict.fromkeys(CFS))
    if close != 'valid' or len(samples) < 2 or any(row['status'] != 'ok' for row in samples): return unknown
    if any(b['start_ms'] <= a['end_ms'] for a,b in zip(samples,samples[1:])): return unknown
    if any(b['counters'][key] < a['counters'][key] for a,b in zip(samples,samples[1:]) for key in CFS
           if a['counters'][key] is not None and b['counters'][key] is not None):
        return dict(status='reset', **dict.fromkeys(CFS))
    first,last=samples[0]['counters'],samples[-1]['counters']
    values={key:last[key]-first[key] if all(row['counters'][key] is not None for row in samples) else None for key in CFS}
    return dict(status='known' if all(value is not None for value in values.values()) else 'unknown', **values)


class FrozenEngine:
    """Read-only adapter. `admitted` comes solely from pilot's frozen daemon witness."""
    def __init__(self, admitted, target, *, request=None, socket_check=None):
        if (type(admitted) is not dict or type(target) is not dict
                or type(admitted.get('endpoint')) is not str or not admitted['endpoint'].startswith('unix:///')
                or type(target.get('id')) is not str or re.fullmatch('[a-f0-9]{64}',target['id']) is None
                or target.get('service') != 'alloy'
                or any(type(target.get(key)) is not str or not target[key] for key in ('image','project'))
                or any(type(admitted.get(key)) is not str or not admitted[key] for key in ('daemon_id','storage'))
                or any(not uint(admitted.get(key)) for key in ('socket_device','socket_inode'))): refuse()
        self.admitted,self.target=dict(admitted),dict(target)
        self.birth=None
        self.socket_birth=None
        self.request=request or self._request
        self.socket_check=socket_check or self._socket_check

    def _socket_check(self):
        info=os.stat(self.admitted['endpoint'][len('unix://'):])
        identity=(info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode,info.st_ctime_ns)
        if (not stat.S_ISSOCK(info.st_mode) or (info.st_dev,info.st_ino) !=
                (self.admitted['socket_device'],self.admitted['socket_inode'])): refuse()
        if self.socket_birth is None:self.socket_birth=identity
        elif self.socket_birth != identity:refuse()

    def _request(self,path,deadline):
        remaining=deadline-time.monotonic()
        if remaining <= 0:raise TimeoutError()
        connection=http.client.HTTPConnection('localhost',timeout=remaining)
        connection.sock=socket.socket(socket.AF_UNIX)
        connection.sock.settimeout(remaining)
        try:
            connection.sock.connect(self.admitted['endpoint'][len('unix://'):])
            connection.request('GET',path,headers={'Connection':'close'})
            response=connection.getresponse()
            if response.status != 200:refuse()
            raw=response.read(ENGINE_BYTES+1)
            if len(raw)>ENGINE_BYTES:refuse()
            return raw
        finally:connection.close()

    def _get(self,suffix,deadline):
        self.socket_check()
        raw=self.request('/v1.48/'+suffix,deadline)
        self.socket_check()
        return decode_engine(raw)

    def _identity(self,deadline):
        info=self._get('info',deadline)
        if info.get('ID') != self.admitted['daemon_id'] or info.get('DockerRootDir') != self.admitted['storage']:refuse()
        row=self._get('containers/'+self.target['id']+'/json',deadline)
        config=row.get('Config'); state=row.get('State')
        if type(config) is not dict or type(state) is not dict or type(config.get('Labels')) is not dict:refuse()
        labels=config['Labels']
        if (row.get('Id') != self.target['id'] or config.get('Image') != self.target['image']
                or labels.get('com.docker.compose.project') != self.target['project']
                or labels.get('com.docker.compose.service') != 'alloy'
                or type(row.get('Image')) is not str or re.fullmatch('sha256:[a-f0-9]{64}',row['Image']) is None
                or type(state.get('StartedAt')) is not str
                or re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z',state['StartedAt']) is None
                or type(state.get('Running')) is not bool or type(state.get('OOMKilled')) is not bool
                or not uint(row.get('RestartCount'))):refuse()
        birth=(row['Id'],row['Image'],state['StartedAt'],row['RestartCount'])
        if self.birth is None:self.birth=birth
        elif self.birth != birth:refuse()
        status=state.get('Status')
        if status is not None and (type(status) is not str or status not in ('created','restarting','running','removing','paused','exited','dead')):refuse()
        return dict(running=state['Running'],oom=state['OOMKilled'],restarts=row['RestartCount'],status=status)

    def acquire(self,deadline):
        before=self._identity(deadline)
        raw=self._get('containers/'+self.target['id']+'/stats?stream=false&one-shot=true',deadline)
        # The one-shot response itself belongs to the exact CID, when Engine supplies it.
        if 'id' in raw and raw['id'] != self.target['id']:refuse()
        after=self._identity(deadline)
        if before != after:refuse()
        return dict(counters=counters(raw),state=after)

    def close(self,deadline):
        if self.birth is None:refuse()
        self._identity(deadline)


def readiness(raw,start,end):
    unknown=dict(status='unknown',start_ms=None,end_ms=None,attempts=None,outcome=None,http_status=None,error=None)
    try:
        if type(raw) is not bytes or len(raw)>ENGINE_BYTES:refuse()
        rows=emitter_phase._decode(raw)
        if type(rows) is not list or len(rows)>100:refuse()
        selected=[row for row in rows if type(row) is dict and row.get('probe')=='alloy_otlp']
        if len(selected)!=1:refuse()
        row=selected[0]
        if (set(row)!={'probe','attempts','outcome','last_http_status','last_transport_error_type'}
                or not uint(row['attempts']) or row['attempts']==0
                or row['outcome'] not in ('passed','timed_out')
                or not (row['last_http_status'] is None or type(row['last_http_status']) is int and 100<=row['last_http_status']<=599)
                or row['last_transport_error_type'] not in (None,'OSError','URLError','ConnectionError','ConnectionResetError',
                    'ConnectionRefusedError','BrokenPipeError','TimeoutError')
                or type(start) is not int or type(end) is not int or not -600000<=start<=end<=0):refuse()
        return dict(status='known',start_ms=start,end_ms=end,attempts=row['attempts'],outcome=row['outcome'],
                    http_status=row['last_http_status'],error=row['last_transport_error_type'])
    except (ValueError,TypeError,KeyError):return unknown


def empty(source,close='unknown'):
    return dict(schema=1,scope='sdk',source=source,mode='observations_only',readiness=readiness(b'[]',0,0),
                samples=[],missed=[0,1,2,3],terminal='unknown',close=close,delta=deltas([],close))


def validate(value,*,source):
    if (not emitter_phase._sha(source,40) or type(value) is not dict
            or set(value)!={'schema','scope','source','mode','readiness','samples','missed','terminal','close','delta'}
            or type(value['schema']) is not int or value['schema']!=1 or value['source']!=source
            or value['scope']!='sdk' or value['mode']!='observations_only'
            or type(value['close']) is not str or value['close'] not in ('valid','unknown','refused')
            or type(value['terminal']) is not str or value['terminal'] not in ('observed','unknown')):refuse()
    ready=value['readiness']
    if type(ready) is not dict or set(ready)!=set(readiness(b'[]',0,0)):refuse()
    if ready['status']=='unknown':
        if ready!=readiness(b'[]',0,0):refuse()
    elif ready['status']=='known':
        raw=json.dumps([dict(probe='alloy_otlp',attempts=ready['attempts'],outcome=ready['outcome'],
                            last_http_status=ready['http_status'],last_transport_error_type=ready['error'])]).encode()
        if readiness(raw,ready['start_ms'],ready['end_ms'])!=ready:refuse()
    else:refuse()
    samples=value['samples'];missed=value['missed']
    if type(samples) is not list or len(samples)>5 or type(missed) is not list:refuse()
    previous=-1;end=-1
    for row in samples:
        if (type(row) is not dict or set(row)!={'slot','start_ms','end_ms','status','counters','state'}
                or type(row['slot']) is not int or not previous<row['slot']<=4
                or type(row['start_ms']) is not int or type(row['end_ms']) is not int
                or not 0<=row['start_ms']<=row['end_ms']<=3000 or row['start_ms']<end
                or type(row['status']) is not str or row['status'] not in ('ok','unknown','refused')
                or type(row['counters']) is not dict or set(row['counters'])!=set(COUNTERS)
                or any(item is not None and not uint(item) for item in row['counters'].values())
                or type(row['state']) is not dict or set(row['state'])!={'running','restarts','oom','status'}
                or any(row['state'][key] is not None and type(row['state'][key]) is not bool for key in ('running','oom'))
                or row['state']['restarts'] is not None and not uint(row['state']['restarts'])
                or row['state']['status'] is not None and (type(row['state']['status']) is not str
                    or row['state']['status'] not in ('created','restarting','running','removing','paused','exited','dead'))):refuse()
        if row['status']!='ok' and (row['counters']!=UNKNOWN or any(item is not None for item in row['state'].values())):refuse()
        previous,end=row['slot'],row['end_ms']
    if (missed!=[slot for slot in range(4) if slot not in [row['slot'] for row in samples]]
            or any(type(slot) is not int for slot in missed)
            or value['terminal']!=('observed' if any(row['slot']==4 for row in samples) else 'unknown')
            or value['delta']!=deltas(samples,value['close'])):refuse()
    delta=value['delta']
    if (type(delta) is not dict or set(delta)!={'status',*CFS}
            or any(delta[key] is not None and not uint(delta[key]) for key in CFS)):refuse()
    # Round-trip rejects non-JSON objects and prevents aliases to external mutable values.
    return emitter_phase._decode(json.dumps(value,allow_nan=False).encode())


def write(path,value,*,source):
    path=Path(path)
    if path.name!=NAME:refuse()
    raw=(json.dumps(validate(value,source=source),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    if len(raw)>MAX_BYTES:refuse()
    directory=descriptor=None;created=None
    temporary='collector-observation.json.new'
    try:
        directory=emitter_phase._directory(path);initial=os.fstat(directory)
        descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
        created=os.fstat(descriptor)
        offset=0
        while offset<len(raw):
            count=os.write(descriptor,raw[offset:])
            if count<=0:refuse()
            offset+=count
        current=os.fstat(descriptor)
        if (current.st_size!=len(raw) or current.st_mode & 0o777!=0o600 or current.st_nlink!=1
                or emitter_phase._identity(current)!=emitter_phase._identity(os.stat(temporary,dir_fd=directory,follow_symlinks=False))):refuse()
        try:previous=os.stat(path.name,dir_fd=directory,follow_symlinks=False)
        except FileNotFoundError:previous=None
        if previous is not None and (not stat.S_ISREG(previous.st_mode) or previous.st_uid!=os.getuid()
                or previous.st_mode & 0o777!=0o600 or previous.st_nlink!=1):refuse()
        emitter_phase._same_directory(directory,path,initial)
        os.replace(temporary,path.name,src_dir_fd=directory,dst_dir_fd=directory)
        created=None
    finally:
        try:
            if created is not None and directory is not None and descriptor is not None:
                try:current=os.stat(temporary,dir_fd=directory,follow_symlinks=False)
                except FileNotFoundError:current=None
                if current is not None and (current.st_dev,current.st_ino)==(created.st_dev,created.st_ino):
                    os.unlink(temporary,dir_fd=directory)
        finally:
            try:
                if descriptor is not None:os.close(descriptor)
            finally:
                if directory is not None:os.close(directory)


def read(path,*,source):
    path=Path(path)
    if path.name!=NAME:refuse()
    try:return validate(emitter_phase._decode(emitter_phase._read_bytes(path,MAX_BYTES)),source=source)
    except FileNotFoundError:raise
    except (OSError,ValueError,TypeError,RecursionError,OverflowError):refuse()


def load_for_collection(output,*,source):
    try:return read(Path(output)/NAME,source=source)
    except FileNotFoundError:return validate(empty(source),source=source)
    except (OSError,ValueError,TypeError,RecursionError,OverflowError):return validate(empty(source,'refused'),source=source)


def observe(engine,*,source,origin,now=time.monotonic,wait=time.sleep,terminal=lambda:False,ready=None):
    """One finite sampler, also a fake-clock seam. No retries or queued ticks."""
    result=empty(source)
    if ready is not None:result['readiness']=ready
    last=origin
    def clock():
        nonlocal last
        current=now()
        if type(current) not in (int,float) or not math.isfinite(current) or current<last:refuse()
        last=current
        return current
    def take(slot):
        start=clock(); values=None;state=None;status='unknown'
        try:
            read_deadline=min(start+1,origin+(2 if slot<4 else 2.8))
            acquired=engine.acquire(read_deadline)
            values,state=acquired['counters'],acquired['state'];status='ok'
        except ValueError:status='refused'
        except (OSError,TimeoutError,RuntimeError,http.client.HTTPException):pass
        finish=clock()
        if finish>read_deadline+.001:values=state=None;status='unknown'
        result['samples'].append(sample(slot,int((start-origin)*1000),int((finish-origin)*1000),values,state,status))
    try:
        for slot in range(4):
            current=clock()
            if terminal():
                if current<origin+2.8:take(4)
                break
            tick=origin+slot*.5
            if current>tick and slot!=0 or slot==0 and current>=origin+.5:continue
            if current>=origin+2:break
            if current<tick:
                wait(tick-current)
                current=clock()
                if terminal():
                    if current<origin+2.8:take(4)
                    break
                # Waking late skips that tick rather than catching up.
                if current>tick+.001:continue
            take(slot)
        if not any(row['slot']==4 for row in result['samples']):
            remaining=origin+2.7-clock()
            if remaining>0:wait(remaining)
            if terminal() and clock()<origin+2.8:take(4)
        # Close revalidates even when no terminal boundary fits the fixed budget.
        try:
            engine.close(min(clock()+1,origin+2.85))
            result['close']='valid' if clock()<=origin+2.85 else 'unknown'
        except ValueError:result['close']='refused'
        except (OSError,TimeoutError,RuntimeError,http.client.HTTPException):pass
    except (ValueError,OverflowError):
        # A nonmonotonic clock invalidates the whole timing bracket.
        return empty(source,'refused')
    result['missed']=[slot for slot in range(4) if slot not in [row['slot'] for row in result['samples']]]
    result['terminal']='observed' if any(row['slot']==4 for row in result['samples']) else 'unknown'
    result['delta']=deltas(result['samples'],result['close'])
    return validate(result,source=source)


class OwnedCollector:
    """Own one fork, no process group; the existing supervisor owns the worker group.

    Fork preserves the admitted source-bound adapter without a resource-profile CLI
    or a socket/credential argument. All child output is discarded except the closed
    projection. finish is diagnostic-only and cannot alter the producer's result.
    """
    def __init__(self,output,*,source,admitted,target,readiness_times=None,engine_factory=None):
        if not emitter_phase._sha(source,40):refuse()
        self.output,self.source=Path(output),source
        self.admitted,self.target=admitted,target
        self.readiness_times=readiness_times
        self.engine_factory=engine_factory
        self.pid=self.notify=None
        self.origin=None

    def start(self,*,origin=None):
        if self.origin is not None:refuse()
        self.origin=time.monotonic() if origin is None else origin
        reader,writer=os.pipe()
        os.set_blocking(reader,False);os.set_blocking(writer,False)
        try:
            self.pid=os.fork()
        except BaseException:
            os.close(reader);os.close(writer);raise
        if self.pid==0:
            os.close(writer)
            try:self._child(reader)
            except BaseException:pass
            finally:os._exit(0)
        os.close(reader);self.notify=writer

    def _child(self,reader):
        import select
        origin=self.origin
        signal.signal(signal.SIGTERM,signal.SIG_DFL)
        signal.signal(signal.SIGINT,signal.SIG_IGN)
        def alarm(_signum,_frame):
            if time.monotonic()>=origin+2.9:os._exit(0)
            raise TimeoutError()
        signal.signal(signal.SIGALRM,alarm)
        signal.setitimer(signal.ITIMER_REAL,max(.000001,origin+2.9-time.monotonic()))
        engine=self.engine_factory() if self.engine_factory is not None else FrozenEngine(self.admitted,self.target)
        class Bounded:
            def call(self,method,deadline):
                remaining=min(deadline,origin+2.85)-time.monotonic()
                if remaining<=0:raise TimeoutError()
                signal.setitimer(signal.ITIMER_REAL,remaining)
                try:return method(deadline)
                finally:signal.setitimer(signal.ITIMER_REAL,max(.000001,origin+2.9-time.monotonic()))
            def acquire(self,deadline):return self.call(engine.acquire,deadline)
            def close(self,deadline):return self.call(engine.close,deadline)
        ended=False
        def terminal():
            nonlocal ended
            if not ended:
                try:
                    byte=os.read(reader,1)
                    if not byte:refuse()
                    ended=True
                except BlockingIOError:pass
            return ended
        def wait(seconds):
            select.select([reader],[],[],max(0,seconds))
        ready=None
        if self.readiness_times is not None:
            try:
                path=self.output/'readiness.json'
                info=path.lstat()
                if info.st_mode & 0o022:refuse()
                raw=emitter_phase._read_bytes(path,ENGINE_BYTES,mode=None)
                ready=readiness(raw,*(int((instant-origin)*1000) for instant in self.readiness_times))
            except (OSError,ValueError,TypeError):pass
        value=observe(Bounded(),source=self.source,origin=origin,wait=wait,terminal=terminal,ready=ready)
        write(self.output/NAME,value,source=self.source)
        os.close(reader)

    def poll(self):
        """Reap while the producer is still running; never wait for its boundary."""
        if self.pid is None:return .05
        pid=self.pid
        if os.waitpid(pid,os.WNOHANG)[0]:
            self.pid=None
        elif time.monotonic()>=self.origin+2.9:
            try:os.kill(pid,signal.SIGKILL)
            except ProcessLookupError:pass
            finally:os.waitpid(pid,0);self.pid=None
        return min(.05,max(.001,self.origin+2.9-time.monotonic()))

    def finish(self):
        pid=self.pid
        try:
            if self.notify is not None:
                try:os.write(self.notify,b'x')
                except (BrokenPipeError,BlockingIOError):pass
                finally:os.close(self.notify);self.notify=None
            # Reserve shutdown time inside the original absolute observer budget.
            while self.pid is not None and time.monotonic()<self.origin+2.9:
                if os.waitpid(pid,os.WNOHANG)[0]:self.pid=None;break
                import select
                select.select([],[],[],min(.01,max(0,self.origin+2.9-time.monotonic())))
        finally:
            if self.pid is not None:
                try:os.kill(pid,signal.SIGKILL)
                except ProcessLookupError:pass
                finally:
                    os.waitpid(pid,0);self.pid=None
        # Missing/invalid child observations produce a bounded UNKNOWN/refused file.
        try:
            value=load_for_collection(self.output,source=self.source)
            write(self.output/NAME,value,source=self.source)
        except (OSError,ValueError,TypeError):pass
