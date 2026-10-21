"""Private fixture protocol/settlement controls, stdlib child only, never native PG."""
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
import fixture


class FixtureLifecycle(unittest.TestCase):
    def test_acknowledged_fixture_close_waits_for_actual_exit_before_success(self):
        code='''import json,sys,time
for raw in sys.stdin:
 c=json.loads(raw)["command"]
 print(json.dumps({"schema":1,"command":c,"state":"done"},separators=(",",":")),flush=True)
 if c=="close":time.sleep(.05);break
'''
        real_popen=subprocess.Popen;owned=[]
        def launch(_args,**kwargs):
            child=real_popen([sys.executable,'-B','-c',code],**kwargs);owned.append(child);return child
        actor=fixture.Fixture()
        try:
            with patch.object(fixture.subprocess,'Popen',side_effect=launch):actor.start()
            actor.act('setup',time.monotonic()+1)
            actor.close(time.monotonic()+5)
            self.assertEqual(owned[0].returncode,0)
            self.assertTrue(owned[0].stdin.closed);self.assertTrue(owned[0].stdout.closed)
        finally:
            for child in owned:
                if child.poll() is None:child.kill()
                child.wait(timeout=2)

    def test_start_cannot_replace_a_live_owned_child(self):
        real_popen=subprocess.Popen;owned=[]
        def launch(_args,**kwargs):
            child=real_popen([sys.executable,'-B','-c','import sys;sys.stdin.read()'],**kwargs);owned.append(child);return child
        actor=fixture.Fixture()
        try:
            with patch.object(fixture.subprocess,'Popen',side_effect=launch):
                actor.start()
                with self.assertRaises(ValueError):actor.start()
            self.assertEqual(len(owned),1)
        finally:
            for child in owned:
                if child.poll() is None:child.kill()
                child.wait(timeout=2)
                child.stdin.close();child.stdout.close()
