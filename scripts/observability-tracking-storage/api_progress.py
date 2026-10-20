"""Separate best-effort milestone channel for the two owned real API producers."""
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status

NAME='api-producer-phase.json'
MAX_BYTES=512
MILESTONES=('producer_started','modules_imported','migrated','provider_started','api_started',
            'http_completed','carrier_confirmed','relay_started','delivery_confirmed','sdk_shutdown','module_map_ready')
FIELDS=('schema','scope','source','state','milestone')


def validate(value,*,scope,source):
    if (scope not in ('tracking','waitlist') or type(source) is not str or re.fullmatch('[0-9a-f]{40}',source) is None
            or type(value) is not dict or set(value)!=set(FIELDS) or type(value['schema']) is not int or value['schema']!=1
            or value['scope']!=scope or value['source']!=source or type(value['state']) is not str
            or value['state'] not in ('observed','unknown','refused') or type(value['milestone']) is not str
            or (value['milestone'] not in MILESTONES if value['state']=='observed' else value['milestone']!='unknown')
            or scope=='tracking' and value['milestone']=='relay_started'):
        raise ValueError('closed API producer phase refused')
    return {key:value[key] for key in FIELDS}


def projection(scope,source,state='unknown'):
    return validate(dict(schema=1,scope=scope,source=source,state=state,milestone='unknown'),scope=scope,source=source)


def read(path,*,scope,source):
    try:
        descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    except FileNotFoundError:
        if path.is_symlink(): raise ValueError('closed API producer phase refused') from None
        return projection(scope,source)
    except OSError:
        raise ValueError('closed API producer phase refused') from None
    with os.fdopen(descriptor,'rb') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1 or info.st_size>MAX_BYTES:
            raise ValueError('closed API producer phase refused')
        raw=stream.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES: raise ValueError('closed API producer phase refused')
    try: return validate(source_status.decode_json(raw),scope=scope,source=source)
    except (ValueError,TypeError,RecursionError,UnicodeError,OverflowError):
        raise ValueError('closed API producer phase refused') from None


def write(path,value,*,scope,source):
    raw=(json.dumps(validate(value,scope=scope,source=source),separators=(',',':'))+'\n').encode()
    if len(raw)>MAX_BYTES: raise ValueError('closed API producer phase refused')
    temporary=path.with_name('.api-producer-phase.new')
    created=False
    try:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        created=True
        with os.fdopen(fd,'wb') as stream: stream.write(raw)
        os.replace(temporary,path)
    finally:
        if created: temporary.unlink(missing_ok=True)


class OwnedProgress:
    def __init__(self,output,*,scope,source):
        projection(scope,source)
        self.output,self.scope,self.source=output,scope,source
    def __enter__(self):
        self.directory=tempfile.TemporaryDirectory(prefix='inside-api-phase-')
        self.path=Path(self.directory.name).resolve()/'phase.json'
        return self
    def environment(self,environment):
        return {**environment,'INSIDE_PRODUCER_PHASE_PATH':str(self.path),
                'INSIDE_PRODUCER_PHASE_SCOPE':self.scope,'INSIDE_PRODUCER_PHASE_SOURCE':self.source}
    def __exit__(self,kind,error,traceback):
        try:
            try:
                value=read(self.path,scope=self.scope,source=self.source)
                # Child authority is limited to completed milestones, never a public refusal/absence projection.
                if self.path.exists() and value['state']!='observed': raise ValueError()
            except (OSError,ValueError): value=projection(self.scope,self.source,'refused')
            try:
                write(self.output/NAME,value,scope=self.scope,source=self.source)
                if value['state']=='refused' and error is None: raise ValueError('closed API producer phase refused')
            except (OSError,ValueError):
                if error is None: raise
        finally:
            try: self.directory.cleanup()
            except OSError:
                if error is None: raise
        return False
