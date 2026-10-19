// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python preparation contracts own no Docker or network resources.
test("observability pilot preparation preserves admission and private query boundaries", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-pilot",
      "-p",
      "test_*.py",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
