"""Opt-in Umami retention and replay of an external durable deletion authority.

The journal contains only opaque UUID targets. Keep it private, encrypted/backed up
separately from PostgreSQL, and never restore an older copy alongside a DB backup.
"""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import uuid
import retention

MAX_BYTES=8*1024*1024
MAX_REQUESTS=10000
REPLAY_SECONDS=30


def identifier(value):
    if type(value) is not str or str(uuid.UUID(value))!=value:raise ValueError('deletion_identifier')
    return value


def request(value):
    if type(value) is not dict or set(value)!={'request_id','website_id','kind','target_id'}:
        raise ValueError('deletion_request')
    for key in ('request_id','website_id','target_id'):identifier(value[key])
    if value['kind'] not in ('website','session','event'):raise ValueError('deletion_kind')
    if value['kind']=='website' and value['website_id']!=value['target_id']:raise ValueError('deletion_website')
    return value


def validate(value):
    if (type(value) is not dict or set(value)!={'schema','ledger_id','requests'}
            or type(value['schema']) is not int or value['schema']!=1
            or type(value['requests']) is not list or len(value['requests'])>MAX_REQUESTS):
        raise ValueError('deletion_authority')
    identifier(value['ledger_id']);seen=set()
    for row in value['requests']:
        request(row)
        if row['request_id'] in seen:raise ValueError('deletion_duplicate')
        seen.add(row['request_id'])
    return value


def _pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('deletion_duplicate_key')
        value[key]=item
    return value


def _private(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid()
            or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1):
        raise ValueError('deletion_authority_permissions')


