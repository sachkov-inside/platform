// @ts-check
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { commandExit } from "./diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const backend = fileURLToPath(new URL("../apps/backend/", import.meta.url));
const requireBackend = createRequire(join(backend, "package.json"));
const vitest = dirname(requireBackend.resolve("vitest/package.json"));
const fixture = join(backend, "test/fixtures/populated-learning-observation");

/** @param {string} line */
function readStage(line) {
  /** @type {unknown} */
  const value = JSON.parse(line);
  assert.ok(typeof value === "object" && value !== null);
  assert.deepEqual(Object.keys(value).sort(), [
    "diagnostic",
    "monotonicMs",
    "phase",
    "stage",
  ]);
  assert.ok("diagnostic" in value && value.diagnostic === "populated-learning");
  assert.ok("stage" in value && typeof value.stage === "string");
  assert.ok(
    "phase" in value &&
      (value.phase === "start" ||
        value.phase === "end" ||
        value.phase === "failed"),
  );
  assert.ok("monotonicMs" in value && typeof value.monotonicMs === "number");
  return {
    diagnostic: value.diagnostic,
    stage: value.stage,
    phase: value.phase,
    monotonicMs: value.monotonicMs,
  };
}

for (const outcome of ["success", "timeout"]) {
  test(`populated learning ${outcome} observation survives the real default reporter`, async (t) => {
    const child = spawnOwned(
      process.execPath,
      [join(vitest, "vitest.mjs"), "run", `${outcome}.case.ts`],
      { cwd: fixture, timeout: 20000 },
    );
    let output = "";
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    });
    try {
      assert.equal(
        await commandExit(child),
        outcome === "success" ? 0 : 1,
        output,
      );
      const records = output
        .split("\n")
        .filter((line) => line.startsWith('{"diagnostic":"populated-learning"'))
        .map(readStage);
      assert.ok(
        records.length > 0,
        `No stage output from ${outcome}: ${output}`,
      );
      assert.ok(records.every((record) => Number.isFinite(record.monotonicMs)));
      const first = records[0];
      const last = records.at(-1);
      assert.ok(first !== undefined && last !== undefined);
      assert.deepEqual(first.stage, "beforeAll");
      assert.deepEqual(last.stage, "cleanup");
      assert.deepEqual(last.phase, "end");
      const started = new Set();
      let previousTime = Number.NEGATIVE_INFINITY;
      for (const record of records) {
        assert.ok(record.monotonicMs >= previousTime);
        previousTime = record.monotonicMs;
        assert.deepEqual(Object.keys(record).sort(), [
          "diagnostic",
          "monotonicMs",
          "phase",
          "stage",
        ]);
        if (record.phase === "start") started.add(record.stage);
        if (record.phase === "end") started.delete(record.stage);
      }
      if (outcome === "timeout") {
        assert.match(output, /Hook timed out in 150ms/u);
        assert.deepEqual([...started], ["beforeAll", "rustfs-start-health"]);
        assert.match(output, /1 skipped/u);
        assert.doesNotMatch(output, /1 passed/u);
      } else {
        assert.equal(started.size, 0);
        assert.ok(records.some((record) => record.stage === "accounts-http"));
      }
      t.diagnostic(JSON.stringify({ outcome, records }));
    } finally {
      await stopOwned(child);
    }
  });
}
