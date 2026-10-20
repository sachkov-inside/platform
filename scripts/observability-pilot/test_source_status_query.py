"""Owned loopback HTTP and process-deadline contracts; no external providers."""
import contextlib
import http.server
from email.message import Message
import json
import os
import stat
import io
import tempfile
from pathlib import Path
import signal
import time
import threading
import unittest
import urllib.parse
from unittest.mock import patch

import source_status_query


@contextlib.contextmanager
def server(callback, *, poll_interval=.5):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            callback(self)

        def log_message(self, *_):
            pass
    instance = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = None
    try:
        instance.daemon_threads = False
        instance.block_on_close = True
        thread = threading.Thread(target=lambda: instance.serve_forever(poll_interval=poll_interval))
        thread.start()
        yield instance.server_port
    finally:
        try:
            if thread is not None and thread.ident is not None:
                instance.shutdown()
        finally:
            instance.server_close()
            if thread is not None and thread.ident is not None:
                thread.join(2)
                if thread.is_alive():
                    raise AssertionError('owned HTTP reader did not stop')


def native_near_now_vector(parameters):
    """Model pinned VM's 30s adjustment and restored outer point timestamp, not a native run."""
    evaluated_at = int(parameters['time'][0])
    effective_at = evaluated_at if parameters.get('nocache') == ['1'] else evaluated_at - 30
    timestamp_query = 'timestamp_with_name(' in parameters['query'][0]
    rows = [{'metric': {'job': job, 'instance': 'pilot',
                        'source_metric' if timestamp_query else '__name__': 'up'},
             'value': [evaluated_at, str(effective_at - 1) if timestamp_query else '1']}
            for job in ('platform-collector', 'platform-trace-store')]
    return json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': rows},
                       'stats': {'seriesFetched': '2', 'executionTimeMsec': 0}}).encode()


