// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const suite of [
  "test_broker_upgrade_proof.py",
  "test_release_broker_image.py",
]) {
  test(`broker maintenance safety contracts: ${suite}`, () => {
    const result = spawnSync("python3", ["-B", `scripts/${suite}`], {
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
  });
}
