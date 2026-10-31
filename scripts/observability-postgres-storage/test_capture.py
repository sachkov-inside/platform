"""Source acquisition timing/ownership and bounded private child protocol, no PG."""
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import capture


class Acquisition(unittest.TestCase):
    def test_owner_checks_share_one_deadline_and_postcheck_failure_never_returns_a_frame(self):
        ticks=iter((1,1.5,2,2.5,3));deadlines=[]
        def verify(deadline):deadlines.append(deadline)
        with patch.object(capture.time,'monotonic',side_effect=lambda:next(ticks)), \
             patch.object(capture,'environment',return_value=(Path('/owned/node'),{})), \
             patch.object(capture,'child',return_value=b'private'),patch.object(capture.frame,'decode',return_value='admitted'):
            self.assertEqual(capture.acquire(verify),'admitted')
        self.assertEqual(deadlines,[5,5])
        with patch.object(capture,'child',return_value=b'private'),patch.object(capture.frame,'decode') as decoder:
            calls=[]
            def changed(deadline):
                calls.append(deadline)
                if len(calls)==2:raise ValueError('ownership')
            with self.assertRaises(ValueError):capture.acquire(changed)
            decoder.assert_not_called()

    def test_explicit_child_environment_drops_ambient_configuration(self):
        with patch.dict(os.environ,{'PGHOST':'foreign','DATABASE_URL':'private','NODE_OPTIONS':'private','HOME':'foreign'}):
            node,env=capture.environment(4)
        self.assertTrue(node.is_absolute())
        self.assertEqual(set(env),{'PATH','INSIDE_PG_SOURCE_PASSWORD','INSIDE_PG_SOURCE_WORK_MS'})

    def test_child_eof_exit_overflow_and_deadline_are_settled_before_return(self):
        # Owned stdlib child only. The outside source test owner also reaps the complete group.
        for case in ('success','failure','overflow','timeout'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'pid';code='import os,sys;open(sys.argv[1],"w").write(str(os.getpid()));'
                code+=('sys.stdout.write("{}\\n")' if case=='success' else 'sys.exit(2)' if case=='failure' else
                       'sys.stdout.write("x"*4097)' if case=='overflow' else 'import signal;signal.pause()')
                args=[sys.executable,'-B','-c',code,str(report)]
                if case=='success':self.assertEqual(capture.child(args,{},time.monotonic()+1),b'{}\n')
                else:
                    with self.assertRaises((ValueError,TimeoutError)):capture.child(args,{},time.monotonic()+.2)
                pid=int(report.read_text())
                with self.assertRaises(ProcessLookupError):os.kill(pid,0)

    def test_acquired_listener_is_reaped_on_success_failure_timeout_and_primary_interruption(self):
        import json
        import socket
        import subprocess
        primary=KeyboardInterrupt()
        for outcome in ('success','failure','timeout','interruption'):
            with self.subTest(outcome=outcome),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'listener.json';owned=[]
                code='''import json,os,signal,socket,sys,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
s=socket.socket();s.bind(("127.0.0.1",0));s.listen(1)
with open(sys.argv[1]+".new","w") as f:json.dump({"pid":os.getpid(),"port":s.getsockname()[1]},f)
os.replace(sys.argv[1]+".new",sys.argv[1])
if sys.argv[2]=="success":sys.stdout.write("{}\\n");sys.stdout.flush()
elif sys.argv[2]=="failure":sys.exit(2)
else:
 sys.stdout.write("R");sys.stdout.flush()
 while True:signal.pause()
'''
                real_popen=subprocess.Popen
                def launch(*args,**kwargs):
                    child=real_popen(*args,**kwargs);owned.append(child);return child
                original_read=os.read
                def interrupted(fd,cap):
                    if owned and fd==owned[0].stdout.fileno():raise primary
                    return original_read(fd,cap)
                try:
                    with patch.object(capture.subprocess,'Popen',side_effect=launch):
                        args=[sys.executable,'-B','-c',code,str(report),outcome]
                        if outcome=='success':self.assertEqual(capture.child(args,{},time.monotonic()+1),b'{}\n')
                        elif outcome=='interruption':
                            with patch.object(capture.os,'read',side_effect=interrupted):
                                with self.assertRaises(KeyboardInterrupt) as caught:capture.child(args,{},time.monotonic()+1)
                            self.assertIs(caught.exception,primary)
                        else:
                            with self.assertRaises((ValueError,TimeoutError)):capture.child(args,{},time.monotonic()+.5)
                    fact=json.loads(report.read_text());self.assertEqual(fact['pid'],owned[0].pid)
                    self.assertIsNotNone(owned[0].returncode)
                    with self.assertRaises(ProcessLookupError):os.kill(fact['pid'],0)
                    with socket.socket() as probe:probe.bind(('127.0.0.1',fact['port']))
                finally:
                    # Only the actual child handle acquired by this test can be rescued on an assertion failure.
                    for child in owned:
                        if child.poll() is None:child.kill()
                        child.wait(timeout=2)

    def test_closed_client_failure_needs_same_deadline_postowner_and_backend_absence_before_zero(self):
        for failure in (None,'owner','absence','expired'):
            primary=capture.ClosedClientFailure();deadlines=[]
            def owner(deadline):
                deadlines.append(deadline)
                if len(deadlines)>1 and failure=='owner':raise ValueError('ownership')
            def absence(deadline):
                deadlines.append(deadline)
                if failure=='absence':raise ValueError('cleanup')
                if failure=='expired':raise TimeoutError()
            with self.subTest(failure=failure),patch.object(capture,'child',side_effect=primary):
                try:capture.acquire(owner,absence)
                except capture.ClosedClientFailure as caught:self.assertIs(caught,primary)
                else:self.fail('failed query returned a sample')
            self.assertEqual(primary.verified,failure is None)
            self.assertEqual(len(set(deadlines)),1)
        # A closed client signal requires a reaped, empty-output process; valid-looking stdout cannot help.
        for wire in ('','{}'):
            args=[sys.executable,'-B','-c','import sys;sys.stdout.write(sys.argv[1]);sys.exit(2)',wire]
            try:capture.child(args,{},time.monotonic()+1)
            except ValueError as caught:self.assertEqual(isinstance(caught,capture.ClosedClientFailure),wire=='')
            else:self.fail('nonzero child accepted')
