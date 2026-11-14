// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Compose installation rejects an untrusted download and preserves the previous plugin", () => {
  const result = spawnSync(
    "python3",
    ["-B", "scripts/test_install_docker_compose.py"],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
