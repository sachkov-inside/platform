"""Own one sampler child: four seconds work plus existing two TERM/two KILL settlement."""
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import time
import frame

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
READER_PASSWORD='postgres_source_fixture_reader'


class ClosedClientFailure(ValueError):
    """Private fixed exit2 fact; parent verification is required before availability-zero export."""
    def __init__(self):
        super().__init__('query_refused');self.verified=False


def environment(remaining):
    node=shutil.which('node')
    if node is None or not 0<remaining<=4:raise ValueError('connection')
    node=Path(node).resolve()
    return node,{'PATH':str(node.parent)+':/usr/bin:/bin','INSIDE_PG_SOURCE_PASSWORD':READER_PASSWORD,
                 'INSIDE_PG_SOURCE_WORK_MS':str(max(1,int(remaining*1000)))}


def child(argv,env,deadline):
    process=None;data=bytearray()
    try:
        if deadline-time.monotonic()<=0:raise TimeoutError()
        process=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout,selectors.EVENT_READ)
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0 or not selector.select(remaining):raise TimeoutError()
                part=os.read(process.stdout.fileno(),min(4097-len(data),4096))
                if not part:break
                data.extend(part)
                if len(data)>4096:raise ValueError('malformed')
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError()
        status=process.wait(timeout=remaining)
        if status==2 and not data:raise ClosedClientFailure()
        if status!=0:raise ValueError('query_refused')
        return bytes(data)
    finally:
        primary,tb=sys.exc_info()[1:];secondary=None
        if process is not None:
            try:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=2)
                    except subprocess.TimeoutExpired:process.kill()
                process.wait(timeout=2)
            except BaseException as failure:secondary=failure
            finally:
                try:
                    if process.stdout is not None:process.stdout.close()
                except BaseException as failure:
                    if secondary is None:secondary=failure
        if primary is not None:
            BaseException.__traceback__.__set__(primary,tb)
        elif secondary is not None:raise ValueError('cleanup') from None


def acquire(check_owner,verify_settled=None,*,budget=4):
    """check_owner receives this SAME decreasing work deadline, never an independent timeout."""
    if type(budget) not in (int,float) or not 0<budget<=4:raise ValueError('query_timeout')
    deadline=time.monotonic()+budget
    check_owner(deadline)
    remaining=deadline-time.monotonic()
    node,env=environment(remaining)
    try:wire=child([str(node),str(HERE/'sample.mjs')],env,deadline)
    except ClosedClientFailure as primary:
        tb=sys.exc_info()[2]
        try:
            if time.monotonic()>=deadline:raise TimeoutError()
            check_owner(deadline)
            if verify_settled is None:raise ValueError('cleanup')
            verify_settled(deadline)
            if time.monotonic()>=deadline:raise TimeoutError()
            primary.verified=True
        except BaseException:pass
        finally:BaseException.__traceback__.__set__(primary,tb)
        raise
    if time.monotonic()>=deadline:raise TimeoutError()
    check_owner(deadline)
    if verify_settled is not None:verify_settled(deadline)
    if time.monotonic()>=deadline:raise TimeoutError()
    return frame.decode(wire,time.time_ns()//1000)
