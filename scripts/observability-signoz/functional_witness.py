"""One closed native data/auth/MCP/gateway witness, never capacity acceptance."""
import http.client
import json
import math
from pathlib import Path
import secrets
import time

import control
import gateway
from metric_recipe import FixedMetricReads

TRACE_ID='00000000000000000000000000001566'
SPAN_ID='0000000000001566'
SERVICE='platform-fallback-control'


def require(value):control.require(value)


def wire(host,port,path,method='GET',body=None,headers=None,accepted=(200,)):
    connection=http.client.HTTPConnection(host,port,timeout=control.remaining())
    data=None if body is None else json.dumps(body,separators=(',',':')).encode()
    started=time.monotonic()
    try:
        connection.request(method,path,data,{'Content-Type':'application/json','Connection':'close',**(headers or {})})
        response=connection.getresponse();payload=response.read(65537)
        require(response.status in accepted and len(payload)<=65536 and time.monotonic()-started<=10)
        return response.status,json.loads(payload) if payload else None
    finally:connection.close()


def scalar_query(signal_name,trace_id):
    require(signal_name in ('traces','logs') and trace_id in (TRACE_ID,'0'*32))
    now=int(time.time()*1000)
    return {'schemaVersion':'v1','start':now-60000,'end':now,'requestType':'scalar','compositeQuery':{'queries':[
        {'type':'builder_query','spec':{'name':'A','signal':signal_name,'aggregations':[{'expression':'count()','alias':'count'}],
            'filter':{'expression':"service.name = '"+SERVICE+"' AND trace_id = '"+trace_id+"'"},'limit':1}}]}}


def query(payload,key):
    _,data,_=control.request('POST','/api/v5/query_range',payload,{'SIGNOZ-API-KEY':key})
    return data


def retained_count(data):
    require(type(data) is dict and data.get('type')=='scalar' and not data.get('warning'))
    results=data.get('data',{}).get('results');require(type(results) is list and len(results)==1)
    table=results[0];require(type(table) is dict and table.get('queryName')=='A')
    columns=table.get('columns');rows=table.get('data')
    require(type(columns) is list and type(rows) is list and len(rows)==1 and type(rows[0]) is list and len(rows[0])==len(columns))
    names=[c.get('name') for c in columns];require(len(names)==len(set(names)))
    values=dict(zip(names,rows[0]))
    required={'raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples'}
    require(set(values)==required)
    for field in ('raw_count','distinct_indices','noninteger_indices','flagged_samples'):
        value=values[field];require(type(value) in (int,float) and math.isfinite(value) and value>=0 and value==int(value))
    require(values['raw_count']<=400)
    if values['raw_count']==400:require(values=={'raw_count':400,'distinct_indices':400,'min_index':1,'max_index':400,'noninteger_indices':0,'flagged_samples':0})
    return int(values['raw_count'])


def mcp_call(method,params,key,identifier):
    body={'jsonrpc':'2.0','id':identifier,'method':method,'params':params}
    _,value=wire('mcp',8000,'/mcp','POST',body,{'SIGNOZ-API-KEY':key,'Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'})
    require(type(value) is dict and value.get('jsonrpc')=='2.0' and value.get('id')==identifier and 'error' not in value)
    result=value.get('result');require(type(result) is dict and result.get('isError') is not True);return result


def mcp_count(payload,key):
    result=mcp_call('tools/call',{'name':'signoz_execute_builder_query','arguments':{'query':payload}},key,3)
    value=result.get('structuredContent')
    if type(value) is not dict:
        blocks=result.get('content');require(type(blocks) is list and 1<=len(blocks)<=16)
        value=json.loads(blocks[0].get('text',''))
    require(type(value) is dict)
    if value.get('status')=='success':value=value.get('data')
    return control.scalar(value)


def await_fact(read,predicate,seconds=60):
    deadline=min(control.DEADLINE,time.monotonic()+seconds)
    while time.monotonic()<deadline:
        value=read()
        if predicate(value):return value
        time.sleep(.25)
    raise control.ControlFailure()


def corpus():
    now=time.time_ns();attr= lambda key,value:{'key':key,'value':{'stringValue':value}}
    resource={'attributes':[attr('service.name',SERVICE),attr('service.version','1566'*10)]}
    trace={'resourceSpans':[{'resource':resource,'scopeSpans':[{'spans':[{'traceId':TRACE_ID,'spanId':SPAN_ID,'name':'known.fixture','kind':2,'startTimeUnixNano':str(now-1000000),'endTimeUnixNano':str(now),'attributes':[attr('http.route','/fixture')],'status':{'code':1}}]}]}]}
    logs={'resourceLogs':[{'resource':resource,'scopeLogs':[{'logRecords':[{'timeUnixNano':str(now),'observedTimeUnixNano':str(now),'body':{'stringValue':'fixture.known'},'severityNumber':9,'severityText':'INFO','traceId':TRACE_ID,'spanId':SPAN_ID}]}]}]}
    metric_resource={'attributes':[attr('service.name','platform-pilot'),attr('service.version','1566'*9+'0008')]}
    metrics={'resourceMetrics':[{'resource':metric_resource,'scopeMetrics':[{'metrics':[{'name':'pilot_requests','gauge':{'dataPoints':[{'timeUnixNano':str(now-400000000+i*1000000),'asInt':str(i+1),'attributes':[attr('http.route','/pilot')]} for i in range(400)]}}]}]}]}
    return {'traces':trace,'logs':logs,'metrics':metrics}


