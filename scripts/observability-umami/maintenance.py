"""Opt-in Umami retention and replay of an external durable deletion authority.

The journal contains only opaque UUID targets. Keep it private, encrypted/backed up
separately from PostgreSQL, and never restore an older copy alongside a DB backup.
"""
from contextlib import contextmanager
import fcntl
import hashlib
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


def _read_json(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        _private(os.fstat(stream.fileno()));encoded=stream.read(MAX_BYTES+1)
    if len(encoded)>MAX_BYTES:raise ValueError('deletion_authority_size')
    return json.loads(encoded,object_pairs_hook=_pairs)


def _write_json(path,value):
    encoded=json.dumps(value,sort_keys=True).encode()+b'\n'
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


def _read(path):return validate(_read_json(path))


def _write(path,value):_write_json(path,validate(value))


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


def _authority_hash(rows):
    return hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def _progress(path,value,generation):
    fresh={'schema':1,'ledger_id':value['ledger_id'],'generation':generation,'step':'replay','next':0,
        'observed_count':len(value['requests']),'observed_sha256':_authority_hash(value['requests'])}
    if not path.exists() and not path.is_symlink():return fresh
    current=_read_json(path)
    if (type(current) is not dict or set(current)!=set(fresh) or type(current['schema']) is not int or current['schema']!=1
            or current['ledger_id']!=value['ledger_id'] or current['step'] not in ('replay','recheck','complete')
            or type(current['next']) is not int or type(current['observed_count']) is not int
            or not 0<=current['next']<=current['observed_count']<=len(value['requests'])
            or current['observed_sha256']!=_authority_hash(value['requests'][:current['observed_count']])):
        raise ValueError('deletion_progress_authority_changed')
    if current['generation']!='daily':identifier(current['generation'])
    if current['generation']!=generation or current['step']=='complete':return fresh
    current.update(observed_count=fresh['observed_count'],observed_sha256=fresh['observed_sha256'])
    return current


def _replay(value,execute,deadline,progress,save,clock):
    for index in range(progress['next'],len(value['requests'])):
        sql=deletion_sql(value['requests'][index])
        for _ in range(retention.MAX_BATCHES):
            remaining=deadline-clock()
            if remaining<=0:return False
            encoded=execute(sql,timeout=min(retention.BATCH_SECONDS,remaining))
            if type(encoded) is not str or len(encoded.encode())>1024:raise ValueError('deletion_replay_result')
            result=json.loads(encoded,object_pairs_hook=_pairs)
            if type(result) is not dict or set(result)!={'remaining'} or type(result['remaining']) is not bool:
                raise ValueError('deletion_replay_result')
            if not result['remaining']:
                # A lost SQL response never advances. An interrupted checkpoint write
                # only repeats an already committed, idempotent target on the next run.
                progress['next']=index+1;save()
                break
        else:return False
    return True


def _maintain(path,execute,open_readers,*,generation,phase,clock):
    with locked(path) as owned:
        value=_read(owned)
        checkpoint=owned.with_name(owned.name+'.'+phase+'-progress.json')
        progress=_progress(checkpoint,value,generation)
        def save():_write_json(checkpoint,progress)
        result={'schema':1,'state':'partial','stage':'deletion_replay','requests':len(value['requests'])}
        try:
            save()
            replay_complete=progress['step']=='recheck' or _replay(value,execute,clock()+REPLAY_SECONDS,progress,save,clock)
            # Even an unfinished deletion corpus receives its independent daily TTL
            # budget. A long absent prefix cannot permanently starve retention.
            result['stage']='current_retention';result['retention']=retention.drain(execute,clock=clock)
            if result['retention']['state']!='complete':
                result['state']='error' if result['retention']['state']=='error' else 'partial'
                return result
            if not replay_complete:
                result.update(stage='deletion_replay',processed=progress['next'])
                return result
            if progress['step']=='replay':
                progress.update(step='recheck',next=0);save()
            result['stage']='deletion_recheck'
            if not _replay(value,execute,clock()+REPLAY_SECONDS,progress,save,clock):
                result['processed']=progress['next']
                return result
            progress.update(step='complete');save()
            open_readers()
            result.update(state='complete',stage='completed')
            return result
        except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
            result['state']='error'
            return result


def run(path,execute,*,clock=time.monotonic):
    """Resume a bounded daily sweep, preserving target progress across invocations."""
    return _maintain(path,execute,lambda:None,generation='daily',phase='daily',clock=clock)


def restore(path,execute,open_readers,*,restore_id=None,clock=time.monotonic):
    """Replay ALL authority for each new restore operation before opening readers.

    The operator keeps readers/ingest stopped, supplies the current external journal
    and uses a NEW restore_id for each independently restored database. Reuse that
    ID only to continue the same interrupted operation. An omitted library ID starts
    a fresh operation; the CLI requires an explicit ID for resumable retries.
    """
    generation=identifier(restore_id) if restore_id is not None else str(uuid.uuid4())
    return _maintain(path,execute,open_readers,generation=generation,phase='restore',clock=clock)


def transport(sql,*,timeout):
    import sql_transport
    return sql_transport.query(sql,timeout=timeout)

def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('initialize','request','run','restore'))
    parser.add_argument('--journal',type=Path,required=True)
    parser.add_argument('--restore-id')
    for name in ('request-id','website-id','kind','target-id'):parser.add_argument('--'+name)
    args=parser.parse_args()
    if os.environ.get('INSIDE_UMAMI_MAINTENANCE_ENABLED')!='true':raise ValueError('maintenance_disabled')
    if args.action=='initialize':initialize(args.journal);return 0
    if args.action=='request':
        append(args.journal,request_id=args.request_id,website_id=args.website_id,kind=args.kind,target_id=args.target_id)
        return 0
    # restore intentionally performs no start command: this exit code is the dependency
    # of the deployment operator's subsequent Umami reader/ingest start.
    if args.action=='restore':
        if args.restore_id is None:raise ValueError('restore_operation_id_required')
        result=restore(args.journal,transport,lambda:None,restore_id=args.restore_id)
    else:result=run(args.journal,transport)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['state']=='complete' else 3 if result['state']=='partial' else 1


if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        raise SystemExit('umami maintenance refused or failed; readers must remain closed after restore') from None
