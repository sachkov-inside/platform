"""Two fixed current-service vectors over the existing authenticated read-only route."""
from contextlib import contextmanager,nullcontext
import importlib.util
import math
import sys
import signal
import threading
from pathlib import Path
import sys
import signal
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status_query

SELECTOR='{service.name="inside-postgresql-source"}'
IDENTITY='__name__,service.name,deployment.environment.name,service.version,scope.name,scope.version'
TIMESTAMPS='label_replace((timestamp_with_name('+SELECTOR+') and on('+IDENTITY+') '+SELECTOR+' keep_metric_names),"source_metric","$1","__name__","(.+)")'

# Verification-only anchored union. No service predicate can conceal a foreign row.
GLOBAL='{__name__=~"^('+ '|'.join('inside\\\\.postgresql\\\\.server\\\\.'+name for name in (
    'backends','waiting_locks','deadlocks_since_reset','postmaster_start_time_microseconds',
    'statistics_reset_time_microseconds','sample_time_microseconds','available')) +')$"}'


def paths(evaluated_at):
    if type(evaluated_at) is not int or evaluated_at<=0:raise ValueError('storage')
    return tuple('/metrics/api/v1/query?'+urllib.parse.urlencode({'query':expr,'time':str(evaluated_at),'timeout':'2s','nocache':'1'})
                 for expr in (SELECTOR,TIMESTAMPS))


def _read(token,verify_owner,*,budget=10,protocol=False,deadline=None):
    if not source_status_query.valid_token(token) or type(budget) not in (int,float) or not 0<budget<=10:raise ValueError('credentials')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),source_status_query.NoRedirect())
    absolute=deadline is not None
    if absolute:
        if not protocol:raise ValueError('storage')
        _remaining(deadline)
    with nullcontext() if absolute else source_status_query._deadline(budget):
        if not absolute:deadline=time.monotonic()+budget
        evaluated_at=math.floor(time.time());bodies=[]
        selected=paths(evaluated_at)
        if protocol:
            selected+=('/metrics/api/v1/query?'+urllib.parse.urlencode({'query':GLOBAL,'time':str(evaluated_at),'timeout':'2s','nocache':'1'}),)
        for path in selected:
            verify_owner(deadline)
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError()
            request=urllib.request.Request('http://127.0.0.1:18427'+path,headers={'Authorization':'Bearer '+token},method='GET')
            with opener.open(request,timeout=remaining) as response:
                if response.status!=200:raise ValueError('storage')
                lengths=response.headers.get_all('Content-Length',[])
                if (len(lengths)>1 or lengths and response.headers.get('Transfer-Encoding')
                        or lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>10)):raise ValueError('malformed')
                raw=response.read(65537)
                if len(raw)>65536 or lengths and len(raw)!=int(lengths[0]):raise ValueError('malformed')
                bodies.append(raw.decode('utf-8',errors='strict'))
        verify_owner(deadline)
        if time.monotonic()>=deadline:raise TimeoutError()
        return (*bodies,evaluated_at,time.time_ns()//1000)


def read(token,verify_owner,*,budget=10):
    return _read(token,verify_owner,budget=budget)


def _protocol(token,verify_owner,expected,budget,deadline):
    values,stamps,global_values,evaluated_at,completed_us=_read(token,verify_owner,budget=budget,protocol=True,deadline=deadline)
    # Fixed local owner, immune to the legacy scripts' top-level "oracle" module name.
    spec=importlib.util.spec_from_file_location('postgres_source_protocol_oracle',Path(__file__).with_name('oracle.py'))
    if spec is None or spec.loader is None:raise ValueError('storage')
    owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)
    result=owner.evaluate_protocol(values,stamps,global_values,evaluated_at=evaluated_at,completed_us=completed_us,expected=expected)
    if deadline is not None:_remaining(deadline)
    return result


def _remaining(deadline):
    now=time.monotonic()
    if type(deadline) not in (int,float) or not math.isfinite(deadline) or deadline-now>10:raise ValueError('storage')
    if deadline<=now:raise TimeoutError()
    return deadline-now


def protocol_read(token,verify_owner,expected,*,budget=10,deadline=None):
    if deadline is None:return _protocol(token,verify_owner,expected,budget,None)
    # Own one real alarm across reads AND the complete decoder, retaining the original absolute end.
    with _completion_deadline(_remaining(deadline)):
        return _protocol(token,verify_owner,expected,budget,deadline)


_alarm_broken=False


@contextmanager
def _completion_deadline(seconds):
    """Only a proved clear permits restoring the previous signal handler."""
    global _alarm_broken
    if _alarm_broken:raise ValueError('cleanup')
    if type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<seconds<=10:raise ValueError('storage')
    if threading.current_thread() is not threading.main_thread() or signal.getitimer(signal.ITIMER_REAL)!=(0,0):raise ValueError('storage')
    prior=signal.getsignal(signal.SIGALRM);inert=False;arm_attempted=False
    primary=None;tb=None
    def expired(_signum,_frame):
        if not inert:raise TimeoutError()
    try:
        signal.signal(signal.SIGALRM,expired)
        arm_attempted=True
        signal.setitimer(signal.ITIMER_REAL,seconds)
        yield
    except BaseException as error:primary,tb=error,sys.exc_info()[2]
    finally:
        # This flag changes the ALREADY installed closure before any fallible settlement.
        # An uncertain timer can then expire harmlessly while the worker unwinds.
        inert=True;disarmed=not arm_attempted
        if arm_attempted:
            try:signal.setitimer(signal.ITIMER_REAL,0);disarmed=True
            except BaseException as error:
                _alarm_broken=True
                if primary is None:primary,tb=error,sys.exc_info()[2]
        if disarmed:
            try:signal.signal(signal.SIGALRM,prior)
            except BaseException as error:
                _alarm_broken=True
                if primary is None:primary,tb=error,sys.exc_info()[2]
        if primary is not None:BaseException.__traceback__.__set__(primary,tb)
    if primary is not None:raise primary from None
