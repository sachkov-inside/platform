"""Complete source discovery precedes bounded, exact-once lifecycle selection."""
import json
from pathlib import Path
import re
import unittest


def refuse():raise ValueError('closed tracking source inventory refused')


def inventory():
    try:
        with Path(__file__).with_name('source-tests.json').open('rb') as stream:raw=stream.read(32769)
        values=json.loads(raw)
        if (len(raw)>32768 or type(values) is not list or len(values)>256
                or any(type(value) is not str or len(value)>192
                       or re.fullmatch(r'test_[a-z0-9_]+\.[A-Za-z][A-Za-z0-9]*\.test_[a-z0-9_]+',value) is None for value in values)
                or values!=sorted(set(values))):refuse()
        return tuple(values)
    except (OSError,ValueError,TypeError,UnicodeError,RecursionError):refuse()


SOURCE_IDS=inventory()
SOURCE_GROUPS={
    'contracts':tuple(value for value in SOURCE_IDS if not value.startswith('test_outer_owner.')),
    'process-owner':tuple(value for value in SOURCE_IDS if value.startswith('test_outer_owner.')),
}


def tests(suite):
    if isinstance(suite,unittest.TestSuite):
        for child in suite:yield from tests(child)
    else:yield suite


def select_group(suite,group):
    # Never select from partial discovery: a lost/duplicated method must stop every group.
    actual=tuple(tests(suite))
    if tuple(test.id() for test in actual)!=SOURCE_IDS:refuse()
    if type(group) is not str or group not in SOURCE_GROUPS:refuse()
    expected=SOURCE_GROUPS[group]
    selected=[test for test in actual if test.id() in expected]
    if tuple(test.id() for test in selected)!=expected:refuse()
    return unittest.TestSuite(selected)
