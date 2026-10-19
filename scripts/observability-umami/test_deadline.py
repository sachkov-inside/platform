"""Owned process + loopback slow-provider/client contracts, all resources finally closed."""
import contextlib
import http.client
import http.server
import importlib.util
import multiprocessing
import pathlib
import signal
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('gateway', pathlib.Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

REQUEST_BUDGET_SECONDS = 0.15
CLIENT_BUDGET_SECONDS = 2
DRIP_INTERVAL_SECONDS = 0.04
JOIN_BUDGET_SECONDS = 3


def serve_gateway(connection, upstream, key):
    def stop(*args):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    server = gateway.DeadlineHTTPServer(('127.0.0.1', 0), gateway.handler(upstream, pathlib.Path(key)), request_budget_seconds=REQUEST_BUDGET_SECONDS)
    connection.send(server.server_port)
    connection.close()
    try:
        server.serve_forever(poll_interval=gateway.REAPER_INTERVAL_SECONDS)
    finally:
        server.server_close()


@contextlib.contextmanager
def running_gateway(upstream, key):
    context = multiprocessing.get_context('spawn')
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=serve_gateway, args=(child, upstream, str(key)))
    process.start()
    child.close()
    try:
        if not parent.poll(JOIN_BUDGET_SECONDS):
            raise AssertionError('gateway did not report owned socket')
        yield parent.recv()
    finally:
        parent.close()
        process.terminate()
        process.join(JOIN_BUDGET_SECONDS)
        if process.is_alive():
            process.kill()
            process.join(JOIN_BUDGET_SECONDS)
        if process.is_alive():
            raise AssertionError('gateway process was not reaped')
        process.close()


def read(port, token='umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'):
    request = urllib.request.Request(f'http://127.0.0.1:{port}/api/websites', headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=CLIENT_BUDGET_SECONDS) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read()


class WallClockBoundary(unittest.TestCase):
    def test_slow_drip_is_terminated_and_other_auth_queries_continue(self):
        started = threading.Event()
        finished = threading.Event()
        stop_drip = threading.Event()
        outcome = []
        revoked = threading.Event()
        class Provider(http.server.BaseHTTPRequestHandler):
            calls = 0
            def log_message(self, *args):
                pass
            def do_GET(self):
                Provider.calls += 1
                if Provider.calls != 1:
                    self.send_response(401 if revoked.is_set() else 200)
                    self.end_headers()
                    self.wfile.write(b'{}')
                    return
                self.send_response(200)
                self.send_header('Content-Length', '100')
                self.end_headers()
                started.set()
                try:
                    for _ in range(100):
                        self.wfile.write(b' ')
                        self.wfile.flush()
                        if stop_drip.wait(DRIP_INTERVAL_SECONDS):
                            break
                except OSError:
                    pass
        provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        provider.daemon_threads = False
        provider_thread = threading.Thread(target=provider.serve_forever)
        provider_thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                key = pathlib.Path(directory) / 'key'
                key.write_text('umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
                with running_gateway(f'http://127.0.0.1:{provider.server_port}', key) as port:
                    def slow_read():
                        try:
                            outcome.append(read(port))
                        except (OSError, http.client.HTTPException):
                            outcome.append('connection_closed')
                        finally:
                            finished.set()
                    slow = threading.Thread(target=slow_read)
                    slow.start()
                    try:
                        self.assertTrue(started.wait(CLIENT_BUDGET_SECONDS))
                        self.assertEqual(read(port, 'wrong')[0], 401)
                        revoked.set()
                        self.assertEqual(read(port)[0], 401)
                        self.assertTrue(finished.wait(CLIENT_BUDGET_SECONDS))
                        self.assertNotEqual(outcome[0][0] if isinstance(outcome[0], tuple) else outcome[0], 200)
                        revoked.clear()
                        self.assertEqual(read(port), (200, b'{}'))
                    finally:
                        slow.join(JOIN_BUDGET_SECONDS)
                        self.assertFalse(slow.is_alive())
        finally:
            stop_drip.set()
            provider.shutdown()
            provider_thread.join(JOIN_BUDGET_SECONDS)
            provider.server_close()

    def test_idle_client_headers_are_closed_by_absolute_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            key = pathlib.Path(directory) / 'key'
            key.write_text('umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
            with running_gateway('http://127.0.0.1:1', key) as port:
                with socket.create_connection(('127.0.0.1', port), timeout=CLIENT_BUDGET_SECONDS) as client:
                    client.sendall(b'GET /api/websites HTTP/1.1\r\nHost: localhost\r\nX-Slow: ')
                    self.assertEqual(read(port, 'wrong')[0], 401)
                    self.assertEqual(client.recv(1), b'')

    def test_dripping_client_headers_do_not_renew_the_request_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            key = pathlib.Path(directory) / 'key'
            key.write_text('umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
            with running_gateway('http://127.0.0.1:1', key) as port:
                with socket.create_connection(('127.0.0.1', port), timeout=CLIENT_BUDGET_SECONDS) as client:
                    client.sendall(b'GET /api/websites HTTP/1.1\r\nHost: localhost\r\nX-Slow: ')
                    closed = threading.Event()
                    def drip():
                        try:
                            for _ in range(100):
                                client.sendall(b'x')
                                if closed.wait(DRIP_INTERVAL_SECONDS):
                                    return
                        except OSError:
                            closed.set()
                    thread = threading.Thread(target=drip)
                    thread.start()
                    try:
                        self.assertEqual(client.recv(1), b'')
                    finally:
                        closed.set()
                        thread.join(JOIN_BUDGET_SECONDS)
                        self.assertFalse(thread.is_alive())
                    self.assertEqual(read(port, 'wrong')[0], 401)

    def test_shutdown_closes_the_inflight_owned_worker_socket(self):
        started = threading.Event()
        release = threading.Event()
        class Provider(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                started.set()
                release.wait(JOIN_BUDGET_SECONDS)
        provider = http.server.HTTPServer(('127.0.0.1', 0), Provider)
        thread = threading.Thread(target=provider.serve_forever)
        thread.start()
        client = None
        try:
            with tempfile.TemporaryDirectory() as directory:
                key = pathlib.Path(directory) / 'key'
                key.write_text('umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
                with running_gateway(f'http://127.0.0.1:{provider.server_port}', key) as port:
                    client = socket.create_connection(('127.0.0.1', port), timeout=CLIENT_BUDGET_SECONDS)
                    client.sendall(b'GET /api/websites HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r\n\r\n')
                    self.assertTrue(started.wait(CLIENT_BUDGET_SECONDS))
                self.assertEqual(client.recv(1), b'')
        finally:
            if client:
                client.close()
            release.set()
            provider.shutdown()
            thread.join(JOIN_BUDGET_SECONDS)
            provider.server_close()