@contextmanager
def locked(path):
    path=Path(path).absolute()
    parent=path.parent.resolve();path=parent/path.name
    info=parent.stat()
    if info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)&0o077:
        raise ValueError('deletion_authority_directory_permissions')
    fd=os.open(str(path)+'.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        _private(os.fstat(fd));fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield path
    finally:os.close(fd)


def _read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        _private(os.fstat(stream.fileno()));encoded=stream.read(MAX_BYTES+1)
    if len(encoded)>MAX_BYTES:raise ValueError('deletion_authority_size')
    return validate(json.loads(encoded,object_pairs_hook=_pairs))


def _write(path,value):
    encoded=json.dumps(validate(value),sort_keys=True).encode()+b'\n'
    if len(encoded)>MAX_BYTES:raise ValueError('deletion_authority_size')
    temporary=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
    try:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(encoded);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:temporary.unlink(missing_ok=True)


def initialize(path):
    with locked(path) as owned:
        if owned.exists() or owned.is_symlink():raise ValueError('deletion_authority_exists')
        _write(owned,{'schema':1,'ledger_id':str(uuid.uuid4()),'requests':[]})


def append(path,*,request_id,website_id,kind,target_id):
    row=request({'request_id':request_id,'website_id':website_id,'kind':kind,'target_id':target_id})
    with locked(path) as owned:
        value=_read(owned)
        for previous in value['requests']:
            if previous['request_id']==request_id:
                if previous!=row:raise ValueError('deletion_request_conflict')
                return
        value['requests'].append(row)
        _write(owned,value)  # Durable authority is committed BEFORE any database deletion.


def deletion_sql(row):
    row=request(row);site=row['website_id'];target=row['target_id'];kind=row['kind']
    predicates={}
    if kind=='event':
        predicates={'event_data':f"website_event_id='{target}'",'revenue':f"event_id='{target}'",'website_event':f"event_id='{target}'"}
    else:
        for table in retention.TABLES:predicates[table]='TRUE' if kind=='website' else f"session_id='{target}'"
        if kind=='session':
            predicates['event_data']=f"website_event_id IN (SELECT event_id FROM public.website_event WHERE website_id='{site}' AND session_id='{target}')"
            predicates['session_replay_saved']=f"visit_id IN (SELECT visit_id FROM public.session_replay WHERE website_id='{site}' AND session_id='{target}')"
    # Dependent rows precede their parent. Replays retain the visit mapping until saved rows are gone.
    order=('event_data','revenue','session_data','session_link','session_replay_saved','heatmap_event','session_replay','website_event','session')
    terms=[];statements=[]
    for table in order:
        if table not in predicates:continue
        predicate=f"website_id='{site}' AND ({predicates[table]})"
        safe=predicate
        if table=='website_event':
            safe+=" AND NOT EXISTS(SELECT 1 FROM public.event_data d WHERE d.website_event_id=website_event.event_id) AND NOT EXISTS(SELECT 1 FROM public.revenue r WHERE r.event_id=website_event.event_id)"
        elif table=='session_replay':
            safe+=" AND NOT EXISTS(SELECT 1 FROM public.session_replay_saved s WHERE s.website_id=session_replay.website_id AND s.visit_id=session_replay.visit_id)"
        elif table=='session':
            for child in ('website_event','session_data','session_link','revenue','session_replay','heatmap_event'):
                safe+=f" AND NOT EXISTS(SELECT 1 FROM public.{child} child WHERE child.session_id=session.session_id)"
        statements.append(f'DELETE FROM public.{table} WHERE ctid IN (SELECT ctid FROM public.{table} WHERE {safe} LIMIT 500);')
        terms.append(f'EXISTS(SELECT 1 FROM public.{table} WHERE {predicate})')
    return """BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL statement_timeout='1s';
SET LOCAL lock_timeout='250ms';
SET LOCAL idle_in_transaction_session_timeout='2s';
DO $$ BEGIN
IF current_database()<>'umami' OR current_user<>'umami' THEN RAISE EXCEPTION 'dedicated Umami role/database required'; END IF;
IF NOT pg_try_advisory_xact_lock(1566,365) THEN RAISE EXCEPTION 'Umami maintenance owned'; END IF;
END $$;
"""+'\n'.join(statements)+"\nSELECT json_build_object('remaining',"+' OR '.join(terms)+');\nCOMMIT;\n'


def _replay(value,execute,deadline):
    for row in value['requests']:
        sql=deletion_sql(row)
        for _ in range(retention.MAX_BATCHES):
            remaining=deadline-time.monotonic()
            if remaining<=0:return False
            encoded=execute(sql,timeout=min(retention.BATCH_SECONDS,remaining))
            if type(encoded) is not str or len(encoded.encode())>1024:raise ValueError('deletion_replay_result')
            result=json.loads(encoded,object_pairs_hook=_pairs)
            if type(result) is not dict or set(result)!={'remaining'} or type(result['remaining']) is not bool:
                raise ValueError('deletion_replay_result')
            if not result['remaining']:break
        else:return False
    return True


def restore(path,execute,open_readers):
    """Caller keeps readers/ingest stopped. Their only transition follows current replay+TTL.

    Hold external journal ownership through opening so new accepted requests cannot
    be omitted between the final replay and the transition. No journal truncation.
    """
    with locked(path) as owned:
        value=_read(owned)
        result={'schema':1,'state':'partial','stage':'deletion_replay','requests':len(value['requests'])}
        try:
            if not _replay(value,execute,time.monotonic()+REPLAY_SECONDS):return result
            result['stage']='current_retention';result['retention']=retention.drain(execute)
            if result['retention']['state']!='complete':
                result['state']='error' if result['retention']['state']=='error' else 'partial'
                return result
            result['stage']='deletion_recheck'
            if not _replay(value,execute,time.monotonic()+REPLAY_SECONDS):return result
            open_readers()
            result.update(state='complete',stage='completed')
            return result
        except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
            result['state']='error'
            return result


def transport(sql,*,timeout):
    import sql_transport
    return sql_transport.query(sql,timeout=timeout)

def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('initialize','request','run','restore'))
    parser.add_argument('--journal',type=Path,required=True)
    for name in ('request-id','website-id','kind','target-id'):parser.add_argument('--'+name)
    args=parser.parse_args()
    if os.environ.get('INSIDE_UMAMI_MAINTENANCE_ENABLED')!='true':raise ValueError('maintenance_disabled')
    if args.action=='initialize':initialize(args.journal);return 0
    if args.action=='request':
        append(args.journal,request_id=args.request_id,website_id=args.website_id,kind=args.kind,target_id=args.target_id)
        return 0
    # restore intentionally performs no start command: this exit code is the dependency
    # of the deployment operator's subsequent Umami reader/ingest start.
    result=restore(args.journal,transport,lambda:None)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['state']=='complete' else 3


if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        raise SystemExit('umami maintenance refused or failed; readers must remain closed after restore') from None
