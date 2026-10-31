"""Linux identity uses an owned real Unix socket; Docker protocol is a bounded double."""
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
import daemon
import pilot


class LinuxDaemonBoundary(unittest.TestCase):
    def test_changed_socket_or_daemon_refuses_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'docker.sock'
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(str(path))
            identity = {'ID':'owned', 'DockerRootDir':directory}
            def read(args, **kwargs):
                if args[-1] == 'show':
                    return 'owned'
                if 'inspect' in args:
                    return 'unix://' + str(path)
                if 'info' in args:
                    return json.dumps(identity)
                raise AssertionError('mutation crossed identity guard')
            try:
                with patch.dict(os.environ, {}, clear=True):
                    frozen = daemon.identify(read)
                    with patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', frozen), patch.object(pilot, '_raw_command', side_effect=read):
                        identity['ID'] = 'foreign'
                        with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                            pilot.command(['docker', 'compose', 'up', '-d'])
            finally:
                listener.close()

    def test_identity_preflight_spends_one_absolute_deadline_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'docker.sock'
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(str(path))
            timeouts = []
            def read(args, *, timeout):
                timeouts.append(timeout)
                if args[-1] == 'show':
                    return 'owned'
                if 'inspect' in args:
                    return 'unix://' + str(path)
                raise AssertionError('expired preflight reached another command')
            try:
                with patch.dict(os.environ, {}, clear=True), \
                        patch.object(pilot, 'FROZEN_DOCKER_IDENTITY', {'platform': 'linux'}), \
                        patch.object(pilot.time, 'monotonic', side_effect=[100, 101.75, 103]), \
                        patch.object(pilot, '_raw_command', side_effect=read):
                    with self.assertRaises(TimeoutError):
                        pilot.assert_docker_identity(deadline=102)
                self.assertEqual(timeouts, [0.5, 0.25])
            finally:
                listener.close()

    def test_remote_or_overridden_endpoint_is_not_admitted(self):
        with patch.dict(os.environ, {'DOCKER_HOST':'tcp://foreign:2375'}, clear=True):
            with self.assertRaises(RuntimeError):
                daemon.identify(lambda args: self.fail('override reached Docker'))
