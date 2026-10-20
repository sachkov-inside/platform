"""Owned loopback HTTP and process-deadline contracts; no external providers."""
import contextlib
import http.server
import json
import os
import io
import tempfile
from pathlib import Path
import signal
import time
import threading
import unittest
import urllib.parse

import source_status_query


@contextlib.contextmanager
def server(callback):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            callback(self)

        def log_message(self, *_):
            pass
    instance = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    instance.daemon_threads = False
    instance.block_on_close = True
    thread = threading.Thread(target=instance.serve_forever)
    thread.start()
    try:
        yield instance.server_port
    finally:
        instance.shutdown()
        instance.server_close()
        thread.join(2)
        if thread.is_alive():
            raise AssertionError('owned HTTP reader did not stop')


class QueryTests(unittest.TestCase):
    def test_two_fixed_authenticated_queries_return_source_status(self):
        requests = []
        def reply(handler):
            parsed = urllib.parse.urlsplit(handler.path)
            query = urllib.parse.parse_qs(parsed.query)
            requests.append((parsed.path, query, handler.headers.get('Authorization')))
            stamp_query = query['query'][0].startswith('timestamp(')
            labels = {'job': 'platform-collector', 'instance': 'pilot',
                      'source_metric' if stamp_query else '__name__': 'up'}
            payload = json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': [
                {'metric': labels, 'value': [100, '99' if stamp_query else '1']} ]}}).encode()
            handler.send_response(200)
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
        with server(reply) as port:
            report = source_status_query.query('private-token', port=port, wall_clock=lambda: 100)
        self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0][0], '/metrics/api/v1/query')
        self.assertEqual(requests[0][1]['time'], ['100'])
        self.assertEqual(requests[0][1]['timeout'], ['2s'])
        self.assertTrue(all(item[2] == 'Bearer private-token' for item in requests))
        self.assertNotIn('private-token', json.dumps(report))

    def test_owned_trickling_body_obeys_one_deadline_and_closes_reader(self):
        disconnected = threading.Event()
        stop = threading.Event()
        def trickle(handler):
            handler.send_response(200)
            handler.send_header('Content-Length', '1000')
            handler.end_headers()
            try:
                for _ in range(1000):
                    handler.wfile.write(b' ')
                    handler.wfile.flush()
                    if stop.wait(.01):
                        break
            except (BrokenPipeError, ConnectionResetError):
                disconnected.set()
        prior_handler = signal.getsignal(signal.SIGALRM)
        with server(trickle) as port:
            try:
                started = time.monotonic()
                result = source_status_query.query('private-token', port=port, deadline_seconds=.15)
                self.assertEqual(result['query']['reason'], 'timeout')
                self.assertLess(time.monotonic() - started, 2)
                self.assertTrue(disconnected.wait(2), 'client socket remained open after timeout')
            finally:
                stop.set()
        self.assertEqual(signal.getsignal(signal.SIGALRM), prior_handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))

    def test_partial_body_and_non_success_status_are_closed_errors(self):
        for response_code in (200, 201):
            def truncated(handler):
                handler.send_response(response_code)
                handler.send_header('Content-Length', '100')
                handler.end_headers()
                handler.wfile.write(b'private-provider-response')
            with server(truncated) as port:
                result = source_status_query.query('private-token', port=port)
            self.assertEqual(result['sources']['collector']['state'], 'query_unavailable')
            self.assertNotIn('private-provider-response', json.dumps(result))

    def test_redirect_never_follows_or_retries(self):
        requests = []
        def redirect(handler):
            requests.append(handler.path)
            handler.send_response(302)
            handler.send_header('Location', 'http://127.0.0.1:1/private-token')
            handler.send_header('Content-Length', '0')
            handler.end_headers()
        with server(redirect) as port:
            result = source_status_query.query('private-token', port=port)
        self.assertEqual(len(requests), 1)
        self.assertEqual(result['query']['reason'], 'http_error')
        self.assertNotIn('private-token', json.dumps(result))

    def test_invalid_port_token_and_missing_credentials_never_print_secrets(self):
        for token, port in (('private-token\r\nInjected: secret', 18427), ('private-token', 'https://foreign'),
                            ('private-token', True), ('private-token', 65536)):
            result = source_status_query.query(token, port=port)
            self.assertEqual(result['query']['reason'], 'credentials')
            self.assertNotIn('private-token', json.dumps(result))
        with tempfile.TemporaryDirectory() as output:
            Path(output, 'auth.json').write_text('{"private-token": "broken"}')
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                self.assertEqual(source_status_query.main(['--output', output]), 1)
            self.assertNotIn('private-token', stream.getvalue())

    def test_one_budget_covers_both_queries_and_never_keeps_first_health(self):
        requests = []
        release = threading.Event()
        def reply(handler):
            requests.append(handler.path)
            handler.send_response(200)
            if len(requests) == 1:
                release.wait(.3)  # Named real-clock contract: spend part of the shared deadline.
                payload = b'{"status":"success","data":{"resultType":"vector","result":[]}}'
                handler.send_header('Content-Length', str(len(payload)))
                handler.end_headers()
                handler.wfile.write(payload)
            else:
                payload = b'{"status":"success","data":{"resultType":"vector","result":[]}}'
                handler.send_header('Content-Length', str(len(payload)))
                handler.end_headers()
                if not release.wait(.6):
                    try:
                        handler.wfile.write(payload)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
        with server(reply) as port:
            try:
                result = source_status_query.query('private-token', port=port, deadline_seconds=.8, wall_clock=lambda: 100)
            finally:
                release.set()
        self.assertEqual(len(requests), 2)
        self.assertEqual(result['query']['reason'], 'timeout')
        self.assertTrue(all(source['state'] == 'query_unavailable' for source in result['sources'].values()))

    def test_interruption_closes_reader_and_restores_alarm(self):
        disconnected = threading.Event()
        stop = threading.Event()
        def interrupt(handler):
            handler.send_response(200)
            handler.send_header('Content-Length', '1000')
            handler.end_headers()
            os.kill(os.getpid(), signal.SIGINT)
            try:
                while not stop.wait(.01):
                    handler.wfile.write(b' ')
                    handler.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                disconnected.set()
        prior_handler = signal.getsignal(signal.SIGALRM)
        with server(interrupt) as port:
            try:
                result = source_status_query.query('private-token', port=port)
                self.assertEqual(result['query']['reason'], 'interrupted')
                self.assertTrue(disconnected.wait(2))
            finally:
                stop.set()
        self.assertEqual(signal.getsignal(signal.SIGALRM), prior_handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))

    def test_existing_alarm_is_preserved_and_larger_deadlines_are_refused(self):
        prior = signal.getsignal(signal.SIGALRM)
        signal.setitimer(signal.ITIMER_REAL, 30)
        try:
            result = source_status_query.query('private-token', port=1)
            self.assertEqual(result['query']['reason'], 'transport_error')
            self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0], 0)
            self.assertEqual(signal.getsignal(signal.SIGALRM), prior)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        for seconds in (11, True, float('inf'), float('nan')):
            self.assertEqual(source_status_query.query('private-token', port=1, deadline_seconds=seconds)
                             ['query']['reason'], 'transport_error')

    def test_oversized_body_is_bounded_and_no_response_or_token_is_retained(self):
        requests = []
        def oversized(handler):
            requests.append(handler.path)
            handler.send_response(200)
            handler.send_header('Content-Length', '1048577')
            handler.end_headers()
            try:
                handler.wfile.write(b' ' * 1048577)
            except (BrokenPipeError, ConnectionResetError):
                pass
        with server(oversized) as port:
            report = source_status_query.query('private-token', port=port)
        self.assertEqual(len(requests), 1)
        self.assertEqual(report['sources']['collector']['state'], 'malformed')
        self.assertLess(len(json.dumps(report)), 1024)

    def test_query_evaluation_uses_whole_seconds_without_ignoring_wall_clock_regression(self):
        requests = []
        def reply(handler):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
            requests.append(query)
            handler.send_response(200)
            payload = b'{"status":"success","data":{"resultType":"vector","result":[]}}'
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
        with server(reply) as port:
            result = source_status_query.query('private-token', port=port, wall_clock=lambda: 100.75)
            self.assertEqual(requests[0]['time'], ['100'])
            self.assertEqual(result['query']['evaluated_at'], 100)
            clocks = iter([100.8, 100.7])
            result = source_status_query.query('private-token', port=port, wall_clock=lambda: next(clocks))
            self.assertEqual(result['sources']['collector']['state'], 'malformed')

    def test_credential_symlink_and_fifo_are_refused_without_opening_foreign_data(self):
        with tempfile.TemporaryDirectory() as output:
            target = Path(output, 'target.json')
            target.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential = Path(output, 'auth.json')
            credential.symlink_to(target)
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', output, '--port', '1'])
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')
            self.assertNotIn('private-token', stream.getvalue())
            credential.unlink()
            os.mkfifo(credential)
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                self.assertEqual(source_status_query.main(['--output', output]), 1)
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')


if __name__ == '__main__':
    unittest.main()
