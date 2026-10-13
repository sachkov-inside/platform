#!/usr/bin/env python3
"""Owned real HTTP/stdio adapter contract; no application or production resources."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import selectors
import signal
import sys
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
STACK = ROOT / "infra/production/monitoring"
LAST_HTTP = {}
LAST_HTTP_PATH = None
SECRETS = ["isolated-admin-proof"]


def sanitized(text):
    for secret in SECRETS:
        text = text.replace(secret, "[redacted]")
    return text


def record_http(url, status, body):
    LAST_HTTP[url] = {"status": status, "body": sanitized(body)}
    if LAST_HTTP_PATH:
        LAST_HTTP_PATH.write_text(json.dumps(LAST_HTTP, indent=2))


def run(*args, budget=120, **kwargs):
    # Worker commands share the supervisor-owned group. Cleanup commands own a new group.
    own_group = os.environ.get("INSIDE_MONITORING_SMOKE_WORKER") != "1"
    process = subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=own_group, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=budget)
    except BaseException:
        if own_group:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.communicate(timeout=5)
        raise
    if process.returncode:
        raise RuntimeError(stderr)
    return stdout


def require_query_samples(result, query_type):
    payload = result.get("structuredContent")
    if payload is None:
        blocks = [block for block in result.get("content", []) if block.get("type") == "text"]
        assert len(blocks) == 1, result
        payload = json.loads(blocks[0]["text"])
    series = payload["data"]
    assert isinstance(series, list) and series, payload
    purchases = [item for item in series if item.get("metric", {}).get("check") == "purchases"]
    assert len(purchases) == 1, series
    samples = [purchases[0].get("value")] if query_type == "instant" else purchases[0].get("values")
    assert isinstance(samples, list) and samples, purchases
    for sample in samples:
        assert isinstance(sample, list) and len(sample) == 2, sample
        assert float(sample[1]) == 2, sample


def http(url, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read().decode()
            record_http(url, response.status, raw)
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        record_http(url, error.code, error.read().decode())
        raise
    except urllib.error.URLError as error:
        record_http(url, None, str(error.reason))
        raise


def poll(read, accept, budget=100):
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        try:
            result = read()
            if accept(result):
                return result
        except (OSError, ValueError):
            pass
        # Poll a successful live ingestion/readiness response, never infer it from elapsed time.
        time.sleep(1)
    raise AssertionError("Live readiness/ingestion budget expired; last HTTP: " + json.dumps(LAST_HTTP))


def worker(args):
    global LAST_HTTP_PATH
    LAST_HTTP_PATH = args.directory / "last-http.json"
    def interrupted(signum, frame):
        raise InterruptedError("Smoke interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    project = args.project
    mcp_name = project + "-mcp"
    directory = args.directory
    temp = str(directory)
    config = json.loads(run("docker", "compose", "-f", str(STACK / "compose.yaml"), "config", "--format", "json", env={**os.environ, "MONITORING_CONFIG_DIR": temp, "MONITORING_DATA_DIR": temp}))
    config["name"] = project
    for name, service in config["services"].items():
        service.pop("network_mode")
        service["networks"] = {"default": None}
        service["restart"] = "no"
        service.pop("volumes")
        service["ports"] = [{"target": 8428 if name == "victoria-metrics" else 3304, "published": "0", "host_ip": "127.0.0.1"}]
    vm = config["services"]["victoria-metrics"]
    vm["command"][0] = "-httpListenAddr=:8428"
    # The isolated tmpfs is 64 MiB; the production 1 GiB free-space guard would reject ingestion.
    vm["command"] = ["-storage.minFreeDiskSpaceBytes=4MiB" if flag.startswith("-storage.minFreeDiskSpaceBytes=") else flag for flag in vm["command"]]
    vm["volumes"] = [str(directory / "scrape.yaml") + ":/etc/victoria-metrics/scrape.yaml:ro"]
    vm["tmpfs"] = ["/storage:size=64m,uid=65534,gid=65534"]
    grafana = config["services"]["grafana"]
    grafana["environment"]["GF_SERVER_HTTP_ADDR"] = "0.0.0.0"
    grafana["environment"]["GF_SECURITY_ADMIN_PASSWORD"] = "isolated-admin-proof"
    grafana["environment"].pop("GF_SECURITY_ADMIN_PASSWORD__FILE")
    grafana["environment"].pop("GF_SECURITY_SECRET_KEY__FILE")
    grafana["tmpfs"].append("/var/lib/grafana:size=64m,uid=472,gid=472")
    provision = directory / "provisioning"
    import shutil
    shutil.copytree(STACK / "provisioning", provision)
    datasource = provision / "datasources/metrics.yaml"
    datasource.write_text(datasource.read_text().replace("http://127.0.0.1:8428", "http://victoria-metrics:8428"))
    grafana["volumes"] = [str(provision) + ":/etc/grafana/provisioning:ro", str(STACK / "dashboards") + ":/etc/grafana/dashboards:ro"]
    metrics = directory / "metrics"
    metrics.mkdir()
    (metrics / "watchdog.prom").write_text("inside_watchdog_business_count{check=\"purchases\"} 2\ninside_watchdog_source_available{source=\"platform_db\"} 0\ninside_watchdog_source_last_success_timestamp_seconds{source=\"platform_db\"} 1800000000\ninside_watchdog_run_timestamp_seconds 1800000000\ninside_watchdog_alerts_active{family=\"db\"} 1\ninside_telegram_update_failed_total 3\n")
    config["services"]["node-exporter"] = {"image": "quay.io/prometheus/node-exporter:v1.12.1@sha256:1b4e4438faca4dd7e001dd445d161a4a2091b0fededa84093b3a8dfeae1f1be0", "command": ["--collector.disable-defaults", "--collector.textfile", "--collector.textfile.directory=/metrics"], "volumes": [str(metrics) + ":/metrics:ro"], "mem_limit": "64m", "cpus": 0.05, "networks": {"default": None}}
    config["networks"] = {"default": {}}
    (directory / "scrape.yaml").write_text("global:\n  scrape_interval: 60s\nscrape_configs:\n  - job_name: host\n    static_configs:\n      - targets: ['node-exporter:9100']\n  - job_name: victoria-metrics\n    static_configs:\n      - targets: ['victoria-metrics:8428']\n")
    compose = directory / "compose.json"
    compose.write_text(json.dumps(config))
    command = ["docker", "compose", "-p", project, "-f", str(compose)]
    process = None
    try:
        run(*command, "up", "-d")
        if args.fail_after_start:
            raise AssertionError("Injected failure after stack acquisition")
        if args.interrupt_after_start:
            os.kill(os.getpid(), signal.SIGTERM)
        if args.kill_after_start:
            os.kill(os.getpid(), signal.SIGKILL)
        if args.timeout_after_start:
            run(sys.executable, "-c", "import subprocess,time; subprocess.Popen(['sleep','600']); time.sleep(600)", budget=0.1)
        vm_port = run(*command, "port", "victoria-metrics", "8428").strip().split(":")[-1]
        grafana_port = run(*command, "port", "grafana", "3304").strip().split(":")[-1]
        vm_url = "http://127.0.0.1:" + vm_port
        url = "http://127.0.0.1:" + grafana_port
        poll(lambda: http(url + "/api/health"), lambda x: x.get("database") == "ok")
        poll(lambda: http(vm_url + '/api/v1/query?query=inside_watchdog_business_count'), lambda x: x["data"]["result"] and x["data"]["result"][0]["value"][1] == "2")
        import base64
        def admin(path, method="GET", body=None):
            request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json", "Authorization": "Basic " + base64.b64encode(b"admin:isolated-admin-proof").decode()})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        account = admin("/api/serviceaccounts", "POST", {"name": "isolated-metrics-viewer", "role": "Viewer"})
        token = admin(f'/api/serviceaccounts/{account["id"]}/tokens', "POST", {"name": "isolated-proof"})["key"]
        SECRETS.append(token)
        token_path = directory / "viewer-token"
        token_path.write_text(token)
        token_path.chmod(0o600)
        assert http(url + "/api/dashboards/uid/inside-health", token=token)["dashboard"]["panels"]
        assert len(http(url + "/api/v1/provisioning/alert-rules", token=token)) == 6
        policy = http(url + "/api/v1/provisioning/policies", token=token)
        assert policy["routes"][0]["mute_time_intervals"] == ["metrics-only"]
        assert http(url + "/api/v1/provisioning/mute-timings", token=token)[0]["time_intervals"][0]["times"] == [{"start_time": "00:00", "end_time": "24:00"}]
        try:
            http(url + "/api/dashboards/db", "POST", {"dashboard": {"title": "forbidden-write", "schemaVersion": 42}}, token)
            raise AssertionError("Viewer unexpectedly wrote a dashboard")
        except urllib.error.HTTPError as error:
            assert error.code == 403
        env = {**os.environ, "GRAFANA_URL": "http://host.docker.internal:" + grafana_port, "GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE": str(token_path), "INSIDE_METRICS_MCP_CONTAINER_NAME": mcp_name}
        process = subprocess.Popen(["bash", str(STACK / "grafana-mcp")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, text=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        def rpc(identifier, method, params):
            process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}) + "\n")
            process.stdin.flush()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if selector.select(max(0, deadline - time.monotonic())):
                    line = process.stdout.readline()
                    if not line:
                        raise AssertionError("MCP terminated before response")
                    response = json.loads(line)
                    if response.get("id") == identifier:
                        assert "error" not in response, response
                        return response["result"]
            raise AssertionError("MCP response budget expired")
        assert rpc(1, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "isolated-metrics-proof", "version": "1"}})["serverInfo"]
        process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        tools = {tool["name"] for tool in rpc(2, "tools/list", {})["tools"]}
        required = {"query_prometheus", "list_prometheus_metric_names", "list_prometheus_label_names", "list_prometheus_label_values", "get_dashboard_by_uid", "alerting_rules_read"}
        assert required <= tools, required - tools
        assert not any(name.startswith(("create_", "update_", "delete_", "patch_")) or name.endswith("_write") for name in tools), tools
        for identifier, name, args in [
            (3, "list_prometheus_metric_names", {"datasourceUid": "inside-metrics", "regex": "inside_watchdog_business_count"}),
            (4, "list_prometheus_label_names", {"datasourceUid": "inside-metrics"}),
            (5, "list_prometheus_label_values", {"datasourceUid": "inside-metrics", "labelName": "check"}),
            (6, "query_prometheus", {"datasourceUid": "inside-metrics", "expr": "inside_watchdog_business_count", "queryType": "instant", "endTime": "now"}),
            (7, "query_prometheus", {"datasourceUid": "inside-metrics", "expr": "inside_watchdog_business_count", "queryType": "range", "startTime": "now-5m", "endTime": "now", "stepSeconds": 60}),
            (8, "get_dashboard_by_uid", {"uid": "inside-health"}),
            (9, "alerting_rules_read", {"operation": "list"}),
        ]:
            result = rpc(identifier, "tools/call", {"name": name, "arguments": args})
            assert not result.get("isError"), (name, result)
            content = json.dumps(result)
            if name == "query_prometheus":
                require_query_samples(result, args["queryType"])
            if name == "list_prometheus_metric_names":
                assert 'inside_watchdog_business_count' in content, content
            if name == "list_prometheus_label_values":
                assert 'purchases' in content, content
            print("PASS", name, args.get("queryType", ""))
        # A Docker volume uses Linux ownership, independent of Desktop bind-mount translation.
        # Copy archive metadata preserves the operator UID/GID and mode 0600.
        linux_name = project + "-mcp-linux"
        token_volume = project + "-token"
        run("docker", "volume", "create", token_volume)
        image = "grafana/mcp-grafana:2.0.2@sha256:78d208116ec52b09b44f0eca66892073b39aefcb64483c54d43255c8eab7e97a"
        run("docker", "create", "--interactive", "--init", "--name", linux_name,
            "--user", f"{os.getuid()}:{os.getgid()}", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "0.25", "--pids-limit", "64",
            "--add-host", "host.docker.internal:host-gateway",
            "--mount", f"type=volume,source={token_volume},target=/run/secrets",
            "--env", "GRAFANA_URL=" + env["GRAFANA_URL"],
            "--env", "GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE=/run/secrets/viewer-token",
            image, "--transport", "stdio", "--disable-write", "--usage-stats=disabled",
            "--enabled-tools=prometheus")
        run("docker", "cp", "--archive", str(token_path), linux_name + ":/run/secrets/viewer-token")
        copied = directory / "linux-token-proof"
        run("docker", "cp", "--archive", linux_name + ":/run/secrets/viewer-token", str(copied))
        metadata = copied.stat()
        assert (metadata.st_uid, metadata.st_gid, metadata.st_mode & 0o777) == (os.getuid(), os.getgid(), 0o600)
        assert token_path.stat().st_mode & 0o777 == 0o600
        process.stdin.close()
        process.wait(timeout=5)
        selector.close()
        process = subprocess.Popen(["docker", "start", "--attach", "--interactive", linux_name], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        assert rpc(10, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "linux-token-proof", "version": "1"}})["serverInfo"]
        process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        require_query_samples(rpc(11, "tools/call", {"name": "query_prometheus", "arguments": {"datasourceUid": "inside-metrics", "expr": "inside_watchdog_business_count", "queryType": "instant", "endTime": "now"}}), "instant")
        print("PASS official MCP Linux-owned token mode0600 with operator UID/GID")
        print("PASS ingestion, dashboard, 6 alerts, Viewer HTTP403, official MCP read-only tools")
    except BaseException as error:
        try:
            logs = run(*command, "logs", "--no-color", "--tail", "60", budget=15)
        except BaseException as log_error:
            logs = "Log capture failed: " + str(log_error)
        evidence = sanitized("Failure: " + str(error) + "\nLast HTTP:\n" + json.dumps(LAST_HTTP, indent=2) + "\nService logs:\n" + logs)
        print(evidence, file=sys.stderr)
        (directory / "failure.txt").write_text(evidence)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-directory", type=Path)
    for mode in ("fail", "interrupt", "kill", "timeout"):
        parser.add_argument("--" + mode + "-after-start", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--project", help=argparse.SUPPRESS)
    parser.add_argument("--directory", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        worker(args)
        return
    project = "inside-monitoring-test-" + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix=project) as temp:
        directory = Path(temp)
        command = [sys.executable, str(Path(__file__).resolve()), "--worker", "--project", project, "--directory", temp]
        for mode in ("fail", "interrupt", "kill", "timeout"):
            if getattr(args, mode + "_after_start"):
                command.append("--" + mode + "-after-start")
        process = subprocess.Popen(command, start_new_session=True, env={**os.environ, "INSIDE_MONITORING_SMOKE_WORKER": "1"})
        status = 1
        cleanup_errors = []
        def interrupted(signum, frame):
            raise InterruptedError("Smoke supervisor interrupted")
        signal.signal(signal.SIGINT, interrupted)
        signal.signal(signal.SIGTERM, interrupted)
        try:
            status = process.wait()
        except BaseException as error:
            print(str(error), file=sys.stderr)
        finally:
            # The outer process survives a killed worker and owns all worker descendants.
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            try:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            except BaseException as error:
                cleanup_errors.append("Worker shutdown: " + str(error))
            compose = ["docker", "compose", "-p", project, "-f", str(directory / "compose.json")]
            try:
                if not (directory / "failure.txt").exists() and status:
                    try:
                        logs = run(*compose, "logs", "--no-color", "--tail", "60", budget=15)
                    except BaseException as error:
                        logs = str(error)
                    last_http = (directory / "last-http.json").read_text() if (directory / "last-http.json").exists() else "no requests completed"
                    evidence = f"Worker exit: {status}\nLast HTTP:\n" + last_http
                    evidence += "\nService logs:\n" + sanitized(logs)
                    (directory / "failure.txt").write_text(evidence)
                    print(evidence, file=sys.stderr)
                if args.evidence_directory and (directory / "failure.txt").exists():
                    args.evidence_directory.mkdir(parents=True, exist_ok=True)
                    (args.evidence_directory / "failure.txt").write_text((directory / "failure.txt").read_text())
            except BaseException as error:
                cleanup_errors.append("Evidence capture: " + str(error))
            steps = [["docker", "rm", "--force", project + "-mcp"], ["docker", "rm", "--force", project + "-mcp-linux"], [*compose, "down", "--volumes", "--remove-orphans"], ["docker", "volume", "rm", project + "-token"]]
            for step in steps:
                try:
                    run(*step, budget=30)
                except BaseException as error:
                    # A nonexistent MCP container is expected when failure precedes its launch.
                    if "No such container" not in str(error) and "no such volume" not in str(error):
                        cleanup_errors.append(str(error))
            try:
                assert not run("docker", "ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.ID}}", budget=15), "Owned containers remain"
                assert not run("docker", "volume", "ls", "--filter", "name=" + project, "--format", "{{.Name}}", budget=15), "Owned volumes remain"
                assert not run("docker", "network", "ls", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.ID}}", budget=15), "Owned networks remain"
                deadline = time.monotonic() + 5
                while True:
                    rows = [row.split() for row in run("ps", "-axo", "pgid=,stat=", budget=5).splitlines()]
                    running = [row for row in rows if row[0] == str(process.pid) and not row[1].startswith("Z")]
                    if not running:
                        break
                    assert time.monotonic() < deadline, "Owned worker descendants remain"
                    time.sleep(0.05)
            except BaseException as error:
                cleanup_errors.append(str(error))
            if cleanup_errors:
                print("Cleanup errors: " + sanitized("; ".join(cleanup_errors)), file=sys.stderr)
            else:
                print("PASS isolated stack cleanup", flush=True)
        raise SystemExit(status if status > 0 else 1 if status or cleanup_errors else 0)


if __name__ == "__main__":
    main()
