"""Closed diagnostic clocks inside the existing worker deadline, never an acceptance oracle."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time

NAME='fullstack-timing.json'
CONTACTS_NAME='fullstack-contacts-timing.json'

MAX_MS=600_000
MAX_ROWS=384
MAX_BYTES=131_072
MAX_WRITES=2*MAX_ROWS+2
STAGES=('initial_mode','initial_up','response_contract','seed_database_ready','seed_migrate','seed_broker_config',
    'seed_api_up','seed_api_ready','seed_accounts','seed_corpus','seed_extra','seed_caddy_adapt',
    'seed_telegram_initialize','seed_telegram_ready','seed_logto_ready','seed_contacts','seed_contact_count','seed_contacts_start','seed_contacts_join',
    'seed_statistics_epoch','seed_umami_database','seed_source_bootstrap','seed_source_authority',
    'seed_umami_up','seed_umami_ready','seed_umami','seed_establish','seed_validate_corpus','grafana_permissions',
    'horizon_install','plugin_install','mode_configure','mode_core_up','mode_source_up','mode_core_stop',
    'mode_database_broker_recreate','mode_database_ready','mode_broker_ready','mode_applications_recreate','mode_api_ready',
    'mode_web_ready','mode_telegram_ready','mode_logto_ready','mode_backend_api_ready','mode_backend_mcp_ready',
    'mode_backend_material-assets-worker_ready','mode_backend_profile-avatars-worker_ready',
    'mode_backend_video-deletions-worker_ready','mode_backend_billing-worker_ready',
    'mode_backend_notifications-worker_ready','mode_warmup',
    'mode_web_initial_series','mode_web_witness','mode_source_barrier','phase_ownership_before','phase_baseline',
    'phase_storage_before_reader','phase_storage_before_database','phase_load','phase_telegram',
    'phase_storage_after_reader','phase_storage_after_database','phase_sampler_join','phase_final_counters',
    'phase_ownership_after','phase_report','outage_core_up','outage_collector_stop','outage_loss',
    'outage_collector_up','outage_ready','outage_recover','evaluate')
STATES={'running':'none','completed':'none','failed':'work_failed','interrupted':'cancelled'}
REFUSALS=('binding_refused','clock_refused','contract_refused','write_refused')


def refuse():raise ValueError('closed fullstack timing contract')


def filename(name):
    if name not in (NAME,CONTACTS_NAME):refuse()
    return name


def source_ok(value):return type(value) is str and re.fullmatch('[0-9a-f]{40}',value) is not None


def output_binding(output):return hashlib.sha256(os.fsencode(Path(output).resolve())).hexdigest()


def context_ok(name,group,phase):
    if type(group) is not int or type(phase) is not int:return False
    if name.startswith('phase_'):return 0<=phase<=11 and group==phase//3
    if name.startswith('mode_'):return 0<=group<=3 and phase==-1
    return group==phase==-1


def decode(raw):
    def unique(pairs):
        result=dict(pairs)
        if len(result)!=len(pairs):refuse()
        return result
    return json.loads(raw,object_pairs_hook=unique)


def source(output):
    try:
        value=read_json(Path(output)/'evidence.json',1_048_576).get('source')
        return value if source_ok(value) else None
    except (OSError,ValueError,AttributeError):return None


def validate(value,source,output,*,scope_binding=None):
    extended=scope_binding is not None
    maximum=900_000 if extended else MAX_MS
    if extended and (type(scope_binding) is not dict or scope_binding.get('scope')!='technical'
            or scope_binding.get('source')!=source or scope_binding.get('output_sha256')!=output_binding(output)
            or scope_binding.get('profile')!='platform-technical-v1'
            or type(scope_binding.get('worker_deadline_seconds')) is not int or scope_binding['worker_deadline_seconds']!=900):refuse()
    keys={'schema','source','output_sha256','state','reason','elapsed_ms','saturated','active','stages'}
    if (type(value) is not dict or set(value)!=(keys|{'worker_deadline_seconds','scope_binding'} if extended else keys)
            or type(value['schema']) is not int or value['schema']!=(2 if extended else 1)
            or extended and (type(value['worker_deadline_seconds']) is not int or value['worker_deadline_seconds']!=900
                or type(value['scope_binding']) is not dict or type(value['scope_binding'].get('worker_deadline_seconds')) is not int
                or value['scope_binding']!=scope_binding)
            or not source_ok(source) or value['source']!=source or value['output_sha256']!=output_binding(output)
            or type(value['state']) is not str or value['state'] not in (*STATES,'refused')
            or type(value['reason']) is not str
            or (value['reason'] not in REFUSALS if value['state']=='refused' else value['reason']!=STATES[value['state']])
            or type(value['elapsed_ms']) is not int or not 0<=value['elapsed_ms']<=maximum
            or type(value['saturated']) is not bool or value['saturated'] and value['elapsed_ms']!=maximum
            or type(value['stages']) is not list or len(value['stages'])>MAX_ROWS):refuse()
    previous=0
    for index,row in enumerate(value['stages']):
        if (type(row) is not dict or set(row)!={'stage','group','phase','start_ms','end_ms','duration_ms','outcome'}
                or type(row['stage']) is not str or row['stage'] not in STAGES
                or not context_ok(row['stage'],row['group'],row['phase'])
                or type(row['start_ms']) is not int or not previous<=row['start_ms']<=value['elapsed_ms']
                or type(row['outcome']) is not str or row['outcome'] not in ('running','completed','failed','interrupted')):refuse()
        if row['outcome']=='running':
            if index!=len(value['stages'])-1 or row['end_ms'] is not None or row['duration_ms'] is not None:refuse()
        else:
            if (type(row['end_ms']) is not int or not row['start_ms']<=row['end_ms']<=value['elapsed_ms']
                    or type(row['duration_ms']) is not int or not 0<=row['duration_ms']<=maximum
                    or not value['saturated'] and row['end_ms']-row['start_ms']!=row['duration_ms']):refuse()
            previous=row['end_ms']
            if row['outcome']!='completed' and index!=len(value['stages'])-1:refuse()
    active=len(value['stages'])-1 if value['stages'] and value['stages'][-1]['outcome']!='completed' else None
    if value['active']!=active or value['active'] is not None and type(value['active']) is not int:refuse()
    if value['state']=='completed' and active is not None:refuse()
    if value['state'] in ('failed','interrupted') and active is not None and value['stages'][-1]['outcome']!=value['state']:refuse()
    if value['state'] in ('running','completed') and any(row['outcome'] in ('failed','interrupted') for row in value['stages']):refuse()
    return value


def read_json(path,limit):
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(descriptor,'rb') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size>limit:refuse()
        raw=stream.read(limit+1)
    if len(raw)>limit:refuse()
    return decode(raw)


def validate_file(value,name):
    filename(name)
    if name==CONTACTS_NAME:
        stages=value['stages']
        if ([row['stage'] for row in stages]!=['seed_contacts','seed_contact_count'][:len(stages)]
                or len(stages)>2 or value['state']=='completed' and len(stages)!=2):refuse()
    return value


def read(output,source,*,binding_output=None,name=NAME,scope_binding=None):
    if scope_binding is not None and name!=NAME:refuse()
    return validate_file(validate(read_json(Path(output)/filename(name),MAX_BYTES),source,output if binding_output is None else binding_output,scope_binding=scope_binding),name)


def write(output,value,source,*,binding_output=None,name=NAME,scope_binding=None):
    if scope_binding is not None and name!=NAME:refuse()
    raw=(json.dumps(validate_file(validate(value,source,output if binding_output is None else binding_output,scope_binding=scope_binding),name),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    path=Path(output)/filename(name);temporary=path.with_name('.'+path.stem+'.new')
    if len(raw)>MAX_BYTES or path.is_symlink() or path.exists() and not path.is_file():refuse()
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    created=None
    try:
        with os.fdopen(descriptor,'wb') as stream:
            info=os.fstat(stream.fileno());created=(info.st_dev,info.st_ino);stream.write(raw)
        os.replace(temporary,path)
    finally:
        if created is not None:
            try:info=temporary.lstat()
            except FileNotFoundError:info=None
            if info is not None and stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==created:temporary.unlink()


class Timing:
    def __init__(self,output,source,*,clock=time.monotonic,name=NAME,scope_binding=None):
        if scope_binding is not None and name!=NAME:refuse()
        self.output=Path(output);self.source=source;self.clock=clock;self.name=filename(name)
        self.scope_binding=scope_binding;self.maximum=MAX_MS if scope_binding is None else 900_000
        self.origin=None;self.last=None;self.raw=0;self.writes=0;self.finished=False
        self.value={'schema':1,'source':source,'output_sha256':output_binding(output),'state':'running','reason':'none',
                    'elapsed_ms':0,'saturated':False,'active':None,'stages':[]}
        if scope_binding is not None:self.value.update(schema=2,worker_deadline_seconds=900,scope_binding=scope_binding)
        if not source_ok(source):self._refuse('binding_refused')
        else:self._sample();self._persist()

    def _refuse(self,reason):self.value.update(state='refused',reason=reason)

    def _sample(self):
        primary=sys.exception()
        try:
            now=self.clock()
            if (type(now) not in (int,float) or not math.isfinite(now) or not 0<=now<=2**53
                    or self.last is not None and now<self.last):refuse()
            if self.origin is None:self.origin=now
            self.raw=math.floor((now-self.origin)*1000);self.last=now
            self.value.update(elapsed_ms=min(self.maximum,self.raw),saturated=self.raw>self.maximum)
            return True
        except BaseException as error:
            if primary is None and not isinstance(error,Exception):raise
            self._refuse('clock_refused');return False

    def _persist(self):
        if not source_ok(self.source):return
        primary=sys.exception()
        try:
            self.writes+=1
            if self.writes>MAX_WRITES:refuse()
            write(self.output,self.value,self.source,**({} if self.name==NAME else {'name':self.name}),**({} if self.scope_binding is None else {'scope_binding':self.scope_binding}))
        except BaseException as error:
            if primary is None and not isinstance(error,Exception):raise
            self._refuse('write_refused')

    def call(self,name,callback,*args,group=-1,phase=-1,**options):
        entered=False
        if not self.finished and self.value['state']=='running':
            if (type(name) is not str or name not in STAGES or self.value['active'] is not None
                    or len(self.value['stages'])>=MAX_ROWS or not context_ok(name,group,phase)):
                self._refuse('contract_refused')
            elif self._sample():
                start=self.raw
                self.value['stages'].append({'stage':name,'group':group,'phase':phase,'start_ms':min(start,self.maximum),
                    'end_ms':None,'duration_ms':None,'outcome':'running'})
                self.value['active']=len(self.value['stages'])-1;entered=True
            self._persist()
        try:result=callback(*args,**options)
        except BaseException as error:
            if entered:self._close(start,'interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else 'failed')
            raise
        else:
            if entered:self._close(start,'completed')
            return result

    def _close(self,start,outcome):
        if self.value['state']!='refused' and self._sample():
            self.value['stages'][-1].update(end_ms=min(self.raw,self.maximum),duration_ms=min(self.raw-start,self.maximum),outcome=outcome)
            if outcome=='completed':self.value['active']=None
            else:self.value.update(state=outcome,reason='cancelled' if outcome=='interrupted' else 'work_failed')
        self._persist()

    def finish(self):
        if self.finished:return
        primary=sys.exception();self.finished=True
        if self.value['state']!='refused' and self._sample() and self.value['state']=='running':
            state=('interrupted' if isinstance(primary,(KeyboardInterrupt,SystemExit)) else 'failed') if primary else 'completed'
            self.value.update(state=state,reason=STATES[state])
        self._persist()
        if primary is None and self.value['state']=='refused':refuse()


def call(timing,name,callback,*args,**options):
    if timing is None:
        options.pop('group',None);options.pop('phase',None)
        return callback(*args,**options)
    return timing.call(name,callback,*args,**options)
