"""Finite worker timings, never a workload deadline or acceptance oracle."""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
import source_status

NAME='core-stage-timing.json'
METADATA_SCOPE='Linux hosted functional smoke; not Timeweb capacity, Mac MCP or full resource acceptance'
EVIDENCE_SCOPE='synthetic OTLP core compatibility smoke only'
MAX_BYTES=16384
MAX_MS=600000
MAX_WRITES=50
STAGES=('plugin_install','compose_validate','compose_up','trace_logging','query_and_boundary_negatives',
        'otlp_ready','phase_idle','phase_steady','phase_spike','stored_fixtures','stored_privacy_health',
        'link_corpus','notification_corpus','dependency_corpus','email_corpus','telegram_corpus',
        'trace_store_surface','native_mcp','read_post','collector_restart','key_rotation','freshness_setup','freshness')
FIELDS={'schema','source','state','reason','elapsed','active','stages'}
PAIRS={'running':('none',),'passed':('none',),'failed':('work_failed',),'interrupted':('cancelled',),
       'refused':('clock_refused','write_refused','order_refused'),'unavailable':('legacy_absent',)}


def refuse():raise ValueError('closed core timing contract')

def source_ok(value):return type(value) is str and re.fullmatch(r'[a-f0-9]{40}',value) is not None

def bounded(value):return {'ms':min(value,MAX_MS),'saturated':value>MAX_MS}

def stamp(value):
    if (type(value) is not dict or set(value)!={'ms','saturated'} or type(value['ms']) is not int
            or not 0<=value['ms']<=MAX_MS or type(value['saturated']) is not bool
            or value['saturated'] and value['ms']!=MAX_MS):refuse()
    return value

def before(a,b):return a['ms']<=b['ms'] and (not a['saturated'] or b['saturated'])

def unavailable(source):
    return {'schema':1,'source':source,'state':'unavailable','reason':'legacy_absent','elapsed':None,'active':None,'stages':[]}


def validate(value,source):
    if (not source_ok(source) or type(value) is not dict or set(value)!=FIELDS or type(value['schema']) is not int
            or value['schema']!=1 or type(value['source']) is not str or value['source']!=source
            or type(value['state']) is not str or value['state'] not in PAIRS or type(value['reason']) is not str
            or value['reason'] not in PAIRS[value['state']] or type(value['stages']) is not list
            or len(value['stages'])>len(STAGES) or value['active'] is not None and type(value['active']) is not str):refuse()
    elapsed=value['elapsed'];rows=value['stages'];active=value['active']
    if elapsed is not None:stamp(elapsed)
    elif rows or value['state'] not in ('unavailable','refused'):refuse()
    previous=None
    for index,row in enumerate(rows):
        if (type(row) is not dict or set(row)!={'stage','start','end','duration','outcome'}
                or type(row['stage']) is not str or row['stage']!=STAGES[index]
                or type(row['outcome']) is not str or row['outcome'] not in ('running','completed','failed','interrupted')):refuse()
        start=stamp(row['start'])
        if not before(start,elapsed) or previous is not None and not before(previous,start):refuse()
        if row['outcome']=='running':
            if index!=len(rows)-1 or row['end'] is not None or row['duration'] is not None:refuse()
        else:
            end=stamp(row['end']);duration=stamp(row['duration'])
            if not before(start,end) or not before(end,elapsed):refuse()
            if not end['saturated']:
                if duration['saturated'] or end['ms']-start['ms']!=duration['ms']:refuse()
            elif not start['saturated'] and not duration['saturated'] and duration['ms']<=MAX_MS-start['ms']:refuse()
            previous=end
        if row['outcome']!='completed' and index!=len(rows)-1:refuse()
    expected=rows[-1]['stage'] if rows and rows[-1]['outcome']!='completed' else None
    if active!=expected:refuse()
    if value['state']=='passed' and (len(rows)!=len(STAGES) or active is not None):refuse()
    if value['state']=='unavailable' and (elapsed is not None or rows or active is not None):refuse()
    if value['state'] in ('running','passed') and any(row['outcome'] in ('failed','interrupted') for row in rows):refuse()
    if value['state']=='failed' and rows and active is not None and rows[-1]['outcome']!='failed':refuse()
    if value['state']=='interrupted' and rows and active is not None and rows[-1]['outcome']!='interrupted':refuse()
    return value


def read_json(path,limit):
    if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_size>limit:refuse()
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):refuse()
        raw=stream.read(limit+1)
    if len(raw)>limit:refuse()
    return source_status.decode_json(raw)


def source_from_evidence(path):
    value=read_json(path,1_048_576)
    if (type(value) is not dict or not source_ok(value.get('source'))
            or type(value.get('scope')) is not str or value['scope']!=EVIDENCE_SCOPE):refuse()
    return value['source']


