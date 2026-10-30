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
    collector = selector(status.SOURCES['collector'], collector_names)
    trace_store = selector(status.SOURCES['trace_store'], trace_names)
    select = '(' + collector + ' or ' + trace_store + ')'
    # Raw rollups disagree on stale-marker membership: keep only timestamp rows
    # whose complete metric identity is still present in the current value vector.
    # timestamp_with_name must receive the raw selector before this intersection.
    identity = '__name__,job,instance,receiver,exporter,data_type,format,path,type,reason'
    def current_stamps(raw):
        return '(timestamp_with_name(' + raw + ') and on(' + identity + ') ' + raw + ' keep_metric_names)'
    stamps = ('label_replace((' + current_stamps(collector) + ' or ' + current_stamps(trace_store) +
              '),"source_metric","$1","__name__","(.+)")')
    return ['/metrics/api/v1/query?' + urllib.parse.urlencode({
        'query': expression, 'time': str(evaluated_at), 'timeout': QUERY_SERVER_TIMEOUT, 'nocache': '1'})
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


def _query(token, *, port=DEFAULT_QUERY_PORT, wall_clock=time.time,
          deadline_seconds=QUERY_DEADLINE_SECONDS):
    """Read two fixed vectors in one main-thread deadline. Only shorter test budgets are allowed."""
    if not valid_token(token) or type(port) is not int or not 1 <= port <= 65535:
        return status.unavailable('credentials'), None
    if (type(deadline_seconds) not in (int, float) or not math.isfinite(deadline_seconds)
            or not 0 < deadline_seconds <= QUERY_DEADLINE_SECONDS):
        return status.unavailable('transport_error'), None
    detail = None
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
                        return status.unavailable('http_error'), None
                    lengths = response.headers.get_all('Content-Length', [])
                    if (len(lengths) > 1 or (lengths and response.headers.get('Transfer-Encoding'))
                            or (lengths and (len(lengths[0]) > 10 or not lengths[0].isascii() or not lengths[0].isdigit()))):
                        raise ValueError()
                    body = response.read(status.MAX_BODY_BYTES + 1)
                    if lengths and len(body) != int(lengths[0]) and len(body) <= status.MAX_BODY_BYTES:
                        raise ValueError()
                    if len(body) > status.MAX_BODY_BYTES:
                        detail = {'context': 'current', 'slot': 'values' if not bodies else 'timestamps',
                                  'code': 'decode', 'values_bytes': None, 'timestamps_bytes': None,
                                  'rows': None, 'difference': None}
                        return status.malformed(), detail
                    bodies.append(body)
            result, detail = status._evaluate(*bodies, evaluated_at=evaluated_at, completed_at=wall_started,
                                     completion_clock=wall_clock)
            duration = time.monotonic() - started
            if duration >= deadline_seconds:
                raise TimeoutError()
            result['query']['duration_seconds'] = duration
            if len(json.dumps(result).encode()) > status.MAX_OUTPUT_BYTES:
                if detail is None:
                    detail = {'context': 'current', 'slot': 'output', 'code': 'output_cap',
                              'values_bytes': len(bodies[0]), 'timestamps_bytes': len(bodies[1]),
                              'rows': None, 'difference': None}
                return status.malformed(), detail
            return result, detail
    except TimeoutError:
        return status.unavailable('timeout'), None
    except KeyboardInterrupt:
        return status.unavailable('interrupted'), None
    except urllib.error.HTTPError as error:
        error.close()
        return status.unavailable('http_error'), None
    except urllib.error.URLError as error:
        return status.unavailable('timeout' if isinstance(error.reason, TimeoutError) else 'transport_error'), None
    except (OSError, ValueError, http.client.HTTPException):
        return status.unavailable('transport_error'), None


def query(token, *, port=DEFAULT_QUERY_PORT, wall_clock=time.time,
          deadline_seconds=QUERY_DEADLINE_SECONDS):
    """Read the fixed pair without exposing private rejection diagnostics."""
    return _query(token, port=port, wall_clock=wall_clock, deadline_seconds=deadline_seconds)[0]


def _read_private_credentials(output):
    # Anchor every directory component rather than following a mutable pathname
    # to auth.json. Only the explicitly named canonical owned output is accepted.
    if (not output.is_absolute() or len(output.parts) > 64
            or output != output.resolve(strict=True)):
        raise ValueError()
    uid = os.getuid()
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    with contextlib.ExitStack() as descriptors:
        directory = os.open(output.anchor, directory_flags)
        descriptors.callback(os.close, directory)
        for component in output.parts[1:]:
            directory = os.open(component, directory_flags, dir_fd=directory)
            descriptors.callback(os.close, directory)
        owner = os.fstat(directory)
        if not stat.S_ISDIR(owner.st_mode) or owner.st_uid != uid or stat.S_IMODE(owner.st_mode) != 0o700:
            raise ValueError()
        def private_reader(_path, flags):
            return os.open('auth.json', flags | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                           dir_fd=directory)
        with open(output / 'auth.json', 'rb', opener=private_reader) as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1 or info.st_size > status.MAX_BODY_BYTES):
                raise ValueError()
            credentials = status.decode_json(stream.read(status.MAX_BODY_BYTES + 1))
            final = os.fstat(stream.fileno())
            linked = os.stat('auth.json', dir_fd=directory, follow_symlinks=False)
            def identity(value):
                return (value.st_dev, value.st_ino, value.st_uid, value.st_mode, value.st_nlink,
                        value.st_size, value.st_mtime_ns, value.st_ctime_ns)
            if identity(info) != identity(final) or identity(final) != identity(linked):
                raise ValueError()
        linked_directory = os.stat(output, follow_symlinks=False)
        final_owner = os.fstat(directory)
        if (output != output.resolve(strict=True)
                or (owner.st_dev, owner.st_ino, owner.st_uid, owner.st_mode)
                != (final_owner.st_dev, final_owner.st_ino, final_owner.st_uid, final_owner.st_mode)
                or (owner.st_dev, owner.st_ino, owner.st_uid, owner.st_mode)
                != (linked_directory.st_dev, linked_directory.st_ino, linked_directory.st_uid, linked_directory.st_mode)):
            raise ValueError()
        if (not isinstance(credentials, dict) or not isinstance(credentials.get('users'), list)
                or len(credentials['users']) != 1 or not isinstance(credentials['users'][0], dict)):
            raise ValueError()
        token = credentials['users'][0]['bearer_token']
        if not valid_token(token):
            raise ValueError()
        return token, _directory_identity(owner)