class QueryTests(unittest.TestCase):
    def test_public_evaluate_fixed_plan_avoids_native_near_now_timestamp_shift(self):
        parameters = [urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
                      for path in source_status_query.query_plan(100)]
        report = source_status_query.status.evaluate(
            *(native_near_now_vector(query) for query in parameters),
            evaluated_at=100, completed_at=100)
        for source in report['sources'].values():
            self.assertEqual(source['state'], 'fresh_up')
            self.assertEqual(source['measured_at'], 99)
            self.assertEqual(source['sample_age_seconds'], 1)
        # A restored outer result timestamp does not repair timestamp(...) evaluated
        # against an older source sample. Preserve that failure as a negative control.
        prior = [{key: value for key, value in query.items() if key != 'nocache'}
                 for query in parameters]
        stale = source_status_query.status.evaluate(
            *(native_near_now_vector(query) for query in prior),
            evaluated_at=100, completed_at=100)
        for source in stale['sources'].values():
            self.assertEqual(source['state'], 'stale')
            self.assertEqual(source['measured_at'], 69)
            self.assertEqual(source['sample_age_seconds'], 31)

    def test_private_reader_fixed_requests_avoid_native_near_now_shift(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential.chmod(0o600)
            requests = []
            def reply(handler):
                parsed = urllib.parse.urlsplit(handler.path)
                parameters = urllib.parse.parse_qs(parsed.query)
                requests.append((parsed.path, parameters, handler.headers.get('Authorization')))
                payload = native_near_now_vector(parameters)
                handler.send_response(200)
                handler.send_header('Content-Length', str(len(payload)))
                handler.end_headers()
                handler.wfile.write(payload)
            with server(reply) as port:
                report = source_status_query.read_report(output, port=port, wall_clock=lambda: 100)
            for source in report['sources'].values():
                self.assertEqual(source['state'], 'fresh_up')
                self.assertEqual(source['measured_at'], 99)
                self.assertEqual(source['sample_age_seconds'], 1)
            self.assertEqual(len(requests), 2)
            for path, parameters, authorization in requests:
                self.assertEqual(path, '/metrics/api/v1/query')
                self.assertEqual(set(parameters), {'query', 'time', 'timeout', 'nocache'})
                self.assertEqual(parameters['time'], ['100'])
                self.assertEqual(parameters['timeout'], ['2s'])
                self.assertEqual(parameters['nocache'], ['1'])
                self.assertEqual(authorization, 'Bearer private-token')
                self.assertNotIn('last_over_time', parameters['query'][0])
            self.assertNotIn('private-token', json.dumps(report))

    def test_two_fixed_authenticated_queries_return_source_status(self):
        requests = []
        def reply(handler):
            parsed = urllib.parse.urlsplit(handler.path)
            query = urllib.parse.parse_qs(parsed.query)
            requests.append((parsed.path, query, handler.headers.get('Authorization')))
            stamp_query = 'timestamp_with_name(' in query['query'][0]
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

    def test_native_stats_loopback_reads_keep_original_timestamps_and_private_credentials(self):
        for fetched, elapsed in (('0', 0), ('9223372036854775807', 9223372036854)):
            with self.subTest(fetched=fetched), tempfile.TemporaryDirectory() as directory:
                output = Path(directory).resolve()
                credential = output / 'auth.json'
                credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
                credential.chmod(0o600)
                calls = []
                def reply(handler):
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
                    calls.append((query, handler.headers.get('Authorization')))
                    stamp = 'timestamp_with_name(' in query['query'][0]
                    rows = [{'metric': {'job': job, 'instance': 'pilot',
                                        'source_metric' if stamp else '__name__': 'up'},
                             'value': [100, '99' if stamp else '1']}
                            for job in ('platform-collector', 'platform-trace-store')]
                    payload = json.dumps({'status': 'success',
                        'data': {'resultType': 'vector', 'result': rows},
                        'stats': {'seriesFetched': fetched, 'executionTimeMsec': elapsed}}).encode()
                    handler.send_response(200)
                    handler.send_header('Content-Length', str(len(payload)))
                    handler.end_headers()
                    handler.wfile.write(payload)
                with server(reply) as port:
                    report = source_status_query.read_report(output, port=port, wall_clock=lambda: 100)
                self.assertEqual(len(calls), 2)
                self.assertTrue(all(query['time'] == ['100'] and query['timeout'] == ['2s']
                                    and token == 'Bearer private-token' for query, token in calls))
                for source in report['sources'].values():
                    self.assertEqual(source['state'], 'fresh_up')
                    self.assertEqual(source['measured_at'], 99)
                    self.assertEqual(source['sample_age_seconds'], 1)
                self.assertNotIn('stats', json.dumps(report))
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
                self.assertEqual(source_status_query.main(['--output', str(output)]), 1)
            self.assertNotIn('private-token', stream.getvalue())

    def test_one_budget_covers_both_queries_and_never_keeps_first_health(self):
        # Controlled clock/HTTP boundary proves the shared budget without assuming
        # the machine can schedule a second real request inside a short interval.
        # The independent owned slow-trickle case proves the real OS deadline.
        clock = [0]
        requests, responses = [], []
        class Response(io.BytesIO):
            status = 200
            def __init__(self, body, finished_at):
                super().__init__(body)
                self.headers = Message()
                self.headers['Content-Length'] = str(len(body))
                self.finished_at = finished_at
            def read(self, limit):
                result = super().read(limit)
                clock[0] = self.finished_at
                return result
        def read(request, *, timeout):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            requests.append(timeout)
            timestamp_query = 'timestamp_with_name(' in query['query'][0]
            labels = {'job': 'platform-collector', 'instance': 'pilot',
                      'source_metric' if timestamp_query else '__name__': 'up'}
            body = json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': [
                {'metric': labels, 'value': [100, '99' if timestamp_query else '1']}]}}).encode()
            response = Response(body, .3 if len(requests) == 1 else .9)
            responses.append(response)
            return response
        with patch('time.monotonic', side_effect=lambda: clock[0]), \
             patch('signal.setitimer'), \
             patch('urllib.request.OpenerDirector.open', side_effect=read):
            result = source_status_query.query('private-token', deadline_seconds=.8, wall_clock=lambda: 100)
        self.assertEqual(len(requests), 2)
        self.assertAlmostEqual(requests[0], .8)
        self.assertAlmostEqual(requests[1], .5)
        self.assertEqual(result['query']['reason'], 'timeout')
        self.assertTrue(all(source['state'] == 'query_unavailable' for source in result['sources'].values()))
        self.assertTrue(all(response.closed for response in responses))

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
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            target = output / 'target.json'
            target.write_text('{"users":[{"bearer_token":"private-token"}]}')
            target.chmod(0o600)
            credential = output / 'auth.json'
            credential.symlink_to(target)
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(output), '--port', '1'])
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')
            self.assertNotIn('private-token', stream.getvalue())
            credential.unlink()
            os.mkfifo(credential)
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                self.assertEqual(source_status_query.main(['--output', str(output)]), 1)
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')

    def test_source_age_and_wall_regression_include_bounded_json_decode(self):
        def reply(handler):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
            timestamp_query = 'timestamp_with_name(' in query['query'][0]
            labels = {'job': 'platform-collector', 'instance': 'pilot',
                      'source_metric' if timestamp_query else '__name__': 'up'}
            payload = json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': [
                {'metric': labels, 'value': [109, '100' if timestamp_query else '1']}]}}).encode()
            handler.send_response(200)
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
        native_decode = json.loads
        with server(reply) as port:
            for after_decode, expected in ((110.001, 'stale'), (109.5, 'malformed')):
                with self.subTest(after_decode=after_decode):
                    clock = [109.999]
                    decodes = []
                    def bounded_decode(*args, **kwargs):
                        result = native_decode(*args, **kwargs)
                        decodes.append(True)
                        clock[0] = after_decode
                        return result
                    with patch('json.loads', side_effect=bounded_decode):
                        report = source_status_query.query('private-token', port=port, wall_clock=lambda: clock[0])
                    self.assertEqual(len(decodes), 2)
                    self.assertEqual(report['sources']['collector']['state'], expected)
                    if expected == 'stale':
                        self.assertEqual(report['query']['evaluated_at'], 109)
                        self.assertEqual(report['query']['completed_at'], 110.001)
                        self.assertGreater(report['sources']['collector']['sample_age_seconds'], 10)

    def test_owned_server_closes_bound_socket_when_serving_thread_cannot_start(self):
        acquired = []
        native_server = http.server.ThreadingHTTPServer
        def acquire(*args, **kwargs):
            instance = native_server(*args, **kwargs)
            acquired.append(instance)
            return instance
        try:
            with patch('http.server.ThreadingHTTPServer', side_effect=acquire), \
                 patch('threading.Thread.start', side_effect=RuntimeError('controlled start refusal')):
                with self.assertRaisesRegex(RuntimeError, 'controlled start refusal'):
                    with server(lambda _: None):
                        self.fail('unstarted server was yielded')
            self.assertEqual(len(acquired), 1)
            self.assertEqual(acquired[0].socket.fileno(), -1)
        finally:
            for instance in acquired:
                instance.server_close()

    def test_private_owned_credential_modes_and_canonical_output_before_http(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            for directory_mode, file_mode in ((0o755, 0o600), (0o770, 0o600), (0o1700, 0o600),
                                               (0o700, 0o644), (0o700, 0o640), (0o700, 0o660), (0o700, 0o700)):
                with self.subTest(directory_mode=directory_mode, file_mode=file_mode):
                    output.chmod(directory_mode)
                    credential.chmod(file_mode)
                    stream = io.StringIO()
                    with patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                        code = source_status_query.main(['--output', str(output)])
                    self.assertEqual(code, 1)
                    http_read.assert_not_called()
                    self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')
                    self.assertNotIn('private-token', stream.getvalue())
                    self.assertNotIn(str(output), stream.getvalue())
            output.chmod(0o700)
            credential.chmod(0o600)
            alias = output / 'alias'
            alias.symlink_to(output, target_is_directory=True)
            candidates = (alias, output / '..' / output.name, Path(os.path.relpath(output)))
            for candidate in candidates:
                with self.subTest(candidate_kind=str(candidate == alias)):
                    stream = io.StringIO()
                    with patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                        code = source_status_query.main(['--output', str(candidate)])
                    self.assertEqual(code, 1)
                    http_read.assert_not_called()
                    self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')

    def test_foreign_uid_credential_is_refused_before_http(self):
        native_stat = os.fstat
        def foreign_file(descriptor):
            info = native_stat(descriptor)
            if stat.S_ISREG(info.st_mode):
                fields = list(info)
                fields[4] = os.getuid() + 1
                return os.stat_result(fields)
            return info
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential.chmod(0o600)
            stream = io.StringIO()
            with patch('os.fstat', side_effect=foreign_file), \
                 patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(output)])
            self.assertEqual(code, 1)
            http_read.assert_not_called()
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')

    def test_owned_private_credentials_reach_only_loopback_and_close_all_file_descriptors(self):
        # Named real-clock adapter contract: the live CLI supplies evaluation time
        # to an owned HTTP fixture. No native-engine compatibility is implied.
        requests, descriptors = [], []
        native_open = os.open
        def acquired(*args, **kwargs):
            descriptor = native_open(*args, **kwargs)
            descriptors.append(descriptor)
            return descriptor
        def reply(handler):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
            requests.append(handler.headers.get('Authorization'))
            evaluation = int(query['time'][0])
            timestamp_query = 'timestamp_with_name(' in query['query'][0]
            rows = [{'metric': {'job': job, 'instance': 'pilot',
                                'source_metric' if timestamp_query else '__name__': 'up'},
                     'value': [evaluation, str(evaluation) if timestamp_query else '1']}
                    for job in ('platform-collector', 'platform-trace-store')]
            payload = json.dumps({'status': 'success', 'data': {'resultType': 'vector', 'result': rows}}).encode()
            handler.send_response(200)
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential.chmod(0o600)
            stream = io.StringIO()
            with server(reply) as port, patch('os.open', side_effect=acquired), contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(output), '--port', str(port)])
            self.assertEqual(code, 0)
            self.assertEqual(requests, ['Bearer private-token', 'Bearer private-token'])
            report = json.loads(stream.getvalue())
            self.assertEqual(report['sources']['collector']['state'], 'fresh_up')
            self.assertEqual(report['sources']['trace_store']['state'], 'fresh_up')
            self.assertNotIn('private-token', stream.getvalue())
            self.assertNotIn(str(output), stream.getvalue())
            self.assertGreater(len(descriptors), 1)
            for descriptor in descriptors:
                with self.assertRaises(OSError):
                    os.fstat(descriptor)

    def test_parent_symlink_and_changed_owned_output_anchor_are_refused_before_http(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory).resolve()
            real = parent / 'real'
            real.mkdir(mode=0o700)
            output = real / 'output'
            output.mkdir(mode=0o700)
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential.chmod(0o600)
            alias = parent / 'alias'
            alias.symlink_to(real, target_is_directory=True)
            stream = io.StringIO()
            with patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(alias / 'output')])
            self.assertEqual(code, 1)
            http_read.assert_not_called()
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')
            native_decode = json.loads
            descriptors = []
            native_open = os.open
            def acquired(*args, **kwargs):
                descriptor = native_open(*args, **kwargs)
                descriptors.append(descriptor)
                return descriptor
            def replace_directory_during_decode(*args, **kwargs):
                result = native_decode(*args, **kwargs)
                output.rename(real / 'moved')
                output.mkdir(mode=0o700)
                replacement = output / 'auth.json'
                replacement.write_text('{"users":[{"bearer_token":"private-token"}]}')
                replacement.chmod(0o600)
                return result
            stream = io.StringIO()
            with patch('json.loads', side_effect=replace_directory_during_decode), \
                 patch('os.open', side_effect=acquired), \
                 patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(output)])
            self.assertEqual(code, 1)
            http_read.assert_not_called()
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')
            self.assertGreater(len(descriptors), 1)
            for descriptor in descriptors:
                with self.assertRaises(OSError):
                    os.fstat(descriptor)

    def test_foreign_uid_output_directory_is_refused_before_reading_credentials(self):
        native_stat = os.fstat
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve()
            inode = output.stat().st_ino
            credential = output / 'auth.json'
            credential.write_text('{"users":[{"bearer_token":"private-token"}]}')
            credential.chmod(0o600)
            def foreign_directory(descriptor):
                info = native_stat(descriptor)
                if info.st_ino == inode:
                    fields = list(info)
                    fields[4] = os.getuid() + 1
                    return os.stat_result(fields)
                return info
            stream = io.StringIO()
            with patch('os.fstat', side_effect=foreign_directory), \
                 patch('urllib.request.OpenerDirector.open') as http_read, contextlib.redirect_stdout(stream):
                code = source_status_query.main(['--output', str(output)])
            self.assertEqual(code, 1)
            http_read.assert_not_called()
            self.assertEqual(json.loads(stream.getvalue())['query']['reason'], 'credentials')

    def test_public_read_report_uses_the_current_private_rotated_token(self):
        tokens = []
        def reply(handler):
            tokens.append(handler.headers.get('Authorization'))
            payload = b'{"status":"success","data":{"resultType":"vector","result":[]}}'
            handler.send_response(200)
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
        with tempfile.TemporaryDirectory() as directory, server(reply) as port:
            output = Path(directory).resolve()
            credential = output / 'auth.json'
            for token in ('original-token', 'rotated-token'):
                credential.write_text(json.dumps({'users': [{'bearer_token': token}]}))
                credential.chmod(0o600)
                report = source_status_query.read_report(output, port=port, wall_clock=lambda: 100)
                self.assertEqual(report['sources']['collector']['state'], 'missing')
                self.assertNotIn(token, json.dumps(report))
        self.assertEqual(tokens, ['Bearer original-token', 'Bearer original-token',
                                  'Bearer rotated-token', 'Bearer rotated-token'])


if __name__ == '__main__':
    unittest.main()
