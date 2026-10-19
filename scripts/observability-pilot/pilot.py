"""Disposable compatibility pilot for #1566. Python standard library only."""

import argparse
from contextlib import contextmanager
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

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "infra/observability/pilot"
SERVICES = ("metrics", "logs", "traces", "alloy", "vmauth", "gateway", "grafana")
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


def compose_plan(source, output, images):
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
        "ports": ["127.0.0.1:14318:4318"],
        "volumes": [f"{source / 'config.alloy'}:/etc/alloy/config.alloy:ro"]})
    services["vmauth"].update({"command": ["-auth.config=/config/auth.json", "-maxConcurrentRequests=4",
        "-maxConcurrentPerUserRequests=2", "-maxQueueDuration=1s", "-httpListenAddr=:8427"],
        "volumes": [f"{output / 'auth.json'}:/config/auth.json:ro"]})
    services["gateway"].update({"ports": ["127.0.0.1:18427:8080"],
        "volumes": [f"{source / 'Caddyfile'}:/etc/caddy/Caddyfile:ro"],
        "environment": {"XDG_CONFIG_HOME": "/tmp/config", "XDG_DATA_HOME": "/tmp/data"}})
    services["grafana"].update({"ports": ["127.0.0.1:13000:3000"],
        "volumes": ["grafana:/var/lib/grafana", f"{output / 'plugins'}:/var/lib/grafana/plugins:ro",
                    f"{output / 'datasources.json'}:/etc/grafana/provisioning/datasources/pilot.yaml:ro"],
        "environment": {"GF_AUTH_ANONYMOUS_ENABLED": "true", "GF_AUTH_ANONYMOUS_ORG_ROLE": "Viewer",
            "GF_AUTH_DISABLE_LOGIN_FORM": "true", "GF_AUTH_BASIC_ENABLED": "false",
            "GF_SECURITY_DISABLE_INITIAL_ADMIN_CREATION": "true", "GF_ANALYTICS_REPORTING_ENABLED": "false",
            "GF_ANALYTICS_CHECK_FOR_UPDATES": "false", "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES": "false"}})
    return {"services": services, "volumes": {name: {} for name in ("metrics", "logs", "traces", "grafana")},
            "networks": {"pilot": {"internal": True}}}


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
    return {
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
    }


def check_disk(*, total, free):
    """Admission is conservative; it is not a storage capacity measurement."""
    ready = total > 0 and free >= 16 * 1024**3
    return {
        "ready": ready, "free_bytes": free, "total_bytes": total,
        "reason": "admitted for isolated smoke only" if ready else
        "pilot requires 16 GiB free: 10 GiB host floor, 4 GiB growth cap, 2 GiB cleanup headroom",
    }

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
                if free > (10 * 1024**3 + 256 * 1024**2) and initial - free < (4 * 1024**3 - 256 * 1024**2):
                    continue
            except OSError:
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


def stdio_probe(executable, environment, tool, arguments, marker):
    """Exercise native MCP, keeping stderr and credentials out of diagnostics."""
    # Stay in the owned worker group so its external supervisor also catches a killed worker.
    process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
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
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        results[name] = stdio_probe(executable, environment, tool, arguments, marker)
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        results[name]["cpu_seconds"] = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
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
    write_json(output / "compose.json", compose_plan(CONFIG, output, lock["images"]))
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


def command(args, *, timeout=COMMAND_TIMEOUT_SECONDS):
    # The repository heavy-check supervisor owns the foreground CLI process tree.
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


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


def await_fact(read, predicate, *, budget=FACT_TIMEOUT_SECONDS):
    deadline = time.monotonic() + budget
    last = None
    while time.monotonic() < deadline:
        try:
            last = read()
            if predicate(last):
                return last
        except (OSError, urllib.error.URLError):
            pass
        # Real network compatibility probe; this pause bounds poll load, not success.
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("pilot fact did not become visible before deadline")


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


def await_otlp_ready(*, port=14318):
    return await_fact(lambda: request("/v1/traces", body={"resourceSpans": []}, method="POST", port=port),
                      lambda response: response[0] == 200)


def await_stored_trace(token, trace_id, *, port=18427):
    return await_fact(lambda: request("/traces/select/jaeger/api/traces/" + trace_id, token=token, port=port),
                      lambda response: response[0] == 200 and "worker.retry" in response[1])


def smoke(token, output, compose):
    query = "/metrics/api/v1/query?" + urllib.parse.urlencode({"query": "1"})
    await_fact(lambda: request(query, token=token), lambda response: response[0] == 200)
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
    await_otlp_ready()
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
    for path, marker in checks:
        await_fact(lambda p=path: request(p, token=token),
                   lambda response, m=marker: response[0] == 200 and m in response[1])
    native = native_probes(token, output)
    write_json(output / "native-mcp.json", native)
    post_path = "/metrics/api/v1/query"
    # Prometheus read POST uses form data; query in URL is also accepted by its API.
    if request(post_path + "?query=1", token=token, method="POST")[0] != 200:
        raise RuntimeError("required read POST failed")
    command(compose + ["restart", "alloy"])
    await_otlp_ready()
    restarted = corpus(now_ns=time.time_ns(), sequence=100)["traces"]
    if request("/v1/traces", body=restarted, method="POST", port=14318)[0] != 200:
        raise RuntimeError("restarted collector rejected its unique trace fixture")
    await_stored_trace(token, f"{101:032x}")
    # Rotate the disposable fixture key and prove the original key no longer works.
    new_token = secrets.token_urlsafe(32)
    write_json(output / "auth.json", auth_config(new_token))
    command(compose + ["restart", "vmauth"])
    await_fact(lambda: request(query, token=new_token), lambda response: response[0] == 200)
    if request(query, token=token)[0] != 401:
        raise RuntimeError("revoked fixture key still accepted")
    write_json(output / "query-timings.json", timings)
    return {"query_ingest_auth_revocation": "passed", "native_mcp": native,
            "resource_acceptance": "pending", "application_sdk_propagation": "pending"}


