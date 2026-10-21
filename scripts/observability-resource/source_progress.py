"""Best-effort fixed source markers in the already captured private test stream."""
import json
from pathlib import Path
import re
import unittest


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

    def stopTest(self,test):
        super().stopTest(test)
        self._source_event('completed',test)
