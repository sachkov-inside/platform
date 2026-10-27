"""Source-specific private receipt and closed public result, with owned atomic inode lifetime."""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from pg_oracle_reasons import ORACLE_REASONS

NAME='postgres-source.json'
TEMPORARY='.postgres-source.json.new'
SCOPE='Isolated ordinary-role PostgreSQL server source only; no production/resource acceptance'
CASE_PHASES=('acquisition','baseline','connections','locks','deadlocks','reset','restart','stale','privacy','cleanup','complete')
PHASES=CASE_PHASES+('baseline_actor_start','baseline_setup',
    'baseline_first_acquire','baseline_first_upload','baseline_first_stored_read','baseline_first_stored_oracle','baseline_first_stored_pending','baseline_first_ledger',
    'baseline_second_acquire','baseline_second_upload','baseline_second_stored_read','baseline_second_stored_oracle','baseline_second_stored_pending','baseline_second_ledger',
    'baseline_waiting_locks',
    'baseline_setup_connect','baseline_setup_identity','baseline_setup_reader',
    'baseline_setup_grant_connect','baseline_setup_read_only','baseline_setup_schema',
    'baseline_setup_table','baseline_setup_rows','baseline_setup_reset',
    'restart_close_clients','restart_stop_identity','restart_stop_command','restart_stopped_identity',
    'restart_stopped_state','restart_unavailable_upload','restart_unavailable_read','restart_start_command',
    'restart_ready','restart_observe')
REASONS=('none','ownership','credentials','connection','query_timeout','query_refused','malformed','identity_unavailable','stale','reset','collector','storage','cleanup',*ORACLE_REASONS)
FRESHNESS=('fresh','stale','missing','unavailable','malformed')
CONTINUITY=('initial','same_epoch','statistics_reset','server_restart','ownership_changed','unknown')


def refuse(*_):raise ValueError('closed PostgreSQL source evidence refused') from None


def sha(value):return type(value) is str and re.fullmatch(r'[0-9a-f]{40}',value) is not None


def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:refuse()
        result[key]=value
    return result


def decode(raw):
    try:
        if raw.startswith(b'\xef\xbb\xbf'):refuse()
        return json.loads(raw.decode('utf-8',errors='strict'),object_pairs_hook=unique,parse_constant=refuse)
    except (ValueError,TypeError,UnicodeError,RecursionError,OverflowError):refuse()


def identity(info):return (info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)


@contextmanager
def directory(root):
    descriptors=[]
    try:
        if not root.is_absolute() or len(root.parts)>64 or root.resolve(strict=True)!=root:refuse()
        flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
        descriptor=os.open(root.anchor,flags);descriptors.append(descriptor)
        for component in root.parts[1:]:
            descriptor=os.open(component,flags,dir_fd=descriptor);descriptors.append(descriptor)
        info=os.fstat(descriptor)
        if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700 or identity(info)!=identity(os.lstat(root)):refuse()
        yield descriptor
        if root.resolve(strict=True)!=root or identity(os.fstat(descriptor))!=identity(os.lstat(root)):refuse()
    finally:
        primary,tb=sys.exc_info()[1:];failed=False
        for descriptor in reversed(descriptors):
            try:os.close(descriptor)
            except BaseException:failed=True
        if primary is not None:BaseException.__traceback__.__set__(primary,tb)
        elif failed:refuse()


def _read(root,name,cap):
    descriptor=None
    try:
        with directory(root) as owned:
            descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=owned)
            before=os.fstat(descriptor)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or before.st_nlink!=1
                    or stat.S_IMODE(before.st_mode)!=0o600 or before.st_size>cap):refuse()
            pieces=[];remaining=cap+1
            while remaining:
                chunk=os.read(descriptor,remaining)
                if not chunk:break
                pieces.append(chunk);remaining-=len(chunk)
            raw=b''.join(pieces)
            if (len(raw)>cap or identity(before)!=identity(os.fstat(descriptor))
                    or identity(before)!=identity(os.stat(name,dir_fd=owned,follow_symlinks=False))):refuse()
            return decode(raw)
    finally:
        primary,tb=sys.exc_info()[1:]
        if descriptor is not None:
            try:os.close(descriptor)
            except BaseException:
                if primary is None:refuse()
            finally:
                if primary is not None:BaseException.__traceback__.__set__(primary,tb)


