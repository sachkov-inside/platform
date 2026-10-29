"""Post-measurement health history. No output, ownership identity or acceptance escapes."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import stage_timing

ROLES=('mcp','material-assets-worker','profile-avatars-worker','video-deletions-worker','billing-worker','notifications-worker')
MAX_BYTES=8192
INPUT_BYTES=32768
MAX_NUMBER=2**53-1
MAX_EPOCH_US=4_133_980_799_999_999  # Last microsecond of UTC year 2100.
READ_SECONDS=2
REASONS=('none','ownership_unavailable','command_unavailable','projection_unavailable','clock_unavailable')
# Select individual fields, never .Output or complete Config/Health objects.
PROJECTION='{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"role":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"oom":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}},"started":{{json .State.StartedAt}},"health":{{if .State.Health}}{"status":{{json .State.Health.Status}},"history":[{{range $i,$v := .State.Health.Log}}{{if $i}},{{end}}{"start":{{json $v.Start}},"end":{{json $v.End}},"exit_code":{{json $v.ExitCode}}}{{end}}]}{{else}}null{{end}}}'


def require(value):
    if not value:raise ValueError('closed_health_probe_timing')


def number(value):return type(value) is int and 0<=value<=MAX_NUMBER


def epoch(value):return number(value) and value<=MAX_EPOCH_US


def binding(output):return hashlib.sha256(os.fsencode(Path(output).resolve())).hexdigest()


def owner(output):
    value=stage_timing.read_json(Path(output)/'owner.json',65536)
    require(type(value) is dict and value.get('cwd')==str(Path(__file__).resolve().parents[2])
            and type(value.get('project')) is str
            and re.fullmatch(r'inside-observability-fullstack-[a-f0-9]{12}',value['project']) is not None)
    return value['project']


def owner_binding(output,project):
    return hashlib.sha256(json.dumps([binding(output),project],separators=(',',':')).encode()).hexdigest()


def anchors_ok(rows):
    if (type(rows) is not list or len(rows)!=2 or any(type(row) is not list or len(row)!=3
            or not all(number(n) for n in row) or not epoch(row[1]) or row[0]>row[2] for row in rows)):return False
    a,b=rows
    return (a[2]<=b[0] and a[1]<=b[1] and b[2]-a[0]<=READ_SECONDS*1_000_000
            and b[0]-a[2]-2<=b[1]-a[1]<=b[2]-a[0]+2)


def anchor():return [time.monotonic_ns()//1000,time.time_ns()//1000,time.monotonic_ns()//1000]


def timestamp(value):
    require(type(value) is str)
    match=re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z',value)
    require(match is not None)
    year,month,day,hour,minute,second=map(int,match.groups()[:6]);require(1970<=year<=2100)
    parsed=datetime(year,month,day,hour,minute,second,tzinfo=timezone.utc)
    elapsed=parsed-datetime(1970,1,1,tzinfo=timezone.utc)
    return (elapsed.days*86400+elapsed.seconds)*1_000_000_000+int((match[7] or '').ljust(9,'0') or '0')


def validate(value,source,output,phase):
    require(type(source) is str and re.fullmatch('[a-f0-9]{40}',source) is not None
            and type(phase) is int and 0<=phase<12)
    require(type(value) is dict and set(value)=={'schema','source','output_sha256','owner_sha256','phase','state','reason','anchors','roles'}
            and type(value['schema']) is int and value['schema']==1 and value['source']==source
            and value['output_sha256']==binding(output) and value['owner_sha256']==owner_binding(output,owner(output))
            and type(value['phase']) is int and value['phase']==phase)
    require(type(value['state']) is str and value['state'] in ('observed','unavailable')
            and type(value['reason']) is str and value['reason'] in REASONS)
    if value['state']=='unavailable':
        require(value['reason']!='none' and value['anchors'] is None and value['roles'] is None)
    else:
        require(value['reason']=='none' and anchors_ok(value['anchors'])
                and type(value['roles']) is dict and set(value['roles'])==set(ROLES))
        for row in value['roles'].values():
            require(type(row) is dict and set(row)=={'started_epoch_us','status','history'}
                    and epoch(row['started_epoch_us']) and row['started_epoch_us']<=value['anchors'][1][1]+1)
            if row['status'] is None:
                require(row['history'] is None);continue
            require(type(row['status']) is str and row['status'] in ('starting','healthy','unhealthy')
                    and type(row['history']) is list and len(row['history'])<=5)
            previous=None
            for record in row['history']:
                require(type(record) is list and len(record)==3 and epoch(record[0]) and epoch(record[1])
                        and row['started_epoch_us']<=record[0]<=record[1]<=value['anchors'][1][1]+1
                        and type(record[2]) is int and -255<=record[2]<=255
                        and (previous is None or previous<=record[0]))
                # A duplicate zero-length record is not another probe.
                require(previous is None or record!=prior)
                previous=record[1];prior=record
    require(len(json.dumps(value,allow_nan=False,separators=(',',':')).encode())<=MAX_BYTES)
    return value


def unavailable(source,output,phase,reason,project):
    return {'schema':1,'source':source,'output_sha256':binding(output),'owner_sha256':owner_binding(output,project),'phase':phase,
            'state':'unavailable','reason':reason,'anchors':None,'roles':None}


def unique(rows):
    result={}
    for key,value in rows:
        require(key not in result);result[key]=value
    return result


def project(raw,project,current,anchors):
    require(type(raw) is str and len(raw.encode())<=INPUT_BYTES)
    rows=[json.loads(line,object_pairs_hook=unique,parse_constant=lambda _:require(False)) for line in raw.splitlines()]
    require(len(rows)==len(ROLES));result={};ids=set()
    for row in rows:
        require(type(row) is dict and set(row)=={'id','project','role','running','oom','restarts','started','health'})
        role=row['role'];require(type(role) is str and role in ROLES and role not in result)
        require(row['project']==project and row['id']==current[role]['id'] and row['id'] not in ids
                and row['running'] is True and row['oom'] is False and type(row['restarts']) is int
                and row['restarts']==current[role]['restarts'])
        ids.add(row['id']);started=timestamp(row['started']);require(started<=anchors[1][1]*1000+999)
        health=row['health']
        if health is None:result[role]={'started_epoch_us':started//1000,'status':None,'history':None};continue
        require(type(health) is dict and set(health)=={'status','history'}
                and type(health['status']) is str and health['status'] in ('starting','healthy','unhealthy')
                and type(health['history']) is list and len(health['history'])<=5)
        history=[];previous=None
        for entry in health['history']:
            require(type(entry) is dict and set(entry)=={'start','end','exit_code'})
            start,end=timestamp(entry['start']),timestamp(entry['end']);code=entry['exit_code']
            require(started<=start<=end<=anchors[1][1]*1000+999 and type(code) is int and -255<=code<=255
                    and (previous is None or previous<=start))
            require(not history or [start//1000,(end+999)//1000,code]!=history[-1])
            history.append([start//1000,(end+999)//1000,code]);previous=end
        result[role]={'started_epoch_us':started//1000,'status':health['status'],'history':history}
    return {role:result[role] for role in ROLES}


def capture(project_name,before,current,source,output,phase,invoke):
    def unknown(reason):return unavailable(source,output,phase,reason,project_name)
    result=unknown('ownership_unavailable')
    try:
        require(type(project_name) is str and re.fullmatch(r'inside-observability-fullstack-[a-f0-9]{12}',project_name) is not None)
        require(owner(output)==project_name)
        ids=[]
        for role in ROLES:
            a,b=before[role],current[role]
            require(type(b['id']) is str and re.fullmatch('[a-f0-9]{64}',b['id']) is not None
                    and b['id']==a['id'] and b['oom'] is False and b.get('running') is True
                    and type(b['restarts']) is int and 0<=b['restarts']<=2147483647 and b['restarts']==a['restarts'])
            ids.append(b['id'])
        require(len(ids)==len(set(ids)))
    except (OSError,KeyError,TypeError,ValueError):return result
    try:start=anchor()
    except (OSError,ValueError,TypeError,OverflowError):return unknown('clock_unavailable')
    try:raw=invoke(['docker'],['inspect','--format',PROJECTION,*ids],timeout=READ_SECONDS)
    except (OSError,RuntimeError,ValueError,subprocess.SubprocessError):return unknown('command_unavailable')
    try:end=anchor()
    except (OSError,ValueError,TypeError,OverflowError):return unknown('clock_unavailable')
    if not anchors_ok([start,end]):return unknown('clock_unavailable')
    try:
        result.update(state='observed',reason='none',anchors=[start,end],roles=project(raw,project_name,current,[start,end]))
        return validate(result,source,output,phase)
    except (OSError,KeyError,TypeError,ValueError,OverflowError,RecursionError):return unknown('projection_unavailable')
