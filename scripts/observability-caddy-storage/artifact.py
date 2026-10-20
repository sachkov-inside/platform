"""Closed canonical evidence with anchored private reads and atomic commits."""
from contextlib import contextmanager
from decimal import Decimal
import json
import math
import os
from pathlib import Path
import stat
import sys
import caddy_status as status
import evidence

NAME='caddy-observation.json'
FIELDS={'schema','scope','partition','state','reason','sample_age_seconds','observation','comparison','transport','not_covered'}


def refuse():raise ValueError('closed Caddy artifact refused')


def integer(value):
    if type(value) is not int or not 0<=value<=status.MAX_NUMBER:refuse()
    return value


def numeric(value):
    if type(value) not in (int,float,Decimal) or not math.isfinite(value) or not 0<=value<=status.MAX_NUMBER:refuse()
    return float(value)


def _duration(value,delta=False):
    if type(value) is not list or not 1<=len(value)<=status.MAX_GROUPS:refuse()
    rows=[];seen=set();count_key='count_delta' if delta else 'count';sum_key='sum_seconds_delta' if delta else 'sum_seconds';bucket_key='bucket_deltas' if delta else 'buckets'
    for row in value:
        if (type(row) is not dict or set(row)!={'method','code',count_key,sum_key,bucket_key}
                or type(row['method']) is not str or row['method'] not in status.METHODS
                or type(row['code']) is not int or not 100<=row['code']<=599
                or type(row[bucket_key]) is not list or len(row[bucket_key])!=12):refuse()
        identity=(row['method'],row['code'])
        if identity in seen:refuse()
        seen.add(identity);count=integer(row[count_key]);total=numeric(row[sum_key]);buckets=[integer(v) for v in row[bucket_key]]
        if any(a>b for a,b in zip(buckets,buckets[1:])) or buckets[-1]!=count or count==0 and total!=0:refuse()
        rows.append({'method':identity[0],'code':identity[1],count_key:count,sum_key:total,bucket_key:buckets})
    if [(r['method'],r['code']) for r in rows]!=sorted(seen):refuse()
    return rows


def validate(value):
    try:
        if (type(value) is not dict or set(value)!=FIELDS or type(value['schema']) is not int or value['schema']!=1
                or value['scope']!='isolated-pilot-caddy' or value['partition']!='srv0/subroute'
                or value['not_covered']!=status.NOT_COVERED or type(value['not_covered']) is not list
                or type(value['transport']) is not dict or set(value['transport'])!={'canonical','mcp'}
                or any(type(v) is not str or v not in ('unrun','passed','failed') for v in value['transport'].values())
                or type(value['state']) is not str or value['state'] not in ('observed','down','missing','stale','incomplete','query_unavailable','malformed')
                or type(value['reason']) is not str):refuse()
        allowed={'observed':{'none'},'down':{'none'},'missing':{'none'},'stale':{'none'},'incomplete':{'unseeded','partial'},
                 'query_unavailable':{'credentials','timeout','transport','http_error','interrupted'},'malformed':{'raw_contract'}}
        state=value['state']
        if value['reason'] not in allowed[state]:refuse()
        age=None if value['sample_age_seconds'] is None else numeric(value['sample_age_seconds'])
        if state in ('down','observed') and (age is None or age>status.MAX_AGE_SECONDS):refuse()
        if state in ('missing','malformed','query_unavailable') and age is not None:refuse()
        observation=comparison=None
        if state=='observed':
            if value['transport']!={'canonical':'passed','mcp':'passed'}:refuse()
            item=value['observation']
            if type(item) is not dict or set(item)!={'requests_total','request_errors_total','in_flight','duration'}:refuse()
            count=integer(item['requests_total']);errors=integer(item['request_errors_total']);flight=integer(item['in_flight']);duration=_duration(item['duration'])
            if errors>count or sum(g['count'] for g in duration)!=count:refuse()
            observation={'requests_total':count,'request_errors_total':errors,'in_flight':flight,'duration':duration}
            item=value['comparison']
            if item is not None:
                if type(item) is not dict or set(item)!={'state','requests_delta','errors_delta','duration'} or type(item['state']) is not str:refuse()
                if item['state'] in ('incomplete','reset_observed'):
                    if item['requests_delta'] is not None or item['errors_delta'] is not None or item['duration']!=[]:refuse()
                    comparison={'state':item['state'],'requests_delta':None,'errors_delta':None,'duration':[]}
                elif item['state']=='observed':
                    delta=integer(item['requests_delta']);error_delta=integer(item['errors_delta']);groups=_duration(item['duration'],True)
                    if (delta>count or error_delta>errors or error_delta>delta or sum(g['count_delta'] for g in groups)!=delta
                            or [(g['method'],g['code']) for g in groups]!=[(g['method'],g['code']) for g in duration]):refuse()
                    for group,current in zip(groups,duration):
                        if group['count_delta']>current['count'] or group['sum_seconds_delta']>current['sum_seconds'] or any(a>b for a,b in zip(group['bucket_deltas'],current['buckets'])):refuse()
                    comparison={'state':'observed','requests_delta':delta,'errors_delta':error_delta,'duration':groups}
                else:refuse()
        elif value['observation'] is not None or value['comparison'] is not None:refuse()
        result=status.record(state,value['reason'],age,observation,comparison);result['transport']=value['transport'].copy()
        if len(json.dumps(result,allow_nan=False).encode())>status.MAX_OUTPUT_BYTES:refuse()
        return result
    except (ValueError,KeyError,TypeError,OverflowError):refuse()


