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

    def test_setup_empty_eof_adopts_only_owned_fixed_exit_status_and_settles_primary(self):
        phases=('baseline_setup_connect','baseline_setup_identity','baseline_setup_reader',
            'baseline_setup_grant_connect','baseline_setup_read_only','baseline_setup_schema',
            'baseline_setup_table','baseline_setup_rows','baseline_setup_reset')
        real_popen=subprocess.Popen
        for status,phase in zip(range(101,110),phases):
            with self.subTest(status=status):
                owned=[]
                def launch(_args,**kwargs):
                    code="import json,sys;assert json.loads(sys.stdin.readline())['command']=='setup';sys.exit("+str(status)+")"
                    child=real_popen([sys.executable,'-B','-c',code],**kwargs);owned.append(child);return child
                actor=fixture.Fixture()
                try:
                    with patch.object(fixture.subprocess,'Popen',side_effect=launch):actor.start()
                    try:actor.act('setup',time.monotonic()+1)
                    except ValueError as primary:
                        before=primary.__traceback__
                        self.assertEqual(str(primary),'query_refused');self.assertEqual(actor.setup_phase,phase)
                        actor.close(time.monotonic()+1)
                        self.assertIs(primary.__traceback__,before)
                    else:self.fail('nonzero setup exit became success')
                    self.assertEqual(owned[0].returncode,status)
                    self.assertTrue(owned[0].stdin.closed);self.assertTrue(owned[0].stdout.closed)
                finally:
                    for child in owned:
                        if child.poll() is None:child.kill()
                        child.wait(timeout=2)
                        child.stdin.close();child.stdout.close()

    def test_ambiguous_setup_output_exit_and_deadline_never_refine_the_failure(self):
        real_popen=subprocess.Popen
        cases={
            'zero':'sys.exit(0)', 'ordinary':'sys.exit(1)', 'unknown':'sys.exit(110)',
            'signal':'os.kill(os.getpid(),signal.SIGTERM)',
            'partial':"sys.stdout.write('{');sys.stdout.flush();sys.exit(101)",
            'junk':"print('{}',flush=True);sys.exit(101)",
            'held_open':'time.sleep(.3)',
            'empty_eof_wait':'os.close(1);time.sleep(.3)',
            'read_error':'time.sleep(.3)',
            'non_setup':'sys.exit(101)',
            'ack':"print(json.dumps({'schema':1,'command':'setup','state':'done'},separators=(',',':')),flush=True);sys.exit(101)",
        }
        for name,body in cases.items():
            with self.subTest(case=name):
                owned=[]
                def launch(_args,**kwargs):
                    code='import json,os,signal,sys,time\njson.loads(sys.stdin.readline())\n'+body
                    child=real_popen([sys.executable,'-B','-c',code],**kwargs);owned.append(child);return child
                actor=fixture.Fixture()
                try:
                    with patch.object(fixture.subprocess,'Popen',side_effect=launch):actor.start()
                    deadline=time.monotonic()+(.08 if name in ('held_open','empty_eof_wait') else 1)
                    if name=='ack':
                        actor.act('setup',deadline)
                        self.assertIsNone(actor.setup_phase)
                        with self.assertRaises(ValueError):actor.close(time.monotonic()+1)
                    else:
                        try:
                            if name=='read_error':
                                with patch.object(actor.process.stdout,'read1',side_effect=OSError('controlled read refusal')):
                                    actor.act('setup',deadline)
                            else:actor.act('reset' if name=='non_setup' else 'setup',deadline)
                        except (ValueError,TimeoutError,OSError) as primary:
                            before=primary.__traceback__
                            self.assertIsNone(actor.setup_phase)
                            if name in ('held_open','empty_eof_wait'):
                                self.assertIsInstance(primary,TimeoutError if name=='held_open' else ValueError)
                                self.assertLess(time.monotonic()-deadline,.8)
                            actor.close(time.monotonic()+1)
                            self.assertIs(primary.__traceback__,before)
                        else:self.fail('failed setup became success')
                    self.assertIsNotNone(owned[0].returncode)
                    self.assertTrue(owned[0].stdin.closed);self.assertTrue(owned[0].stdout.closed)
                finally:
                    for child in owned:
                        if child.poll() is None:child.kill()
                        child.wait(timeout=2)
                        child.stdin.close();child.stdout.close()

    def test_already_exited_setup_fast_path_resets_metadata_without_read_or_wait(self):
        real_popen=subprocess.Popen;owned=[]
        def launch(_args,**kwargs):
            child=real_popen([sys.executable,'-B','-c','import sys;sys.exit(101)'],**kwargs);owned.append(child);return child
        actor=fixture.Fixture()
        try:
            with patch.object(fixture.subprocess,'Popen',side_effect=launch):actor.start()
            owned[0].wait(timeout=1);actor.setup_phase='baseline_setup_reader'
            with patch.object(owned[0],'wait',side_effect=AssertionError('unexpected fast-path wait')), \
                 patch.object(fixture.selectors,'DefaultSelector',side_effect=AssertionError('unexpected fast-path read')):
                with self.assertRaises(ValueError):actor.act('setup',time.monotonic()+1)
            self.assertIsNone(actor.setup_phase)
            with self.assertRaises(ValueError):actor.close(time.monotonic()+1)
            self.assertTrue(owned[0].stdin.closed);self.assertTrue(owned[0].stdout.closed)
        finally:
            for child in owned:
                if child.poll() is None:child.kill()
                child.wait(timeout=2)
                child.stdin.close();child.stdout.close()
