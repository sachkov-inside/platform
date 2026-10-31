// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";

// deterministic-test-allow unit-io: Full storage row and grouped IPC contracts run without Docker or providers; the outside owner bounds the child.
test("waitlist storage refuses hostile full rows and invalid grouped witnesses", async () => {
  const result = await runOwnedProcess(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-waitlist-storage",
    ],
    { timeoutMs: 15000, terminateGraceMs: 2500, cleanupBudgetMs: 5000 },
  );
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});

// deterministic-test-allow unit-io: Real compiled runtime and pinned JSON/protobuf serializers feed the entire strict oracle, without API/PG/storage.
test("waitlist causal roles have actual pinned serializer flags", async () => {
  const result = await runOwnedProcess(
    "python3",
    ["-B", "scripts/observability-waitlist-storage/trace_flags_contract.py"],
    { timeoutMs: 15000, terminateGraceMs: 2500, cleanupBudgetMs: 5000 },
  );
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});
