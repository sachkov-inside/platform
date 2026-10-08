// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deterministicTestViolations } from "./deterministic-tests.mjs";

test("duration waits require a local reason", () => {
  assert.match(
    deterministicTestViolations(
      "apps/web/test/example.spec.ts",
      "await page.waitForTimeout(50);",
    ).join("\n"),
    /duration-wait/u,
  );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/web/test/example.spec.ts",
      "// deterministic-test-allow duration-wait: Token expires on the external server clock.\nawait page.waitForTimeout(50);",
    ),
    [],
  );
});

test("mutating a module seed is refused, fresh local data is allowed", () => {
  assert.match(
    deterministicTestViolations(
      "apps/backend/test/unit/example.test.ts",
      'const seed = {count: 0}; test("first", () => { seed.count++; });',
    ).join("\n"),
    /shared-mutation/u,
  );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/backend/test/unit/example.test.ts",
      'test("first", () => { const seed = {count: 0}; seed.count++; });',
    ),
    [],
  );
});

test("unit tests cannot import process/network clients or fetch real data", () => {
  for (const source of [
    'import { execFile } from "node:child_process";',
    'await import("node:http");',
    'await fetch("https://example.test");',
  ])
    assert.match(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ).join("\n"),
      /unit-io/u,
    );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/backend/test/integration/example.test.ts",
      'await fetch("http://127.0.0.1:1234");',
    ),
    [],
  );
});

test("timer aliases, globals and computed wait calls are recognized", () => {
  for (const source of [
    'import { setTimeout as delay } from "node:timers/promises"; await delay(10);',
    "await new Promise(done => globalThis.setTimeout(done, 10));",
    'await page["waitForTimeout"](10);',
  ])
    assert.match(
      deterministicTestViolations("apps/web/test/example.spec.ts", source).join(
        "\n",
      ),
      /duration-wait/u,
    );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/web/test/example.spec.ts",
      '// waitForTimeout is banned\nconst text = "setTimeout(done, 10)";',
    ),
    [],
  );
});

test("an exception cannot cover another call or omit the reason", () => {
  for (const source of [
    "// deterministic-test-allow duration-wait:\nsetTimeout(done, 10);",
    "// deterministic-test-allow duration-wait: Deadline for stuck work.\nsetTimeout(done, 10);\nsetTimeout(done, 20);",
  ])
    assert.equal(
      deterministicTestViolations("apps/web/test/example.spec.ts", source)
        .length,
      1,
    );
});

test("shared mutations cover assignments, arrays and helpers, without shadowed locals", () => {
  for (const source of [
    'const seed = []; test("x", () => seed.push(1));',
    'const seed = {}; function update() { seed.name = "x"; }',
    'const seed = {}; test("x", () => delete seed.name);',
  ])
    assert.match(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ).join("\n"),
      /shared-mutation/u,
    );
  for (const source of [
    'const seed = {}; test("x", () => {const seed = {}; seed.name = "x";});',
    'const seed = []; beforeEach(() => {seed.length = 0;}); test("x", () => seed.push(1));',
    'const [a, b] = ["a", "b"]; test("x", () => expect(a).toBe("a"));',
  ])
    assert.deepEqual(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ),
      [],
    );
});

test("the guardrail exits nonzero for a bad test fixture", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./check-deterministic-tests.mjs", import.meta.url),
      ),
      fileURLToPath(new URL("./fixtures/deterministic-tests", import.meta.url)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stderr);
  for (const rule of ["duration-wait", "shared-mutation", "unit-io"])
    assert.ok(result.stderr.includes(rule), result.stderr);
});
