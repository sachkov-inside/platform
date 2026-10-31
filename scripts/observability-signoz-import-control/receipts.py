"""Diagnostic-only thread-scoped observation of unchanged Engine.raw."""
from contextlib import contextmanager
import math
import sys
import time

import lifecycle


def number(value):
    return type(value) in (int,float) and math.isfinite(value)


@contextmanager
def observe_raw(engine,argv):
    """Copy existing raw locals on return; never intervene in the observed call."""
    receipt={'available':False}
    previous=sys.getprofile()
    if previous is not None or sys.implementation.name!='cpython':
        yield receipt
        return
    code=lifecycle.Engine.raw.__code__;expected=tuple(argv);count=0;fault=False
    def observe(frame,event,_argument):
        nonlocal count,fault
        try:
            if fault or event!='return' or frame.f_code is not code:return
            values=frame.f_locals
            if values.get('self') is not engine or tuple(values.get('args',()))!=expected:return
            count+=1
            if count!=1:
                fault=True;receipt.clear();receipt['available']=False;return
            started=values.get('started');deadline=values.get('deadline');cap=values.get('timeout')
            if not all(number(v) for v in (started,deadline,cap)):return
            proc=values.get('proc');finished=time.monotonic();remaining=engine.deadline-started
            if not number(remaining) or not started<=deadline or finished<started:return
            receipt.update(available=True,started=started,finished=finished,timeout_seconds=cap,
                raw_window_seconds=deadline-started,outer_remaining_seconds=remaining,
                native_exit=proc.returncode,reaped=proc not in engine.child)
        except BaseException:
            fault=True;receipt.clear();receipt['available']=False
    sys.setprofile(observe)
    try:yield receipt
    finally:
        changed=sys.getprofile() is not observe
        sys.setprofile(previous)
        if changed or fault or count!=1:
            receipt.clear();receipt['available']=False


def full_window(receipt):
    return (type(receipt) is dict and set(receipt)=={'available','started','finished','timeout_seconds','raw_window_seconds','outer_remaining_seconds','native_exit','reaped'}
        and all(number(receipt.get(k)) for k in ('started','finished','timeout_seconds','raw_window_seconds','outer_remaining_seconds'))
        and 0<=receipt['started']<=receipt['finished'] and receipt['finished']-receipt['started']<=90
        and type(receipt['native_exit']) is int and -128<=receipt['native_exit']<=255
        and receipt.get('available') is True and receipt.get('reaped') is True
        and receipt.get('timeout_seconds')==3 and receipt.get('raw_window_seconds')==3
        and number(receipt.get('outer_remaining_seconds')) and receipt['outer_remaining_seconds']>=3)
