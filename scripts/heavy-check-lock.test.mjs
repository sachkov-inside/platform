// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("heavy commands share two slots and clean up after parent kill", () => {
  const result = spawnSync("python3", ["scripts/heavy-check/test_lock.py"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
