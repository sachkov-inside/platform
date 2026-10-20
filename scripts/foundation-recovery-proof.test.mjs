// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("foundation recovery proof refuses unsafe runners and preserves resource ownership", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts",
      "-p",
      "test_foundation_recovery_proof.py",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
