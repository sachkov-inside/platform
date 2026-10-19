"""Real owned process groups and Unix sockets. No Docker or external providers."""
import json
from pathlib import Path
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import runtime

PROCESS_FAILURE_SECONDS = .25
SOCKET_PROBE_SECONDS = .1


class Processes(unittest.TestCase):
    def setUp(self):
        frozen=patch.multiple(runtime.pilot,FROZEN_DOCKER_ENDPOINT=None,FROZEN_DOCKER_IDENTITY=None)
        frozen.start()
        self.addCleanup(frozen.stop)

    def test_resource_project_uses_external_supervisor_cleanup_for_every_worker_outcome(self):
        fixture = runtime.ROOT / 'scripts/observability-pilot/fixtures/process.py'
        for mode, expected in (('success',0),('failure',7),('timeout',124),('sigterm',143),('sigkill',137),('descendant',0)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output=Path(directory)
                (output/'foreign-resource').write_text('preserve')
                compose=[sys.executable,str(fixture),'compose',directory,'normal']
                docker=[sys.executable,str(fixture),'docker',directory,'normal']
                status=runtime.pilot.supervise_worker([sys.executable,str(fixture),'worker',directory,mode],compose,output,
                    runtime.PROJECT_PREFIX+'012345abcdef',docker=docker,deadline_seconds=PROCESS_FAILURE_SECONDS,cleanup_services=runtime.SERVICES)
                self.assertEqual(status,expected)
                self.assertEqual((output/'foreign-resource').read_text(),'preserve')
                self.assertFalse((output/'owned-resource').exists())
                self.assertEqual(json.loads((output/'cleanup.json').read_text())['residue'],'passed')
                if mode=='descendant':
                    with socket.socket(socket.AF_UNIX) as probe:
                        probe.settimeout(SOCKET_PROBE_SECONDS)
                        with self.assertRaises((FileNotFoundError,ConnectionRefusedError)):
                            probe.connect(str(output/'child.sock'))

    def test_stats_slow_drip_is_bounded_by_external_reader_process_deadline(self):
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                try:
                    while self.rfile.readline(4096).strip():
                        pass
                    self.wfile.write(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{')
                    self.wfile.flush()
                    for _ in range(999):
                        time.sleep(.02)
                        self.wfile.write(b' ')
                        self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):
                    pass
        with tempfile.TemporaryDirectory() as directory:
            endpoint=Path(directory)/'engine.sock'
            server=socketserver.ThreadingUnixStreamServer(str(endpoint),Handler)
            server.daemon_threads=True
            thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01))
            thread.start()
            try:
                command=[sys.executable,'-c','import sys;sys.path.insert(0,sys.argv[1]);import engine;engine.fetch(sys.argv[2],"a"*64)',str(runtime.SCRIPTS),'unix://'+str(endpoint)]
                with self.assertRaises(subprocess.TimeoutExpired):
                    subprocess.run(command,capture_output=True,timeout=PROCESS_FAILURE_SECONDS)
            finally:
                server.shutdown();server.server_close();thread.join(1)
                self.assertFalse(thread.is_alive())

    def test_failed_down_preserves_private_env_for_registered_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            private=output/'runtime';private.mkdir();env=private/'api.env';env.write_text('private')
            tls=output/'provider-tls';tls.mkdir();key=tls/'server.key';key.write_text('synthetic-private')
            trust=output/'trust';trust.mkdir();ca=trust/'provider.pem';ca.write_text('public-certificate')
            (output/'cleanup.json').write_text(json.dumps({'down':'failed','residue':'failed'}))
            runtime.cleanup_private(output,acquired=True)
            self.assertTrue(env.exists())
            self.assertTrue(key.exists())
            self.assertTrue(ca.exists())
            (output/'cleanup.json').write_text(json.dumps({'down':'passed','residue':'passed'}))
            runtime.cleanup_private(output,acquired=True)
            self.assertFalse(env.exists())
            self.assertFalse(key.exists())
            self.assertFalse(ca.exists())

    def test_resource_recovery_rechecks_prefix_and_daemon_before_any_cleanup(self):
        identity={'platform':'linux','context':'default','endpoint':'unix:///fixture/docker.sock','daemon_id':'owned',
                  'storage':'/var/lib/docker','socket_device':1,'socket_inode':2}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            owner={'project':runtime.PROJECT_PREFIX+'a'*12,'cwd':str(runtime.ROOT),'daemon':identity}
            (output/'worker.json').write_text(json.dumps({'pid':12345,'group':12345}))
            (output/'compose.json').write_text('{}')
            for project,changed in (('inside-platform',False),(owner['project'],True),(owner['project'],False)):
                (output/'owner.json').write_text(json.dumps({**owner,'project':project}))
                with patch.object(runtime.pilot.daemon,'identify',return_value={**identity,'daemon_id':'changed'} if changed else identity), \
                        patch.object(runtime.ci.os,'kill',side_effect=ProcessLookupError),patch.object(runtime.ci.os,'killpg',side_effect=ProcessLookupError), \
                        patch.object(runtime.ci,'cleanup_project',return_value={'down':'passed','residue':'passed'}) as cleanup:
                    if project=='inside-platform' or changed:
                        with self.assertRaises((ValueError,RuntimeError)):
                            runtime.ci.recover(output,project_prefix=runtime.PROJECT_PREFIX,services=runtime.SERVICES)
                        cleanup.assert_not_called()
                    else:
                        runtime.ci.recover(output,project_prefix=runtime.PROJECT_PREFIX,services=runtime.SERVICES)
                        self.assertEqual(cleanup.call_args.kwargs['services'],runtime.SERVICES)
                        self.assertEqual(cleanup.call_args.args[2],owner['project'])
