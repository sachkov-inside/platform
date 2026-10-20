"""Fixed loopback Caddy read; no arbitrary URL, proxy, selector, credential or outage inference."""
import http.client
import math
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status_query
import caddy_status

QUERY_SECONDS=10
SERVER_TIMEOUT='2s'
PORT=18427


def query_plan(evaluated_at):
    # Raw identities are retained until the whole value/timestamp pair has been validated.
    names='|'.join(sorted(caddy_status.NAMES))
    selector='{job="platform-caddy",instance="pilot",__name__=~"^('+names+')$"}'
    identity='__name__,job,instance,server,handler,code,method,le'
    stamps='label_replace((timestamp_with_name('+selector+') and on('+identity+') '+selector+' keep_metric_names),"source_metric","$1","__name__","(.+)")'
    return [dict(query=expression,time=str(evaluated_at),timeout=SERVER_TIMEOUT,nocache='1') for expression in (selector,stamps)]


def _failure(reason):
    result=caddy_status.unavailable(reason);result['transport']['canonical']='failed'
    return result,None


def read_snapshot(token,*,evaluated_at=None,previous=None,wall_clock=time.time,deadline_seconds=QUERY_SECONDS):
    """Return a validated public report plus a private in-memory acquisition for comparison.

    The acquisition is never an artifact. Public collection accepts only the exact report schema.
    """
    if not source_status_query.valid_token(token):return _failure('credentials')
    if type(deadline_seconds) not in (int,float) or not math.isfinite(deadline_seconds) or not 0<deadline_seconds<=QUERY_SECONDS:return _failure('transport')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),source_status_query.NoRedirect())
    try:
        started=time.monotonic()
        with source_status_query._deadline(deadline_seconds):
            wall_started=wall_clock();caddy_status.clock(wall_started)
            evaluated=math.floor(wall_started) if evaluated_at is None else evaluated_at
            if type(evaluated) is not int or not 0<=evaluated<=math.floor(wall_started):caddy_status.refuse()
            bodies=[]
            for params in query_plan(evaluated):
                remaining=deadline_seconds-(time.monotonic()-started)
                if remaining<=0:raise TimeoutError()
                url='http://127.0.0.1:'+str(PORT)+'/metrics/api/v1/query?'+urllib.parse.urlencode(params)
                request=urllib.request.Request(url,headers={'Authorization':'Bearer '+token},method='GET')
                with opener.open(request,timeout=remaining) as response:
                    if response.status!=200:return _failure('http_error')
                    lengths=response.headers.get_all('Content-Length',[])
                    if (len(lengths)>1 or lengths and response.headers.get('Transfer-Encoding')
                            or lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>10)):caddy_status.refuse()
                    raw=response.read(caddy_status.MAX_BODY_BYTES+1)
                    if len(raw)>caddy_status.MAX_BODY_BYTES or lengths and len(raw)!=int(lengths[0]):caddy_status.refuse()
                    bodies.append(raw)
            acquired={'values':bodies[0],'timestamps':bodies[1],'evaluated_at':evaluated,'completed_at':wall_started}
            def completed_clock():
                final=wall_clock();acquired['completed_at']=final;return final
            report=caddy_status.evaluate(*bodies,evaluated_at=evaluated,completed_at=wall_started,previous=previous,completion_clock=completed_clock)
            duration=time.monotonic()-started
            if not 0<=duration<deadline_seconds:raise TimeoutError()
            report['transport']['canonical']='failed' if report['state']=='malformed' else 'passed'
            return report,None if report['state']=='malformed' else acquired
    except TimeoutError:return _failure('timeout')
    except KeyboardInterrupt:return _failure('interrupted')
    except urllib.error.HTTPError as error:
        error.close();return _failure('http_error')
    except urllib.error.URLError as error:return _failure('timeout' if isinstance(error.reason,TimeoutError) else 'transport')
    except ValueError:
        result=caddy_status.record('malformed','raw_contract');result['transport']['canonical']='failed';return result,None
    except (OSError,http.client.HTTPException):return _failure('transport')


def query(token,**options):
    return read_snapshot(token,**options)[0]
