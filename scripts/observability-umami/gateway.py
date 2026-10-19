"""Pilot-only Umami query boundary. No generic proxy or embedded MCP route."""
import argparse
import hmac
import http.client
import http.server
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

DAY_MS = 86_400_000
HISTORY_MS = 365 * DAY_MS
QUERY_WINDOW_MS = 31 * DAY_MS
RESPONSE_BYTES = 1_048_576
QUERY_TIMEOUT_SECONDS = 10


def read_path(method, target, now_ms):
    """Return a canonical allowlisted path, or raise ValueError before forwarding."""
    if method != 'GET':
        raise ValueError('method')
    parsed = urllib.parse.urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.fragment or len(target) > 2048:
        raise ValueError('target')
    query = urllib.parse.parse_qs(parsed.query, strict_parsing=True, keep_blank_values=True)
    if any(len(values) != 1 for values in query.values()):
        raise ValueError('duplicate')
    values = {key: items[0] for key, items in query.items()}
    if parsed.path == '/api/websites':
        if set(values) - {'includeTeams', 'page', 'pageSize'}:
            raise ValueError('query')
        if values.get('includeTeams', 'true') != 'true':
            raise ValueError('teams')
        page = values.get('page', '1')
        size = values.get('pageSize', '100')
        if not page.isdecimal() or not 1 <= int(page) <= 1000 or not size.isdecimal() or not 1 <= int(size) <= 100:
            raise ValueError('pagination')
        return '/api/websites?' + urllib.parse.urlencode({'includeTeams': 'true', 'page': page, 'pageSize': size})
    parts = parsed.path.split('/')
    if len(parts) != 5 or parts[:3] != ['', 'api', 'websites'] or parts[4] not in ('stats', 'events'):
        raise ValueError('path')
    if str(uuid.UUID(parts[3])) != parts[3]:
        raise ValueError('website')
    allowed = {'startAt', 'endAt'} | ({'page', 'pageSize'} if parts[4] == 'events' else set())
    if set(values) - allowed or not {'startAt', 'endAt'} <= set(values):
        raise ValueError('query')
    for key in ('startAt', 'endAt'):
        if not values[key].isascii() or not values[key].isdecimal():
            raise ValueError('date')
    start, end = int(values['startAt']), int(values['endAt'])
    if not now_ms - HISTORY_MS <= start <= end <= now_ms or end - start > QUERY_WINDOW_MS:
        raise ValueError('window')
    # Upstream stats ALWAYS also queries a comparison window, defaulting to prev.
    if parts[4] == 'stats' and start - (end - start) < now_ms - HISTORY_MS:
        raise ValueError('comparison_history')
    if parts[4] == 'events':
        for key, maximum in (('page', 1000), ('pageSize', 100)):
            value = values.setdefault(key, '1' if key == 'page' else '100')
            if not value.isascii() or not value.isdecimal() or not 1 <= int(value) <= maximum:
                raise ValueError('pagination')
    return parsed.path + '?' + urllib.parse.urlencode(values)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def handler(upstream, key_path):
    opener = urllib.request.build_opener(NoRedirect)

    class QueryHandler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(QUERY_TIMEOUT_SECONDS)

        def log_message(self, *args):
            pass  # No URL, token, body or upstream exception enters collector logs.

        def respond(self, status, data):
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            try:
                path = read_path(self.command, self.path, int(time.time() * 1000))
            except (ValueError, OverflowError):
                self.respond(403, b'{"error":"query_not_allowed"}')
                return
            # Read on every request: local key replacement takes effect without restart.
            try:
                key = key_path.read_text().strip()
            except (OSError, UnicodeError):
                self.respond(503, b'{"error":"credentials_unavailable"}')
                return
            if not key.startswith('umami_') or not hmac.compare_digest(self.headers.get('Authorization', '').encode('utf-8'), ('Bearer ' + key).encode('utf-8')):
                self.respond(401, b'{"error":"unauthorized"}')
                return
            request = urllib.request.Request(upstream + path, headers={'Authorization': 'Bearer ' + key})
            try:
                with opener.open(request, timeout=QUERY_TIMEOUT_SECONDS) as response:
                    payload = response.read(RESPONSE_BYTES + 1)
                    if len(payload) > RESPONSE_BYTES:
                        raise ValueError('response_limit')
                    json.loads(payload)
                self.respond(200, payload)
            except urllib.error.HTTPError as error:
                status = 401 if error.code == 401 else 502
                error.close()
                self.respond(status, b'{"error":"upstream_unavailable"}')
            except (OSError, ValueError, http.client.HTTPException):
                self.respond(502, b'{"error":"upstream_unavailable"}')

        def deny(self):
            self.respond(403, b'{"error":"query_not_allowed"}')

        do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = deny

    return QueryHandler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file', type=pathlib.Path, required=True)
    args = parser.parse_args()
    # Deployment is fixed to the isolated service DNS, not an arbitrary user URL.
    server = http.server.HTTPServer(('0.0.0.0', 3001), handler('http://umami:3000', args.key_file))
    server.serve_forever()


if __name__ == '__main__':
    main()
