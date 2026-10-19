"""Disposable compatibility pilot for #1566. Python standard library only."""

import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import resource
import secrets
import select
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import orbstack
import daemon
import collector_privacy
from storage_policy import admission as check_disk, assert_budget

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "infra/observability/pilot"
SERVICES = ("metrics", "logs", "traces", "alloy", "vmauth", "gateway", "grafana")
FROZEN_DOCKER_ENDPOINT = None
FROZEN_DOCKER_IDENTITY = None
COMMAND_TIMEOUT_SECONDS = 60
ACQUISITION_TIMEOUT_SECONDS = 240
CLEANUP_TIMEOUT_SECONDS = 90
PILOT_DEADLINE_SECONDS = 600
QUERY_TIMEOUT_SECONDS = 10
FACT_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = .25
ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS = 30
MCP_RESPONSE_TIMEOUT_SECONDS = 15
WORKER_SHUTDOWN_SECONDS = 2
MONITOR_SHUTDOWN_SECONDS = 1
COMPRESSED_ASSET_MEMORY_BUDGET_BYTES = 128 * 1024**2
PLUGIN_UNPACKED_BUDGET_BYTES = 256 * 1024**2


def compose_plan(source, output, images, *, credential_owner):
    """Only loopback fixture ingress, query ingress and human Grafana are published."""
    services = {}
    budgets = {"metrics": (768, .4), "logs": (768, .4), "traces": (768, .4),
               "alloy": (512, .25), "vmauth": (128, .1), "gateway": (128, .1), "grafana": (512, .25)}
    for name in SERVICES:
        memory, cpus = budgets[name]
        services[name] = {"image": images[name], "mem_limit": f"{memory}m", "cpus": cpus,
            "pids_limit": 128, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
            "read_only": True, "tmpfs": ["/tmp:size=16777216"], "networks": ["pilot"],
            "logging": {"driver": "json-file", "options": {"max-size": "5m", "max-file": "1"}}}
    for name, retention in [("metrics", "90d"), ("logs", "14d"), ("traces", "14d")]:
        services[name].update({"command": ["-storageDataPath=/data", f"-retentionPeriod={retention}",
            "-memory.allowedBytes=256MiB"], "volumes": [f"{name}:/data"]})
    services["metrics"]["command"] += ["-search.maxQueryDuration=8s", "-search.maxConcurrentRequests=2"]
    for name in ("logs", "traces"):
        services[name]["command"] += ["-search.maxQueryDuration=8s", "-search.maxConcurrentRequests=2"]
    services["alloy"].update({"command": ["run", "/etc/alloy/config.alloy", "--storage.path=/tmp/alloy"],
        "logging": {"driver":"none"},
        "ports": ["127.0.0.1:14318:4318"],
        "volumes": [f"{source / 'config.alloy'}:/etc/alloy/config.alloy:ro"]})
    # The private auth bind mount is mode 0600; its owner can read it without DAC_OVERRIDE.
    services["vmauth"].update({"user": f"{credential_owner[0]}:{credential_owner[1]}",
        "command": ["-auth.config=/config/auth.json", "-maxConcurrentRequests=4",
        "-maxConcurrentPerUserRequests=2", "-maxQueueDuration=1s", "-httpListenAddr=:8427"],
        "volumes": [f"{output / 'auth.json'}:/config/auth.json:ro"]})
    # The pinned vendor binary has effective NET_BIND_SERVICE file capability; dropping it prevents exec.
    services["gateway"].update({"cap_add": ["NET_BIND_SERVICE"], "ports": ["127.0.0.1:18427:8080"],
        "volumes": [f"{source / 'Caddyfile'}:/etc/caddy/Caddyfile:ro"],
        "environment": {"XDG_CONFIG_HOME": "/tmp/config", "XDG_DATA_HOME": "/tmp/data"}})
    services["grafana"].update({"ports": ["127.0.0.1:13000:3000"],
        "volumes": ["grafana:/var/lib/grafana", f"{output / 'plugins'}:/var/lib/grafana/plugins:ro",
                    f"{output / 'datasources.json'}:/etc/grafana/provisioning/datasources/pilot.yaml:ro"],
        "environment": {"GF_AUTH_ANONYMOUS_ENABLED": "true", "GF_AUTH_ANONYMOUS_ORG_ROLE": "Viewer",
            "GF_AUTH_DISABLE_LOGIN_FORM": "true", "GF_AUTH_BASIC_ENABLED": "false",
            "GF_SECURITY_DISABLE_INITIAL_ADMIN_CREATION": "true", "GF_ANALYTICS_REPORTING_ENABLED": "false",
            "GF_ANALYTICS_CHECK_FOR_UPDATES": "false", "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES": "false"}})
    # Internal-only networking omitted host port mappings in the component probe. Keep storage/auth isolated.
    for service in services.values():
        if "ports" in service:
            service["networks"].append("ingress")
    return {"services": services, "volumes": {name: {} for name in ("metrics", "logs", "traces", "grafana")},
            "networks": {"pilot": {"internal": True}, "ingress": {"driver": "bridge", "internal": False}}}


