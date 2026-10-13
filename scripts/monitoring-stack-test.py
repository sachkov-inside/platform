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
SECRETS = ["isolated-admin-proof"]


def sanitized(text):
    for secret in SECRETS:
        text = text.replace(secret, "[redacted]")
    return text


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=120, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout


def http(url, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read().decode()
            LAST_HTTP[url] = {"status": response.status, "body": sanitized(raw[:2000])}
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        LAST_HTTP[url] = {"status": error.code, "body": sanitized(error.read().decode()[:2000])}
        raise
    except urllib.error.URLError as error:
        LAST_HTTP[url] = {"status": None, "body": str(error.reason)}
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-directory", type=Path)
    parser.add_argument("--fail-after-start", action="store_true")
    parser.add_argument("--interrupt-after-start", action="store_true")
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise InterruptedError("Smoke interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    project = "inside-monitoring-test-" + uuid.uuid4().hex[:12]
    mcp_name = project + "-mcp"
    with tempfile.TemporaryDirectory(prefix=project) as temp:
        directory = Path(temp)
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
            process = subprocess.Popen(["bash", str(STACK / "grafana-mcp")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, start_new_session=True, text=True)
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
                    assert 'purchases' in content and '2' in content, content
                if name == "list_prometheus_metric_names":
                    assert 'inside_watchdog_business_count' in content, content
                if name == "list_prometheus_label_values":
                    assert 'purchases' in content, content
                print("PASS", name, args.get("queryType", ""))
            print("PASS ingestion, dashboard, 6 alerts, Viewer HTTP403, official MCP read-only tools")
        except BaseException as error:
            logs = subprocess.run([*command, "logs", "--no-color", "--tail", "60"], capture_output=True, text=True, timeout=15)
            evidence = sanitized("Failure: " + str(error) + "\nLast HTTP:\n" + json.dumps(LAST_HTTP, indent=2) + "\nService logs:\n" + logs.stdout + logs.stderr)
            print(evidence, file=sys.stderr)
            if args.evidence_directory:
                args.evidence_directory.mkdir(parents=True, exist_ok=True)
                (args.evidence_directory / "failure.txt").write_text(evidence)
            raise
        finally:
            if process is not None:
                process.stdin.close()
                with contextlib.suppress(subprocess.TimeoutExpired):
                    process.wait(timeout=5)
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                process.stdout.close()
            subprocess.run(["docker", "rm", "--force", mcp_name], capture_output=True, timeout=30)
            run(*command, "down", "--volumes", "--remove-orphans")
            assert not run("docker", "ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.ID}}"), "Owned containers remain"
            print("PASS isolated stack cleanup")


if __name__ == "__main__":
    main()
