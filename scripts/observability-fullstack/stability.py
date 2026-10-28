"""Closed numerical stability control. Completion never grants capacity acceptance."""
import json
import math
import os
from pathlib import Path
import re
import resource
import stat
import sys
import time

NAME='fullstack-stability.json'
MARKER='fullstack-stability-plan.json'
MAX_BYTES=1_048_576
MODES=(False,False,False,True,True,False)
ACCEPTANCE={'state':'not_applicable','capacity':False,'minimum_candidate_gib':None}
LABELS=('web_home','web_material','api_catalog','api_account','telegram_webhook','logto_discovery')
DELTA_CONTEXT=('logical_cpus','cpu_total_ticks','steal_ticks','context_switches','cpu_some_total_us','process_cpu_seconds')
CONTEXT=('logical_cpus','cpu_total_ticks','clock_ticks_per_second','steal_ticks','runqueue','blocked','context_switches','cpu_some_total_us','process_cpu_seconds','process_max_rss_bytes','capture_elapsed_ms')
COUNTERS=('cpu_total_ns','cpu_periods','cpu_throttled_periods','cpu_throttled_ns','memory_charged_bytes','memory_working_set_bytes','io_read_operations','io_write_operations')


def number(value):return type(value) in (int,float) and math.isfinite(value) and 0<=value<=2**53-1

def counter_delta(before,after):return after-before if number(before) and number(after) and after>=before else None