def attribute(key, value):
    return {"key": key, "value": {"stringValue": value}}


def corpus(*, now_ns, sequence):
    """Synthetic protocol corpus, not proof of application SDK propagation."""
    trace_id = f"{sequence + 1:032x}"
    resource = {"attributes": [attribute("service.name", "platform-pilot"),
        attribute("deployment.environment.name", "isolated-pilot"),
        attribute("service.version", "a" * 40)]}
    names = ["HTTP GET /pilot", "queue.publish", "worker.attempt", "worker.retry", "dependency.http"]
    spans = []
    for index, name in enumerate(names):
        span = {"traceId": trace_id, "spanId": f"{index + 1:016x}", "name": name,
            "kind": 1, "startTimeUnixNano": str(now_ns + index * 1_000_000),
            "endTimeUnixNano": str(now_ns + (index + 1) * 1_000_000),
            "attributes": [attribute("http.route", "/pilot")],
            "status": {"code": 2 if index == 2 else 1}}
        if index:
            span["parentSpanId"] = f"{index:016x}"
        spans.append(span)
    return collector_privacy.challenge({
        "traces": {"resourceSpans": [{"resource": resource, "scopeSpans": [{"spans": spans}]}]},
        "logs": {"resourceLogs": [{"resource": resource, "scopeLogs": [{"logRecords": [{
            "timeUnixNano": str(now_ns), "observedTimeUnixNano": str(now_ns),
            "severityNumber": 17, "severityText": "ERROR", "body": {"stringValue": "pilot.known_failure"},
            "traceId": trace_id, "spanId": "0000000000000003",
        }]}]}]},
        "metrics": {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"metrics": [{
            "name": "pilot_requests", "gauge": {"dataPoints": [{
                "timeUnixNano": str(now_ns), "asInt": str(sequence + 1),
                "attributes": [attribute("http.route", "/pilot")],
            }]},
        }]}]}]},
    })


@contextmanager
def disk_budget(path):
    """Bound no-build pilot growth on the identified Docker storage filesystem."""
    initial = shutil.disk_usage(path).free
    stop = threading.Event()
    previous = signal.getsignal(signal.SIGUSR1)

    def exceeded(_signum, _frame):
        raise RuntimeError("pilot disk budget exceeded; stopping owned resources")

    def monitor():
        while not stop.wait(POLL_INTERVAL_SECONDS):
            try:
                free = shutil.disk_usage(path).free
                assert_budget(initial, free)
                continue
            except (OSError, RuntimeError):
                pass
            os.kill(os.getpid(), signal.SIGUSR1)
            break

    signal.signal(signal.SIGUSR1, exceeded)
    worker = threading.Thread(target=monitor, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=MONITOR_SHUTDOWN_SECONDS)
        signal.signal(signal.SIGUSR1, previous)


def downloaded_asset(asset):
    size = asset.get("size_bytes")
    if type(size) is not int or not 0 < size <= COMPRESSED_ASSET_MEMORY_BUDGET_BYTES:
        raise RuntimeError("pinned archive has invalid size metadata")
    with urllib.request.urlopen(asset["url"], timeout=ARCHIVE_DOWNLOAD_TIMEOUT_SECONDS) as response:
        archive = response.read(size + 1)
    if len(archive) != size or "sha256:" + hashlib.sha256(archive).hexdigest() != asset["digest"]:
        raise RuntimeError("pinned archive failed size/digest check")
    return archive


def stdio_probe(executable, environment, tool, arguments, marker, *, argv=None, validate_result=None):
    """Exercise native MCP, keeping stderr and credentials out of diagnostics."""
    # Stay in the owned worker group so its external supervisor also catches a killed worker.
    process = subprocess.Popen(argv or [str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, env=environment)
    buffered = b""

    def rpc(identifier, method, params):
        nonlocal buffered
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        if identifier is not None:
            message["id"] = identifier
        process.stdin.write((json.dumps(message) + "\n").encode())
        process.stdin.flush()
        if identifier is None:
            return None
        deadline = time.monotonic() + MCP_RESPONSE_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            while b"\n" in buffered:
                line, buffered = buffered.split(b"\n", 1)
                response = json.loads(line)
                if not isinstance(response, dict):
                    raise RuntimeError("MCP response must be an object")
                if response.get("id") == identifier:
                    if "error" in response:
                        raise RuntimeError("native MCP rejected request")
                    return response.get("result")
            readable, _, _ = select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))
            if readable:
                chunk = os.read(process.stdout.fileno(), 65_536)
                if not chunk:
                    raise RuntimeError("native MCP exited before response")
                buffered += chunk
                if len(buffered) > 1_048_576:
                    raise RuntimeError("native MCP response exceeds pilot budget")
        raise RuntimeError("native MCP response deadline exceeded")

    try:
        rpc(1, "initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                             "clientInfo": {"name": "platform-pilot", "version": "1"}})
        rpc(None, "notifications/initialized", {})
        discovery = rpc(2, "tools/list", {})
        if not isinstance(discovery, dict) or not isinstance(discovery.get("tools"), list):
            raise RuntimeError("native MCP tool discovery failed")
        names = [entry.get("name") for entry in discovery["tools"] if isinstance(entry, dict)]
        if tool not in names:
            raise RuntimeError("required native MCP query tool unavailable")
        result = rpc(3, "tools/call", {"name": tool, "arguments": arguments})
        if not isinstance(result, dict) or result.get("isError") or marker not in json.dumps(result):
            raise RuntimeError("native MCP failed to return known fixture")
        if validate_result is not None:
            validate_result(result)
        collector_privacy.assert_clean(result)
        return {"discovered_tools": names, "query": tool, "known_fixture": "passed"}
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=WORKER_SHUTDOWN_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=WORKER_SHUTDOWN_SECONDS)
        process.stdout.close()


