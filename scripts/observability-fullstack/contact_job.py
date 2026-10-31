"""One contact seed child inside the existing externally supervised worker group."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
import stage_timing
import telegram

NAME='contacts-owner.json'
REAP_SECONDS=.5


def read(path):
    return stage_timing.read_json(path,1_048_576)


def digest(path):
    # Validate the owner records before hashing their canonical data. No private
    # values are copied into the child's record or the public timing artifacts.
    return hashlib.sha256(json.dumps(read(path),sort_keys=True,separators=(',',':')).encode()).hexdigest()


def verify(output,token):
    output=Path(output)
    info=(output/NAME).lstat()
    value=read(output/NAME);worker=read(output/'worker.json')
    if (output.is_symlink() or output.stat().st_mode&0o777!=0o700
            or not stat.S_ISREG(info.st_mode) or info.st_mode&0o777!=0o600 or info.st_uid!=os.getuid() or info.st_nlink!=1
            or type(worker) is not dict or type(value) is not dict or set(value)!={'schema','source','token','worker','group','owner_sha256','worker_sha256'}
            or type(value['schema']) is not int or value['schema']!=1
            or not stage_timing.source_ok(value['source']) or value['source']!=stage_timing.source(output)
            or type(token) is not str or re.fullmatch('[0-9a-f]{64}',token) is None or value['token']!=token
            or type(value['worker']) is not int or value['worker']!=os.getppid()
            or type(value['group']) is not int or value['group']!=os.getpgrp()
            or worker.get('pid')!=value['worker'] or worker.get('group')!=value['group']
            or value['owner_sha256']!=digest(output/'owner.json') or value['worker_sha256']!=digest(output/'worker.json')):
        raise ValueError('contacts_worker_binding')
    return value['source']


class Job:
    def __init__(self,process,deadline):self.process=process;self.deadline=deadline

    def wait(self):
        remaining=self.deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('contacts_preparation_deadline')
        status=self.process.wait(timeout=remaining)
        if time.monotonic()>self.deadline:raise TimeoutError('contacts_preparation_deadline')
        if status:raise RuntimeError('contacts_preparation_failed')

    def close(self):
        # The registered external supervisor remains the complete group owner,
        # including a CLI/plugin whose direct Python parent exits during failure.
        # This child creates no session/group outside that original boundary.
        if self.process.poll() is None:
            self.process.terminate()
            try:self.process.wait(timeout=REAP_SECONDS)
            except subprocess.TimeoutExpired:
                self.process.kill();self.process.wait(timeout=REAP_SECONDS)


@contextmanager
def start(output,argv,*,timing=None):
    output=Path(output);source=stage_timing.source(output);worker=read(output/'worker.json')
    if (not stage_timing.source_ok(source) or output.is_symlink() or output.stat().st_mode&0o777!=0o700
            or type(worker) is not dict or worker.get('pid')!=os.getpid() or worker.get('group')!=os.getpgrp()):
        raise ValueError('contacts_worker_binding')
    value={'schema':1,'source':source,'token':secrets.token_hex(32),'worker':os.getpid(),'group':os.getpgrp(),
        'owner_sha256':digest(output/'owner.json'),'worker_sha256':digest(output/'worker.json')}
    # Never replace another preparation's binding or a foreign/symlink record.
    descriptor=os.open(output/NAME,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'w') as stream:json.dump(value,stream)
    if (output/stage_timing.CONTACTS_NAME).exists() or (output/stage_timing.CONTACTS_NAME).is_symlink():
        raise ValueError('contacts_timing_already_exists')
    deadline=time.monotonic()+telegram.SETUP_SECONDS
    process=stage_timing.call(timing,'seed_contacts_start',subprocess.Popen,[*argv,'--contacts-token',value['token']],stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    job=Job(process,deadline)
    try:yield job
    finally:
        primary=sys.exception()
        try:job.close()
        except BaseException:
            if primary is None:raise
