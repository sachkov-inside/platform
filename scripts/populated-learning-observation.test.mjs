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

for (const outcome of ["success", "timeout"]) {
  test(`populated learning ${outcome} observation survives the real default reporter`, async () => {
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
        .map((line) => JSON.parse(line));
      assert.ok(
        records.length > 0,
        `No stage output from ${outcome}: ${output}`,
      );
      assert.ok(records.every((record) => Number.isFinite(record.monotonicMs)));
      assert.deepEqual(records[0].stage, "beforeAll");
      assert.deepEqual(records.at(-1).stage, "cleanup");
      assert.deepEqual(records.at(-1).phase, "end");
      const started = new Set();
      for (const record of records) {
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
        assert.doesNotMatch(output, /1 passed/u);
      } else assert.equal(started.size, 0);
    } finally {
      await stopOwned(child);
    }
  });
}