def native_probes(token, output):
    system = platform.system()
    if system not in ("Darwin", "Linux") or platform.machine() not in ("arm64", "aarch64", "x86_64"):
        raise RuntimeError("native MCP pilot supports Darwin/Linux arm64/x86_64 only")
    architecture = "arm64" if platform.machine() in ("arm64", "aarch64") else "x86_64"
    lock = json.loads((CONFIG / "inputs.lock.json").read_text())
    probes = [
        ("mcp-victoriametrics", "metrics", "VM", "query", {"query": "pilot_requests"}, "pilot_requests"),
        ("mcp-victorialogs", "logs", "VL", "query", {"query": "_time:5m", "start": "0", "limit": 10}, "pilot.known_failure"),
        ("mcp-victoriatraces", "traces", "VT", "trace", {"trace_id": "00000000000000000000000000000001"}, "worker.retry"),
    ]
    results = {}
    for name, route, prefix, tool, arguments, marker in probes:
        asset = next(item for item in lock["artifacts"][name]["assets"]
                     if item["name"] == f"{name}_{system}_{architecture}.tar.gz")
        executable = output / name
        with tarfile.open(fileobj=io.BytesIO(downloaded_asset(asset)), mode="r:gz") as archive:
            entry = next(item for item in archive.getmembers() if Path(item.name).name == name and item.isfile())
            if entry.size > 256 * 1024 * 1024:
                raise RuntimeError("MCP executable exceeds unpacked pilot budget")
            with archive.extractfile(entry) as source, executable.open("wb") as target:
                shutil.copyfileobj(source, target)
        executable.chmod(0o700)
        environment = {"PATH": os.environ.get("PATH", ""), "HOME": str(output), "MCP_SERVER_MODE": "stdio",
                       f"{prefix}_INSTANCE_ENTRYPOINT": f"http://127.0.0.1:18427/{route}",
                       f"{prefix}_INSTANCE_BEARER_TOKEN": token, "VM_INSTANCE_TYPE": "single"}
        before = resource.getrusage(resource.RUSAGE_CHILDREN) if system == 'Linux' else None
        results[name] = stdio_probe(executable, environment, tool, arguments, marker)
        if system == 'Linux':
            after = resource.getrusage(resource.RUSAGE_CHILDREN)
            results[name]['cpu_seconds'] = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
        else:
            results[name]['cpu_seconds'] = None
            results[name]['cpu_measurement'] = 'unavailable: concurrent verification subprocesses; per-MCP measurement pending'
        results[name]["host_os"] = system
        executable.unlink()
    return results


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def auth_config(token):
    routes = json.loads((CONFIG / "vmauth.routes.json").read_text())
    return {"users": [{"bearer_token": token, "max_concurrent_requests": 2, "url_map": [
        {"src_paths": [f"/{name}{path}" for path in route["paths"]],
         "drop_src_path_prefix_parts": 1, "url_prefix": route["backend"]}
        for name, route in routes.items()
    ]}]}


def prepare(output):
    output.mkdir(parents=True, exist_ok=False)
    os.chmod(output, 0o700)
    lock = json.loads((CONFIG / "inputs.lock.json").read_text())
    token = secrets.token_urlsafe(32)
    write_json(output / "auth.json", auth_config(token))
    os.chmod(output / "auth.json", 0o600)
    auth_owner = (output / "auth.json").stat()
    write_json(output / "compose.json", compose_plan(CONFIG, output, lock["images"],
        credential_owner=(auth_owner.st_uid, auth_owner.st_gid)))
    datasources = [
        {"name": "Pilot metrics", "uid": "pilot-metrics", "type": "prometheus",
         "url": "http://gateway:8080/metrics", "access": "proxy", "editable": False},
        {"name": "Pilot logs", "uid": "pilot-logs", "type": "victoriametrics-logs-datasource",
         "url": "http://gateway:8080/logs", "access": "proxy", "editable": False},
        {"name": "Pilot traces", "uid": "pilot-traces", "type": "jaeger",
         "url": "http://gateway:8080/traces/select/jaeger", "access": "proxy", "editable": False},
    ]
    for datasource in datasources:
        datasource["jsonData"] = {"httpHeaderName1": "Authorization"}
        datasource["secureJsonData"] = {"httpHeaderValue1": "Bearer " + token}
    write_json(output / "datasources.json", {"apiVersion": 1, "datasources": datasources})
    (output / "plugins").mkdir()
    return token


