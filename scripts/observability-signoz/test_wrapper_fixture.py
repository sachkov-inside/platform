"""Signal-resistant detached fixture, activated only by the wrapper fault contract."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest


class DetachedFixture(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('SIGNOZ_WRAPPER_FIXTURE'), 'wrapper fault fixture only')
    def test_detached_child_and_new_session_grandchild(self):
        root=Path(os.environ['SIGNOZ_WRAPPER_FIXTURE'])
        program="""import json,os,pathlib,signal,subprocess,sys,time
if os.environ.get('SIGNOZ_WRAPPER_RESIST')=='1':signal.signal(signal.SIGTERM,signal.SIG_IGN)
grand=subprocess.Popen([sys.executable,'-c',"import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN) if os.environ.get('SIGNOZ_WRAPPER_RESIST')=='1' else None;time.sleep(60)"],start_new_session=True)
pathlib.Path(sys.argv[1]).write_text(json.dumps([os.getpid(),grand.pid]))
time.sleep(60)
"""
        child=subprocess.Popen([sys.executable,'-B','-c',program,str(root/'child.json')],start_new_session=True,
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        end=time.monotonic()+5
        while not (root/'child.json').exists() and time.monotonic()<end:time.sleep(.01)
        descendants=json.loads((root/'child.json').read_text())
        (root/'ready.json').write_text(json.dumps([os.getpid(),*descendants]))
        # A launcher timeout/TERM must not depend on this test's Python finally.
        while not (root/'release').exists():time.sleep(.01)
        self.assertEqual((root/'release').read_text(),'success')


if __name__=='__main__':unittest.main()
