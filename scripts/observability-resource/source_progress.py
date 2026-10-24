"""Best-effort fixed source markers in the already captured private test stream."""
import json
from pathlib import Path
import re
import unittest
import sys


def _refuse():raise ValueError('closed Resource source inventory refused')


def _inventory():
    try:
        with Path(__file__).with_name('source-tests.json').open('rb') as stream:raw=stream.read(32769)
        if len(raw)>32768:_refuse()
        values=json.loads(raw)
        if (type(values) is not list or len(values)>256 or any(type(v) is not str or len(v)>192
                or re.fullmatch(r'test_[a-z0-9_]+\.[A-Za-z][A-Za-z0-9]*\.test_[a-z0-9_]+',v) is None for v in values)
                or values!=sorted(set(values))):_refuse()
        return tuple(values)
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError):_refuse()


SOURCE_IDS=_inventory()


def verify_inventory(suite):
    def flatten(value):
        if isinstance(value,unittest.TestSuite):
            for child in value:yield from flatten(child)
        else:yield value.id()
    try:actual=tuple(flatten(suite))
    except Exception:_refuse()
    if any(type(value) is not str for value in actual) or actual!=SOURCE_IDS:_refuse()


_timing=None
TIMING_MODES=('success','failure','timeout','sigterm','sigkill','descendant')


def initialize_timing(seed):
    if sys.exc_info()[1] is not None:return
    global _timing
    try:
        if seed is None:_timing=None;return
        if (type(seed) is not dict or set(seed)!={'origin','clock','stream','last','count','bytes'}
                or type(seed['origin']) is not int or seed['origin']<0 or not callable(seed['clock'])
                or seed['last']!=0 or seed['count']!=1 or seed['bytes']!=len('RESOURCE_TIMING_V1 begin runner 0\n')):
            raise ValueError()
        _timing=seed
    except Exception:_timing=None


def timing_event(event,slot):
    if sys.exc_info()[1] is not None:return
    global _timing
    if _timing is None:return
    try:
        if (type(event) is not str or event not in ('begin','end') or type(slot) is not str
                or slot not in ('runner','item84',*TIMING_MODES) or _timing['count']>=16):
            _timing=None;return
        point=_timing['clock']()
        if type(point) is not int:raise ValueError()
        elapsed=point-_timing['origin']
        if not _timing['last']<=elapsed<=60_000_000_000:raise ValueError()
        line='RESOURCE_TIMING_V1 '+event+' '+slot+' '+str(elapsed)+'\n'
        if _timing['bytes']+len(line)>2048:raise ValueError()
        _timing['stream'].write('\n'+line);_timing['stream'].flush()
        _timing['last']=elapsed;_timing['count']+=1;_timing['bytes']+=len(line)
    except Exception:_timing=None


def _timing_source(result,event):
    if sys.exc_info()[1] is not None:return
    global _timing
    if _timing is None:return
    try:
        if event=='start' and result._source_index==83 and result._source_active==SOURCE_IDS[83]:
            timing_event('begin','item84')
        elif event=='completed' and result._source_index==84 and result._source_active is None:
            timing_event('end','item84')
    except Exception:_timing=None


class ProgressResult(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self._source_index=0;self._source_active=None;self._source_enabled=True

    def _source_event(self,event,test):
        if not self._source_enabled:return
        try:
            identifier=test.id()
            if (type(identifier) is not str or self._source_index>=len(SOURCE_IDS)
                    or identifier!=SOURCE_IDS[self._source_index]
                    or event=='start' and self._source_active is not None
                    or event=='completed' and self._source_active!=identifier):
                self._source_enabled=False;return
            literal=SOURCE_IDS[self._source_index]
            self.stream.write('\nRESOURCE_SOURCE_V1 '+event+' '+literal+'\n');self.stream.flush()
            if event=='start':self._source_active=literal
            else:self._source_active=None;self._source_index+=1
        except Exception:
            # IO/diagnostic failures cannot replace test outcomes; control-flow interrupts propagate.
            self._source_enabled=False

    def startTest(self,test):
        super().startTest(test)
        self._source_event('start',test)
        _timing_source(self,'start')

    def stopTest(self,test):
        super().stopTest(test)
        self._source_event('completed',test)
        _timing_source(self,'completed')