def docker_args(args):
    if args and args[0] == 'docker' and FROZEN_DOCKER_ENDPOINT and '--context' not in args and args[1:2] != ['context']:
        return ['docker', '--host', FROZEN_DOCKER_ENDPOINT, *args[1:]]
    return args


def _raw_command(args, *, timeout=COMMAND_TIMEOUT_SECONDS):
    # The repository heavy-check supervisor owns the foreground CLI process tree.
    return subprocess.run(docker_args(args), check=True, capture_output=True, text=True, timeout=timeout).stdout


def assert_docker_identity():
    if FROZEN_DOCKER_IDENTITY is not None:
        read = lambda args: _raw_command(args, timeout=orbstack.IDENTITY_COMMAND_TIMEOUT_SECONDS)
        current = daemon.identify(read) if FROZEN_DOCKER_IDENTITY.get('platform') == 'linux' else orbstack.identify(read, home=Path.home())
        if current != FROZEN_DOCKER_IDENTITY:
            raise RuntimeError('Docker identity changed; mutations refused, manual owner recovery required')


def command(args, *, timeout=COMMAND_TIMEOUT_SECONDS):
    if args and args[0] == 'docker' and any(verb in args for verb in ('pull','up','down','restart')):
        assert_docker_identity()
    return _raw_command(args, timeout=timeout)


def request(path, *, token=None, body=None, method="GET", port=18427):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=QUERY_TIMEOUT_SECONDS) as response:
            payload = response.read(1_048_577)
            if len(payload) > 1_048_576:
                raise RuntimeError("query exceeded the 1 MiB pilot response budget")
            return response.status, payload.decode()
    except urllib.error.HTTPError as error:
        # Never persist error bodies: collectors/proxies can echo request data.
        status = error.code
        error.close()
        return status, ""


def await_fact(read, predicate, *, budget=FACT_TIMEOUT_SECONDS, probe=None, output=None):
    deadline = time.monotonic() + budget
    diagnostic = {"probe": probe, "attempts": 0, "outcome": "failed",
                  "last_http_status": None, "last_transport_error_type": None}
    try:
        while time.monotonic() < deadline:
            diagnostic["attempts"] += 1
            try:
                last = read()
                if isinstance(last, tuple) and last and type(last[0]) is int:
                    diagnostic["last_http_status"] = last[0]
                diagnostic["last_transport_error_type"] = None
                if predicate(last):
                    diagnostic["outcome"] = "passed"
                    return last
            except (OSError, urllib.error.URLError) as error:
                diagnostic["last_http_status"] = None
                diagnostic["last_transport_error_type"] = type(error).__name__
            # Real network compatibility probe; this pause bounds poll load, not success.
            time.sleep(POLL_INTERVAL_SECONDS)
        diagnostic["outcome"] = "timed_out"
        raise RuntimeError(f"pilot fact {probe or 'unlabelled'} did not become visible before deadline")
    finally:
        if probe is not None and output is not None:
            destination = output / "readiness.json"
            previous = json.loads(destination.read_text()) if destination.exists() else []
            write_json(destination, [*previous, diagnostic])


def install_plugin(output):
    lock = json.loads((CONFIG / "inputs.lock.json").read_text())
    asset = lock["artifacts"]["victorialogs-datasource"]["assets"][0]
    unpacked_size = asset.get("unpacked_size_bytes")
    if type(unpacked_size) is not int or not 0 < unpacked_size <= PLUGIN_UNPACKED_BUDGET_BYTES:
        raise RuntimeError("pinned plugin unpacked size metadata exceeds pilot budget")
    archive = downloaded_asset(asset)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        if sum(info.file_size for info in zipped.infolist()) != unpacked_size:
            raise RuntimeError("plugin unpacked size differs from pinned metadata")
        for info in zipped.infolist():
            destination = (output / "plugins" / info.filename).resolve()
            if not destination.is_relative_to((output / "plugins").resolve()):
                raise RuntimeError("unsafe plugin archive path")
        zipped.extractall(output / "plugins")
    for path in (output / "plugins").rglob("*"):
        if path.is_file() and "backend" in path.name:
            path.chmod(0o755)


def await_otlp_ready(*, port=14318, output=None, probe="alloy_otlp"):
    return await_fact(lambda: request("/v1/traces", body={"resourceSpans": []}, method="POST", port=port),
                      lambda response: response[0] == 200, probe=probe, output=output)


def await_stored_trace(token, trace_id, *, port=18427, output=None):
    return await_fact(lambda: request("/traces/select/jaeger/api/traces/" + trace_id, token=token, port=port),
                      lambda response: response[0] == 200 and "worker.retry" in response[1],
                      probe="restarted_stored_trace", output=output)


