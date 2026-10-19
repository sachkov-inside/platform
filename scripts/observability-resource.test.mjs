// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";
import "./observability-resource/test-client.mjs";

// deterministic-test-allow unit-io: external Node owner bounds the stdlib Python resource contracts and their owned process/Unix-socket fixtures.
test("resource manifest, counters and lifecycle retain bounded ownership and UNKNOWN semantics", async () => {
  const result = await runOwnedProcess("python3", [
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-resource",
    "-p",
    "test_*.py",
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stderr);
});
