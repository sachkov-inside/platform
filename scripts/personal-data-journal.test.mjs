// @ts-check
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

test("private request journal archive and offline recovery (Python/age adapter)", () => {
  // unit-io: owned Python adapter; every crypto subprocess is bounded and uses temporary keys.
  const result = spawnSync(
    "python3",
    ["scripts/personal-data-journal-test.py"],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