def smoke(token, output, compose):
    query = "/metrics/api/v1/query?" + urllib.parse.urlencode({"query": "1"})
    await_fact(lambda: request(query, token=token), lambda response: response[0] == 200,
               probe="metrics_query", output=output)
    failures = []
    for prefix, path in [
        ("metrics", "/api/v1/import"), ("metrics", "/api/v1/admin/tsdb/delete_series"),
        ("metrics", "/-/reload"), ("metrics", "/snapshot/create"),
        ("logs", "/insert/jsonline"), ("logs", "/internal/force_merge"),
        ("traces", "/insert/opentelemetry/v1/traces"), ("traces", "/internal/force_merge"),
        ("", "/-/reload"), ("", "/metrics"), ("", "/api/admin"),
        ("metrics", "/api/v1/query/../../admin/tsdb/delete_series"),
        ("metrics", "/api/v1/query/%2e%2e/%2e%2e/admin/tsdb/delete_series"),
        ("logs", "//insert/jsonline"), ("traces", "/%69nsert/opentelemetry/v1/traces"),
    ]:
        for method in ("GET", "POST", "DELETE", "PUT", "PATCH"):
            status, _ = request(("/" + prefix if prefix else "") + path, token=token, method=method)
            if status not in (400, 401, 403, 404, 405):
                failures.append({"method": method, "path": prefix + path, "status": status})
    for method in ("DELETE", "PUT", "PATCH", "OPTIONS"):
        if request(query, token=token, method=method)[0] != 403:
            failures.append({"method": method, "path": "query", "status": "method not denied"})
    if request(query)[0] != 401 or request(query, token="invalid")[0] != 401:
        failures.append({"auth": "absent or invalid key accepted"})
    if failures:
        write_json(output / "negative-failures.json", failures)
        raise RuntimeError("read-only negative probes failed")

    timings = []
    await_otlp_ready(output=output)
    offset = 0
    for phase, count in (("idle", 0), ("steady", 10), ("spike", 50)):
        phase_start = time.monotonic()
        for sequence in range(count):
            fixture = corpus(now_ns=time.time_ns(), sequence=offset + sequence)
            for name, payload in fixture.items():
                status, _ = request("/v1/" + name, body=payload, method="POST", port=14318)
                if status != 200:
                    raise RuntimeError(f"OTLP {name} ingest rejected: {status}")
            # Query competes with ingestion during steady and spike.
            started = time.monotonic()
            status, _ = request(query, token=token)
            if status != 200:
                raise RuntimeError("query unavailable during ingestion")
            timings.append({"phase": phase, "query_seconds": time.monotonic() - started})
        snapshot = command(["docker", "stats", "--no-stream", "--format", "{{json .}}",
                            *command(compose + ["ps", "-q"]).split()])
        (output / f"stats-{phase}.jsonl").write_text(snapshot)
        write_json(output / f"phase-{phase}.json", {
            "duration_seconds": time.monotonic() - phase_start, "fixture_chains": count,
            "note": "short functional smoke; not the accepted steady-state resource corpus",
        })
        offset += count
    checks = [
        ("/metrics/api/v1/query?" + urllib.parse.urlencode({"query": "pilot_requests"}), "pilot_requests"),
        ("/logs/select/logsql/query?" + urllib.parse.urlencode({"query": "_time:5m", "limit": 10}), "pilot.known_failure"),
        ("/traces/select/jaeger/api/traces/00000000000000000000000000000001", "worker.retry"),
    ]
    for index, (path, marker) in enumerate(checks):
        response = await_fact(lambda p=path: request(p, token=token),
                   lambda response, m=marker: response[0] == 200 and m in response[1],
                   probe=("metrics_fixture", "logs_fixture", "traces_fixture")[index], output=output)
        collector_privacy.assert_clean(response[1])
        if index == 2:
            collector_privacy.assert_link_preserved(response[1])
    # Read all records/series in this bounded disposable corpus, not only the positive marker.
    for path in ('/logs/select/logsql/query?'+urllib.parse.urlencode({'query':'_time:5m', 'limit':200}),
                 '/metrics/api/v1/query?'+urllib.parse.urlencode({'query':'{__name__=~".+"}'})):
        status, body = request(path, token=token)
        if status != 200:
            raise RuntimeError('collector privacy storage corpus query failed')
        collector_privacy.assert_clean(body)
    up_path = '/metrics/api/v1/query?'+urllib.parse.urlencode({'query':'up{job="platform-collector"}'})
    health = await_fact(lambda: request(up_path, token=token),
        lambda response: response[0] == 200 and '"1"' in response[1],
        probe='collector_safe_health', output=output)
    collector_privacy.assert_clean(health[1])
    write_json(output/'collector-privacy.json', {'accessible_field_sentinel':'passed',
        'safe_link_correlation':'passed', 'safe_collector_health':'passed',
        'collector_raw_diagnostics':'discarded by Docker logging none; not collected',
        'untrusted_link_metadata':'unsupported; no production/general-source acceptance',
        'source':'synthetic SDK-shaped links; actual SDK wire path is separate evidence'})
    native = native_probes(token, output)
    write_json(output / "native-mcp.json", native)
    post_path = "/metrics/api/v1/query"
    # Prometheus read POST uses form data; query in URL is also accepted by its API.
    if request(post_path + "?query=1", token=token, method="POST")[0] != 200:
        raise RuntimeError("required read POST failed")
    command(compose + ["restart", "alloy"])
    await_otlp_ready(output=output, probe="restarted_alloy_otlp")
    restarted = corpus(now_ns=time.time_ns(), sequence=100)["traces"]
    if request("/v1/traces", body=restarted, method="POST", port=14318)[0] != 200:
        raise RuntimeError("restarted collector rejected its unique trace fixture")
    await_stored_trace(token, f"{101:032x}", output=output)
    # Rotate the disposable fixture key and prove the original key no longer works.
    new_token = secrets.token_urlsafe(32)
    write_json(output / "auth.json", auth_config(new_token))
    command(compose + ["restart", "vmauth"])
    await_fact(lambda: request(query, token=new_token), lambda response: response[0] == 200,
               probe="replacement_key_query", output=output)
    if request(query, token=token)[0] != 401:
        raise RuntimeError("revoked fixture key still accepted")
    write_json(output / "query-timings.json", timings)
    return {"query_ingest_auth_revocation": "passed", "native_mcp": native,
            "resource_acceptance": "pending", "application_sdk_propagation": "pending"}


