// @ts-check
import assert from "node:assert/strict";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";
import { test } from "node:test";

// deterministic-test-allow unit-io: external Node owner bounds and cleans the isolated Python process group; owned loopback only.
test("Umami pilot query boundary rejects writes and bounds analytical reads", async () => {
  const result = await runOwnedProcess("python3", [
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-umami",
    "-p",
    "test_*.py",
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stderr);
});
