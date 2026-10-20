"""The outer launcher owns the RPC helper, native child and acquired socket."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT=Path(__file__).resolve().parents[2]


def cleanup_launcher(owner,state):
    primary=sys.exc_info()[1]
    try:
        try:
            if owner.poll() is None:owner.terminate()
            try:owner.wait(timeout=6)
            except subprocess.TimeoutExpired:
                owner.kill();owner.wait(timeout=3)
        finally:
            # The launcher can already be gone while its registered group still owns a socket.
            if state is not None:rescue_registered(state)
    except Exception:
        if primary is None:raise
        primary.add_note('closed fixture cleanup failed')


def rescue_registered(state):
    group=state['python']
    if type(group) is not int or group<=1 or group==os.getpgrp():raise ValueError('closed fixture ownership')
    def members():
        live=[]
        for name in ('child','helper','python'):
            pid=state[name]
            if type(pid) is not int or pid<=1:raise ValueError('closed fixture ownership')
            try:
                if os.getpgid(pid)!=group:raise ValueError('closed fixture ownership')
                live.append(pid)
            except ProcessLookupError:pass
        return live
    for signum in (signal.SIGTERM,signal.SIGKILL):
        if not members():break
        try:os.killpg(group,signum)
        except ProcessLookupError:pass
        deadline=time.monotonic()+3
        while members() and time.monotonic()<deadline:time.sleep(.01)
    if members():raise RuntimeError('closed fixture cleanup deadline')
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',state['port']))


class OutsideOwner(unittest.TestCase):
    def test_success_failure_timeout_and_interruption_reap_acquired_native_socket(self):
        for protocol,case in ((protocol,case) for protocol in ('--fixture','--held-fixture') for case in ('success','failure','timeout','interruption')):
            with self.subTest(protocol=protocol,case=case),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'owner.json';state=None
                owner=subprocess.Popen(['node','scripts/observability-caddy-storage/contract-runner.mjs',protocol,case,str(report)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                try:
                    deadline=time.monotonic()+4
                    while not report.exists():
                        if owner.poll() is not None or time.monotonic()>=deadline:self.fail('owned fixture never acquired socket')
                        time.sleep(.01)
                    state=json.loads(report.read_text())
                    if case=='interruption':
                        with socket.create_connection(('127.0.0.1',state['port']),timeout=1):pass
                        owner.terminate()
                    self.assertEqual(owner.wait(timeout=7),0 if case=='success' else 1)
                    for name in ('child','helper','python'):
                        with self.assertRaises(ProcessLookupError):os.kill(state[name],0)
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                        probe.bind(('127.0.0.1',state['port']))
                finally:
                    cleanup_launcher(owner,state)

    def test_early_exited_launcher_does_not_skip_registered_group_cleanup_or_mask_assertion(self):
        for protocol in ('--fixture','--held-fixture'):
            with self.subTest(protocol=protocol),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'owner.json';state=None
                owner=subprocess.Popen(['node','scripts/observability-caddy-storage/contract-runner.mjs',protocol,'early_exit',str(report)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                primary=AssertionError('owned early launcher failure')
                try:
                    deadline=time.monotonic()+4
                    while not report.exists():
                        if owner.poll() is not None or time.monotonic()>=deadline:self.fail('owned fixture never acquired socket')
                        time.sleep(.01)
                    state=json.loads(report.read_text())
                    self.assertEqual(int(subprocess.check_output(['ps','-o','ppid=','-p',str(state['python'])],text=True)),owner.pid)
                    self.assertEqual(os.getpgid(state['child']),state['python'])
                    owner.kill();self.assertEqual(owner.wait(timeout=3),-signal.SIGKILL)
                    os.kill(state['child'],0)
                    with self.assertRaises(AssertionError) as caught:
                        try:raise primary
                        finally:cleanup_launcher(owner,state)
                    self.assertIs(caught.exception,primary)
                    for name in ('child','helper','python'):
                        with self.assertRaises(ProcessLookupError):os.kill(state[name],0)
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',state['port']))
                finally:
                    if state is not None:rescue_registered(state)
                    if owner.poll() is None:owner.kill()
                    owner.wait(timeout=3)
