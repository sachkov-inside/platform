"""Public preparation boundary; no Docker, network or process dependencies."""

import unittest
from pathlib import Path

from pilot import check_disk
import pilot


class PilotPreparationTest(unittest.TestCase):
    def test_full_disk_blocks_pilot_without_claiming_measured_capacity(self):
        self.assertEqual(check_disk(total=1000, free=249), {
            "ready": False, "free_bytes": 249, "total_bytes": 1000,
            "reason": "pilot requires 16 GiB free: 10 GiB host floor, 4 GiB growth cap, 2 GiB cleanup headroom",
        })

    def test_local_smoke_admission_does_not_require_25_percent_of_entire_mac_disk(self):
        self.assertTrue(check_disk(total=460 * 1024**3, free=16 * 1024**3)["ready"])

    def test_fixture_has_one_trace_with_distinct_retry_and_worker_attempts(self):
        fixture = pilot.corpus(now_ns=1_790_000_000_000_000_000, sequence=7)
        spans = fixture["traces"]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual([span["name"] for span in spans], [
            "HTTP GET /pilot", "queue.publish", "worker.attempt", "worker.retry", "dependency.http",
        ])
        self.assertEqual(len({span["traceId"] for span in spans}), 1)
        self.assertEqual(len({span["spanId"] for span in spans}), 5)
        self.assertEqual(spans[-1]["parentSpanId"], spans[-2]["spanId"])

    def test_prepared_stack_keeps_storage_ports_private_and_drops_host_capabilities(self):
        plan = pilot.compose_plan(Path("/source"), Path("/owned-run"),
                                  {name: "pinned" for name in pilot.SERVICES})
        for name in ("metrics", "logs", "traces", "vmauth"):
            self.assertNotIn("ports", plan["services"][name])
        self.assertEqual(plan["services"]["gateway"]["ports"], ["127.0.0.1:18427:8080"])
        self.assertTrue(all(service["cap_drop"] == ["ALL"] for service in plan["services"].values()))


if __name__ == "__main__":
    unittest.main()