def _read_private_token(output):
    return _read_private_credentials(output)[0]


def _directory_identity(info):
    return info.st_dev, info.st_ino, info.st_uid, info.st_mode


@contextlib.contextmanager
def _owned_directory(output, expected=None):
    if (not output.is_absolute() or len(output.parts) > 64
            or output != output.resolve(strict=True)):
        raise ValueError()
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    with contextlib.ExitStack() as stack:
        directory = os.open(output.anchor, flags)
        stack.callback(os.close, directory)
        for component in output.parts[1:]:
            directory = os.open(component, flags, dir_fd=directory)
            stack.callback(os.close, directory)
        owner = os.fstat(directory)
        identity = _directory_identity(owner)
        if (not stat.S_ISDIR(owner.st_mode) or owner.st_uid != os.getuid()
                or stat.S_IMODE(owner.st_mode) != 0o700
                or expected is not None and identity != expected):
            raise ValueError()
        _check_directory(output, directory, identity)
        yield directory, identity
        _check_directory(output, directory, identity)


def _check_directory(output, directory, identity):
    if (output != output.resolve(strict=True)
            or _directory_identity(os.fstat(directory)) != identity
            or _directory_identity(output.stat(follow_symlinks=False)) != identity):
        raise ValueError()


def _file_identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _anchored_json(directory, name, limit, *, private=False):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                         dir_fd=directory)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or info.st_size > limit or private and stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError()
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError()
        final = os.fstat(stream.fileno())
        linked = os.stat(name, dir_fd=directory, follow_symlinks=False)
        if _file_identity(info) != _file_identity(final) or _file_identity(final) != _file_identity(linked):
            raise ValueError()
    return status.decode_json(raw)


def _diagnostic_anchor(output, expected=None):
    with _owned_directory(output, expected) as (directory, identity):
        evidence = _anchored_json(directory, 'evidence.json', status.MAX_BODY_BYTES)
        if (type(evidence) is not dict
                or evidence.get('scope') != 'synthetic OTLP core compatibility smoke only'):
            raise ValueError()
        source = evidence.get('source')
        # Validate the source without accepting any caller-selected diagnostic fields.
        status.rejection({'context': 'current', 'slot': 'internal', 'code': 'internal_shape',
                          **dict.fromkeys(status.REJECTION_COUNTS)}, source)
        return identity, source


