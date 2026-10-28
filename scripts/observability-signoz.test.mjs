// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "./observability-signoz/verify.mjs";

// deterministic-test-allow unit-io: existing outside native owner covers detached Python fixture sessions, including death of this Node owner; no Docker/live providers.
test("SigNoz functional witness preserves private evidence and owned fault cleanup", async () => {
  const result = await verify();
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});