def container_states(raw, *, services=SERVICES):
    """Compose status boundary: retain no commands, environment, labels or error text."""
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list) or len(rows) > len(services) + 1:
        raise ValueError("unexpected owned container status collection")
    result = []
    for row in rows:
        if not isinstance(row, dict) or row.get("Service") not in (*services, "storage-probe"):
            raise ValueError("unexpected owned container service")
        state = row.get("State")
        health = row.get("Health")
        exit_code = row.get("ExitCode")
        result.append({"service": row["Service"],
            "state": state if state in ("created", "restarting", "running", "removing", "paused", "exited", "dead") else "unknown",
            "health": health if health in ("", "starting", "healthy", "unhealthy", "none") else "unknown",
            "exit_code": exit_code if type(exit_code) is int and 0 <= exit_code <= 255 else None})
    return result


def cleanup_project(compose, output, project, *, docker=("docker",), services=SERVICES):
    """Diagnostics may fail; down and both residue checks are independent obligations."""
    result = {}
    def checked_command(args, **kwargs):
        assert_docker_identity()
        return command(args, **kwargs)
    try:
        snapshot = checked_command(compose + ["ps", "--all", "--format", "json"])
        states = container_states(snapshot, services=services)
        if not (output / "container-states.json").exists():
            write_json(output / "container-states.json", states)
        result["diagnostics"] = "passed"
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result["diagnostics"] = "failed: " + type(error).__name__
    try:
        checked_command(compose + ["down", "--volumes", "--remove-orphans"], timeout=CLEANUP_TIMEOUT_SECONDS)
        result["down"] = "passed"
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        result["down"] = "failed: " + type(error).__name__
    remaining = []
    for args in (["ps", "-aq"], ["volume", "ls", "-q"]):
        try:
            residual = checked_command(list(docker) + args + ["--filter", f"label=com.docker.compose.project={project}"])
            if residual.strip():
                remaining.append("owned resources remain")
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            remaining.append(type(error).__name__)
    result["residue"] = "passed" if not remaining else "failed: " + ", ".join(remaining)
    write_json(output / "cleanup.json", result)
    return result


def supervise_worker(execute, compose, output, project, *, docker=("docker",),
                     deadline_seconds=PILOT_DEADLINE_SECONDS, cleanup_services=None):
    """Supervisor stays outside the worker group that owns all acquisition processes."""
    process = None
    status = 1
    monitor_failed = [False]
    previous = signal.getsignal(signal.SIGUSR1)
    def latch_monitor_failure(_signum, _frame):
        # No exception may interrupt mandatory group shutdown/down/residue/outcome.
        monitor_failed[0] = True
    signal.signal(signal.SIGUSR1, latch_monitor_failure)
    try:
        try:
            process = subprocess.Popen(execute, start_new_session=True)
            write_json(output / 'worker.json', {'pid':process.pid, 'group':process.pid,
                       'supervisor_pid':os.getpid(), 'deadline_seconds':deadline_seconds})
            deadline = time.monotonic() + deadline_seconds
            while True:
                if monitor_failed[0]:
                    status = 1
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    status = 124
                    break
                try:
                    status = process.wait(timeout=min(POLL_INTERVAL_SECONDS, remaining))
                    if status < 0:
                        status = 128 - status
                    break
                except subprocess.TimeoutExpired:
                    continue
        finally:
            try:
                if process is not None:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        process.wait(timeout=WORKER_SHUTDOWN_SECONDS)
                    except subprocess.TimeoutExpired:
                        pass
                    # The leader can exit before its CLI/stdio descendants.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=WORKER_SHUTDOWN_SECONDS)
            finally:
                cleanup = cleanup_project(compose, output, project, docker=docker, **({'services': cleanup_services} if cleanup_services is not None else {}))
                if (monitor_failed[0] or cleanup['down'] != 'passed' or cleanup['residue'] != 'passed') and status == 0:
                    status = 1
                write_json(output / 'worker-outcome.json', {'exit_code':status,
                           'monitor_failed':monitor_failed[0], 'cleanup':cleanup})
                if cleanup['down'] != 'passed' or cleanup['residue'] != 'passed':
                    raise RuntimeError('owned pilot cleanup failed; inspect cleanup.json and owner.json')
    finally:
        signal.signal(signal.SIGUSR1, previous)
    return status


