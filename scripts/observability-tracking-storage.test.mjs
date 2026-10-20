// @ts-check
import assert from "node:assert/strict";
import { runTrackingContracts } from "./observability-tracking-storage/contract-runner.mjs";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python owns bounded storage JSON/protocol/plan contracts and reaps native loopback children; no Docker or external providers.
test("tracking storage validates full private rows before projection and owns child cleanup", async () => {
  const result = await runTrackingContracts([]);
  assert.equal(
    result.reason,
    "exit",
    "tracking contracts interrupted or exceeded budget",
  );
  assert.equal(result.code, 0, result.stderr);
});
