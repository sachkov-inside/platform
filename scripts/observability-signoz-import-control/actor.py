"""Fixed public-empty import actor; no parameters or functional execution."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identity():
    stat=Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()
    return {'boot':digest(Path('/proc/sys/kernel/random/boot_id').read_text().strip()),
        'time_namespace':digest(os.readlink('/proc/self/ns/time')),
        'self_generation':digest(str(os.getpid())+':'+stat[19]+':'+os.readlink('/proc/self/ns/pid'))}


def main():
    before=identity();sys.path.insert(0,'/driver')
    started=time.monotonic();cpu_started=time.process_time()
    import inside
    import functional_witness
    cpu_finished=time.process_time();finished=time.monotonic()
    after=identity()
    print(json.dumps({'schema':1,'before':before,'after':after,'started':started,'finished':finished,
        'cpu_seconds':cpu_finished-cpu_started,'imports_completed':True},separators=(',',':')))


if __name__=='__main__':main()
