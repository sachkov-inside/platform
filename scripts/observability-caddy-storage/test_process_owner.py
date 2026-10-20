"""The outer launcher owns the RPC helper, native child and acquired socket."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import unittest

ROOT=Path(__file__).resolve().parents[2]


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
                    if owner.poll() is None:owner.terminate()
                    try:owner.wait(timeout=6)
                    except subprocess.TimeoutExpired:
                        # Recover only the committed private child group, never a foreign PID/group.
                        if state is not None:
                            try:
                                if os.getpgid(state['child'])==state['python']:os.killpg(state['python'],signal.SIGKILL)
                            except ProcessLookupError:pass
                        owner.kill();owner.wait(timeout=3)
