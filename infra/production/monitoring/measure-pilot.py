#!/usr/bin/env python3
"""Read-only ten-minute production pilot; conservatively bound RSS by cgroup memory."""
import json
from pathlib import Path
import subprocess
import time


def command(*args):
    return subprocess.check_output(args, text=True, timeout=10).strip()


def unit(name):
    return dict(line.split("=", 1) for line in command("systemctl", "show", name, "--property=ControlGroup,CPUUsageNSec,MemoryPeak,InvocationID,ActiveState").splitlines())


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


def main():
    ids = command("docker", "ps", "--filter", "label=com.docker.compose.project=inside-production-monitoring", "--format", "{{.ID}}").splitlines()
    if len(ids) != 2:
        raise RuntimeError("Both monitoring containers must run throughout the pilot")
    groups = [cgroup(command("docker", "inspect", "--format", "{{.State.Pid}}", identifier)) for identifier in ids]
    exporter = unit("inside-node-exporter.service")
    if exporter["ActiveState"] != "active":
        raise RuntimeError("node_exporter must be active")
    groups.append(Path("/sys/fs/cgroup") / exporter["ControlGroup"].lstrip("/"))
    initial = sum(read_group(group)[0] for group in groups)
    watchdog = unit("inside-watchdog.service")
    invocation = watchdog["InvocationID"]
    watchdog_cpu = 0.0
    max_memory = 0
    minimum_available = mem_available()
    max_data = 0
    samples = 0
    start = time.monotonic()
    while True:
        readings = [read_group(group) for group in groups]
        watchdog = unit("inside-watchdog.service")
        if watchdog["ActiveState"] == "inactive" and watchdog["InvocationID"] != invocation:
            invocation = watchdog["InvocationID"]
            watchdog_cpu += int(watchdog["CPUUsageNSec"]) / 1_000_000_000
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
            cpu = sum(value for value, _ in readings) - initial + watchdog_cpu
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