@contextmanager
def directory(root):
    if not root.is_absolute() or len(root.parts)>64 or root!=root.resolve(strict=True):refuse()
    descriptors=[]
    try:
        flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
        descriptor=os.open(root.anchor,flags);descriptors.append(descriptor)
        for component in root.parts[1:]:
            descriptor=os.open(component,flags,dir_fd=descriptor);descriptors.append(descriptor)
        info=os.fstat(descriptor)
        if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:refuse()
        yield descriptor
    finally:
        primary=sys.exc_info()[0] is not None
        close_failed=False
        for descriptor in reversed(descriptors):
            try:os.close(descriptor)
            except OSError:close_failed=True
        if close_failed and not primary:refuse()


def _read(root, name, validator, cap):
    try:
        with directory(root) as directory_fd:
            try:descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory_fd)
            except FileNotFoundError:return None
            with os.fdopen(descriptor,'rb') as stream:
                info=os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1
                        or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>cap):refuse()
                raw=stream.read(cap+1)
                final=os.fstat(stream.fileno());linked=os.stat(name,dir_fd=directory_fd,follow_symlinks=False)
                identity=lambda v:(v.st_dev,v.st_ino,v.st_uid,v.st_mode,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
                if len(raw)>cap or identity(info)!=identity(final) or identity(final)!=identity(linked):refuse()
            return validator(status.source_status.decode_json(raw))
    except (OSError,ValueError,TypeError,RecursionError):refuse()


def _write(root,value,name,validator,cap):
    value=validator(value);raw=(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n').encode()
    if len(raw)>cap:refuse()
    temporary="."+name+".new"
    with directory(root) as directory_fd:
        created=False
        try:
            descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_CLOEXEC,0o600,dir_fd=directory_fd);created=True
            with os.fdopen(descriptor,'wb') as stream:stream.write(raw)
            os.replace(temporary,name,src_dir_fd=directory_fd,dst_dir_fd=directory_fd)
            created=False
        finally:
            if created:os.unlink(temporary,dir_fd=directory_fd)


def read(root):
    return _read(root,NAME,validate,status.MAX_OUTPUT_BYTES)


def write(root,value):
    _write(root,value,NAME,validate,status.MAX_OUTPUT_BYTES)


def read_run(root):
    return _read(root,'caddy-run.json',evidence.validate,evidence.MAX_BYTES)


def write_run(root,value):
    _write(root,value,'caddy-run.json',evidence.validate,evidence.MAX_BYTES)
