// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { signalProcessGroup } from "./process-group-signal.mjs";
import { fileURLToPath } from "node:url";
import { deterministicTestViolations } from "./deterministic-tests.mjs";

test("calendar fixtures cannot read the wall clock without a local reason", () => {
  for (const source of [
    "const today = new Date();",
    "const expiry = new Date(Date.now() + 60_000);",
    "const today = Date();",
    "const today = new globalThis.Date();",
    'const now = window.Date["now"]();',
    'import { systemClock as clock } from "./clock.js";',
  ])
    assert.match(
      deterministicTestViolations(
        "apps/telegram/test/example.test.ts",
        source,
      ).join("\n"),
      /wall-clock/u,
    );
  for (const source of [
    'const now = new Date("2026-01-01T00:00:00Z"); const expiry = new Date(now.getTime() + 60_000);',
    "const now = fixtureClock.now();",
    "function render(Date) { return new Date(); }",
    "const Date = FixtureDate; const now = Date.now();",
    'const text = "new Date() and Date.now()";',
    "// deterministic-test-allow wall-clock: vi.useFakeTimers and setSystemTime own this case.\nconst now = new Date();",
  ])
    assert.deepEqual(
      deterministicTestViolations("apps/telegram/test/example.test.ts", source),
      [],
    );
  assert.deepEqual(
    deterministicTestViolations(
      "scripts/diagnostic.mjs",
      "const now = Date.now();",
      false,
    ),
    [],
  );
});

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

test("loop, catch and named expression clocks are local bindings", () => {
  for (const source of [
    "for (const Date of clocks) { Date.now(); }",
    "for (let Date = clock; Date; ) { Date.now(); }",
    "for (const Date in clocks) { Date.now(); }",
    "for (var Date of clocks) {} Date.now();",
    "{ var Date = clock; } Date.now();",
    "try { run(); } catch (Date) { Date.now(); }",
    "const read = function Date() { return Date.now(); };",
    "const clock = class Date { static read() { return Date.now(); } };",
  ])
    assert.deepEqual(
      deterministicTestViolations("test/example.test.ts", source),
      [],
    );
  assert.match(
    deterministicTestViolations(
      "test/example.test.ts",
      "for (const Date of clocks) { Date.now(); } Date.now();",
    ).join("\n"),
    /wall-clock/u,
  );
});

test("a property named global is not the global clock owner", () => {
  for (const owner of ["global", "globalThis", "window"])
    assert.deepEqual(
      deterministicTestViolations(
        "test/example.test.ts",
        `clock.${owner}.Date.now();`,
      ),
      [],
    );
  assert.match(
    deterministicTestViolations(
      "test/example.test.ts",
      "globalThis.Date.now();",
    ).join("\n"),
    /wall-clock/u,
  );
});

test("hoisted clock bindings do not escape static blocks or function bodies", () => {
  for (const source of [
    "class Fixture { static { var Date = clock; } } Date.now();",
    "function read(now = Date.now()) { var Date = clock; return now; }",
  ])
    assert.match(
      deterministicTestViolations("test/example.test.ts", source).join("\n"),
      /wall-clock/u,
    );
  for (const kind of ["var", "let", "const"])
    assert.deepEqual(
      deterministicTestViolations(
        "test/example.test.ts",
        `class Fixture { static { ${kind} Date = clock; Date.now(); } }`,
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
  for (const rule of [
    "duration-wait",
    "shared-mutation",
    "unit-io",
    "process-cleanup",
    "wall-clock",
  ])
    assert.ok(result.stderr.includes(rule), result.stderr);
});

test("exported seeds and a reset in another scope cannot escape the rule", () => {
  for (const source of [
    'export const seed = []; test("x", () => seed.push(1));',
    'const seed = []; describe("a", () => {beforeEach(() => {seed.length = 0;});}); test("b", () => seed.push(1));',
    'const seed = []; beforeEach(() => {const seed = []; seed.length = 0;}); test("b", () => seed.push(1));',
    'const seed = []; beforeEach(() => {function unused() {seed.length = 0;}}); test("b", () => seed.push(1));',
  ])
    assert.match(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ).join("\n"),
      /shared-mutation/u,
    );
});

test("one reason cannot exempt two calls on the following line", () => {
  assert.equal(
    deterministicTestViolations(
      "apps/web/test/example.spec.ts",
      "// deterministic-test-allow duration-wait: Bound one stuck wait.\nsetTimeout(done, 10); setTimeout(done, 20);",
    ).length,
    1,
  );
});

test("destructured local bindings are fresh data", () => {
  for (const source of [
    "const seed = {}; function increment({seed}) { seed.count++; }",
    'const seed = []; test("x", () => { const {seed} = fresh(); seed.push(1); });',
  ])
    assert.deepEqual(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ),
      [],
    );
});

