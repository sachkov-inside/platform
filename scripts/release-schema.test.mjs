import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("checked-in release manifest schema is generated from its Zod owner", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-release-manifest-schema.mjs", "--check"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release manifest schema is up to date\./u);
});
