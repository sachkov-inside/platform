// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python owns bounded storage JSON/protocol/plan contracts and reaps native loopback children; no Docker or external providers.
test("tracking storage validates full private rows before projection and owns child cleanup", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-tracking-storage",
      "-p",
      "test_*.py",
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
