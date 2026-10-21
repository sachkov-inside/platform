// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const file of [
  "test_backup_repository_inventory.py",
  "test_backup_repository_transition.py",
  "test_backup_storage_metadata.py",
]) {
  test(`backup repository contract: ${file}`, () => {
    const result = spawnSync(
      "python3",
      ["-B", "-m", "unittest", "discover", "-s", "scripts", "-p", file],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr);
  });
}
