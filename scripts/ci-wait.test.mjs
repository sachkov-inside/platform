// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

test("exact CI observation rejects missing, stale, failed and incomplete runs", async () => {
  const child = spawnOwned(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts",
      "-p",
      "test_ci_wait.py",
    ],
    { stdio: "inherit" },
  );
  const deadline = setTimeout(() => {
    void stopOwned(child);
  }, 10_000);
  try {
    assert.equal(await commandExit(child), 0);
  } finally {
    clearTimeout(deadline);
    await stopOwned(child);
  }
});
