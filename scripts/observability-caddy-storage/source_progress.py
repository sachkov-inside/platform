"""Best-effort fixed source markers in the already captured private test stream."""
import json
from pathlib import Path
import re
import unittest


def _refuse():raise ValueError('closed Caddy source inventory refused')


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
# Process-lifecycle acceptance owns real listeners, launchers and group retirement.
# Keep its deadline independent from the pure/protocol contracts, with one shared inventory.
_TRANSPORT_PREFIXES=('test_mcp.','test_mcp_snapshot.','test_request_hold.','test_warm_matching.')
SOURCE_GROUPS={
    'contracts':tuple(value for value in SOURCE_IDS if not value.startswith(('test_process_owner.',*_TRANSPORT_PREFIXES))),
    'transport':tuple(value for value in SOURCE_IDS if value.startswith(_TRANSPORT_PREFIXES)),
    'process-owner':tuple(value for value in SOURCE_IDS if value.startswith('test_process_owner.')),
}


def _tests(suite):
    if isinstance(suite,unittest.TestSuite):
        for child in suite:yield from _tests(child)
    else:yield suite


def select_group(suite,group):
    # Validate complete discovery before any selection, so filtering cannot hide a lost method.
    verify_inventory(suite)
    if type(group) is not str or group not in SOURCE_GROUPS:_refuse()
    expected=SOURCE_GROUPS[group]
    selected=[test for test in _tests(suite) if test.id() in expected]
    if tuple(test.id() for test in selected)!=expected:_refuse()
    return unittest.TestSuite(selected)


def verify_inventory(suite):
    try:actual=tuple(test.id() for test in _tests(suite))
    except Exception:_refuse()
    if any(type(value) is not str for value in actual) or actual!=SOURCE_IDS:_refuse()


class ProgressResult(unittest.TextTestResult):
    def __init__(self,*args,source_group=None,**kwargs):
        super().__init__(*args,**kwargs)
        if source_group is not None and (type(source_group) is not str or source_group not in SOURCE_GROUPS):_refuse()
        self._source_ids=SOURCE_IDS if source_group is None else SOURCE_GROUPS[source_group]
        self._source_index=0;self._source_active=None;self._source_enabled=True

    def _source_event(self,event,test):
        if not self._source_enabled:return
        try:
            identifier=test.id()
            if (type(identifier) is not str or self._source_index>=len(self._source_ids)
                    or identifier!=self._source_ids[self._source_index]
                    or event=='start' and self._source_active is not None
                    or event=='completed' and self._source_active!=identifier):
                self._source_enabled=False;return
            literal=self._source_ids[self._source_index]
            self.stream.write('\nCADDY_SOURCE_V1 '+event+' '+literal+'\n');self.stream.flush()
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
