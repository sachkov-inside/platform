// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCaddyContracts } from "./observability-caddy-storage/contract-runner.mjs";

// deterministic-test-allow unit-io: pure bounded Caddy contracts and owned protocol fixtures, no Docker or external provider; outer owner reaps children on every outcome.
test("Caddy refuses invalid whole observations and owns protocol children", async () => {
  const result = await runCaddyContracts([]);
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});
