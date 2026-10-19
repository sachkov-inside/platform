// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python owns bounded loopback HTTP contracts with finally cleanup; no Docker/providers.
test("Umami pilot query boundary rejects writes and bounds analytical reads", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-umami",
      "-p",
      "test_*.py",
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
