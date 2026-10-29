"""Limited-client protocol, explicit denial vs unknown; no namespace claim on Mac."""
import errno
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler,HTTPServer
import io
import json
from pathlib import Path
import runpy
import socket
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import agent_probe


class IdentityCommand(unittest.TestCase):
    def command(self,path,args=('socket-identity',),changed=None):
        native_lstat=Path.lstat;output=io.StringIO();status=0
        def lstat(value,*positional,**keywords):
            native=native_lstat(path if value==Path('/gateway/reader.sock') else value,*positional,**keywords)
            if changed is not None and value==Path('/gateway/reader.sock'):
                native=SimpleNamespace(**{k:getattr(native,k) for k in ('st_mode','st_uid','st_gid','st_nlink','st_dev','st_ino')})
                for key,value in changed.items():setattr(native,key,value)
            return native
        with patch.object(sys,'argv',[agent_probe.__file__,*args]),patch.object(Path,'lstat',lstat),\
             patch.object(agent_probe.os,'open',side_effect=AssertionError('no admission/private access')),\
             patch.object(socket,'create_connection',side_effect=AssertionError('no backend request')),redirect_stdout(output):
            try:runpy.run_path(agent_probe.__file__,run_name='__main__')
            except SystemExit as error:status=error.code
        return status,json.loads(output.getvalue())

    def test_literal_identity_command_reports_absence_and_actual_owned_Unix_socket(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'reader.sock'
            self.assertEqual(self.command(path),(0,{'available':False}))
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
                stream.bind(str(path));path.chmod(0o600)
                self.assertEqual(self.command(path),(0,{'available':True,'identity':agent_probe.socket_identity(path)}))

    def test_identity_command_refuses_socket_symlink_type_permissions_owner_and_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'reader.sock';alias=root/'alias'
            path.write_text('not a socket')
            self.assertEqual(self.command(path),(1,{'agent_failed':1}));path.unlink()
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
                stream.bind(str(path));path.chmod(0o600);alias.symlink_to(path)
                self.assertEqual(self.command(alias),(1,{'agent_failed':1}))
                path.chmod(0o640)
                self.assertEqual(self.command(path),(1,{'agent_failed':1}));path.chmod(0o600)
                native=path.lstat()
                for changed in ({'st_uid':native.st_uid+1},{'st_gid':native.st_gid+1},{'st_nlink':2}):
                    with self.subTest(changed=changed):self.assertEqual(self.command(path,changed=changed),(1,{'agent_failed':1}))
                self.assertEqual(self.command(path,('socket-identity','/other/path')),(1,{'agent_failed':1}))

    def test_wire_refuses_actual_socket_replaced_after_admission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'reader.sock';original=root/'original.sock'
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as first,socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as replacement:
                first.bind(str(path));path.chmod(0o600);identity=agent_probe.socket_identity(path)
                # Keep the original inode alive so the replacement cannot reuse it.
                path.rename(original);replacement.bind(str(path));path.chmod(0o600)
                actual_identity=agent_probe.socket_identity
                with patch.object(agent_probe,'socket_identity',side_effect=lambda:actual_identity(path)),\
                     patch.object(socket,'create_connection',side_effect=AssertionError('no backend request')):
                    with self.assertRaises(ValueError):agent_probe.wire({'socket_identity':identity},agent_probe.time.monotonic()+1)


class DirectBoundary(unittest.TestCase):
    def test_any_reachable_backend_including_HTTP401_refuses_denial(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def do_GET(self):self.send_response(401);self.end_headers()
        server=HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.01));thread.start()
        try:
            with self.assertRaisesRegex(ValueError,'backend_reachable'):
                agent_probe.deny_tcp('127.0.0.1',server.server_port,1)
        finally:server.shutdown();server.server_close();thread.join(timeout=2)
        self.assertFalse(thread.is_alive())

    def test_only_explicit_kernel_ENETUNREACH_is_denial_not_timeout_or_refused(self):
        for error in (TimeoutError(),ConnectionRefusedError(errno.ECONNREFUSED,'fixture'),OSError(errno.EHOSTUNREACH,'fixture')):
            with patch.object(socket,'create_connection',side_effect=error),self.assertRaises(ValueError):agent_probe.deny_tcp('172.20.0.2',8080,1)
        with patch.object(socket,'create_connection',side_effect=OSError(errno.ENETUNREACH,'fixture')):
            agent_probe.deny_tcp('172.20.0.2',8080,1)

    def test_admission_rejects_credential_extra_foreign_endpoint_and_partial_targets(self):
        config={'schema':1,'nonce':'a'*32,'agent_key':'b'*64,'remaining_seconds':100,'network_namespace':'net:[123]',
            'socket_identity':{'device':1,'inode':2,'uid':1001,'gid':1001,'mode':0o600,'links':1},
            'targets':{'postgres':'172.20.0.2','clickhouse':'172.20.0.3','keeper':'172.20.0.4','collector':'172.20.0.5','server':'172.20.0.6','mcp':'172.20.0.7','disk':'172.20.0.8'}}
        self.assertEqual(agent_probe.admission(config),config)
        for changed in (dict(config,viewer_key='forbidden'),dict(config,targets={}),
            dict(config,targets={**config['targets'],'server':'127.0.0.1'}),dict(config,targets={**config['targets'],'server':'8.8.8.8'})):
            with self.assertRaises(ValueError):agent_probe.admission(changed)


if __name__=='__main__':unittest.main()
