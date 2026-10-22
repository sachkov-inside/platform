"""An opt-in private Caddy/Alloy overlay; Core defaults retain their sole owner."""
import hashlib
import json
import os
import stat
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
    bounds='|'.join(__import__('re').escape(v) for v in caddy_status.WIRE_BUCKETS)
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


def _file_identity(value):
    return (value.st_dev,value.st_ino,value.st_uid,value.st_gid,value.st_mode,value.st_nlink,
            value.st_size,value.st_mtime_ns,value.st_ctime_ns)


def private_owner(output):
    """One verified owner for the three fixed private bind readers; no payload reads."""
    import artifact
    try:
        with artifact.directory(output) as directory_fd:
            descriptors=[]
            try:
                owner=None
                for name in ('config.alloy','Caddyfile','auth.json'):
                    descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory_fd)
                    descriptors.append((name,descriptor,None))
                    info=os.fstat(descriptor)
                    pair=(info.st_uid,info.st_gid)
                    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1
                            or info.st_uid!=os.getuid()
                            or any(type(v) is not int or not 0<=v<=4294967294 for v in pair)
                            or owner is not None and pair!=owner):artifact.refuse()
                    owner=pair;descriptors[-1]=(name,descriptor,info)
                for name,descriptor,info in descriptors:
                    final=os.fstat(descriptor);linked=os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
                    if _file_identity(info)!=_file_identity(final) or _file_identity(final)!=_file_identity(linked):artifact.refuse()
                return owner
            finally:
                primary=sys.exc_info()[0] is not None
                close_error=None
                for _,descriptor,_ in reversed(descriptors):
                    try:os.close(descriptor)
                    except OSError as error:
                        if close_error is None:close_error=error
                if close_error is not None and not primary:artifact.refuse()
    except OSError:artifact.refuse()


def plan(output):
    owner=private_owner(output)
    images=json.loads((pilot.CONFIG/'inputs.lock.json').read_text())['images']
    result=pilot.compose_plan(pilot.CONFIG,output,images,credential_owner=owner)
    for role in ('alloy','gateway'):result['services'][role]['user']=f'{owner[0]}:{owner[1]}'
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


def verify(output):
    import artifact
    import source_status_query
    token=source_status_query._read_private_token(output)
    files=(('Caddyfile',caddy_config().encode(),(0o600,)),('config.alloy',alloy_config().encode(),(0o600,)),
           ('compose.json',(json.dumps(plan(output),indent=2)+'\n').encode(),(0o600,0o644)),
           ('auth.json',(json.dumps(pilot.auth_config(token),indent=2)+'\n').encode(),(0o600,)))
    with artifact.directory(output) as directory_fd:
        for name,expected,modes in files:
            descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory_fd)
            with os.fdopen(descriptor,'rb') as stream:
                before=os.fstat(stream.fileno())
                if (not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or before.st_nlink!=1
                        or stat.S_IMODE(before.st_mode) not in modes or len(expected)>caddy_status.MAX_BODY_BYTES
                        or before.st_size!=len(expected)):artifact.refuse()
                raw=stream.read(len(expected)+1)
                after=os.fstat(stream.fileno());linked=os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
                identity=_file_identity
                if raw!=expected or identity(before)!=identity(after) or identity(after)!=identity(linked):artifact.refuse()
