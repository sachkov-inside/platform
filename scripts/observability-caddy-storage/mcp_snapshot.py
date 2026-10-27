"""Fixed native MCP query pair, retaining original samples until the full oracle passes."""
from contextlib import contextmanager
import math
import os
import time
import caddy_mcp
import caddy_query
import caddy_status
import evidence
import pilot
import source_status_query


@contextmanager
def session(executable, token, *, progress=None, failure=None, _fixture=None):
    """Prepare one owned native child before acquiring the compared source/held interval.

    Exactly one query pair is permitted. Each caller owns a separate phase; the existing
    helper's sixty-second lifetime and cleanup remain the final process boundary.
    """
    if not source_status_query.valid_token(token):caddy_status.refuse()
    startup=[False]
    def checkpoint(phase):
        name="mcp_"+phase
        if name not in evidence.MCP_STARTUP_PHASES:caddy_status.refuse()
        startup[0]=True
        if progress is not None:progress(name)
    def report(phase, _outcome):
        startup[0]=phase in ("initialize","discovery")
        if progress is not None:
            progress({'initialize':'mcp_initialize','discovery':'mcp_discovery',
                      'primary':'mcp_values','additional_1':'mcp_timestamps'}[phase])
    environment={'PATH':os.environ.get('PATH',''),'HOME':str(executable.parent),
                 'MCP_SERVER_MODE':'stdio','VM_INSTANCE_ENTRYPOINT':'http://127.0.0.1:18427/metrics',
                 'VM_INSTANCE_BEARER_TOKEN':token,'VM_INSTANCE_TYPE':'single'}
    argv=None
    if _fixture is not None:argv,environment=_fixture
    try:
        with pilot.ready_stdio_probe(executable,environment,argv=argv,progress=report,
                                     decode_response=caddy_mcp.decode_response,startup_checkpoint=checkpoint) as (probe,_measurement):
            def read(*,evaluated_at,previous=None,wall_clock=time.time):
                deadline=time.monotonic()+caddy_query.QUERY_SECONDS
                started=wall_clock();caddy_status.clock(started)
                if type(evaluated_at) is not int or not 0<=evaluated_at<=math.floor(started):caddy_status.refuse()
                plans=caddy_query.query_plan(evaluated_at)
                arguments=[{'query':plan['query'],'time':plan['time'],'timeout':plan['timeout'],
                            'nocache':True,'trace':False} for plan in plans]
                bodies=[]
                def capture(result):bodies.append(caddy_mcp.body(result))
                # Original whole vectors remain private until every native field and age passes.
                probe('query',arguments[0],'',validate_result=capture,
                      additional=(('query',arguments[1],'',capture),),deadline=deadline)
                if len(bodies)!=2:caddy_status.refuse()
                acquired={'values':bodies[0],'timestamps':bodies[1],'evaluated_at':evaluated_at,'completed_at':started}
                def completed_clock():
                    acquired['completed_at']=wall_clock();return acquired['completed_at']
                if progress is not None:progress('mcp_evaluate')
                result=caddy_status.evaluate(*bodies,evaluated_at=evaluated_at,completed_at=started,
                    previous=previous,completion_clock=completed_clock)
                if time.monotonic()>=deadline:raise TimeoutError('closed Caddy MCP query deadline')
                if result['state']=='malformed':caddy_status.refuse()
                result['transport']['mcp']='passed'
                return result,acquired
            startup[0]=False  # Subsequent caller work/cleanup is not MCP startup.
            yield read
    except BaseException as error:
        if startup[0] and failure is not None:
            try:failure(error)
            except BaseException:pass  # Preserve the escaping protocol/cleanup object.
        raise



def read_snapshot(executable, token, *, evaluated_at, previous=None, wall_clock=time.time,
                  progress=None, failure=None, _fixture=None):
    """Keep the one-shot interface for callers without a prior/held freshness window."""
    with session(executable,token,progress=progress,failure=failure,_fixture=_fixture) as read:
        return read(evaluated_at=evaluated_at,previous=previous,wall_clock=wall_clock)
