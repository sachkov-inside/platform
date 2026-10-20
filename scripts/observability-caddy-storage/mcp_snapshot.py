"""Fixed native MCP query pair, retaining original samples until the full oracle passes."""
import math
import os
import time
import caddy_mcp
import caddy_query
import caddy_status
import pilot
import source_status_query


def read_snapshot(executable, token, *, evaluated_at, previous=None, wall_clock=time.time,
                  progress=None, _fixture=None):
    started=wall_clock()
    caddy_status.clock(started)
    if (not source_status_query.valid_token(token) or type(evaluated_at) is not int
            or not 0<=evaluated_at<=math.floor(started)):
        caddy_status.refuse()
    plans=caddy_query.query_plan(evaluated_at)
    arguments=[{'query':plan['query'],'time':plan['time'],'timeout':plan['timeout'],
                'nocache':True,'trace':False} for plan in plans]
    bodies=[]
    def capture(result):
        bodies.append(caddy_mcp.body(result))
    def report(phase, _outcome):
        if progress is not None:
            progress({'initialize':'mcp_initialize','discovery':'mcp_discovery',
                      'primary':'mcp_values','additional_1':'mcp_timestamps'}[phase])
    environment={'PATH':os.environ.get('PATH',''),'HOME':str(executable.parent),
                 'MCP_SERVER_MODE':'stdio','VM_INSTANCE_ENTRYPOINT':'http://127.0.0.1:18427/metrics',
                 'VM_INSTANCE_BEARER_TOKEN':token,'VM_INSTANCE_TYPE':'single'}
    argv=None
    if _fixture is not None:
        argv,environment=_fixture
    # No discovery metadata, stderr, raw body or process measurements become a public artifact.
    pilot.stdio_probe(executable,environment,'query',arguments[0],'',argv=argv,
        validate_result=capture,additional=(('query',arguments[1],'',capture),),
        progress=report,decode_response=caddy_mcp.decode_response)
    if len(bodies)!=2:
        caddy_status.refuse()
    acquired={'values':bodies[0],'timestamps':bodies[1],'evaluated_at':evaluated_at,'completed_at':started}
    def completed_clock():
        acquired['completed_at']=wall_clock()
        return acquired['completed_at']
    result=caddy_status.evaluate(*bodies,evaluated_at=evaluated_at,completed_at=started,
        previous=previous,completion_clock=completed_clock)
    if result['state']=='malformed':
        caddy_status.refuse()
    result['transport']['mcp']='passed'
    return result,acquired
