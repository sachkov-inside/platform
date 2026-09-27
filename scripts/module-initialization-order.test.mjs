// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = fileURLToPath(
  new URL("check-module-initialization-order.mjs", import.meta.url),
);
const fixture = fileURLToPath(
  new URL("fixtures/module-initialization-order", import.meta.url),
);

/**
 * @param {string} root
 * @param {string[]} [project]
 */
function run(root, project = []) {
  const result = spawnSync(process.execPath, [checker, root, ...project], {
    encoding: "utf8",
  });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("repository scripts declare module values before the code that runs", () => {
  const result = run(repositoryRoot);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Module initialization order passed\./u);
});

test("a top-level call into a function that reads a later declaration fails", () => {
  const result = run(fixture, ["scripts-project.json"]);
  assert.notEqual(result.status, 0, "the checker accepted a late declaration");
  assert.match(
    result.output,
    /late-schema\.mjs: line 3 runs assertHealth, which reads healthStatuses declared on line 9/u,
  );
  assert.match(
    result.output,
    /late-arrow-and-class\.mjs: line 4 runs describeStatus, which reads statusLabel declared on line 7/u,
  );
  assert.match(
    result.output,
    /late-arrow-and-class\.mjs: line 5 runs HealthReport, which reads reportPrefix declared on line 15/u,
  );
  assert.match(
    result.output,
    /late-static\.mjs: line 3 runs readLimit, which reads limit declared on line 8/u,
  );
  assert.doesNotMatch(
    result.output,
    /deferred-callback\.mjs/u,
    "a callback that runs after the module has loaded was reported",
  );
});
