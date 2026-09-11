import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = fileURLToPath(
  new URL("check-material-blocks-boundary.mjs", import.meta.url),
);
const negativeFixture = fileURLToPath(
  new URL("fixtures/material-blocks-boundary", import.meta.url),
);

test("the block registry entry point stays free of Tiptap", () => {
  const result = spawnSync(process.execPath, [checker, repositoryRoot], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("guardrail rejects a Tiptap import reachable from the registry entry point", () => {
  const result = spawnSync(process.execPath, [checker, negativeFixture], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot depend on Tiptap/u);
});