def validate_recorded_daemon_identity(identity, *, linux):
    """Validate the current ownership-record format without consulting Docker."""
    common = {'context', 'endpoint', 'daemon_id', 'storage', 'socket_device', 'socket_inode'}
    expected = common | ({'platform'} if linux else {'backing'})
    if not isinstance(identity, dict) or set(identity) != expected:
        raise ValueError('invalid recorded Docker identity')
    for key in ('context', 'endpoint', 'daemon_id', 'storage'):
        value = identity[key]
        if (not isinstance(value, str) or not 0 < len(value) <= 4096
                or any(ord(char) < 32 or ord(char) == 127 for char in value)):
            raise ValueError('invalid recorded Docker identity')
    if (not identity['endpoint'].startswith('unix:///')
            or not Path(identity['storage']).is_absolute()
            or type(identity['socket_device']) is not int or identity['socket_device'] < 0
            or type(identity['socket_inode']) is not int or identity['socket_inode'] <= 0):
        raise ValueError('invalid recorded Docker identity')
    if linux:
        if identity['platform'] != 'linux':
            raise ValueError('invalid recorded Docker identity')
    else:
        backing = identity['backing']
        if (identity['context'] != 'orbstack' or identity['storage'] != '/var/lib/docker'
                or not isinstance(backing, dict) or set(backing) != {'path', 'device', 'inode'}
                or not isinstance(backing['path'], str) or not 0 < len(backing['path']) <= 4096
                or any(ord(char) < 32 or ord(char) == 127 for char in backing['path'])
                or not Path(backing['path']).is_absolute()
                or type(backing['device']) is not int or backing['device'] < 0
                or type(backing['inode']) is not int or backing['inode'] <= 0):
            raise ValueError('invalid recorded Docker identity')


def restore_daemon(owner):
    """Require one valid, freshly matched identity before permitting mutation."""
    global FROZEN_DOCKER_ENDPOINT, FROZEN_DOCKER_IDENTITY
    if not isinstance(owner, dict):
        raise ValueError('invalid recorded Docker identity')
    # The unused platform is absent or null; other falsey values are malformed.
    records = [(name, owner[name]) for name in ('orbstack', 'daemon')
               if name in owner and owner[name] is not None]
    if len(records) != 1:
        raise ValueError('invalid recorded Docker identity: exactly one variant required')
    name, identity = records[0]
    linux = name == 'daemon'
    validate_recorded_daemon_identity(identity, linux=linux)
    current = daemon.identify(command) if linux else orbstack.identify(command, home=Path.home())
    if current != identity:
        raise RuntimeError('Docker recovery identity changed; manual owner inspection required')
    FROZEN_DOCKER_ENDPOINT, FROZEN_DOCKER_IDENTITY = current['endpoint'], current


def worker_storage_guard(owner, compose, output):
    restore_daemon(owner)
    if owner.get('orbstack'):
        lock = json.loads((CONFIG / 'probe.lock.json').read_text())
        return orbstack.vm_budget(compose, lock, command, output, docker_args=docker_args)
    return disk_budget(Path(owner['docker_storage']))


