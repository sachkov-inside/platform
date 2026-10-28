"""Limited-client protocol, explicit denial vs unknown; no namespace claim on Mac."""
import errno
from http.server import BaseHTTPRequestHandler,HTTPServer
import socket
import threading
import unittest
from unittest.mock import patch

import agent_probe


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
