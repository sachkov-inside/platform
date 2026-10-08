// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "../owned-process.mjs";

test(
  "owned command supervision cleans real descendants across owner exits and signals",
  { timeout: 90_000 },
  async () => {
    const child = spawnOwned(
      "python3",
      ["scripts/owned-process/test_supervisor.py"],
      {
        stdio: "inherit",
      },
    );
    try {
      /** @type {Promise<number | null>} */
      const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
      });
      const status = await exited;
      assert.equal(status, 0);
    } finally {
      await stopOwned(child);
    }
  },
);
