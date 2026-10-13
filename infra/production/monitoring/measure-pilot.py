#!/usr/bin/env python3
"""Read-only ten-minute production pilot; conservatively bound RSS by cgroup memory."""
import json
from pathlib import Path
import subprocess
import time


def command(*args):
    return subprocess.check_output(args, text=True, timeout=10).strip()


def unit(name):
    return dict(line.split("=", 1) for line in command("systemctl", "show", name, "--property=ControlGroup,CPUUsageNSec,MemoryPeak,InvocationID,ActiveState,MainPID").splitlines())


def cgroup(pid):
    rows = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    unified = next(line[3:] for line in rows if line.startswith("0::"))
    return Path("/sys/fs/cgroup") / unified.lstrip("/")


def read_group(path):
    cpu = dict(line.split() for line in (path / "cpu.stat").read_text().splitlines())
    return int(cpu["usage_usec"]) / 1_000_000, int((path / "memory.current").read_text())


def mem_available():
    row = next(line for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:"))
    return int(row.split()[1]) * 1024


def identities(ids):
    containers = []
    template = '{"id":{{json .Id}},"pid":{{json .State.Pid}},"started_at":{{json .State.StartedAt}},"restart_count":{{json .RestartCount}},"running":{{json .State.Running}}}'
    for identifier in ids:
        value = json.loads(command("docker", "inspect", "--format", template, identifier))
        if not isinstance(value, dict) or value.get("running") is not True or not isinstance(value.get("pid"), int) or value["pid"] <= 0:
            raise RuntimeError("Monitoring container identity is unavailable")
        containers.append(value)
    exporter = unit("inside-node-exporter.service")
    if exporter["ActiveState"] != "active" or not exporter["InvocationID"] or exporter["MainPID"] == "0":
        raise RuntimeError("node_exporter identity is unavailable")
    return containers, {key: exporter[key] for key in ("ControlGroup", "InvocationID", "MainPID", "ActiveState")}


def require_stable(expected, observed, previous_cpu, current_cpu):
    if expected != observed:
        raise RuntimeError("A monitoring process restarted; discard the pilot")
    if len(previous_cpu) != len(current_cpu) or any(current < previous for previous, current in zip(previous_cpu, current_cpu)):
        raise RuntimeError("A monitoring CPU counter reset; discard the pilot")


def watchdog_cpu_delta(previous, current):
    old = previous["CPUUsageNSec"]
    new = current["CPUUsageNSec"]
    if not old.isdigit() or not new.isdigit():
        raise RuntimeError("Watchdog CPU accounting is unavailable; discard the pilot")
    if previous["InvocationID"] == current["InvocationID"]:
        if int(new) < int(old):
            raise RuntimeError("Watchdog CPU counter reset; discard the pilot")
        return (int(new) - int(old)) / 1_000_000_000
    if previous["ActiveState"] != "inactive":
        raise RuntimeError("Watchdog completion CPU was not observed; discard the pilot")
    return int(new) / 1_000_000_000


def main():
    ids = command("docker", "ps", "--filter", "label=com.docker.compose.project=inside-production-monitoring", "--format", "{{.ID}}").splitlines()
    if len(ids) != 2:
        raise RuntimeError("Both monitoring containers must run throughout the pilot")
    expected_identities = identities(ids)
    groups = [cgroup(command("docker", "inspect", "--format", "{{.State.Pid}}", identifier)) for identifier in ids]
    exporter = unit("inside-node-exporter.service")
    if exporter["ActiveState"] != "active":
        raise RuntimeError("node_exporter must be active")
    groups.append(Path("/sys/fs/cgroup") / exporter["ControlGroup"].lstrip("/"))
    previous_cpu = [read_group(group)[0] for group in groups]
    require_stable(expected_identities, identities(ids), previous_cpu, previous_cpu)
    initial = sum(previous_cpu)
    watchdog = unit("inside-watchdog.service")
    watchdog_cpu = 0.0
    max_memory = 0
    minimum_available = mem_available()
    max_data = 0
    samples = 0
    start = time.monotonic()
    while True:
        observed_identities = identities(ids)
        readings = [read_group(group) for group in groups]
        current_cpu = [value for value, _ in readings]
        require_stable(expected_identities, observed_identities, previous_cpu, current_cpu)
        require_stable(expected_identities, identities(ids), previous_cpu, current_cpu)
        previous_cpu = current_cpu
        current_watchdog = unit("inside-watchdog.service")
        watchdog_cpu += watchdog_cpu_delta(watchdog, current_watchdog)
        watchdog = current_watchdog
        # memory.current includes resident pages and cache; adding unit peak is conservative.
        peak = watchdog.get("MemoryPeak", "0")
        watchdog_memory = int(peak) if peak.isdigit() else 0
        max_memory = max(max_memory, sum(memory for _, memory in readings) + watchdog_memory)
        minimum_available = min(minimum_available, mem_available())
        used = int(command("du", "-sb", "/var/lib/inside/monitoring").split()[0])
        max_data = max(max_data, used)
        samples += 1
        elapsed = time.monotonic() - start
        if elapsed >= 600:
            # Check again after the final counters, including restarts between this sample's reads.
            final_cpu = [read_group(group)[0] for group in groups]
            require_stable(expected_identities, identities(ids), current_cpu, final_cpu)
            final_watchdog = unit("inside-watchdog.service")
            watchdog_cpu += watchdog_cpu_delta(watchdog, final_watchdog)
            cpu = sum(final_cpu) - initial + watchdog_cpu
            elapsed = time.monotonic() - start
            cores = len([line for line in Path("/proc/stat").read_text().splitlines() if line.startswith("cpu") and line[3:4].isdigit()])
            cpu_percent = 100 * cpu / elapsed / cores
            break
        time.sleep(min(5, 600 - elapsed))
    report = {"duration_seconds": round(elapsed, 2), "samples": samples, "host_cores": cores, "monitoring_memory_upper_bound_bytes": max_memory, "average_total_host_cpu_percent": round(cpu_percent, 3), "minimum_host_mem_available_bytes": minimum_available, "maximum_monitoring_data_bytes": max_data, "memory_scope": "VM/Grafana/exporter cgroup memory.current plus watchdog MemoryPeak; upper bound, not exact RSS"}
    report["passed"] = max_memory <= 768 * 1024**2 and cpu_percent <= 5 and minimum_available >= 700 * 1024**2 and max_data < 2 * 1024**3
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