def _read_rejection(output, source, expected=None):
    with _owned_directory(output, expected) as (directory, _):
        evidence = _anchored_json(directory, 'evidence.json', status.MAX_BODY_BYTES)
        if (type(evidence) is not dict or evidence.get('source') != source
                or evidence.get('scope') != 'synthetic OTLP core compatibility smoke only'):
            raise ValueError()
        value = _anchored_json(directory, status.REJECTION_NAME, status.REJECTION_MAX_BYTES, private=True)
        return status.validate_rejection(value, source)


def _publish_rejection(output, anchor, detail):
    identity, source = anchor
    value = status.rejection(detail, source)
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
    if len(raw) > status.REJECTION_MAX_BYTES:
        raise ValueError()
    temporary = '.source-status-rejection.new'
    with _owned_directory(output, identity) as (directory, _):
        evidence = _anchored_json(directory, 'evidence.json', status.MAX_BODY_BYTES)
        if (type(evidence) is not dict or evidence.get('source') != source
                or evidence.get('scope') != 'synthetic OTLP core compatibility smoke only'):
            raise ValueError()
        # First refusal wins for this run. Never overwrite a stale or unsafe file.
        try:
            old = _anchored_json(directory, status.REJECTION_NAME, status.REJECTION_MAX_BYTES, private=True)
        except FileNotFoundError:
            pass
        else:
            status.validate_rejection(old, source)
            return
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=directory)
        # Hold the inode through cleanup so a replacement cannot reuse its identity.
        with os.fdopen(descriptor, 'wb') as stream:
            created = None
            try:
                created = os.fstat(stream.fileno())
                if (not stat.S_ISREG(created.st_mode) or created.st_uid != os.getuid()
                        or stat.S_IMODE(created.st_mode) != 0o600 or created.st_nlink != 1):
                    raise ValueError()
                stream.write(raw)
                stream.flush()
                final = os.fstat(stream.fileno())
                linked = os.stat(temporary, dir_fd=directory, follow_symlinks=False)
                if _file_identity(final) != _file_identity(linked):
                    raise ValueError()
                _check_directory(output, directory, identity)
                # link publishes complete bytes atomically without replacing a competing first failure.
                os.link(temporary, status.REJECTION_NAME, src_dir_fd=directory, dst_dir_fd=directory,
                        follow_symlinks=False)
                published = os.stat(status.REJECTION_NAME, dir_fd=directory, follow_symlinks=False)
                if ((published.st_dev, published.st_ino, published.st_uid, published.st_mode,
                     published.st_nlink, published.st_size, published.st_mtime_ns)
                        != (created.st_dev, created.st_ino, created.st_uid, created.st_mode,
                            2, len(raw), final.st_mtime_ns)):
                    current = os.stat(status.REJECTION_NAME, dir_fd=directory, follow_symlinks=False)
                    if _file_identity(current) == _file_identity(published):
                        os.unlink(status.REJECTION_NAME, dir_fd=directory)
                    raise ValueError()
            finally:
                if created is not None:
                    linked = os.stat(temporary, dir_fd=directory, follow_symlinks=False)
                    if (linked.st_dev, linked.st_ino) == (created.st_dev, created.st_ino):
                        os.unlink(temporary, dir_fd=directory)
        stored = _anchored_json(directory, status.REJECTION_NAME, status.REJECTION_MAX_BYTES, private=True)
        if status.validate_rejection(stored, source) != value:
            raise ValueError()


def read_report(output, *, port=DEFAULT_QUERY_PORT, wall_clock=time.time,
                deadline_seconds=QUERY_DEADLINE_SECONDS):
    """Read current private credentials on every acquisition, including after rotation."""
    try:
        token, credential_identity = _read_private_credentials(output)
        anchor = None
        try:
            anchor = _diagnostic_anchor(output, credential_identity)
        except BaseException:
            pass
        report, detail = _query(token, port=port, wall_clock=wall_clock, deadline_seconds=deadline_seconds)
        if anchor is not None and detail is not None:
            try:
                _publish_rejection(output, anchor, detail)
            except BaseException:
                pass  # Diagnostic refusal cannot replace the original query result.
        return report
    except KeyboardInterrupt:
        return status.unavailable('interrupted')
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        return status.unavailable('credentials')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='Canonical absolute owned pilot output (0700), containing private auth.json (0600)')
    parser.add_argument('--port', default=DEFAULT_QUERY_PORT, type=int)
    args = parser.parse_args(argv)
    report = read_report(args.output, port=args.port)
    print(json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False))
    return 0 if all(source['state'] == 'fresh_up' for source in report['sources'].values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
