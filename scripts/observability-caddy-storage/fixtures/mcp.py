"""Owned protocol fixture, never a VictoriaMetrics/native collection claim."""
import json
import os
from pathlib import Path
import sys
import socket
import signal

report=Path(os.environ['CADDY_TEST_REPORT'])
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
report.with_suffix('.tmp').write_text(json.dumps({'pid':os.getpid(),'child':os.getpid(),'helper':os.getppid(),'python':int(os.environ.get('CADDY_TEST_PARENT_PID',os.getppid())),'port':listener.getsockname()[1]}))
report.with_suffix('.tmp').replace(report)
if os.environ.get('CADDY_TEST_CASE')=='failure':sys.exit(3)
if os.environ.get('CADDY_TEST_CASE') in ('timeout','interruption'):
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    while True:signal.pause()
for line in sys.stdin:
    request=json.loads(line);identifier=request.get('id')
    if identifier is None: continue
    if identifier==1: result={'protocolVersion':'2024-11-05','capabilities':{},'serverInfo':{'name':'fixture','version':'1'}}
    elif identifier==2: result={'tools':[{'name':'query','inputSchema':{'type':'object','properties':{name:{'type':kind} for name,kind in (('query','string'),('time','string'),('step','string'),('timeout','string'),('trace','boolean'),('nocache','boolean'))},'required':['query']},'annotations':{'title':'Instant Query','readOnlyHint':True,'destructiveHint':False,'openWorldHint':True}}]}
    else: result={'content':[{'type':'text','text':Path(os.environ['CADDY_TEST_BODY_FILE']).read_text() if 'CADDY_TEST_BODY_FILE' in os.environ else 'caddy_http_requests_total'}]}
    raw=json.dumps({'jsonrpc':'2.0','id':identifier,'result':result})
    if os.environ.get('CADDY_TEST_BAD')=='duplicate' and identifier==3:
        raw=raw.replace('"id": 3','"id":3,"i\\u0064":3')
    print(raw,flush=True)
