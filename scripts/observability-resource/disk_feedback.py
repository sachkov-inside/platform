"""Closed source-bound same-read numeric facts, never allocation/capacity proof."""
import json
import os
import re
import stat
import sys
from disk_samples import DiskSamples
from acquisition import decode_json

NAME='resource-disk-samples.json'
MAX_BYTES=4096
FIELDS={'schema','source','state','reason','cutoff','baseline','latest_safe','stopping','last_observed_before_first_pull'}
STATES=('observed','unavailable','refused')
REASONS=('none','legacy_absent','not_started','entry_unavailable','unsealed_exit','read_unavailable','legacy_stop','numeric_refused','sample_failure')
CUTOFFS=('legacy_absent','not_entered','unsealed_exit','after_bounded_join')
KINDS=('not_reached','baseline','safe','stopping','unavailable','refused')


def refuse():raise ValueError('resource_numeric_contract')


def point(value,baseline=False):
    if (type(value) is not dict or set(value)!={'id','free_bytes'}
            or type(value['id']) is not int or type(value['free_bytes']) is not int
            or not 0<=value['free_bytes']<=2**63-1
            or not (value['id']==0 if baseline else 1<=value['id']<=65535)):refuse()
    return value


def unavailable(source,reason='legacy_absent',cutoff='legacy_absent'):
    return {'schema':1,'source':source,'state':'unavailable','reason':reason,'cutoff':cutoff,
            'baseline':None,'latest_safe':None,'stopping':None,
            'last_observed_before_first_pull':{'state':'not_reached','sample':None}}


def validate(value,source):
    if (type(source) is not str or re.fullmatch(r'[a-f0-9]{40}',source) is None
            or type(value) is not dict or set(value)!=FIELDS or type(value['schema']) is not int or value['schema']!=1
            or type(value['source']) is not str or value['source']!=source
            or any(type(value[k]) is not str for k in ('state','reason','cutoff'))
            or value['state'] not in STATES or value['reason'] not in REASONS or value['cutoff'] not in CUTOFFS):refuse()
    baseline,safe,stop=(value[k] for k in ('baseline','latest_safe','stopping'))
    if baseline is not None:point(baseline,True)
    for item in (safe,stop):
        if item is not None:
            point(item)
            if baseline is None:refuse()
    if safe is not None and stop is not None and safe['id']>=stop['id']:refuse()
    state,reason,cutoff=(value[k] for k in ('state','reason','cutoff'))
    if state=='observed':
        if reason!='none' or cutoff!='after_bounded_join' or baseline is None:refuse()
    elif state=='refused':
        if reason not in ('numeric_refused','sample_failure') or cutoff=='legacy_absent':refuse()
    else:
        pairs={'legacy_absent':'legacy_absent','not_started':'not_entered','entry_unavailable':'not_entered',
               'unsealed_exit':'unsealed_exit','read_unavailable':'after_bounded_join','legacy_stop':'after_bounded_join'}
        if pairs.get(reason)!=cutoff:refuse()
        if reason in ('legacy_absent','not_started') and any(x is not None for x in (baseline,safe,stop)):refuse()
        if reason in ('read_unavailable','legacy_stop') and (baseline is None or stop is not None):refuse()
    checkpoint=value['last_observed_before_first_pull']
    if (type(checkpoint) is not dict or set(checkpoint)!={'state','sample'} or type(checkpoint['state']) is not str
            or checkpoint['state'] not in KINDS):refuse()
    kind,sample=checkpoint['state'],checkpoint['sample']
    if kind in ('baseline','safe','stopping'):
        point(sample,kind=='baseline')
        expected={'baseline':baseline,'safe':safe,'stopping':stop}[kind]
        if expected is None:refuse()
        if kind=='safe':
            if sample['id']>expected['id'] or sample['id']==expected['id'] and sample!=expected:refuse()
        elif sample!=expected:refuse()
    elif sample is not None:refuse()
    if kind=='unavailable' and state not in ('unavailable','refused') or kind=='refused' and state!='refused':refuse()
    if reason in ('legacy_absent','not_started') and kind!='not_reached':refuse()
    return value


def read(path,source):
    if not path.exists() and not path.is_symlink():return validate(unavailable(source),source)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_BYTES:refuse()
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):refuse()
        raw=stream.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES:refuse()
    return validate(decode_json(raw),source)


def write(path,value,source):
    raw=(json.dumps(validate(value,source),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    if len(raw)>MAX_BYTES or path.is_symlink() or path.exists() and not path.is_file():refuse()
    temporary=path.with_name('.resource-disk-samples.new')
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(descriptor,'wb') as stream:stream.write(raw)
        os.replace(temporary,path)
    finally:
        primary=sys.exc_info()[0] is not None
        try:
            if temporary.is_file() and not temporary.is_symlink():temporary.unlink()
        except OSError:
            if not primary:raise


def encoded_point(value):return None if value is None else {'id':value[0],'free_bytes':value[1]}


class Record:
    def __init__(self,source):
        validate(unavailable(source),source)
        self.source=source;self.view=None;self.attempted=False;self.did_enter=False
        self.checkpoint=('not_reached',None);self.checkpoint_taken=False
        self.failed=False;self.value=None;self.persist_attempted=False

    def attempt(self):self.attempted=True
    def entered(self,view):
        self.did_enter=True
        if type(view) is DiskSamples:self.view=view
        else:self.failed=True

    def first_pull(self):
        if self.checkpoint_taken:return
        self.checkpoint_taken=True
        try:
            if type(self.view) is not DiskSamples:raise ValueError('resource_numeric_view')
            snapshot=self.view.current
            self.checkpoint=(snapshot[5],snapshot[6])
        except Exception:
            self.failed=True;self.checkpoint=('refused',None)

    def seal(self):
        if self.value is not None:return
        primary=sys.exc_info()[0] is not None
        try:
            snapshot=self.view.final if type(self.view) is DiskSamples else None
        except BaseException:
            if not primary and sys.exc_info()[0] not in (OSError,ValueError):raise
            self.failed=True;snapshot=None
        cutoff='after_bounded_join' if snapshot is not None else 'unsealed_exit' if self.did_enter else 'not_entered'
        reason='unsealed_exit' if self.did_enter else 'entry_unavailable' if self.attempted else 'not_started'
        value=unavailable(self.source,reason,cutoff)
        prefix=snapshot
        if prefix is None and type(self.view) is DiskSamples:
            try:prefix=self.view.current
            except Exception:self.failed=True
        if prefix is not None:
            value.update(baseline=encoded_point(prefix[2]),latest_safe=encoded_point(prefix[3]),stopping=encoded_point(prefix[4]))
        if snapshot is not None:value.update(state=snapshot[0],reason=snapshot[1])
        if self.failed and value['state']!='refused':value.update(state='refused',reason='sample_failure')
        kind,sample=self.checkpoint
        value['last_observed_before_first_pull']={'state':kind,'sample':encoded_point(sample)}
        self.value=validate(value,self.source)

    def require(self):
        self.seal()
        if self.value['state']!='observed' or self.value['reason']!='none':raise ValueError('resource_numeric_required')

    def persist(self,path):
        if self.persist_attempted:return
        self.persist_attempted=True
        primary=sys.exc_info()[0] is not None
        try:self.seal();write(path,self.value,self.source)
        except BaseException:
            if not primary:raise
