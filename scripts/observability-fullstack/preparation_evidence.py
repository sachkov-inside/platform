"""Closed numeric preparation checkpoints, source-bound and independent of build output."""
import json
import os
import re
import sys
import disk_feedback
from storage_policy import FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES

NAME='fullstack-preparation.json'
LIMIT=16*1024


def stage(value):
    return type(value) is str and (value in ('not_started','manifest') or re.fullmatch(r'build_(backend|foundation|web|telegram|logto)|preload_([0-9]|[12][0-9]|3[01])',value) is not None)


def validate(value, source):
    if (type(value) is not dict or set(value)!={'schema','source','growth_limit_bytes','stage','completed','checkpoints','disk'}
            or type(value['schema']) is not int or value['schema']!=1 or value['source']!=source
            or type(value['growth_limit_bytes']) is not int or value['growth_limit_bytes']!=FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES
            or not stage(value['stage']) or type(value['completed']) is not list or len(value['completed'])>38
            or any(not stage(item) or item=='not_started' for item in value['completed'])
            or len(set(value['completed']))!=len(value['completed'])
            or type(value['checkpoints']) is not list or len(value['checkpoints'])>38):
        raise ValueError('fullstack_preparation_evidence')
    disk_feedback.validate(value['disk'],source)
    for point in value['checkpoints']:
        if type(point) is not dict or set(point)!={'stage','sample'} or not stage(point['stage']):raise ValueError('fullstack_preparation_evidence')
        if point['sample'] is not None:
            if type(point['sample']) is not dict:raise ValueError('fullstack_preparation_evidence')
            disk_feedback.point(point['sample'],point['sample'].get('id')==0)
    return value


def read(path,source):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>LIMIT:raise ValueError('fullstack_preparation_evidence')
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as stream:raw=stream.read(LIMIT+1)
    if len(raw)>LIMIT:raise ValueError('fullstack_preparation_evidence')
    return validate(disk_feedback.decode_json(raw),source)


class Record:
    def __init__(self, metadata, source, disk):
        self.path=metadata/NAME;self.source=source;self.disk=disk
        self.stage='not_started';self.done=[];self.checkpoints=[]

    def mark(self, name):
        if not stage(name):raise ValueError('fullstack_preparation_stage')
        self.stage=name
        self.persist()

    def completed(self):
        self.done.append(self.stage)
        sample=self.disk.view.current[6] if self.disk.view is not None else None
        self.checkpoints.append({'stage':self.stage,'sample':disk_feedback.encoded_point(sample)})
        self.persist()

    def persist(self):
        primary=sys.exc_info()[0] is not None
        try:
            # Intermediate observations must not seal the live record.
            observed=disk_feedback.Record(self.source)
            observed.view=self.disk.view;observed.attempted=self.disk.attempted;observed.did_enter=self.disk.did_enter
            observed.checkpoint=self.disk.checkpoint;observed.backend_checkpoint=self.disk.backend_checkpoint
            observed.seal()
            value={'schema':1,'source':self.source,'growth_limit_bytes':FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES,
                'stage':self.stage,'completed':self.done,'checkpoints':self.checkpoints,'disk':observed.value}
            raw=(json.dumps(validate(value,self.source),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
            if len(raw)>LIMIT or self.path.is_symlink():raise ValueError('fullstack_preparation_evidence')
            descriptor=os.open(self.path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
            with os.fdopen(descriptor,'wb') as stream:stream.write(raw)
        except BaseException:
            if not primary:raise
