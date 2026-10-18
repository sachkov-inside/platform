import { test } from "node:test";
import assert from "node:assert/strict";
import { healthResult } from "./health.mjs";
test("health reflects a successful database probe", () => {
  assert.deepEqual(healthResult([{ ready: 1 }]), {
    status: "ready",
    database: "connected",
  });
});
test("a failed database probe cannot claim readiness", () => {
  assert.throws(() => healthResult([]), /not ready/);
});