def validate(value,source):
    fields={'schema','scope','source','state','phase','reason','cases','duration_seconds'}
    if (not sha(source) or type(value) is not dict or set(value)!=fields or type(value['schema']) is not int
            or value['schema']!=1 or value['scope']!='isolated-postgresql-source' or value['source']!=source
            or type(value['state']) is not str or value['state'] not in ('incomplete','passed','failed')
            or value['phase'] not in PHASES or value['reason'] not in REASONS
            or type(value['cases']) is not list or len(value['cases'])>16
            or type(value['duration_seconds']) not in (int,float) or not math.isfinite(value['duration_seconds'])
            or not 0<=value['duration_seconds']<=600):refuse()
    if value['reason'] in ORACLE_REASONS and (value['state']!='failed'
            or value['phase'] not in ('baseline_first_stored_oracle','baseline_second_stored_oracle','restart_unavailable_read')):refuse()
    cases=[]
    for case in value['cases']:
        if (type(case) is not dict or set(case)!={'phase','freshness','continuity','count_complete','points','age_seconds'}
                or case['phase'] not in CASE_PHASES or case['freshness'] not in FRESHNESS or case['continuity'] not in CONTINUITY
                or type(case['count_complete']) is not bool or type(case['points']) is not int or not 0<=case['points']<=7
                or case['age_seconds'] is not None and (type(case['age_seconds']) not in (int,float)
                    or not math.isfinite(case['age_seconds']) or not 0<=case['age_seconds']<=600)):refuse()
        cases.append(case.copy())
    if value['state']=='passed' and (value['phase']!='complete' or value['reason']!='none'
            or [c['phase'] for c in cases]!=['baseline','connections','locks','deadlocks','reset','restart','stale','privacy']):refuse()
    if value['state']=='passed':
        for case in cases:
            continuity={'reset':'statistics_reset','restart':'server_restart'}.get(case['phase'],'same_epoch')
            if (case['freshness']!='fresh' or case['points']!=7 or case['age_seconds'] is None
                    or case['age_seconds']>10 or case['continuity']!=continuity
                    or case['phase'] in ('reset','restart') and case['count_complete']):refuse()
    return {**value,'cases':cases}


def report(source):
    return validate(dict(schema=1,scope='isolated-postgresql-source',source=source,state='incomplete',phase='acquisition',
                         reason='none',cases=[],duration_seconds=0),source)


def read(root,source):
    try:return validate(_read(Path(root),NAME,4096),source)
    except (OSError,ValueError,TypeError,KeyError,UnicodeError,RecursionError):refuse()


def write(root,value):
    root=Path(root);value=validate(value,value.get('source') if type(value) is dict else None)
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    if len(raw)>4096:refuse()
    descriptor=None;created=None;committed=False
    try:
        with directory(root) as owned:
            try:
                descriptor=os.open(TEMPORARY,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=owned)
                created=os.fstat(descriptor);offset=0
                while offset<len(raw):
                    count=os.write(descriptor,raw[offset:])
                    if count<=0:refuse()
                    offset+=count
                current=os.fstat(descriptor)
                if (current.st_uid!=os.getuid() or current.st_nlink!=1 or not stat.S_ISREG(current.st_mode)
                        or stat.S_IMODE(current.st_mode)!=0o600 or current.st_size!=len(raw)
                        or identity(current)!=identity(os.stat(TEMPORARY,dir_fd=owned,follow_symlinks=False))):refuse()
                try:existing=os.stat(NAME,dir_fd=owned,follow_symlinks=False)
                except FileNotFoundError:existing=None
                if existing is not None and (not stat.S_ISREG(existing.st_mode) or existing.st_uid!=os.getuid()
                        or existing.st_nlink!=1 or stat.S_IMODE(existing.st_mode)!=0o600):refuse()
                os.replace(TEMPORARY,NAME,src_dir_fd=owned,dst_dir_fd=owned);committed=True
            finally:
                # Keep the original temp FD open through cleanup: inode reuse cannot turn foreign bytes into ours.
                if descriptor is not None:
                    primary,tb=sys.exc_info()[1:]
                    try:
                        try:
                            if not committed and created is not None:
                                try:linked=os.stat(TEMPORARY,dir_fd=owned,follow_symlinks=False)
                                except FileNotFoundError:linked=None
                                held=os.fstat(descriptor)
                                if (linked is not None and stat.S_ISREG(linked.st_mode) and linked.st_nlink==1
                                        and linked.st_uid==created.st_uid and linked.st_gid==created.st_gid
                                        and (linked.st_dev,linked.st_ino)==(held.st_dev,held.st_ino)==(created.st_dev,created.st_ino)):
                                    os.unlink(TEMPORARY,dir_fd=owned)
                        finally:
                            try:os.close(descriptor)
                            finally:descriptor=None
                    except BaseException:
                        if primary is None:raise
                    finally:
                        if primary is not None:BaseException.__traceback__.__set__(primary,tb)
    except (OSError,ValueError,TypeError,KeyError):refuse()


