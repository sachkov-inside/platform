#!/usr/bin/env python3
"""Fixed read-only pilot query view. Does not start, stop or configure any service."""
import argparse
import contextlib
import math
import os
import stat
import signal
import threading
import json
import http.client
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import source_status as status

QUERY_DEADLINE_SECONDS = 10
QUERY_SERVER_TIMEOUT = '2s'
DEFAULT_QUERY_PORT = 18427


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        response.close()
        raise urllib.error.HTTPError(request.full_url, code, '', {}, None)


def query_plan(evaluated_at):
    collector_names = {'up'} | status.COLLECTOR_GAUGES | status.COLLECTOR_COUNTERS
    collector_names |= {name + '_total' for name in status.COLLECTOR_COUNTERS}
    trace_names = {'up'} | set(status.TRACE_COUNTERS)
    def selector(job, names):
        return '{job="' + job + '",instance="pilot",__name__=~"^(' + '|'.join(sorted(names)) + ')$"}'
    select = '(' + selector(status.SOURCES['collector'], collector_names) + ' or ' + selector(status.SOURCES['trace_store'], trace_names) + ')'
    stamps = 'timestamp(label_replace(' + select + ',"source_metric","$1","__name__","(.+)"))'
    return ['/metrics/api/v1/query?' + urllib.parse.urlencode({
        'query': expression, 'time': str(evaluated_at), 'timeout': QUERY_SERVER_TIMEOUT})
        for expression in (select, stamps)]


def valid_token(token):
    return (isinstance(token, str) and 0 < len(token) <= 256
            and all(character in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for character in token))


@contextlib.contextmanager
def _deadline(seconds):
    # This synchronous CLI owns no reader thread/process. SIGALRM also bounds a
    # server which trickles headers/body so a per-recv socket timeout never fires.
    # Refuse an existing alarm rather than stealing another owner's timer.
    if threading.current_thread() is not threading.main_thread() or signal.getitimer(signal.ITIMER_REAL) != (0, 0):
        raise ValueError()
    prior = signal.getsignal(signal.SIGALRM)
    def expired(*_):
        raise TimeoutError()
    signal.signal(signal.SIGALRM, expired)
    try:
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, prior)


def query(token, *, port=DEFAULT_QUERY_PORT, wall_clock=time.time,
          deadline_seconds=QUERY_DEADLINE_SECONDS):
    """Read two fixed vectors in one main-thread deadline. Only shorter test budgets are allowed."""
    if not valid_token(token) or type(port) is not int or not 1 <= port <= 65535:
        return status.unavailable('credentials')
    if (type(deadline_seconds) not in (int, float) or not math.isfinite(deadline_seconds)
            or not 0 < deadline_seconds <= QUERY_DEADLINE_SECONDS):
        return status.unavailable('transport_error')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        started = time.monotonic()
        with _deadline(deadline_seconds):
            wall_started = wall_clock()
            if (type(wall_started) not in (int, float) or not 0 <= wall_started <= status.MAX_SAFE_NUMBER
                    or not math.isfinite(wall_started)):
                raise ValueError()
            # Whole-second query evaluation avoids assuming subsecond precision
            # in the pinned instant-query wire timestamp. Age still uses completion.
            evaluated_at = math.floor(wall_started)
            bodies = []
            for path in query_plan(evaluated_at):
                remaining = deadline_seconds - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError()
                request = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
                                                 headers={'Authorization': 'Bearer ' + token}, method='GET')
                with opener.open(request, timeout=remaining) as response:
                    if response.status != 200:
                        return status.unavailable('http_error')
                    lengths = response.headers.get_all('Content-Length', [])
                    if (len(lengths) > 1 or (lengths and response.headers.get('Transfer-Encoding'))
                            or (lengths and (len(lengths[0]) > 10 or not lengths[0].isascii() or not lengths[0].isdigit()))):
                        raise ValueError()
                    body = response.read(status.MAX_BODY_BYTES + 1)
                    if lengths and len(body) != int(lengths[0]) and len(body) <= status.MAX_BODY_BYTES:
                        raise ValueError()
                    if len(body) > status.MAX_BODY_BYTES:
                        return status.malformed()
                    bodies.append(body)
            completed_at = wall_clock()
            if completed_at < wall_started:
                return status.malformed()
            result = status.evaluate(*bodies, evaluated_at=evaluated_at, completed_at=completed_at)
            duration = time.monotonic() - started
            if duration >= deadline_seconds:
                raise TimeoutError()
            result['query']['duration_seconds'] = duration
            if len(json.dumps(result).encode()) > status.MAX_OUTPUT_BYTES:
                return status.malformed()
            return result
    except TimeoutError:
        return status.unavailable('timeout')
    except KeyboardInterrupt:
        return status.unavailable('interrupted')
    except urllib.error.HTTPError as error:
        error.close()
        return status.unavailable('http_error')
    except urllib.error.URLError as error:
        return status.unavailable('timeout' if isinstance(error.reason, TimeoutError) else 'transport_error')
    except (OSError, ValueError, http.client.HTTPException):
        return status.unavailable('transport_error')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='Owned pilot output containing auth.json')
    parser.add_argument('--port', default=DEFAULT_QUERY_PORT, type=int)
    args = parser.parse_args(argv)
    try:
        def private_reader(path, flags):
            return os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK)
        with open(args.output / 'auth.json', 'rb', opener=private_reader) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > status.MAX_BODY_BYTES:
                raise ValueError()
            credentials = status.decode_json(stream.read(status.MAX_BODY_BYTES + 1))
        token = credentials['users'][0]['bearer_token']
        report = query(token, port=args.port)
    except KeyboardInterrupt:
        report = status.unavailable('interrupted')
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        report = status.unavailable('credentials')
    print(json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False))
    return 0 if all(source['state'] == 'fresh_up' for source in report['sources'].values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
