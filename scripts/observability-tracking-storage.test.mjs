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

// deterministic-test-allow unit-io: the accepted outer owner reaps the SDK/tracking native listener fixtures and their pipes on every outcome.
test("SDK and tracking native diagnostics keep private output closed and reap listeners", async () => {
  const result = await runTrackingContracts([
    "--script",
    "diagnostic_contract.py",
  ]);
  assert.equal(
    result.reason,
    "exit",
    "native diagnostic contracts interrupted or exceeded budget",
  );
  assert.equal(result.code, 0, result.stderr);
});

// deterministic-test-allow unit-io: actual private marker writes and owned HTTP listeners verify cleanup after each native outcome without API/PG execution.
test("tracking and waitlist API progress stays closed across owned child outcomes", async () => {
  const result = await runTrackingContracts([
    "--script",
    "api_progress_contract.py",
  ]);
  assert.equal(
    result.reason,
    "exit",
    "API progress contracts exceeded ownership budget",
  );
  assert.equal(result.code, 0, result.stderr);
});
