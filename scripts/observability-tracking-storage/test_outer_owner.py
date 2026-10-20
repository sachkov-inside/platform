"""External launcher must release a committed native listener on every exit path."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


def exists(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


class OuterOwner(unittest.TestCase):
    def test_outer_timeout_after_listener_acquisition_reaps_whole_tree(self):
        self.check('timeout')

    def test_outer_interruption_after_listener_acquisition_reaps_whole_tree(self):
        self.check('interruption')

    def test_outer_interruption_coordinates_nested_owner_group(self):
        self.check('nested_interruption')

    def test_outer_success_reaps_whole_tree(self):
        self.check('success')

    def test_outer_failure_reaps_whole_tree(self):
        self.check('failure')

    def check(self, case):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'owned.json'
            owner = subprocess.Popen(['node', 'scripts/observability-tracking-storage/contract-runner.mjs',
                                      '--fixture', case, str(report)], cwd=ROOT,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            state = None
            try:
                deadline = time.monotonic() + 5
                while not report.exists():
                    if time.monotonic() >= deadline or owner.poll() is not None:
                        self.fail('external fixture did not acquire its listener')
                    time.sleep(.01)
                state = json.loads(report.read_text())
                if case in ('timeout', 'interruption', 'nested_interruption'):
                    with socket.create_connection(('127.0.0.1', state['port']), timeout=1):
                        pass
                if case in ('interruption', 'nested_interruption'):
                    os.kill(owner.pid, signal.SIGTERM)
                self.assertEqual(owner.wait(timeout=9), 0 if case == 'success' else 1)
                for key in ('python', 'child', *(['outer_python', 'inner_owner'] if case == 'nested_interruption' else [])):
                    self.assertFalse(exists(state[key]), 'owned descendant survived external launcher')
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', state['port']))
            finally:
                # Give the owned outer launcher a chance to reap its own nested session.
                if owner.poll() is None:
                    owner.terminate()
                    try:
                        owner.wait(timeout=6)
                    except subprocess.TimeoutExpired:
                        pass
                # Only the registered private group can be recovered on assertion failure.
                if state is not None and exists(state['child']):
                    if os.getpgid(state['child']) == state['python']:
                        try:
                            os.killpg(state['python'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                if owner.poll() is None:
                    owner.kill()
                owner.wait(timeout=3)
