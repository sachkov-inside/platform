// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python owns bounded benign process trees and loopback fixtures; no Docker or external provider calls.
test("SigNoz functional witness preserves private evidence and owned fault cleanup", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-signoz",
      "-p",
      "test_*.py",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
