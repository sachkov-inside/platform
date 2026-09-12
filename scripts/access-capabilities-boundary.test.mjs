import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = fileURLToPath(new URL("check-access-capabilities-boundary.mjs", import.meta.url));
const negativeFixture = fileURLToPath(
  new URL("fixtures/access-capabilities-boundary", import.meta.url),
);

function run(root) {
  const result = spawnSync(process.execPath, [checker, root], { encoding: "utf8" });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("the repository keeps one owner of the access vocabulary", () => {
  const result = run(repositoryRoot);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Access capabilities boundary passed\./u);
});

test("a second copy of the vocabulary fails, wherever an application declares it", () => {
  const result = run(negativeFixture);
  assert.notEqual(result.status, 0, "the checker accepted a second copy of the vocabulary");
  assert.match(result.output, /accessComposition belongs to @inside\/access-capabilities/u);
  assert.match(result.output, /a Guide capability is built by @inside\/access-capabilities/u);
});
