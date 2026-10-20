"""Owned stdio boundary model, injected literal SETTINGS; no network or vendor execution."""
import json
import os
from pathlib import Path
import sys

route=Path(sys.argv[0]).name.removeprefix('mcp-victoria')
route={'metrics':'metrics','logs':'logs','traces':'traces'}[route]
(Path(os.environ['HOME'])/('fixture-'+route+'.json')).write_text(json.dumps({'pid':os.getpid()}))
calls=0
for line in sys.stdin:
    request=json.loads(line);identifier=request.get('id')
    if identifier is None:continue
    method=request['method'];tool='trace' if route=='traces' else 'query'
    if method=='initialize':result={'protocolVersion':'2024-11-05','capabilities':{}}
    elif method=='tools/list':result={'tools':[{'name':tool}]}
    else:
        arguments=request['params']['arguments'];age=SETTINGS['age'];body=None
        if route=='metrics':
            query=arguments['query'];history=query.startswith('last_over_time(')
            evaluation=age-(0 if arguments.get('nocache') is True else 30)
            if evaluation-(600 if history else 300)<0<=evaluation:
                body=SETTINGS['notifications'] if 'notification' in query else {'data':[{'metric':{'__name__':'pilot_requests'},'value':[1800000000,'60']}]}
            else:body={'status':'success','data':{'resultType':'vector','result':[]}}
        elif route=='logs':
            body='pilot.known_failure' if age<(600 if arguments['query']=='_time:10m' else 300) else ''
        else:
            trace=arguments['trace_id']
            body=SETTINGS['traces'].get(trace,'worker.retry')
        phase='primary' if calls==0 else 'additional_'+str(calls)
        calls+=1
        failure=SETTINGS.get('failure')
        if failure and failure['route']==route and failure['phase']==phase:
            if failure['kind']=='invalid_result':result=['PRIVATE_VALUE']
            elif failure['kind']=='tool_error':result={'isError':True,'content':[{'type':'text','text':'PRIVATE_VALUE'}]}
            else:result={'content':[{'type':'text','text':json.dumps({'traceID':arguments.get('trace_id'),'private':'PRIVATE_VALUE'})}]}
        else:result={'content':[{'type':'text','text':json.dumps(body)}]}
    print(json.dumps({'jsonrpc':'2.0','id':identifier,'result':result}),flush=True)
