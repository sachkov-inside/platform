// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

test("acquisition guard closes exited launchers' pipe holders and preserves deadline failures (native process contracts)", async () => {
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
      "test_acquisition_diagnostic_guard.py",
    ],
    { stdio: "inherit" },
  );
  // deterministic-test-allow duration-wait: bounds the native process-contract suite; child exit is its completion barrier.
  const deadline = setTimeout(() => {
    void stopOwned(child);
  }, 20_000);
  try {
    assert.equal(await commandExit(child), 0);
  } finally {
    clearTimeout(deadline);
    await stopOwned(child);
  }
});
