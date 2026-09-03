import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = fileURLToPath(
  new URL("check-workshop-runtime-boundary.mjs", import.meta.url),
);
const negativeFixture = fileURLToPath(
  new URL("fixtures/workshop-runtime-boundary", import.meta.url),
);
const allowedFixture = fileURLToPath(
  new URL("fixtures/workshop-runtime-boundary-allowed", import.meta.url),
);

test("production graph keeps participant execution outside Platform runtime", () => {
  const result = spawnSync(process.execPath, [checker, repositoryRoot], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("guardrail rejects backend execution and Docker control", () => {
  const result = spawnSync(process.execPath, [checker, negativeFixture], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /participant evaluator execution is forbidden/u);
  assert.match(result.stderr, /cannot own participant evaluator execution/u);
});

test("guardrail permits unrelated backend subprocess ownership", () => {
  const result = spawnSync(process.execPath, [checker, allowedFixture], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