def persist(root,value):
    primary,tb=sys.exc_info()[1:]
    try:write(root,value)
    except BaseException:
        if primary is None:raise
        BaseException.__traceback__.__set__(primary,tb)


def receipt(root):
    try:
        value=_read(Path(root),'source.json',1_048_576)
        fields={'checkout_sha','checkout_tree','repository','run_id','run_attempt','event','provider_execution_sha',
                'provider_pr_head_sha','provider_pr_base_sha','inputs','scope'}
        if (type(value) is not dict or set(value)!=fields or not sha(value['checkout_sha']) or not sha(value['checkout_tree'])
                or value['provider_execution_sha']!=value['checkout_sha'] or value['scope']!=SCOPE):refuse()
        if any(value[k] is not None and type(value[k]) is not str for k in ('repository','run_id','run_attempt','event')):refuse()
        if any(value[k] is not None and not sha(value[k]) for k in ('provider_pr_head_sha','provider_pr_base_sha')):refuse()
        inputs=value['inputs']
        if (type(inputs) is not dict or len(inputs)>10000 or any(type(k) is not str or len(k.encode())>1024
            or type(v) is not str or re.fullmatch(r'[0-9a-f]{64}',v) is None for k,v in inputs.items())):refuse()
        return value['checkout_sha']
    except (OSError,ValueError,TypeError,KeyError,UnicodeError,RecursionError):refuse()


def upload_operation(value):
    """Fixed acquisition witness, never provider responses, command arguments or SQL."""
    if (type(value) is not dict or set(value)!={'schema','phase','step','outcome','error','http_status','returncode'}
            or type(value['schema']) is not int or value['schema']!=1 or value['phase'] not in PHASES
            or value['step'] not in ('deadline','owner_before','payload','http_open','http_body','owner_after','complete')
            or value['outcome'] not in ('running','passed','failed')
            or value['error'] not in (None,'timeout','http_status','transport','command_failed','interrupted','invalid_result','operation_failed')
            or value['http_status'] is not None and (type(value['http_status']) is not int or not 100<=value['http_status']<=599)
            or value['returncode'] is not None and (type(value['returncode']) is not int or not -128<=value['returncode']<=255)):
        refuse()
    return value.copy()


def persist_upload(root,value):
    primary,tb=sys.exc_info()[1:]
    try:
        raw=(json.dumps(upload_operation(value),sort_keys=True,separators=(',',':'))+'\n').encode()
        if len(raw)>1024:refuse()
        with directory(Path(root)) as owned:
            fd=os.open('postgres-upload.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=owned)
            try:
                if os.write(fd,raw)!=len(raw):refuse()
            finally:os.close(fd)
    except BaseException:
        if primary is None:raise
        BaseException.__traceback__.__set__(primary,tb)


def visibility(value,source):
    if (type(value) is not dict or set(value)!={'schema','source','overflow','rows'} or type(value['schema']) is not int
            or value['schema']!=1 or not sha(source) or value['source']!=source or type(value['overflow']) is not bool
            or type(value['rows']) is not list or len(value['rows'])>64):refuse()
    phases={phase for phase in PHASES if phase.startswith(('baseline_first_','baseline_second_'))}
    for row in value['rows']:
        if (type(row) is not dict or set(row)!={'phase','step','elapsed_ms','expected_age_ms','stored_age_ms','freshness','previous_committed'}
                or type(row['phase']) is not str or row['phase'] not in phases or row['step'] not in ('acquired','uploaded','stored')
                or type(row['elapsed_ms']) is not int or not 0<=row['elapsed_ms']<=180000
                or row['expected_age_ms'] is not None and (type(row['expected_age_ms']) is not int or not -2000<=row['expected_age_ms']<=180000)
                or row['stored_age_ms'] is not None and (type(row['stored_age_ms']) is not int or not 0<=row['stored_age_ms']<=600000)
                or row['freshness'] not in (None,*FRESHNESS) or type(row['previous_committed']) is not bool):refuse()
    return value


def persist_visibility(root,value,source):
    primary,tb=sys.exc_info()[1:]
    try:
        raw=(json.dumps(visibility(value,source),sort_keys=True,separators=(',',':'))+'\n').encode()
        if len(raw)>16384:refuse()
        with directory(Path(root)) as owned:
            fd=os.open('postgres-visibility.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=owned)
            try:
                if os.write(fd,raw)!=len(raw):refuse()
            finally:os.close(fd)
    except BaseException:
        if primary is None:raise
        BaseException.__traceback__.__set__(primary,tb)
