"""Preparation and bounded local process/loopback contracts; no Docker or live providers."""

import unittest
from pathlib import Path
import sys
import tempfile
import threading
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer

from pilot import check_disk
import pilot

WORKER_FAILURE_BUDGET_SECONDS = 1
SERVER_SHUTDOWN_BUDGET_SECONDS = 2


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

    def test_diagnostics_failure_cannot_skip_owned_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "owned-resource").write_text("owned")
            (output / "foreign-resource").write_text("foreign")
            fixture = Path(__file__).parent / "fixtures/process.py"
            compose = [sys.executable, str(fixture), "compose", directory, "diagnostics-failure"]
            docker = [sys.executable, str(fixture), "docker", directory, "normal"]
            result = pilot.cleanup_project(compose, output, "inside-observability-pilot-fixture", docker=docker)
            self.assertEqual(result["down"], "passed")
            self.assertEqual(result["residue"], "passed")
            self.assertIn("failed", result["diagnostics"])
            self.assertFalse((output / "owned-resource").exists())
            self.assertTrue((output / "foreign-resource").exists())

    def test_supervisor_cleans_only_owned_resources_after_each_worker_outcome(self):
        fixture = Path(__file__).parent / "fixtures/process.py"
        for mode, expected_status in [("success", 0), ("failure", 7), ("timeout", 124),
                                      ("sigterm", 143), ("sigkill", 137), ("descendant", 0)]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                (output / "foreign-resource").write_text("foreign")
                compose = [sys.executable, str(fixture), "compose", directory, "normal"]
                docker = [sys.executable, str(fixture), "docker", directory, "normal"]
                execute = [sys.executable, str(fixture), "worker", directory, mode]
                status = pilot.supervise_worker(execute, compose, output,
                    "inside-observability-pilot-fixture", docker=docker,
                    deadline_seconds=WORKER_FAILURE_BUDGET_SECONDS)
                self.assertEqual(status, expected_status)
                self.assertFalse((output / "owned-resource").exists())
                self.assertTrue((output / "foreign-resource").exists())
                self.assertIn("down --volumes --remove-orphans", (output / "commands").read_text())
                if mode == "descendant":
                    def descendant_socket_closed():
                        with socket.socket(socket.AF_UNIX) as probe:
                            try:
                                probe.connect(str(output / "child.sock"))
                            except ConnectionRefusedError:
                                return True
                            return False
                    pilot.await_fact(descendant_socket_closed, bool,
                                     budget=WORKER_FAILURE_BUDGET_SECONDS)

    def test_otlp_readiness_waits_for_acceptance_and_restart_waits_for_stored_trace(self):
        class Receiver(BaseHTTPRequestHandler):
            posts = 0
            queries = 0

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                Receiver.posts += 1
                self.send_response(503 if Receiver.posts == 1 else 200)
                self.end_headers()

            def do_GET(self):
                Receiver.queries += 1
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}' if Receiver.queries == 1 else b'{"span":"worker.retry"}')

            def log_message(self, *_args):
                pass

        with HTTPServer(("127.0.0.1", 0), Receiver) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                port = server.server_port
                pilot.await_otlp_ready(port=port)
                pilot.await_stored_trace("fixture-key", "0" * 31 + "1", port=port)
                self.assertEqual(Receiver.posts, 2)
                self.assertEqual(Receiver.queries, 2)
            finally:
                server.shutdown()
                thread.join(timeout=SERVER_SHUTDOWN_BUDGET_SECONDS)
                self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