test("suite seeds are shared but test-local seeds are fresh", () => {
  assert.match(
    deterministicTestViolations(
      "apps/backend/test/unit/example.test.ts",
      'describe("s", () => {const seed = []; test("x", () => seed.push(1));});',
    ).join("\n"),
    /shared-mutation/u,
  );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/backend/test/unit/example.test.ts",
      'describe("s", () => {const seed = []; beforeEach(() => {seed.length = 0;}); test("x", () => seed.push(1));});',
    ),
    [],
  );
});

test("immutable service methods and beforeAll arrangement are allowed", () => {
  for (const source of [
    'const store = {delete() {}}; test("x", () => store.delete());',
    'const seed = {}; beforeAll(() => { seed.id = "fixed"; }); test("x", () => expect(seed.id).toBe("fixed"));',
  ])
    assert.deepEqual(
      deterministicTestViolations(
        "apps/backend/test/unit/example.test.ts",
        source,
      ),
      [],
    );
});

test("a test process without an exit cleanup owner is refused", () => {
  assert.match(
    deterministicTestViolations(
      "apps/backend/test/unit/example.test.ts",
      'const child = spawn("load");',
    ).join("\n"),
    /process-cleanup/u,
  );
  assert.deepEqual(
    deterministicTestViolations(
      "apps/backend/test/integration/example.test.ts",
      'const child = spawn("load"); try { await work(); } finally { await stopProcessGroup(child); }',
    ),
    [],
  );
});

test("diagnostic process aliases need cleanup, an unrelated child does not satisfy it", () => {
  for (const source of [
    'import { spawn as launch } from "node:child_process"; const load = launch("sleep", ["600"]);',
    'const load = spawn("load"); try { work(); } finally { other.kill(); }',
    'const load = spawn("load"); afterEach(() => { const load = other(); load.kill(); });',
    'const load = spawn("load"); try { work(); } finally { function unused() { load.kill(); } }',
  ])
    assert.match(
      deterministicTestViolations("scripts/diagnostic.mjs", source, false).join(
        "\n",
      ),
      /process-cleanup/u,
    );
  assert.deepEqual(
    deterministicTestViolations(
      "scripts/diagnostic.mjs",
      'const load = spawn("load"); try { work(); } finally { signalProcessGroup(load.pid, "SIGKILL"); }',
      false,
    ),
    [],
  );
});

test("EXIT cleanup leaves no background load on success, failure, timeout or SIGTERM", async () => {
  for (const [mode, code] of [
    ["success", 0],
    ["failure", 23],
    ["signal", 143],
    ["timeout", 143],
  ]) {
    const child = spawn(
      "bash",
      [
        fileURLToPath(
          new URL("./fixtures/process-cleanup.sh", import.meta.url),
        ),
        String(mode),
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (mode === "timeout")
      child.stdout.once("data", () => {
        AbortSignal.timeout(25).addEventListener(
          "abort",
          () => child.kill("SIGTERM"),
          { once: true },
        );
      });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    try {
      await once(child, "close", {
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(child.exitCode, code);
      const pid = Number(stdout.trim());
      assert.ok(Number.isInteger(pid) && pid > 0, stdout);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      // The test owns the entire fixture group even if the fixture breaks or times out.
      if (child.pid !== undefined) signalProcessGroup(child.pid, "SIGKILL");
    }
  }
});

test("cleanup resolves acquisition assignments and a child named process", () => {
  for (const source of [
    'let child; try { child = spawn("load"); await work(); } finally { child?.kill("SIGKILL"); }',
    'const process = spawn("load"); try { await work(); } finally { process.kill("SIGKILL"); }',
  ])
    assert.deepEqual(
      deterministicTestViolations("scripts/diagnostic.mjs", source, false),
      [],
    );
});
