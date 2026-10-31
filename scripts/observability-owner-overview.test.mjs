// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";

// deterministic-test-allow unit-io: existing public owner bounds a pure Python contract suite; no native process, network or provider fixtures.
test("owner overview preserves bounded comparisons and source uncertainty", async () => {
  const result = await runOwnedProcess("python3", [
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-owner-overview",
    "-p",
    "test_overview.py",
  ]);
  assert.equal(result.reason, "exit");
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
});
