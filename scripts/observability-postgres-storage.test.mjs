// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runPostgresContracts } from "./observability-postgres-storage/contract-runner.mjs";

// deterministic-test-allow unit-io: owned Python source contracts acquire only task-owned stdlib children/listeners and reap them; no PG, Docker or provider.
test("ordinary PostgreSQL source validates complete private facts and owns child settlement", async () => {
  const result = await runPostgresContracts();
  assert.equal(
    result.reason,
    "exit",
    "PostgreSQL source contracts exceeded ownership boundary",
  );
  assert.equal(result.code, 0, "PostgreSQL source contracts failed");
});
