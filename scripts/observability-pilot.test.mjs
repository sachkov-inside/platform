// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

if (
  process.platform !== "linux" ||
  process.env["INSIDE_CORE_SOURCE_PROGRESS"] !== "1"
) {
  // deterministic-test-allow unit-io: Python owns bounded local process/loopback contracts; no Docker or live providers.
  test("observability pilot preparation preserves admission and private query boundaries", () => {
    const result = spawnSync(
      "python3",
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        "scripts/observability-pilot",
        "-p",
        "test_*.py",
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
  });
} else {
  // deterministic-test-allow unit-io: identical synchronous Python source lifetime and original30s; fixed markers add no process containment guarantee.
  test("observability pilot preparation preserves admission and private query boundaries", async () => {
    const { assertCoreContracts } =
      await import("./observability-pilot/source-progress.mjs");
    const result = spawnSync(
      "python3",
      ["scripts/observability-pilot/source_runner.py"],
      { encoding: "utf8", timeout: 30000 },
    );
    assertCoreContracts(result);
  });

  test("Core passive progress validates the entire bounded fixed prefix", async () => {
    const { readFile } = await import("node:fs/promises");
    const { sourceProgress, assertCoreContracts } =
      await import("./observability-pilot/source-progress.mjs");
    /** @type {unknown} */
    const raw = JSON.parse(
      await readFile("scripts/observability-pilot/source-tests.json", "utf8"),
    );
    assert.ok(
      Array.isArray(raw) &&
        raw.length === 274 &&
        raw.every((value) => typeof value === "string"),
    );
    const first = raw[0];
    const second = raw[1];
    assert.ok(typeof first === "string" && typeof second === "string");
    const start = `CORE_SOURCE_V1 start ${first}\n`;
    const completed = `CORE_SOURCE_V1 completed ${first}\n`;
    assert.deepEqual(sourceProgress(start), {
      lastStarted: first,
      lastCompleted: null,
      completedCount: 0,
    });
    assert.deepEqual(sourceProgress(start + completed), {
      lastStarted: first,
      lastCompleted: first,
      completedCount: 1,
    });
    const full = raw
      .map(
        (id) => `CORE_SOURCE_V1 start ${id}\nCORE_SOURCE_V1 completed ${id}\n`,
      )
      .join("");
    assert.equal(Buffer.byteLength(full), 72932);
    assert.equal(sourceProgress(full)?.completedCount, 274);
    for (const invalid of [
      "",
      "legacy private-canary",
      completed,
      start + start,
      start + completed + completed,
      `CORE_SOURCE_V1 start ${second}\n`,
      start + `CORE_SOURCE_V1 completed ${second}\n`,
      start.slice(0, -1),
      start + "CORE_SOURCE",
      start.replace("V1", "V2"),
      start.replace("start", "other"),
      start.replace(first, "private-canary"),
      start.replace("\n", "\r\n"),
      start.replace("start ", "start  "),
      "private-prefix " + start,
      start + "CORE_SOURCE_private-canary\n",
      start + "CORE_SOURCE_é\n",
      full + start,
      start + "CORE_SOURCE" + "x".repeat(131072) + "\n",
      start + "x".repeat(1_048_576),
    ]) {
      assert.equal(sourceProgress(invalid), null);
    }
    assert.equal(
      sourceProgress({
        toString() {
          throw new Error("foreign string");
        },
      }),
      null,
    );
    assert.deepEqual(
      sourceProgress(start + "x".repeat(1_048_576 - Buffer.byteLength(start))),
      { lastStarted: first, lastCompleted: null, completedCount: 0 },
    );
    // deterministic-test-allow unit-io: the fixed separate three-method synthetic entry acquires only private stdio; it never runs the original274 fixtures.
    assertCoreContracts(
      spawnSync(
        "python3",
        ["scripts/observability-pilot/source_progress_contract.py"],
        { encoding: "utf8", timeout: 30000 },
      ),
    );
  });

  test("Core passive assertions retain native outcome and redact foreign captures", async () => {
    const { sourceProgress, assertCoreContracts } =
      await import("./observability-pilot/source-progress.mjs");
    const { readFile } = await import("node:fs/promises");
    /** @type {unknown} */
    const raw = JSON.parse(
      await readFile("scripts/observability-pilot/source-tests.json", "utf8"),
    );
    assert.ok(Array.isArray(raw) && raw.every((id) => typeof id === "string"));
    const first = raw[0];
    assert.ok(typeof first === "string");
    const prefix = `CORE_SOURCE_V1 start ${first}\n`;
    const full = raw
      .map(
        (id) => `CORE_SOURCE_V1 start ${id}\nCORE_SOURCE_V1 completed ${id}\n`,
      )
      .join("");
    const beforeRead = {
      status: null,
      signal: "SIGTERM",
      error: { code: "ENOBUFS" },
      get stderr() {
        throw new Error("private-canary");
      },
    };
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
          throw new Error("private-canary");
        },
        getOwnPropertyDescriptor() {
          traps++;
          throw new Error("private-canary");
        },
      },
    );
    const failures = [
      beforeRead,
      proxy,
      null,
      {},
      { status: 0, signal: null, error: proxy },
      {
        get status() {
          throw new Error("private-canary");
        },
        signal: null,
      },
      {
        status: {
          toString() {
            throw new Error("private-canary");
          },
        },
        signal: null,
      },
      {
        status: 0,
        get signal() {
          throw new Error("private-canary");
        },
      },
      {
        status: 0,
        signal: null,
        error: {
          get code() {
            throw new Error("private-canary");
          },
        },
      },
      {
        status: 0,
        signal: null,
        error: {
          code: "private-canary",
          get message() {
            throw new Error("private-canary");
          },
        },
      },
      { status: 1, signal: null, stderr: full },
      { status: null, signal: null, stderr: full },
      { status: 0, signal: "SIGTERM", stderr: full },
      {
        status: null,
        signal: "SIGTERM",
        error: { code: "ETIMEDOUT" },
        stderr: prefix + "private-canary",
      },
    ];
    for (const value of failures) {
      try {
        assertCoreContracts(value);
        assert.fail("controlled native failure hidden");
      } catch (error) {
        assert.ok(error instanceof assert.AssertionError);
        assert.ok(!error.message.includes("private-canary"));
        assert.ok(!error.stack?.includes("private-canary"));
        assert.ok(error.message.includes("Core source progress:"));
      }
    }
    assert.equal(traps, 0);
    for (const stderr of [
      "legacy private-canary",
      prefix + "CORE_SOURCE_bad\n",
      full,
    ]) {
      assertCoreContracts({ status: 0, signal: null, stderr });
    }
    assertCoreContracts({
      status: 0,
      signal: null,
      get stderr() {
        throw new Error("never inspect getter");
      },
    });
    assert.equal(sourceProgress(full)?.completedCount, 274);
  });

  test("Core passive dispatch retains exact legacy platform and flag branches", async () => {
    const { readFile } = await import("node:fs/promises");
    const { runInNewContext } = await import("node:vm");
    const { assertCoreContracts } =
      await import("./observability-pilot/source-progress.mjs");
    const source = await readFile(
      "scripts/observability-pilot.test.mjs",
      "utf8",
    );
    const body = source
      .replace(/^import [^\n]+;\n/gmu, "")
      .replaceAll(
        /import\("[^"\n]*source-progress\.mjs"\)/gu,
        "importHelper()",
      );
    for (const [platform, flag] of [
      ["darwin", undefined],
      ["darwin", "1"],
      ["linux", undefined],
      ["linux", "true"],
      ["linux", "1"],
    ]) {
      /** @type {Array<()=>unknown>} */
      const callbacks = [];
      /** @type {unknown[][]} */
      const calls = [];
      let imports = 0;
      runInNewContext(body, {
        process: { platform, env: { INSIDE_CORE_SOURCE_PROGRESS: flag } },
        assert,
        /** @param {unknown} _title @param {()=>unknown} callback */
        test: (_title, callback) => callbacks.push(callback),
        /** @param {unknown[]} args */
        spawnSync: (...args) => {
          calls.push(args);
          return { status: 0, signal: null, stderr: "private-canary" };
        },
        importHelper: async () => {
          imports++;
          return { assertCoreContracts };
        },
      });
      const callback = callbacks[0];
      assert.ok(callback !== undefined);
      await callback();
      const admitted = platform === "linux" && flag === "1";
      assert.equal(callbacks.length, admitted ? 4 : 1);
      assert.equal(imports, admitted ? 1 : 0);
      assert.equal(calls.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
        "python3",
        admitted
          ? ["scripts/observability-pilot/source_runner.py"]
          : [
              "-m",
              "unittest",
              "discover",
              "-s",
              "scripts/observability-pilot",
              "-p",
              "test_*.py",
            ],
        { encoding: "utf8", timeout: 30000 },
      ]);
    }
  });
}
