"""Native-only regression for the five checked-in Web quality-gated panels.

Caller supplies the already provisioned VictoriaMetrics binary and owns the outer
process group (scripts/owned-node.mjs). No download, Docker or external endpoint.
"""
import argparse
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]


def prove(binary):
    with tempfile.TemporaryDirectory(prefix='inside-web-query-proof-') as directory:
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        # Same group as the externally supervised proof, never a detached child.
        child = subprocess.Popen([str(binary), f'-httpListenAddr=127.0.0.1:{port}',
            f'-storageDataPath={directory}', '-retentionPeriod=90d',
            '-memory.allowedBytes=32MiB', '-search.latencyOffset=1ms', '-loggerLevel=WARN'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={**os.environ, 'GOMAXPROCS': '1', 'GOMEMLIMIT': '128MiB'})
        try:
            def request(path, payload=None):
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                try:
                    connection.request('POST' if payload is not None else 'GET', path, payload)
                    response = connection.getresponse()
                    body = response.read(65537)
                    if response.status not in (200, 204) or len(body) > 65536:
                        raise AssertionError('native_query_response')
                    return body
                finally:
                    connection.close()

            ready_deadline = time.monotonic() + 5
            while True:
                try:
                    request('/health')
                    break
                except OSError:
                    if time.monotonic() >= ready_deadline:
                        raise AssertionError('native_query_startup') from None
                    time.sleep(.02)
            panels = [panel for panel in json.loads((ROOT / 'infra/observability/production/overview.json').read_text())['panels']
                      if panel['title'].startswith('Web HTTP ') and
                      ('quality gated' in panel['title'] or 'fraction' in panel['title'])]
            assert len(panels) == 5
            # One actual wall-clock capture keeps all historical cohorts in retention.
            newest = int(time.time()) - 10
            cases = ('healthy', '58-samples', 'missing', '57-samples', 'failed-scrape', 'stale', 'reset', 'epoch-change',
                     '99-observations', 'new-500', 'new-404', 'new-200', 'new-500-single-sample', 'no-errors', 'old-500')
            results = []
            for case_index, case in enumerate(cases):
                end = newest - (len(cases) - case_index) * 600
                # Distinct fixed identities isolate cohorts without inventing a prior status sample.
                sha = hashlib.sha256(case.encode()).hexdigest()
                rows = []
                samples = {'missing': 0, '57-samples': 57, '58-samples': 58}.get(case, 60)
                for index in range(-1, samples) if samples else ():
                    at = end - 305 if index == -1 else end - (samples - 1 - index) * 5
                    source = ',source_sha="' + sha + '",service="platform-web",environment="test"'
                    base = 'job="platform-web-http",instance="web"'
                    route = ',route="/account",method="GET"'
                    count = index - 30 if case == 'reset' and index >= 30 else max(index, 0)
                    completed = count * 99 // 59 if case == '99-observations' else 100 + count * 10
                    if case == 'new-200':
                        completed = 1000
                    values = [
                        ('up', base, 0 if case == 'failed-scrape' and index == 30 else 1),
                        ('inside_web_http_observed_at_seconds', base + source, at - (11 if case == 'stale' else 0)),
                        ('inside_web_http_process_start_time_seconds', base + source, end - 3600 + (1 if case == 'epoch-change' and index >= 30 else 0)),
                    ]
                    if case != 'new-200' or index >= 58:
                        values.append(('inside_web_http_duration_seconds_count', base + source + route + ',code="200",outcome="completed"', completed))
                    for code in ('200', '404', '500'):
                        if case == 'no-errors' and code != '200':
                            continue
                        born = case == 'new-' + code or (case == 'new-500-single-sample' and code == '500')
                        if born and index < (59 if case == 'new-500-single-sample' else 58):
                            continue
                        value = 1000 if born or (case == 'old-500' and code == '500') else 100 + count * (10 if code == '200' else 1)
                        values.append(('inside_web_http_requests_total', base + source + route + f',code="{code}",outcome="completed"', value))
                    for bound, value in (('0.1', completed / 2), ('1', completed), ('+Inf', completed)):
                        if case != 'new-200' or index >= 58:
                            values.append(('inside_web_http_duration_seconds_bucket', base + source + route + f',code="200",outcome="completed",le="{bound}"', value))
                    rows.extend(f'{name}{{{labels}}} {value} {at * 1000}\n' for name, labels, value in values)
                if rows:
                    request('/api/v1/import/prometheus', ''.join(rows).encode())
                    request('/internal/force_flush')  # Fixture publication only, never a runtime freshness proof.
                observed = []
                for panel in panels:
                    payload = json.loads(request('/api/v1/query?' + urllib.parse.urlencode(
                        {'query': panel['query'], 'time': end, 'nocache': 1})))
                    assert payload['status'] == 'success'
                    vector = payload['data']['result']
                    quantile = 'quality gated' in panel['title']
                    expected = case in ('healthy', '58-samples', 'new-500', 'new-404', 'new-200', 'new-500-single-sample', 'no-errors', 'old-500') or (case == '99-observations' and not quantile)
                    if case == 'new-200' and quantile:
                        expected = False  # Latency keeps its conservative observation-history gate.
                    if bool(vector) != expected:
                        diagnostics = {}
                        for expression in ('count_over_time(up[5m])', 'min_over_time(up[5m])',
                            'increase(inside_web_http_duration_seconds_count[5m])',
                            'resets(inside_web_http_duration_seconds_count[5m])',
                            'changes(inside_web_http_process_start_time_seconds[5m])',
                            'count_over_time(inside_web_http_observed_at_seconds[5m])',
                            'time()-inside_web_http_observed_at_seconds',
                            'histogram_quantile(0.5,sum by(le,source_sha,route,method,code)(rate(inside_web_http_duration_seconds_bucket[5m])))'):
                            diagnostics[expression] = json.loads(request('/api/v1/query?' + urllib.parse.urlencode({'query':expression,'time':end,'nocache':1})))['data']['result']
                        raise AssertionError((case, panel['title'], vector, diagnostics))
                    if vector:
                        assert len(vector) == 1 and math.isfinite(float(vector[0]['value'][1]))
                        assert vector[0]['metric']['source_sha'] == sha
                        if not quantile:
                            error = '404' if '4xx' in panel['title'] else '500'
                            fraction = 1 / 12
                            if case in ('new-500', 'new-404', 'new-500-single-sample'):
                                born_code = '404' if case == 'new-404' else '500'
                                fraction = (1000 if error == born_code else 59) / 1649
                            elif case == 'new-200':
                                fraction = 59 / 1118
                            elif case == 'no-errors':
                                fraction = 0
                            elif case == 'old-500':
                                fraction = 0 if error == '500' else 1 / 11
                            assert math.isclose(float(vector[0]['value'][1]), fraction, rel_tol=1e-6), (case, panel['title'], vector, fraction)
                    observed.append({'panel': panel['title'], 'present': bool(vector)})
                results.append({'case': case, 'panels': observed})
            return results
        finally:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
            with socket.socket() as probe:
                probe.settimeout(1)
                assert probe.connect_ex(('127.0.0.1', port)) != 0, 'native_listener_leaked'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vm-binary', type=Path, required=True)
    arguments = parser.parse_args()
    assert arguments.vm_binary.is_absolute() and arguments.vm_binary.is_file()
    print(json.dumps(prove(arguments.vm_binary)))