def run(output, *, prepare_inputs=None, worker_script=None, ports=(18427, 14318, 13000),
        project_prefix='inside-observability-pilot-', services=None, scope=None, missing=None):
    if command(["git", "-C", str(ROOT), "status", "--porcelain"]).strip():
        raise RuntimeError("commit pilot inputs before running; evidence must identify immutable source")
    context = command(["docker", "context", "show"]).strip()
    global FROZEN_DOCKER_ENDPOINT, FROZEN_DOCKER_IDENTITY
    mac = None
    linux = None
    if platform.system() == 'Darwin' and platform.machine() == 'arm64':
        mac = orbstack.identify(command, home=Path.home())
        FROZEN_DOCKER_ENDPOINT = mac['endpoint']
        FROZEN_DOCKER_IDENTITY = mac
        storage = Path(mac['backing']['path'])
    elif platform.system() == 'Linux':
        linux = daemon.identify(command)
        FROZEN_DOCKER_ENDPOINT, FROZEN_DOCKER_IDENTITY = linux['endpoint'], linux
        storage = Path(linux['storage'])
    else:
        raise RuntimeError('Docker storage identification unsupported on this platform/context')
    if not storage.is_absolute() or not storage.is_file() and not storage.is_dir():
        raise RuntimeError('cannot identify Docker storage filesystem')
    disk = shutil.disk_usage(storage)
    admission = check_disk(total=disk.total, free=disk.free)
    print(json.dumps({'disk_admission': admission}), flush=True)
    if not admission['ready']:
        raise RuntimeError(admission['reason'])
    # Record shared workload but never mutate its services, networks or volumes.
    existing = json.loads(command(["docker", "compose", "ls", "--format", "json"]))
    for port in ports:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    (prepare_inputs or prepare)(output)
    if mac:
        lock = json.loads((CONFIG / 'probe.lock.json').read_text())
        plan = json.loads((output / 'compose.json').read_text())
        plan['services']['storage-probe'] = orbstack.probe_service(lock, mac['storage'])
        write_json(output / 'compose.json', plan)
    project = project_prefix + uuid.uuid4().hex[:12]
    compose = ["docker", "compose", "-p", project, "-f", str(output / "compose.json")]
    evidence = {"source": command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).strip(),
                "project": project, "disk_admission": admission, "docker_context": context,
                "foreign_projects": [row.get("Name") for row in existing], "status": "failed",
                "scope": scope or "synthetic OTLP core compatibility smoke only",
                "missing": missing if missing is not None else ["Mac native MCP execution", "full accepted resource corpus", "SDK propagation",
                            "PII/sentinel", "retention/cleanup/restore", "Umami", "production and seven days"]}
    if mac:
        evidence['missing'].append('Mac native MCP CPU measurement')
    write_json(output / "owner.json", {"project": project, "cwd": str(ROOT), "supervisor_pid": os.getpid(),
                                    "docker_storage": str(storage), "orbstack": mac, "daemon": linux,
                                    "cleanup": compose + ["down", "--volumes", "--remove-orphans"]})
    write_json(output / "evidence.json", evidence)
    try:
        guard = orbstack.host_budget(mac, output, command) if mac else nullcontext()
        with guard:
            status = supervise_worker([sys.executable, str(worker_script or Path(__file__).resolve()), "worker", "--output", str(output)],
                                      compose, output, project, **({'cleanup_services':services} if services is not None else {}))
        evidence = json.loads((output / "evidence.json").read_text())
        evidence["worker_exit_code"] = status
        if status:
            evidence['status'] = 'failed: worker or storage monitor; inspect outcome and cleanup'
            raise subprocess.CalledProcessError(status, "observability pilot worker")
    finally:
        if (output / "cleanup.json").exists():
            evidence["cleanup"] = json.loads((output / "cleanup.json").read_text())
        (output / "auth.json").unlink(missing_ok=True)
        (output / "datasources.json").unlink(missing_ok=True)
        write_json(output / "evidence.json", evidence)
    return evidence


def run_worker(output):
    owner = json.loads((output / "owner.json").read_text())
    if owner["supervisor_pid"] != os.getppid():
        raise RuntimeError("pilot worker requires its registered external supervisor")
    compose = ["docker", "compose", "-p", owner["project"], "-f", str(output / "compose.json")]
    token = json.loads((output / "auth.json").read_text())["users"][0]["bearer_token"]
    mac = owner.get('orbstack')
    guard = worker_storage_guard(owner, compose, output)
    with guard:
        install_plugin(output)
        command(compose + ["config", "--quiet"])
        command(compose + ["up", "-d"], timeout=ACQUISITION_TIMEOUT_SECONDS)
        result = smoke(token, output, compose)
        evidence = json.loads((output / "evidence.json").read_text())
        evidence.update(result)
        if mac:
            evidence['missing'].remove('Mac native MCP execution')
        evidence["status"] = "core smoke passed; full pilot acceptance pending"
        write_json(output / "evidence.json", evidence)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "prepare", "run", "worker"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "preflight":
        disk = shutil.disk_usage(ROOT)
        result = check_disk(total=disk.total, free=disk.free)
        print(json.dumps(result, indent=2))
        return 0 if result["ready"] else 2
    output = (args.output or ROOT / ".reports" / ("observability-pilot-" + uuid.uuid4().hex[:12])).resolve()
    if args.action == "prepare":
        prepare(output)
        print(f"Prepared {output}; runtime compatibility unverified; no images downloaded.")
    elif args.action == "worker":
        if args.output is None:
            raise RuntimeError("supervised worker requires its owned output directory")
        run_worker(output)
    else:
        print(json.dumps(run(output), indent=2))
    return 0


if __name__ == "__main__":
    def interrupt(signum, _frame):
        raise KeyboardInterrupt(f"signal {signum}")
    signal.signal(signal.SIGTERM, interrupt)
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"observability-pilot: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
