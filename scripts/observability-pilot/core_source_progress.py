"""Passive fixed source markers; test completion never substitutes for unittest's verdict."""
import json
from pathlib import Path
import re
import sys
import unittest


def _refuse():raise ValueError('closed Core source inventory refused')


def _inventory():
    try:
        with Path(__file__).with_name('source-tests.json').open('rb') as stream:raw=stream.read(32769)
        if len(raw)>32768:_refuse()
        values=json.loads(raw)
        if (type(values) is not list or len(values)>512 or not values
                or any(type(value) is not str or len(value)>192 or not value.isascii()
                    or re.fullmatch(r'test_[a-z0-9_]+\.[A-Za-z][A-Za-z0-9]*\.test_[A-Za-z0-9_]+',value) is None for value in values)
                or values!=sorted(set(values))):_refuse()
        return tuple(values)
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError):_refuse()


SOURCE_IDS=_inventory()


def verify_inventory(suite):
    def flatten(value):
        if isinstance(value,unittest.TestSuite):
            for child in value:yield from flatten(child)
        else:yield value
    try:
        tests=tuple(flatten(suite))
        actual=tuple(unittest.TestCase.id(test) for test in tests)
        if actual!=SOURCE_IDS or len({id(test) for test in tests})!=len(tests):_refuse()
        return {id(test):(test,SOURCE_IDS[index]) for index,test in enumerate(tests)}
    except Exception:_refuse()


class PassiveResult(unittest.TextTestResult):
    _source_objects=None

    def _source_event(self,event,test):
        active=sys.exc_info()
        try:
            entry=self._source_objects.get(id(test))
            if entry is None or entry[0] is not test:_refuse()
            self.stream.write('\nCORE_SOURCE_V1 '+event+' '+entry[1]+'\n')
            self.stream.flush()
        except BaseException as error:
            if active[1] is not None:return
            if issubclass(type(error),OSError):return
            raise
        finally:
            if active[1] is not None:BaseException.__traceback__.__set__(active[1],active[2])

    def startTest(self,test):
        super().startTest(test)
        self._source_event('start',test)

    def stopTest(self,test):
        super().stopTest(test)
        self._source_event('completed',test)


class PassiveRunner(unittest.TextTestRunner):
    def run(self,test):
        objects=verify_inventory(test)
        class FixedResult(PassiveResult):_source_objects=objects
        self.resultclass=FixedResult
        return super().run(test)
