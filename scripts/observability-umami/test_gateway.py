"""Public gateway policy: reads stay bounded, mutations never reach Umami."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('gateway', pathlib.Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

NOW = 1800000000000
SITE = '00000000-0000-4000-8000-000000000001'


class GatewayPolicy(unittest.TestCase):
    def test_recent_stats_is_allowed(self):
        self.assertEqual(gateway.read_path('GET', f'/api/websites/{SITE}/stats?startAt=1799996400000&endAt=1800000000000', NOW), f'/api/websites/{SITE}/stats?startAt=1799996400000&endAt=1800000000000')



class QueryDenials(unittest.TestCase):
    def test_mutations_and_route_bypasses_are_denied(self):
        for method, path in [('POST', '/api/send'), ('POST', '/mcp'), ('DELETE', f'/api/websites/{SITE}'), ('GET', '/api/users'), ('GET', '/api/websites/../users'), ('GET', '/api/websites%2f..%2fusers'), ('GET', 'http://other/api/websites'), ('GET', '/api/websites?includeTeams=true&includeTeams=false')]:
            with self.subTest(method=method, path=path), self.assertRaises(ValueError):
                gateway.read_path(method, path, NOW)

    def test_query_budget_and_comparison_cannot_bypass_history(self):
        for query in ['startAt=0&endAt=1', 'startAt=1790000000000&endAt=1800000000000', 'startAt=1800000000000&endAt=1800000000001', 'startAt=1799996400000&endAt=1800000000000&compare=year', 'startAt=1799996400000&endAt=1800000000000&search=private', 'startAt=1768464000000&endAt=1768550400000']:
            with self.subTest(query=query), self.assertRaises(ValueError):
                gateway.read_path('GET', f'/api/websites/{SITE}/stats?{query}', NOW)

    def test_event_pagination_is_bounded_and_preserved(self):
        path = f'/api/websites/{SITE}/events?startAt=1799996400000&endAt=1800000000000&page=3&pageSize=25'
        self.assertEqual(gateway.read_path('GET', path, NOW), path)
        with self.assertRaises(ValueError):
            gateway.read_path('GET', path.replace('pageSize=25', 'pageSize=101'), NOW)


class LoopbackBoundary(unittest.TestCase):
    """Owned HTTP socket, 2s client budget; shutdown and join in every outcome."""
    def test_missing_key_is_unavailable_without_leaking_file_name(self):
        import http.server
        import tempfile
        import threading
        import urllib.error
        import urllib.request
        with tempfile.TemporaryDirectory() as directory:
            server = http.server.HTTPServer(('127.0.0.1', 0), gateway.handler('http://127.0.0.1:1', pathlib.Path(directory) / 'sentinel-secret-key'))
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                with self.assertRaises(urllib.error.HTTPError) as result:
                    urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/websites', timeout=2)
                with result.exception as error:
                    self.assertEqual(error.code, 503)
                    self.assertEqual(error.read(), b'{"error":"credentials_unavailable"}')
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()

    def test_revocation_is_checked_upstream_and_provider_error_is_not_exposed(self):
        import http.server
        import tempfile
        import threading
        import urllib.error
        import urllib.request
        calls = []
        class Provider(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                calls.append(self.path)
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"secret":"sentinel-private-provider"}')
        with tempfile.TemporaryDirectory() as directory:
            key = pathlib.Path(directory) / 'reader.key'
            key.write_text('umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
            upstream = http.server.HTTPServer(('127.0.0.1', 0), Provider)
            server = http.server.HTTPServer(('127.0.0.1', 0), gateway.handler(f'http://127.0.0.1:{upstream.server_port}', key))
            threads = [threading.Thread(target=item.serve_forever) for item in (upstream, server)]
            for thread in threads:
                thread.start()
            try:
                for _ in range(2):
                    request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/websites', headers={'Authorization': 'Bearer umami_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'})
                    with self.assertRaises(urllib.error.HTTPError) as result:
                        urllib.request.urlopen(request, timeout=2)
                    with result.exception as error:
                        self.assertEqual(error.code, 401)
                        self.assertEqual(error.read(), b'{"error":"upstream_unavailable"}')
                self.assertEqual(len(calls), 2)
            finally:
                server.shutdown()
                upstream.shutdown()
                for thread in threads:
                    thread.join(timeout=2)
                server.server_close()
                upstream.server_close()
