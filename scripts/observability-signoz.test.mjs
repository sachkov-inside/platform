// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { verify } from "./observability-signoz/verify.mjs";

test("SigNoz dispatch reserves 60 seconds only for the default source aggregate", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const { EventEmitter } = await import("node:events");
  const source = await readFile(
    "scripts/observability-signoz/verify.mjs",
    "utf8",
  );
  const body = source
    .slice(0, source.indexOf("\nif ("))
    .replace(/^import [^\n]+;\n/gmu, "")
    .replace("export async function", "async function");
  for (const [
    options,
    expected,
  ] of /** @type {[{args?: string[], timeoutMs?: number}, number][]} */ ([
    [{}, 60000],
    [{ args: ["fixture"] }, 30000],
    [{ timeoutMs: 30000 }, 30000],
    [{ args: ["fixture"], timeoutMs: 700 }, 700],
    [{ timeoutMs: 30001 }, 0],
    [{ args: ["fixture"], timeoutMs: 30001 }, 0],
    [{ timeoutMs: 0 }, 0],
    [{ timeoutMs: Number.NaN }, 0],
  ])) {
    /** @type {number[]} */
    const budgets = [];
    let starts = 0;
    let stops = 0;
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      pid: 123,
      stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
    });
    const context = {
      options,
      process: { env: {}, on: () => {}, off: () => {} },
      fileURLToPath: () => "owned-supervisor",
      resolve: () => "owned-supervisor",
      /** @param {string} command @param {string[]} args */
      spawnOwned: (command, args) => {
        starts++;
        assert.equal(command, "python3");
        assert.deepEqual(
          JSON.parse(JSON.stringify(args)),
          options.args ?? [
            "-B",
            "-m",
            "unittest",
            "discover",
            "-s",
            "scripts/observability-signoz",
            "-p",
            "test_*.py",
          ],
        );
        queueMicrotask(() => child.emit("exit"));
        return child;
      },
      /** @param {unknown} owned @param {number} graceMs */
      stopOwned: (owned, graceMs) => {
        stops++;
        assert.equal(owned, child);
        assert.equal(graceMs, 100);
        child.emit("close");
        return Promise.resolve();
      },
      /** @param {unknown} _callback @param {number} ms */
      setTimeout: (_callback, ms) => budgets.push(ms),
      clearTimeout: () => {},
    };
    const run = async () => {
      /** @type {unknown} */
      const result = await runInNewContext(
        body + "\nverify(options);",
        context,
      );
      return result;
    };
    if (expected === 0) {
      await assert.rejects(run);
      assert.equal(starts, 0);
      assert.equal(stops, 0);
      assert.deepEqual(budgets, []);
    } else {
      await run();
      assert.equal(starts, 1);
      assert.equal(stops, 2);
      assert.deepEqual(budgets, [expected]);
    }
  }
});

// deterministic-test-allow unit-io: existing outside native owner covers detached Python fixture sessions, including death of this Node owner; no Docker/live providers.
test("SigNoz functional witness preserves private evidence and owned fault cleanup", async () => {
  // The nested owner fault must reach its benign fixture before the ready deadline.
  // Ordinary runs retain the complete Python suite under its aggregate guard.
  const result = await verify(
    process.env["SIGNOZ_WRAPPER_FIXTURE"]
      ? {
          args: ["-B", "scripts/observability-signoz/test_wrapper_fixture.py"],
        }
      : {},
  );
  assert.equal(result.reason, "exit");
  assert.equal(result.code, 0, result.stderr);
});
