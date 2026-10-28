// @ts-check
import assert from "node:assert/strict";
import {
  runTrackingContracts,
  sourceGroups,
  sourceIds,
  assertTrackingContracts,
} from "./observability-tracking-storage/contract-runner.mjs";
import { test } from "node:test";

test("tracking source groups retain every ordered original method exactly once", () => {
  assert.deepEqual(Object.keys(sourceGroups), ["contracts", "process-owner"]);
  assert.equal(sourceGroups.contracts.length, 84);
  assert.equal(sourceGroups["process-owner"].length, 5);
  const combined = Object.values(sourceGroups).flat();
  assert.equal(new Set(combined).size, 89);
  assert.deepEqual(combined.toSorted(), sourceIds);
});

// deterministic-test-allow unit-io: Python owns bounded storage JSON/protocol/plan contracts and reaps native loopback children; no Docker or external providers.
test("tracking storage validates full private rows before projection", async () => {
  const result = await runTrackingContracts(["--source-group", "contracts"]);
  assertTrackingContracts(result, "contracts");
});

// deterministic-test-allow unit-io: independently bounded original five outer-owner methods exercise all real outcomes and nested cancellation without shortening TERM grace.
test("tracking process owner reaps listeners through all five lifecycle contracts", async () => {
  const result = await runTrackingContracts([
    "--source-group",
    "process-owner",
  ]);
  assertTrackingContracts(result, "process-owner");
});

test("tracking success requires a complete closed group marker without exposing private output", () => {
  for (const group of /** @type {const} */ (["contracts", "process-owner"])) {
    const marker = `TRACKING_CONTRACTS_V1 completed ${group} ${sourceGroups[group].length}`;
    for (const stderr of [
      "private-canary",
      marker,
      marker + "0\n",
      marker + "\n" + marker + "\n",
      "TRACKING_CONTRACTS_private-canary",
    ]) {
      assert.throws(
        () =>
          assertTrackingContracts(
            {
              reason: "exit",
              code: 0,
              signal: null,
              pid: undefined,
              stdout: "private-canary",
              stderr,
            },
            group,
          ),
        (error) =>
          error instanceof assert.AssertionError &&
          !error.message.includes("private-canary"),
      );
    }
    for (const reason of /** @type {const} */ ([
      "timeout",
      "interrupted",
      "output_limit",
      "exit",
    ])) {
      assert.throws(
        () =>
          assertTrackingContracts(
            {
              reason,
              code: 1,
              signal: null,
              pid: undefined,
              stdout: "private-canary",
              stderr: marker + "\n",
            },
            group,
          ),
        (error) =>
          error instanceof assert.AssertionError &&
          !error.message.includes("private-canary"),
      );
    }
  }
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

// deterministic-test-allow unit-io: Real compiled runtime and pinned JSON/protobuf serializers feed the strict tracking oracle; no API/PG/storage.
test("tracking causal roles have actual pinned serializer flags", async () => {
  const result = await runTrackingContracts([
    "--script",
    "trace_flags_contract.py",
  ]);
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});

// deterministic-test-allow unit-io: existing outside owner reaps controlled producer phase/library children; no application PG or external provider.
test("producer first-failure phases preserve closed capture ownership", async () => {
  const result = await runTrackingContracts([
    "--script",
    "producer_phase_contract.py",
  ]);
  assert.equal(
    result.reason,
    "exit",
    "producer phase contracts interrupted or exceeded budget",
  );
  assert.equal(result.code, 0, "producer phase contracts failed");
});
