"""Identical Resource source discovery with a closed, best-effort progress witness."""
from pathlib import Path
import sys
import os
import time
import unittest



def _timing_begin(*,environment=os.environ,clock=time.monotonic_ns,stream=sys.stderr):
    if sys.exc_info()[1] is not None:return None
    try:
        switch=environment.get('RESOURCE_TEST_TIMING_V1')
        if type(switch) is not str or switch!='1':return None
        origin=clock()
        if type(origin) is not int or origin<0:return None
        line='RESOURCE_TIMING_V1 begin runner 0\n'
        stream.write('\n'+line);stream.flush()
        return {'origin':origin,'clock':clock,'stream':stream,'last':0,'count':1,'bytes':len(line)}
    except Exception:return None


def main():
    timing=_timing_begin()
    if sys.argv[1:]:raise ValueError('closed Resource source arguments refused')
    import source_progress
    if timing is not None:source_progress.initialize_timing(timing)
    suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_*.py')
    source_progress.verify_inventory(suite)
    result=unittest.TextTestRunner(resultclass=source_progress.ProgressResult).run(suite)
    source_progress.timing_event('end','runner')
    return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print('resource-source: closed boundary failure',file=sys.stderr)
        sys.exit(1)
