// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// deterministic-test-allow unit-io: Python runs pure bounded JSON oracle contracts, without process descendants, Docker or providers.
test("native SDK storage oracles reject private neighbors before pending", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-sdk-storage",
      "-p",
      "test_oracle.py",
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