def run():
    admission=json.loads(Path('/private/admission.json').read_text())
    require(admission.get('owner')=='monitoring-1566-signoz-functional' and type(admission.get('remaining_seconds')) is int and 0<admission['remaining_seconds']<=600)
    control.DEADLINE=time.monotonic()+admission['remaining_seconds']
    control.FUNCTIONAL_STAGE='bootstrap'
    facts={}
    def exercise(_proxy,key):
        control.FUNCTIONAL_STAGE='mcp_ready'
        # The upstream MCP must build its native docs index; shallow liveness is insufficient.
        def mcp_ready():
            try:return wire('mcp',8000,'/readyz',accepted=(200,503))[0]==200
            except (OSError,http.client.HTTPException):return False
        await_fact(mcp_ready,bool,55)
        control.FUNCTIONAL_STAGE='mcp_initialize'
        initialized=mcp_call('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'platform-owned-witness','version':'1'}},key,1)
        require(initialized.get('protocolVersion')=='2025-11-25')
        wire('mcp',8000,'/mcp','POST',{'jsonrpc':'2.0','method':'notifications/initialized'}, {'SIGNOZ-API-KEY':key,'Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},accepted=(200,202,204))
        control.FUNCTIONAL_STAGE='mcp_inventory'
        inventory=mcp_call('tools/list',{},key,2);tools=inventory.get('tools')
        require(inventory.get('nextCursor') in (None,'') and type(tools) is list and 1<=len(tools)<=128 and any(t.get('name')=='signoz_execute_builder_query' for t in tools))
        control.FUNCTIONAL_STAGE='ingest'
        for signal_name,body in corpus().items():
            _,reply=wire('signoz-ingester',4318,'/v1/'+signal_name,'POST',body)
            require(type(reply) is dict and not reply.get('partialSuccess'))
        def retained():
            now=int(time.time()*1000);payload=FixedMetricReads(8,now-600000,now).call('retained_sample_count',{})
            return retained_count(query(payload,key))
        control.FUNCTIONAL_STAGE='retained_metrics'
        await_fact(retained,lambda count:count==400)
        control.FUNCTIONAL_STAGE='trace_log'
        for signal_name in ('traces','logs'):
            await_fact(lambda:control.scalar(query(scalar_query(signal_name,TRACE_ID),key)),lambda count:count==1)
            require(control.scalar(query(scalar_query(signal_name,'0'*32),key))==0)
        facts['retained_400']=1;facts['trace_log_correlation']=1
        # Native MCP executes a source-fixed scalar trace read; full raw metric count above
        # is separately verified against the400 actual OTLP points.
        control.FUNCTIONAL_STAGE='mcp_read'
        require(mcp_count(scalar_query('traces',TRACE_ID),key)==1);facts['native_mcp']=1
        def read(operation):
            if operation=='retained_metrics':return retained()
            if operation=='correlated_traces':return control.scalar(query(scalar_query('traces',TRACE_ID),key))
            if operation=='correlated_logs':return control.scalar(query(scalar_query('logs',TRACE_ID),key))
            require(operation=='mcp_correlated_traces');return mcp_count(scalar_query('traces',TRACE_ID),key)
        agent_key=secrets.token_hex(32)
        control.FUNCTIONAL_STAGE='finite_gateway'
        with gateway.serve(agent_key,read) as address:
            for operation,expected in [('retained_metrics',400),('correlated_traces',1),('correlated_logs',1),('mcp_correlated_traces',1)]:
                _,value=wire(*address,'/read','POST',{'operation':operation,'parameters':{}},{'Authorization':'Bearer '+agent_key});require(value=={'state':'observed','count':expected})
            for method,path,body in [('POST','/v1/metrics',{}),('POST','/v1/logs',{}),('POST','/v1/traces',{}),('DELETE','/api/v1/service_accounts/x',None),('POST','/api/v5/query_range',{}),('POST','/read',{'operation':'raw_sql','parameters':{}}),('POST','/read',{'operation':'retained_metrics','parameters':{'query':'SELECT 1'}})]:
                _,value=wire(*address,path,method,body,{'Authorization':'Bearer '+agent_key},accepted=(403,));require(value=={'state':'denied'})
            wire(*address,'/read','POST',{'operation':'retained_metrics','parameters':{}},{'Authorization':'Bearer wrong'},accepted=(403,))
        facts['finite_gateway']=1
    control.FUNCTIONAL_HOOK=exercise
    result=control.bootstrap();result.update(facts);result['full_workload_acceptance']=0;result['capacity_acceptance']=0
    print(json.dumps(result,separators=(',',':')))
