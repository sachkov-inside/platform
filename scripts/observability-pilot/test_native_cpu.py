"""Isolated native CPU and stdio contracts; synthetic processes, no Docker."""
import os
import json
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pilot
import native_cpu
from unittest.mock import patch

FIXTURE = Path(__file__).with_name('fixtures') / 'native_cpu_case.py'
CASE_DEADLINE_SECONDS = 15
CLEANUP_DEADLINE_SECONDS = 12
SOCKET_PROBE_TIMEOUT_SECONDS = 1


def owned_case(mode, directory):
    read_fd, control = os.pipe()
    try:
        owner = subprocess.Popen([sys.executable, str(FIXTURE), 'supervise', str(read_fd), str(os.getpid()), mode, directory],
                                 pass_fds=(read_fd,), start_new_session=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL)
    except BaseException:
        os.close(control)
        raise
    finally:
        os.close(read_fd)
    try:
        status = owner.wait(timeout=CASE_DEADLINE_SECONDS)
        payload = owner.stdout.read(native_cpu.METADATA_MAX_BYTES + 1)
        if len(payload) > native_cpu.METADATA_MAX_BYTES:
            raise RuntimeError('CPU fixture response exceeds budget')
        return status, json.loads(payload) if payload else None
    finally:
        try:
            if owner.poll() is None:
                os.write(control, b'0\n')
        except BrokenPipeError:
            pass
        finally:
            os.close(control)
            owner.wait(timeout=CLEANUP_DEADLINE_SECONDS)
            owner.stdout.close()


class NativeCpuTest(unittest.TestCase):
    def assert_native_closed(self, directory):
        state = Path(directory) / 'native.json'
        pid = json.loads(state.read_text())['pid']
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(SOCKET_PROBE_TIMEOUT_SECONDS)
            with self.assertRaises((ConnectionRefusedError, FileNotFoundError)):
                probe.connect(str(state.with_suffix('.sock')))

    def test_stdio_cpu_excludes_unrelated_child_reaped_during_the_query(self):
        with tempfile.TemporaryDirectory() as directory:
            status, result = owned_case('concurrent', directory)
            self.assertEqual(status, 0)
            self.assertEqual(result['known_fixture'], 'passed')
            self.assertEqual(result['discovered_tools'], ['query'])
            self.assertEqual(result['cpu_measurement'], 'isolated_reaped_child_cpu')
            # Kernel CPU work, not wall-clock speed: unrelated child burns .5s, native burns .04s.
            self.assertGreaterEqual(result['cpu_seconds'], .04)
            self.assertLess(result['cpu_seconds'], .3)
            self.assert_native_closed(directory)

    def test_error_timeout_and_owner_sigkill_reap_only_the_owned_native_tree(self):
        for mode, code in [('error', 0), ('protocol-error', 0), ('timeout', 0), ('signal', 0), ('interruption', 137)]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                status, result = owned_case(mode, directory)
                self.assertEqual(status, code)
                if mode == 'error':
                    self.assertEqual(result['cpu_measurement'], 'isolated_reaped_child_cpu')
                    self.assertGreaterEqual(result['cpu_seconds'], 0)
                if mode == 'protocol-error':
                    self.assertEqual(result, {'outcome': 'error'})
                if mode == 'signal':
                    self.assertEqual(result, {'outcome': 'interrupted'})
                if mode == 'timeout':
                    self.assertEqual(result, {'outcome': 'timeout'})
                self.assert_native_closed(directory)

    def test_additional_queries_share_one_owned_native_and_validation_failure_reaps_it(self):
        for mode in ('additional','additional-error'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                status,result = owned_case(mode,directory)
                self.assertEqual(status,0)
                if mode=='additional':
                    self.assertIsNotNone(result)
                    self.assertEqual(result['additional_known_fixtures'],3)
                    self.assertEqual(result['validated'],3)
                else:
                    self.assertEqual(result,{'outcome':'rejected'})
                self.assert_native_closed(directory)

    def test_cpu_metadata_rejects_private_or_malformed_unclosed_values(self):
        unknown = {'cpu_seconds': None, 'cpu_measurement': 'unavailable'}
        valid = {'schema': 1, 'user_seconds': .25, 'system_seconds': .125}
        self.assertEqual(native_cpu.decode_metadata(json.dumps(valid).encode()),
                         {'cpu_seconds': .375, 'cpu_measurement': 'isolated_reaped_child_cpu'})
        invalid = [b'', b'[]', b'not-json', b'{"schema":1,"schema":1,"user_seconds":0,"system_seconds":0}',
                   json.dumps({**valid, 'private': 'sentinel-key'}).encode(), b'x' * (native_cpu.METADATA_MAX_BYTES + 1)]
        for value in (True, -1, float('nan'), float('inf'), 10**1000, 'sentinel-key'):
            invalid.append(json.dumps({**valid, 'user_seconds': value}).encode())
        for value in invalid:
            with self.subTest(size=len(value)):
                self.assertEqual(native_cpu.decode_metadata(value), unknown)
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, json.dumps(valid).encode())
            with patch.object(native_cpu, 'METADATA_TIMEOUT_SECONDS', .01):
                self.assertEqual(native_cpu.read_metadata(read_fd), unknown)
            os.close(write_fd)
            write_fd = None
            # The incomplete first read is consumed; closed empty input must stay unknown.
            self.assertEqual(native_cpu.read_metadata(read_fd), unknown)
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    def test_closed_cpu_pipe_accepts_only_its_complete_numeric_record(self):
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, b'{"schema":1,"user_seconds":0.25,"system_seconds":0.125}')
            os.close(write_fd)
            write_fd = None
            self.assertEqual(native_cpu.read_metadata(read_fd),
                             {'cpu_seconds': .375, 'cpu_measurement': 'isolated_reaped_child_cpu'})
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    def test_completion_is_scope_specific_and_never_turns_unknown_into_zero(self):
        measured = {'cpu_seconds': .125, 'cpu_measurement': 'isolated_reaped_child_cpu'}
        core = ('mcp-victoriametrics', 'mcp-victorialogs', 'mcp-victoriatraces')
        self.assertTrue(native_cpu.has_measurements({name: measured for name in core}, core))
        self.assertTrue(native_cpu.has_measurements({'umami': measured}, ('umami',)))
        self.assertFalse(native_cpu.has_measurements({'umami': measured}, core))
        self.assertFalse(native_cpu.has_measurements({name: measured for name in core}, ('umami',)))
        for value in (None, True, float('nan'), float('inf'), -1, 10**1000):
            self.assertFalse(native_cpu.has_measurements({'umami': {**measured, 'cpu_seconds': value}}, ('umami',)))
        self.assertFalse(native_cpu.has_measurements({'umami': {'cpu_seconds': None, 'cpu_measurement': 'unavailable'}}, ('umami',)))
