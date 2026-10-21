import sys
if sys.platform!='linux' or len(sys.argv)!=1:raise SystemExit('closed Core source runner refused')

import os
import unittest

# Match the original -m unittest entry before its normal discovery installs the start directory.
sys.path[0]=os.getcwd()
sys.argv=[os.path.basename(sys.executable)+' -m unittest','discover','-s','scripts/observability-pilot','-p','test_*.py']


class PassiveRunner:
    def __init__(self,*args,**kwargs):
        # TestProgram constructs its runner after ordinary discovery, never before it.
        from source_progress import PassiveRunner as OwnerRunner
        self._owner=OwnerRunner(*args,**kwargs)

    def run(self,test):return self._owner.run(test)


unittest.main(module=None,testRunner=PassiveRunner)
