// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";

// deterministic-test-allow unit-io: existing external owner bounds the pure Python preparation contract, without Docker or provider calls.
test("production preparation keeps explicit opt-in, private keys and isolated query boundaries", async () => {
  const result = await runOwnedProcess("python3", [
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-production",
    "-p",
    "test_*.py",
  ]);
  assert.equal(result.reason, "exit");
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
});