def schedule():
    return [{'ordinal':i,'enabled':MODES[i//2],'measured':bool(i%2),
        'definition':{'name':'spike','seconds':10,'requests_per_second':40}} for i in range(12)]


def context(proc=Path('/proc')):
    """No PID scan/text: only aggregate kernel numbers and this observer's rusage."""
    start=time.monotonic();result=dict.fromkeys(CONTEXT);result['logical_cpus']=os.cpu_count()
    try:
        rows={parts[0]:parts[1:] for line in (proc/'stat').read_text().splitlines() if (parts:=line.split())}
        result.update(cpu_total_ticks=sum(map(int,rows['cpu'][:8])),clock_ticks_per_second=os.sysconf('SC_CLK_TCK'),steal_ticks=int(rows['cpu'][7]),runqueue=int(rows['procs_running'][0]),
            blocked=int(rows['procs_blocked'][0]),context_switches=int(rows['ctxt'][0]))
    except (OSError,ValueError,KeyError,IndexError):pass
    try:
        some=next(line for line in (proc/'pressure/cpu').read_text().splitlines() if line.startswith('some '))
        result['cpu_some_total_us']=int(next(token.split('=',1)[1] for token in some.split() if token.startswith('total=')))
    except (OSError,ValueError,StopIteration):pass
    usage=resource.getrusage(resource.RUSAGE_SELF)
    result.update(process_cpu_seconds=usage.ru_utime+usage.ru_stime,process_max_rss_bytes=usage.ru_maxrss*(1024 if sys.platform=='linux' else 1),
        capture_elapsed_ms=(time.monotonic()-start)*1000)
    return {key:value if number(value) else None for key,value in result.items()}


def record(source,roles=(),images=None):
    return {'schema':1,'source':source,'scope':'diagnostic_only','state':'incomplete','acceptance':dict(ACCEPTANCE),
        'service_roles':list(roles),'images':images or {},'warmup':[],'measurements':[]}


def project(value,ordinal,roles):
    """Discard private/native errors. Fixed roles become numeric indices in raw frames."""
    load=value['load'];timing=load['timing_diagnostics']
    def numeric(value):return value if number(value) else None
    frames=[];previous=None
    for sample in value['samples']:
        raw=sample['counters']
        current=sample['diagnostic_context']
        delta={key:counter_delta(previous.get(key) if previous else None,current[key]) for key in DELTA_CONTEXT}
        resets=sum(number(previous.get(key)) and number(current[key]) and current[key]<previous[key] for key in DELTA_CONTEXT) if previous else 0
        frames.append({'anchor':sample['counter_clock_anchor'],'context':current,'context_delta':delta,'context_resets':resets,
            'at_seconds':numeric(raw.get('at_seconds')),'counter_errors':len(raw['errors']),
            'services':[[index,*[numeric(raw['services'][role].get(key)) for key in COUNTERS]]
                for index,role in enumerate(roles) if role in raw['services']]})
        previous=current
    return {'ordinal':ordinal,'completed':load['completed'] and not value['errors'] and not any(sample['counters']['errors'] for sample in value['samples']),'scheduled':load['scheduled'],
        'missed':load['missed'],'success':load['success'],'unexpected_failures':load['unexpected_failures'],
        'latency':load['latency'],'requests':timing['requests'],'phase_start':timing['phase_start'],'phase_end':timing['phase_end'],
        'host':frames}


def experiment(source,configure,measure,persist,roles=(),images=None):
    result=record(source,roles,images);persist(result)
    for row in schedule():
        if not row['measured']:configure(row['enabled'])
        value=measure(row)
        if row['measured']:result['measurements'].append(value)
        else:result['warmup'].append({'ordinal':row['ordinal'],'completed':value['completed']})
        persist(result)
        if not value['completed']:raise ValueError('stability_load_incomplete')
    result['state']='complete';validate(result,source,roles);persist(result);return result


def validate(value,source,roles=()):
    def need(ok):
        if not ok:raise ValueError('closed_stability_diagnostic')
    need(type(value) is dict and set(value)=={'schema','source','scope','state','acceptance','service_roles','images','warmup','measurements'})
    need(type(value['schema']) is int and value['schema']==1 and re.fullmatch('[a-f0-9]{40}',source) is not None and value['source']==source)
    need(value['scope']=='diagnostic_only' and value['state'] in ('incomplete','complete') and value['acceptance']==ACCEPTANCE
        and type(value['acceptance']['capacity']) is bool and value['service_roles']==list(roles))
    images=value['images'];need(type(images) is dict and (not images or set(images)=={'backend','foundation','web','telegram','logto'}))
    need(all(type(v) is str and re.fullmatch('sha256:[a-f0-9]{64}',v) is not None for v in images.values()))
    warm=value['warmup'];rows=value['measurements']
    need(type(warm) is list and type(rows) is list and len(warm)<=6 and len(rows)<=len(warm) and len(warm)-len(rows)<=1)
    for index,row in enumerate(warm):need(type(row) is dict and set(row)=={'ordinal','completed'} and type(row['ordinal']) is int and row['ordinal']==index*2 and type(row['completed']) is bool)
    def anchor(value):return value is None or type(value) is list and len(value)==3 and all(number(v) for v in value) and value[0]<=value[2]
    for index,row in enumerate(rows):
        need(type(row) is dict and set(row)=={'ordinal','completed','scheduled','missed','success','unexpected_failures','latency','requests','phase_start','phase_end','host'})
        need(type(row['ordinal']) is int and row['ordinal']==index*2+1 and type(row['completed']) is bool)
        need(all(type(row[k]) is int and 0<=row[k]<=400 for k in ('scheduled','missed','success','unexpected_failures')))
        need(not row['completed'] or (row['scheduled']==row['success']==400 and row['missed']==row['unexpected_failures']==0))
        need(type(row['latency']) is list and len(row['latency'])<=300 and type(row['requests']) is list and len(row['requests'])<=300)
        for r in row['latency']:need(type(r) is dict and set(r)=={'label','elapsed_ms'} and r['label'] in LABELS and number(r['elapsed_ms']))
        seen=set()
        for r in row['requests']:
            need(type(r) is list and len(r)==4 and all(number(n) for n in r) and type(r[0]) is int and 0<=r[0]<400 and type(r[1]) is int and r[1] in (0,1,2,3,6,7) and r[1]==r[0]%8 and r[0] not in seen and r[2]<=r[3]);seen.add(r[0])
        need(anchor(row['phase_start']) and anchor(row['phase_end']) and type(row['host']) is list and len(row['host'])<=64)
        for frame in row['host']:
            need(type(frame) is dict and set(frame)=={'anchor','context','context_delta','context_resets','at_seconds','counter_errors','services'} and anchor(frame['anchor']))
            need(frame['at_seconds'] is None or number(frame['at_seconds']))
            need(type(frame['counter_errors']) is int and 0<=frame['counter_errors']<=len(roles))
            need(type(frame['context']) is dict and set(frame['context'])==set(CONTEXT) and all(v is None or number(v) for v in frame['context'].values()))
            need(type(frame['context_delta']) is dict and set(frame['context_delta'])==set(DELTA_CONTEXT) and all(v is None or number(v) for v in frame['context_delta'].values()))
            need(type(frame['context_resets']) is int and 0<=frame['context_resets']<=len(DELTA_CONTEXT))
            need(type(frame['services']) is list and len(frame['services'])<=len(roles));services=set()
            for service in frame['services']:
                need(type(service) is list and len(service)==len(COUNTERS)+1 and type(service[0]) is int and 0<=service[0]<len(roles) and service[0] not in services and all(v is None or number(v) for v in service[1:]));services.add(service[0])
        need(all(r['label']==dict(zip((0,1,2,3,6,7),LABELS))[request[1]] for r,request in zip(row['latency'],row['requests'])))
        if row['completed']:need(len(row['latency'])==len(row['requests'])==300 and len(row['host'])>=2 and row['phase_start'] is not None and row['phase_end'] is not None and row['phase_end'][0]-row['phase_start'][0]>=10000)
    if len(json.dumps(value,allow_nan=False).encode())>MAX_BYTES:raise ValueError('stability_artifact_budget')
    if value['state']=='complete':need(len(rows)==len(warm)==6 and all(r['completed'] for r in [*rows,*warm]) and bool(images))
    return value


def read_json(path):
    path=Path(path)
    try:
        descriptor=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
        with os.fdopen(descriptor) as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size>MAX_BYTES:raise ValueError('stability_artifact_file')
            def unique(pairs):
                value={}
                for key,item in pairs:
                    if key in value:raise ValueError('stability_duplicate_key')
                    value[key]=item
                return value
            return json.load(stream,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('stability_numeric')))
    except (OSError,RecursionError) as error:raise ValueError('stability_artifact_file') from error


def read(output,source,roles=()):return validate(read_json(Path(output)/NAME),source,roles)


def require_marker(event):
    if type(event) is not dict or type(event.get('pull_request')) is not dict or type(event['pull_request'].get('body')) is not str or '<!-- monitoring-stability: run -->' not in event['pull_request']['body']:
        raise ValueError('explicit_stability_marker_required')