def cleanup_project(compose, output, project, *, docker=("docker",)):
    """Diagnostics may fail; down and both residue checks are independent obligations."""
    result = {}
    try:
        snapshot = command(compose + ["ps", "--all", "--format", "json"])
        (output / "container-states.json").write_text(snapshot)
        result["diagnostics"] = "passed"
    except (OSError, subprocess.SubprocessError) as error:
        result["diagnostics"] = "failed: " + type(error).__name__
    try:
        command(compose + ["down", "--volumes", "--remove-orphans"], timeout=CLEANUP_TIMEOUT_SECONDS)
        result["down"] = "passed"
    except (OSError, subprocess.SubprocessError) as error:
        result["down"] = "failed: " + type(error).__name__
    remaining = []
    for args in (["ps", "-aq"], ["volume", "ls", "-q"]):
        try:
            residual = command(list(docker) + args + ["--filter", f"label=com.docker.compose.project={project}"])
            if residual.strip():
                remaining.append("owned resources remain")
        except (OSError, subprocess.SubprocessError) as error:
            remaining.append(type(error).__name__)
    result["residue"] = "passed" if not remaining else "failed: " + ", ".join(remaining)
    write_json(output / "cleanup.json", result)
    return result


def supervise_worker(execute, compose, output, project, *, docker=("docker",),
                     deadline_seconds=PILOT_DEADLINE_SECONDS):
    """Supervisor stays outside the worker group that owns all acquisition processes."""
    process = None
    status = 1
    try:
        process = subprocess.Popen(execute, start_new_session=True)
        write_json(output / "worker.json", {"pid": process.pid, "group": process.pid,
                   "supervisor_pid": os.getpid(), "deadline_seconds": deadline_seconds})
        try:
            status = process.wait(timeout=deadline_seconds)
            if status < 0:
                status = 128 - status
        except subprocess.TimeoutExpired:
            status = 124
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
                # Also stop group members after the worker itself has already exited.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=WORKER_SHUTDOWN_SECONDS)
        finally:
            cleanup = cleanup_project(compose, output, project, docker=docker)
            write_json(output / "worker-outcome.json", {"exit_code": status, "cleanup": cleanup})
            if cleanup["down"] != "passed" or cleanup["residue"] != "passed":
                raise RuntimeError("owned pilot cleanup failed; inspect cleanup.json and owner.json")
    return status


def run(output):
    if command(["git", "-C", str(ROOT), "status", "--porcelain"]).strip():
        raise RuntimeError("commit pilot inputs before running; evidence must identify immutable source")
    context = command(["docker", "context", "show"]).strip()
    if platform.system() != "Linux":
        raise RuntimeError(f"Docker storage identification unsupported on {platform.system()}/{context}; use isolated Linux Engine for core smoke, Mac native probes separately")
    storage = Path(command(["docker", "info", "--format", "{{.DockerRootDir}}"]).strip())
    if not storage.is_absolute() or not storage.is_dir():
        raise RuntimeError("cannot identify Docker storage filesystem")
    disk = shutil.disk_usage(storage)
    admission = check_disk(total=disk.total, free=disk.free)
    print(json.dumps({"disk_admission": admission}), flush=True)
    if not admission["ready"]:
        raise RuntimeError(admission["reason"])
    # Record shared workload but never mutate its services, networks or volumes.
    existing = json.loads(command(["docker", "compose", "ls", "--format", "json"]))
    for port in (18427, 14318, 13000):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    prepare(output)
    project = "inside-observability-pilot-" + uuid.uuid4().hex[:12]
    compose = ["docker", "compose", "-p", project, "-f", str(output / "compose.json")]
    evidence = {"source": command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).strip(),
                "project": project, "disk_admission": admission, "docker_context": context,
                "foreign_projects": [row.get("Name") for row in existing], "status": "failed",
                "scope": "synthetic OTLP core compatibility smoke only",
                "missing": ["Mac native MCP execution", "full accepted resource corpus", "SDK propagation",
                            "PII/sentinel", "retention/cleanup/restore", "Umami", "production and seven days"]}
    write_json(output / "owner.json", {"project": project, "cwd": str(ROOT), "supervisor_pid": os.getpid(),
                                    "docker_storage": str(storage),
                                    "cleanup": compose + ["down", "--volumes", "--remove-orphans"]})
    write_json(output / "evidence.json", evidence)
    try:
        status = supervise_worker([sys.executable, str(Path(__file__).resolve()), "worker", "--output", str(output)],
                                  compose, output, project)
        evidence = json.loads((output / "evidence.json").read_text())
        evidence["worker_exit_code"] = status
        if status:
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
    with disk_budget(Path(owner["docker_storage"])):
        install_plugin(output)
        command(compose + ["config", "--quiet"])
        command(compose + ["up", "-d"], timeout=ACQUISITION_TIMEOUT_SECONDS)
        result = smoke(token, output, compose)
        evidence = json.loads((output / "evidence.json").read_text())
        evidence.update(result)
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
