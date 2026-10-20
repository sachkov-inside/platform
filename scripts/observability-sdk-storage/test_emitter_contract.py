"""Real production CLI/SDK/OTLP-to-Python contract, with owned native listeners only."""
import contextlib
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest

import sdk_storage


@contextlib.contextmanager
def receiver():
    counts = {'traces': 0, 'metrics': 0}
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            # The real Node exporter uses chunked OTLP. Requiring Content-Length
            # would make this fixture return400 and test a different failure.
            self.connection.settimeout(2)
            if self.path not in ('/v1/traces', '/v1/metrics'):
                self.send_error(400)
                return
            if self.headers.get('transfer-encoding', '').lower() == 'chunked':
                total = 0
                while True:
                    token = self.rfile.readline(32).strip().split(b';', 1)[0]
                    if not token or len(token) > 8 or any(c not in b'0123456789abcdefABCDEF' for c in token):
                        self.send_error(400)
                        return
                    size = int(token, 16)
                    total += size
                    if total > 262144:
                        self.send_error(400)
                        return
                    if size == 0:
                        if self.rfile.readline(32) != b'\r\n':
                            self.send_error(400)
                            return
                        break
                    if len(self.rfile.read(size)) != size or self.rfile.read(2) != b'\r\n':
                        self.send_error(400)
                        return
            else:
                size = int(self.headers.get('content-length', '0'))
                if not 0 < size <= 262144 or len(self.rfile.read(size)) != size:
                    self.send_error(400)
                    return
            counts[self.path.rsplit('/', 1)[-1]] += 1
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', '2')
            self.end_headers()
            self.wfile.write(b'{}')

    # The production CLI deliberately has one fixed loopback collector endpoint.
    # Binding failure refuses the test; it never stops a foreign listener.
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 14318), Handler)
    server.daemon_threads = False
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05})
    running = False
    try:
        thread.start()
        running = True
        yield counts
    finally:
        if running:
            server.shutdown()
        server.server_close()
        if running:
            thread.join(timeout=1)
            if thread.is_alive():
                raise RuntimeError('owned OTLP receiver thread remained')
        if server.fileno() != -1:
            raise RuntimeError('owned OTLP receiver socket remained')
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', 14318))


class ProductionEmitterContract(unittest.TestCase):
    def test_real_cli_stdout_is_validated_before_normalized_public_module_artifact(self):
        with receiver() as counts:
            emitted = sdk_storage.emitter(environment={**os.environ, 'SDK_STORAGE_RELEASE': 'a'*40})
            observed = sdk_storage.witness(emitted)
            self.assertEqual(observed['provider_requests'], 1)
            self.assertEqual(observed['body_read'], 'passed')
            self.assertEqual(counts['traces'], 1)
            self.assertGreaterEqual(counts['metrics'], 1)
            modules = observed['runtime_modules']
            self.assertIs(type(modules), dict)
            for name in ('technical-telemetry-runtime', 'technical-telemetry'):
                path = 'apps/backend/dist/infrastructure/observability/'+name+'.js'
                self.assertEqual(modules[path], hashlib.sha256((sdk_storage.pilot.ROOT/path).read_bytes()).hexdigest())
            for name in ('s3-object-storage', 's3-request-observation'):
                path = 'apps/backend/dist/infrastructure/object-storage/'+name+'.js'
                self.assertEqual(modules[path], hashlib.sha256((sdk_storage.pilot.ROOT/path).read_bytes()).hexdigest())
            # The real compiled dependency graph contains paths longer than the
            # shared decoder's key128 bound. They are private wire string values.
            self.assertTrue(any(len(path) > 128 for path in modules))
            with tempfile.TemporaryDirectory() as directory:
                output, metadata, public = (Path(directory)/name for name in ('private', 'metadata', 'public'))
                output.mkdir(mode=0o700)
                metadata.mkdir(mode=0o700)
                sdk_storage.pilot.write_json(output/'runtime-modules.json', {'schema': 1, 'sha256': modules})
                sdk_storage.ci.collect(output, metadata, public, artifacts=('runtime-modules.json',))
                artifact = json.loads((public/'runtime-modules.json').read_text())
                self.assertEqual(artifact, {'schema': 1, 'sha256': modules})

    def test_owned_receiver_closes_when_stdout_cannot_be_decoded(self):
        with receiver():
            with self.assertRaises(ValueError):
                sdk_storage.emitter(argv=['node', '-e', 'process.stdout.write("{")'], budget=1)


    def test_owned_receiver_closes_when_decoded_witness_is_rejected(self):
        raw = json.dumps({'schema': 2, 'trace_id': 'a'*32, 'root_id': 'b'*16,
            'provider_requests': 1, 'body_read': 'passed', 'runtime_modules': [
                {'path': 'node_modules/unrelated'+str(i)+'.js', 'sha256': 'a'*64} for i in range(4)]})
        with receiver():
            emitted = sdk_storage.emitter(argv=['node', '-e', 'process.stdout.write(process.argv[1])', raw], budget=3)
            with self.assertRaisesRegex(ValueError, '^production module witness missing$'):
                sdk_storage.witness(emitted)


if __name__ == '__main__':
    unittest.main()