def source_from_metadata(path):
    value=read_json(path,1_048_576)
    if (type(value) is not dict or not source_ok(value.get('checkout_sha'))
            or not source_ok(value.get('checkout_tree')) or type(value.get('provider_execution_sha')) is not str
            or value['checkout_sha']!=value['provider_execution_sha']
            or type(value.get('scope')) is not str or value['scope']!=METADATA_SCOPE):refuse()
    return value['checkout_sha']


def read(path,source):
    if not path.exists() and not path.is_symlink():return validate(unavailable(source),source)
    return validate(read_json(path,MAX_BYTES),source)


def write(path,value,source):
    raw=(json.dumps(validate(value,source),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    if len(raw)>MAX_BYTES or path.is_symlink() or path.exists() and not path.is_file():refuse()
    temporary=path.with_name('.core-stage-timing.new')
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    created=None;committed=False
    try:
        with os.fdopen(descriptor,'wb') as stream:
            info=os.fstat(stream.fileno());created=(info.st_dev,info.st_ino);stream.write(raw)
        os.replace(temporary,path);committed=True
    finally:
        primary,tb=sys.exc_info()[1:]
        try:
            if not committed and created is not None:
                try:info=temporary.lstat()
                except FileNotFoundError:info=None
                if info is not None and stat.S_ISREG(info.st_mode) and (info.st_dev,info.st_ino)==created:temporary.unlink()
        except BaseException:
            if primary is None:raise
            BaseException.with_traceback(primary,tb)


class Timing:
    def __init__(self,output,source,*,clock=None):
        self.path=Path(output)/NAME;self.source=source;self.clock=time.monotonic if clock is None else clock
        self.origin=None;self.last_clock=None;self.raw=0;self.start_raw=None;self.writes=0;self.finished=False
        self.value={'schema':1,'source':source,'state':'running','reason':'none','elapsed':None,'active':None,'stages':[]}
        if not source_ok(source):self._refuse('write_refused');return
        self._sample();self._persist()

    def _refuse(self,reason):
        if self.value['state'] not in ('refused','failed','interrupted'):
            self.value.update(state='refused',reason=reason)

    def _sample(self):
        if self.value['state']=='refused':return False
        primary,tb=sys.exc_info()[1:]
        try:
            now=self.clock()
            if type(now) not in (int,float) or not math.isfinite(now) or not 0<=now<=2**53:refuse()
            if self.last_clock is not None and now<self.last_clock:refuse()
            if self.origin is None:self.origin=now
            raw=math.floor((now-self.origin)*1000)
            if not 0<=raw<=2**63-1:refuse()
            self.raw=raw;self.last_clock=now;self.value['elapsed']=bounded(raw)
            return True
        except BaseException as error:
            if primary is None and not isinstance(error,Exception):raise
            self._refuse('clock_refused')
            if primary is not None:BaseException.with_traceback(primary,tb)
            return False

    def _persist(self):
        if not source_ok(self.source):return
        primary,tb=sys.exc_info()[1:]
        try:
            self.writes+=1
            if self.writes>MAX_WRITES:refuse()
            write(self.path,self.value,self.source)
        except BaseException as error:
            if primary is None and not isinstance(error,Exception):raise
            self._refuse('write_refused')
            if primary is not None:BaseException.with_traceback(primary,tb)

    @contextmanager
    def stage(self,name):
        entered=False
        if not self.finished and self.value['state']=='running':
            index=len(self.value['stages'])
            if type(name) is not str or index>=len(STAGES) or name!=STAGES[index] or self.value['active'] is not None:
                self._refuse('order_refused')
            elif self._sample():
                self.start_raw=self.raw
                self.value['stages'].append({'stage':name,'start':bounded(self.raw),'end':None,'duration':None,'outcome':'running'})
                self.value['active']=name;entered=True
            self._persist()
        try:yield
        except BaseException as error:
            if entered:self._close('interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else 'failed')
            raise
        else:
            if entered:self._close('completed')

    def _close(self,outcome):
        if self.value['state']!='refused' and self._sample():
            self.value['stages'][-1].update(end=bounded(self.raw),duration=bounded(self.raw-self.start_raw),outcome=outcome)
            if outcome=='completed':self.value['active']=None
            else:self.value.update(state=outcome,reason='cancelled' if outcome=='interrupted' else 'work_failed')
        self._persist()

    def require(self):
        if (self.value['state']!='running' or len(self.value['stages'])!=len(STAGES)
                or self.value['active'] is not None):refuse()
        validate(self.value,self.source)

    def finish(self):
        if self.finished:return
        primary,tb=sys.exc_info()[1:];self.finished=True
        if self._sample() and self.value['state']=='running':
            if primary is not None:
                self.value.update(state='interrupted' if isinstance(primary,(KeyboardInterrupt,SystemExit)) else 'failed',
                                  reason='cancelled' if isinstance(primary,(KeyboardInterrupt,SystemExit)) else 'work_failed')
            elif len(self.value['stages'])==len(STAGES) and self.value['active'] is None:self.value.update(state='passed')
        self._persist()
        if primary is not None:BaseException.with_traceback(primary,tb)
        elif self.value['state']=='refused':refuse()
