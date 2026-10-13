"""Pilot process-identity guard contract with fixed external-source observations."""
import copy
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pilot", ROOT / "infra/production/monitoring/measure-pilot.py")
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PilotIdentityTest(unittest.TestCase):
    def expected(self):
        return ([{"id": "vm", "pid": 101, "started_at": "2026-10-13T00:00:00Z", "restart_count": 0, "running": True}, {"id": "grafana", "pid": 102, "started_at": "2026-10-13T00:00:00Z", "restart_count": 0, "running": True}], {"ControlGroup": "/exporter", "InvocationID": "first", "MainPID": "103", "ActiveState": "active"})

    def test_stable_sources_accept_monotonic_cpu(self):
        expected = self.expected()
        pilot.require_stable(expected, copy.deepcopy(expected), [4, 7, 1], [4.1, 7.2, 1.1])

    def test_each_container_identity_change_rejects_even_when_cgroup_path_stays(self):
        for field, changed in [("id", "replacement"), ("pid", 201), ("started_at", "2026-10-13T00:01:00Z"), ("restart_count", 1), ("running", False)]:
            with self.subTest(field=field):
                expected = self.expected()
                observed = copy.deepcopy(expected)
                observed[0][0][field] = changed
                with self.assertRaisesRegex(RuntimeError, "restarted"):
                    pilot.require_stable(expected, observed, [4, 7, 1], [4, 7, 1])

    def test_exporter_new_invocation_rejects_reused_cgroup(self):
        expected = self.expected()
        observed = copy.deepcopy(expected)
        observed[1]["InvocationID"] = "second"
        with self.assertRaisesRegex(RuntimeError, "restarted"):
            pilot.require_stable(expected, observed, [4, 7, 1], [4, 7, 1])

    def test_counter_reset_rejects_unchanged_identity(self):
        expected = self.expected()
        with self.assertRaisesRegex(RuntimeError, "counter reset"):
            pilot.require_stable(expected, expected, [4, 7, 1], [0, 7, 1])

    def test_watchdog_cpu_includes_active_initial_and_final_invocations(self):
        def observation(identifier, state, cpu):
            return {"InvocationID": identifier, "ActiveState": state, "CPUUsageNSec": str(cpu * 1_000_000_000)}
        initial = observation("first", "active", 10)
        completed = observation("first", "inactive", 12)
        final_active = observation("second", "active", 5)
        self.assertEqual(pilot.watchdog_cpu_delta(initial, completed), 2)
        self.assertEqual(pilot.watchdog_cpu_delta(completed, final_active), 5)
        self.assertEqual(pilot.watchdog_cpu_delta(final_active, observation("second", "active", 8)), 3)
        with self.assertRaisesRegex(RuntimeError, "completion CPU"):
            pilot.watchdog_cpu_delta(initial, final_active)

    def test_report_includes_watchdog_active_at_window_end(self):
        output = io.StringIO()
        reads = iter([(0, 0), (10, 0), (60, 128 * 1024**2)])
        def unit_observation(name):
            if "exporter" in name:
                return {"ActiveState": "active", "ControlGroup": "/exporter"}
            cpu, peak = next(reads)
            return {"ActiveState": "active", "InvocationID": "same", "CPUUsageNSec": str(cpu * 1_000_000_000), "MemoryPeak": str(peak)}
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(pilot, "identities", return_value=self.expected()))
            stack.enter_context(patch.object(pilot, "command", side_effect=lambda *args: "vm\ngrafana" if args[1] == "ps" else "0" if args[0] == "du" else "101"))
            stack.enter_context(patch.object(pilot, "unit", side_effect=unit_observation))
            stack.enter_context(patch.object(pilot, "cgroup", return_value=Path("/same/cgroup")))
            stack.enter_context(patch.object(pilot, "read_group", return_value=(4, 1024)))
            stack.enter_context(patch.object(pilot, "mem_available", return_value=1024**3))
            stack.enter_context(patch.object(pilot.time, "monotonic", side_effect=[0, 600, 600]))
            stack.enter_context(patch.object(Path, "read_text", return_value="cpu0 0\ncpu1 0\n"))
            stack.enter_context(contextlib.redirect_stdout(output))
            pilot.main()
        report = json.loads(output.getvalue())
        self.assertEqual(report["average_total_host_cpu_percent"], 5)
        self.assertEqual(report["monitoring_memory_upper_bound_bytes"], 3 * 1024 + 128 * 1024**2)

    def test_unknown_watchdog_memory_rejects_measurement(self):
        for peak in (None, "[not set]"):
            with self.subTest(peak=peak), contextlib.ExitStack() as stack:
                def unit_observation(name):
                    value = {"ActiveState": "active" if "exporter" in name else "inactive", "ControlGroup": "/exporter", "InvocationID": "same", "CPUUsageNSec": "0"}
                    if peak is not None:
                        value["MemoryPeak"] = peak
                    return value
                stack.enter_context(patch.object(pilot, "identities", return_value=self.expected()))
                stack.enter_context(patch.object(pilot, "command", side_effect=lambda *args: "vm\ngrafana" if args[1] == "ps" else "0" if args[0] == "du" else "101"))
                stack.enter_context(patch.object(pilot, "unit", side_effect=unit_observation))
                stack.enter_context(patch.object(pilot, "cgroup", return_value=Path("/same/cgroup")))
                stack.enter_context(patch.object(pilot, "read_group", return_value=(4, 1024)))
                stack.enter_context(patch.object(pilot, "mem_available", return_value=1024**3))
                stack.enter_context(patch.object(pilot.time, "monotonic", side_effect=[0, 600, 600]))
                stack.enter_context(patch.object(Path, "read_text", return_value="cpu0 0\ncpu1 0\n"))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                with self.assertRaisesRegex(RuntimeError, "memory accounting"):
                    pilot.main()

    def test_measurement_checks_initial_during_and_final_identities(self):
        expected = self.expected()
        changed = copy.deepcopy(expected)
        changed[1]["InvocationID"] = "restarted"
        for position in (1, 2, 3, 4):
            readings = [copy.deepcopy(expected) for _ in range(5)]
            readings[position] = changed
            with self.subTest(position=position), contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(pilot, "identities", side_effect=readings))
                stack.enter_context(patch.object(pilot, "command", side_effect=lambda *args: "vm\ngrafana" if args[1] == "ps" else "0" if args[0] == "du" else "101"))
                # The exporter must be active; watchdog completion is unnecessary in this fixed window.
                stack.enter_context(patch.object(pilot, "unit", side_effect=lambda name: {"ActiveState": "active" if "exporter" in name else "inactive", "InvocationID": "watchdog", "CPUUsageNSec": "0", "MemoryPeak": "0", "ControlGroup": "/exporter"}))
                stack.enter_context(patch.object(pilot, "cgroup", return_value=Path("/same/cgroup")))
                stack.enter_context(patch.object(pilot, "read_group", return_value=(4, 1024)))
                stack.enter_context(patch.object(pilot, "mem_available", return_value=1024**3))
                stack.enter_context(patch.object(pilot.time, "monotonic", side_effect=[0, 600]))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                with self.assertRaisesRegex(RuntimeError, "restarted"):
                    pilot.main()


if __name__ == "__main__":
    unittest.main()
