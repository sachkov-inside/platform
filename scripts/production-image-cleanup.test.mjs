// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// The Python tests own temporary paths and flock descriptors through unittest cleanup;
// all Docker/process calls are doubles, so this bounded child has no descendants.
test("production image retention protects deployment recovery without production access (Python boundary)", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/production-image-cleanup",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || "Python retention tests failed",
  );
});
