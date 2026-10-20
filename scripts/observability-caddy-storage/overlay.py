"""An opt-in private Caddy/Alloy overlay; Core defaults retain their sole owner."""
import hashlib
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import pilot
import caddy_status

BASE_CADDY_SHA256='dc93c89bfe3b2cb6824c2689603ebdbe1c49f25bdf82c8105e5ca6cf510b98d5'
ADAPTED_CANONICAL_SHA256='00a8d5fe3cef873218d140a5f374e203530afc975011f1ca03be59f5810c9ed3'


def caddy_config():
    raw=(pilot.CONFIG/'Caddyfile').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=BASE_CADDY_SHA256: raise ValueError('Caddy source changed; re-adapt before acceptance')
    return raw.decode().replace('auto_https off','auto_https off\n\tmetrics',1)+'''\n:9091 {
\t@native {
\t\tmethod GET
\t\tpath /metrics
\t}
\thandle @native {
\t\tmetrics {
\t\t\tdisable_openmetrics
\t\t}
\t}
\thandle {
\t\trespond 403
\t}
}
'''


def alloy_config():
    # Read the current accepted generated privacy configuration, never the c82 frontier copy.
    base=(pilot.CONFIG/'config.alloy').read_text()
    families='|'.join(caddy_status.NAMES)
    native='|'.join(caddy_status.NAMES[1:])
    methods='|'.join(caddy_status.METHODS)
    bounds='|'.join(__import__('re').escape(v) for v in caddy_status.BUCKETS)
    rules=[{'source_labels':['__name__'],'regex':families,'action':'keep'},
           {'source_labels':['__name__','server','handler'],'regex':'up;;|('+native+');srv0;subroute','action':'keep'},
           {'source_labels':['method'],'regex':'(|'+methods+')','action':'keep'},
           {'source_labels':['code'],'regex':'(|[1-5][0-9]{2})','action':'keep'},
           {'source_labels':['le'],'regex':'(|'+bounds+')','action':'keep'},
           {'target_label':'job','replacement':'platform-caddy'},
           {'target_label':'instance','replacement':'pilot'},
           {'regex':'__name__|job|instance|server|handler|code|method|le','action':'labelkeep'}]
    block='''
// Caddy isolated-pilot opt-in only. Native source is checked privately before label deletion.
prometheus.scrape "caddy_native" {
  targets = [{"__address__" = "gateway:9091"}]
  metrics_path = "/metrics"
  honor_labels = false
  scrape_interval = "5s"
  scrape_timeout = "2s"
  body_size_limit = "1MiB"
  sample_limit = 2000
  forward_to = [prometheus.relabel.caddy_native.receiver]
}
prometheus.relabel "caddy_native" {
  forward_to = [prometheus.remote_write.collector_health.receiver]
'''
    for rule in rules:
        block+='  rule {\n'+''.join('    '+key+' = '+json.dumps(value)+'\n' for key,value in rule.items())+'  }\n'
    return base+block+'}\n'


def plan(output):
    auth=(output/'auth.json').stat()
    images=json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images']
    result=pilot.compose_plan(pilot.CONFIG,output,images,credential_owner=(auth.st_uid,auth.st_gid))
    result['services']['gateway']['logging']={'driver':'none'}
    result['services']['gateway']['volumes']=[f'{output}/Caddyfile:/etc/caddy/Caddyfile:ro']
    result['services']['alloy']['volumes']=[f'{output}/config.alloy:/etc/alloy/config.alloy:ro']
    return result


def prepare(output):
    pilot.prepare(output)
    for name,raw in (('Caddyfile',caddy_config()),('config.alloy',alloy_config())):
        descriptor=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'w') as stream: stream.write(raw)
    pilot.write_json(output/'compose.json',plan(output))
