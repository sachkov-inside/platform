"""One closed startup refusal, independent of workload or capacity acceptance."""
import json
import os
from pathlib import Path
import stage_timing

NAME='fullstack-startup-refusal.json'
MAX_BYTES=4096
STATES=('created','running','paused','restarting','removing','exited','dead')


def require(ok):
    if not ok:raise ValueError('closed_startup_refusal')


def validate(value,source,backends):
    require(type(value) is dict and set(value)=={'schema','source','role','probe','containers'})
    require(type(value['schema']) is int and value['schema']==1
            and stage_timing.source_ok(source) and value['source']==source)
    role=value['role'];require(type(role) is str and role in (*backends,'rabbitmq'))
    probe=value['probe'];require(type(probe) is dict and set(probe)=={'reason','exit_code'})
    reason=probe['reason'];code=probe['exit_code']
    require(type(reason) is str and reason in ('exit_nonzero','output_limit','timeout','unavailable'))
    require(code is None or type(code) is int and -255<=code<=255)
    if reason=='exit_nonzero':require(code is not None and code!=0)
    elif reason=='output_limit':require(code==0)
    else:require(code is None)
    containers=value['containers'];require(type(containers) is dict and set(containers)=={role,'rabbitmq'})
    for row in containers.values():
        require(type(row) is dict and type(row.get('state')) is str)
        if row['state'] in ('unavailable','missing'):require(set(row)=={'state'});continue
        require(set(row)=={'state','running','oom','exit_code','restarts'} and row['state'] in STATES
                and type(row['running']) is bool and type(row['oom']) is bool
                and type(row['exit_code']) is int and -255<=row['exit_code']<=255
                and type(row['restarts']) is int and 0<=row['restarts']<=2147483647)
    return value


def read(output,source,backends):
    path=Path(output)/NAME
    if not path.exists() and not path.is_symlink():return None
    return validate(stage_timing.read_json(path,MAX_BYTES),source,backends)


def write(output,value,source,backends):
    raw=(json.dumps(validate(value,source,backends),sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
    require(len(raw)<=MAX_BYTES)
    # Exclusive creation preserves the first refusal and rejects replaced/symlink receipts.
    descriptor=os.open(Path(output)/NAME,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'wb') as stream:stream.write(raw)
