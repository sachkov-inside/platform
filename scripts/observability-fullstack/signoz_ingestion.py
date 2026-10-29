"""Fixed representative ingestion inputs. Primary policies remain their source-owned texts."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'scripts/observability-pilot'))
import privacy_config

NETWORKS=('sig-trace-edge','sig-trace-forward','sig-signal-ingest')
HELPER='sig-trace-sanitizer'


def need(ok):
    if not ok:raise ValueError('representative_ingestion_contract')


def component(text,header):
    """Locate a source-fixed Alloy component; strings/comments cannot close its braces."""
    prefix=header+' {';need(text.count(prefix)==1);start=text.index(prefix)
    index=start+len(prefix);depth=1;quoted=raw=escaped=comment=False
    while index<len(text):
        char=text[index];next_char=text[index+1:index+2]
        if comment:
            if char=='\n':comment=False
        elif raw:
            if char=='`':raw=False
        elif quoted:
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char=='"':quoted=False
        elif char=='/' and next_char=='/':comment=True
        elif char=='`':raw=True
        elif char=='"':quoted=True
        elif char=='{':depth+=1
        elif char=='}':
            depth-=1
            if depth==0:return start,index+1
        index+=1
    raise ValueError('representative_ingestion_contract')


def remove(text,header):
    start,end=component(text,header);return text[:start]+text[end:]


def replace_once(text,old,new):
    need(text.count(old)==1);return text.replace(old,new)


def exporter(label,endpoint):
    return f'''otelcol.exporter.otlphttp "{label}" {{
  client {{
    endpoint = "{endpoint}"
    timeout = "5s"
  }}
  sending_queue {{
    queue_size = 64
    num_consumers = 1
  }}
  retry_on_failure {{ max_elapsed_time = "30s" }}
}}
'''


def edge_config():
    text=privacy_config.render()
    text=text.replace('// Link metadata is removed by the pinned VictoriaTraces ingestion filter, not OTTL.',
        '// Link metadata is removed by the fixed private representative trace sanitizer.')
    for signal,old in (('metrics','http://metrics:8428/opentelemetry'),('logs','http://logs:9428/insert/opentelemetry'),('traces','http://traces:10428/insert/opentelemetry')):
        start,end=component(text,'otelcol.exporter.otlphttp "'+signal+'"');body=text[start:end]
        body=replace_once(body,old,'http://inside-trace-sanitizer:4318' if signal=='traces' else 'http://inside-signoz-collector:4318')
        if signal=='traces':
            body=replace_once(body,'    headers = {"VT-Ignore-Fields" = "link:link_attr:*,link:link_trace_state:*"}\n','    compression = "none"\n')
            body=replace_once(body,'{\n  client {','{\n  encoding = "json"\n  client {')
        text=text[:start]+body+text[end:]
    for header in ('prometheus.scrape "trace_store_health"','prometheus.relabel "trace_store_health"','prometheus.remote_write "collector_health"'):
        text=remove(text,header)
    text=text.replace('prometheus.remote_write.collector_health.receiver','otelcol.receiver.prometheus.edge.receiver')
    stdout=privacy_config.render_stdout()
    stdout=replace_once(stdout,'forward_to = [loki.write.stdout.receiver]','forward_to = [otelcol.receiver.loki.stdout.receiver]')
    stdout=remove(stdout,'loki.write "stdout"')
    stdout=stdout.replace('prometheus.remote_write.collector_health.receiver','otelcol.receiver.prometheus.edge.receiver')
    web=(ROOT/'infra/observability/production/web-http.alloy').read_text().replace('prometheus.remote_write.collector_health.receiver','otelcol.receiver.prometheus.edge.receiver')
    return text+'\n'+stdout+'\n'+web+'''
otelcol.receiver.prometheus "edge" {
  output { metrics = [otelcol.exporter.otlphttp.metrics.input] }
}
otelcol.receiver.loki "stdout" {
  output { logs = [otelcol.exporter.otlphttp.logs.input] }
}
'''


def host_config(roles,project):
    text=(ROOT/'infra/observability/production/host.alloy').read_text()
    start,end=component(text,'prometheus.relabel "containers"');body=text[start:end]
    old=next(line for line in body.splitlines() if 'regex = "up;;|container_' in line)
    replacement='up;;|container_.+;('+'|'.join(re.escape(role) for role in sorted(roles))+');'+re.escape(project)
    body=replace_once(body,old,'    regex = '+json.dumps(replacement))
    text=text[:start]+body+text[end:]
    text=remove(text,'prometheus.remote_write "host"')
    text=text.replace('prometheus.remote_write.host.receiver','otelcol.receiver.prometheus.host.receiver')
    return text+'''
otelcol.receiver.prometheus "host" {
  output { metrics = [otelcol.exporter.otlphttp.host.input] }
}
'''+exporter('host','http://inside-signoz-host-ingest:4318')


def attach(plan,run,project,nonce,source):
    """Called only inside the closed core constructor, never on external Compose input."""
    need(HELPER not in plan['services'] and not any(name in plan['networks'] for name in NETWORKS))
    collector=plan['services']['sig-collector'];need(set(collector['networks'])=={'sig-backend','storage','hostsource'})
    del collector['networks']['storage']
    collector['networks']['hostsource']={'aliases':['inside-signoz-host-ingest']}
    collector['networks']['sig-trace-forward']={'aliases':['inside-signoz-trace-ingest']}
    collector['networks']['sig-signal-ingest']={'aliases':['inside-signoz-collector']}
    alloy=plan['services']['alloy'];need(type(alloy['networks']) is dict and set(alloy['networks'])=={'storage','telemetry','loopback'})
    alloy['networks']['sig-trace-edge']={};alloy['networks']['sig-signal-ingest']={}
    for name in NETWORKS:plan['networks'][name]={'internal':True,'driver':'bridge'}
    python=plan['services']['sig-agent']['image']
    binding={'commit':source['commit'],'tree':source['tree'],'nonce':nonce,'project':project}
    plan['services'][HELPER]={'image':python,'platform':'linux/amd64','pull_policy':'never','user':plan['services']['sig-agent']['user'],
        'read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'mem_limit':'64m','memswap_limit':'64m','cpus':.05,
        'pids_limit':64,'restart':'no','logging':{'driver':'none'},'networks':{'sig-trace-edge':{'aliases':['inside-trace-sanitizer']},'sig-trace-forward':{}},
        'command':['python','-B','/driver/trace_sanitizer.py'],'environment':{'INSIDE_TRACE_BINDING':json.dumps(binding,separators=(',',':'))},
        'volumes':[str(HERE/'trace_sanitizer.py')+':/driver/trace_sanitizer.py:ro'],
        'tmpfs':['/state:size=65536,mode=0700,uid='+plan['services']['sig-agent']['user'].split(':')[0]+',gid='+plan['services']['sig-agent']['user'].split(':')[1]]}
    files={'edge.alloy':edge_config(),'host.alloy':host_config(tuple(plan['services']),project)}
    for role,name,target in (('alloy','edge.alloy','/etc/alloy/config.alloy'),('host-agent','host.alloy','/etc/alloy/host.alloy')):
        service=plan['services'][role];old=service['volumes'][0]
        need(type(old) is str and old.endswith(':'+target+':ro'))
        service['volumes'][0]=str(run/'representative-ingestion'/name)+':'+target+':ro'
    return files


def input_hashes():
    paths=[Path(__file__),HERE/'core_layout.py',HERE/'trace_sanitizer.py',ROOT/'scripts/observability-pilot/collector_privacy.py',Path(privacy_config.__file__),privacy_config.CONFIG/'privacy-policy.json',
        ROOT/'infra/observability/production/stdout.alloy.tmpl',ROOT/'infra/observability/production/host.alloy',
        ROOT/'infra/observability/production/web-http.alloy']
    return {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
