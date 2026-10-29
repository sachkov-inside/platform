// @ts-check
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "../owned-process.mjs";

test("owner exit grace validates before acquisition and stays outside spawn options", (context) => {
  const boundary = new Error("spawn boundary");
  const spawn = context.mock.method(childProcess, "spawn", () => {
    throw boundary;
  });
  syncBuiltinESMExports();
  try {
    for (const value of [
      -1,
      5001,
      NaN,
      Infinity,
      -Infinity,
      "0",
      null,
      true,
      {},
    ]) {
      assert.throws(
        // Deliberately exercise untyped callers at the public boundary.
        // @ts-expect-error Invalid runtime option.
        () => spawnOwned("unused", [], { ownerExitGraceMilliseconds: value }),
        RangeError,
      );
    }
    assert.equal(spawn.mock.callCount(), 0);
    for (const value of [undefined, 0, 123.5, 5000]) {
      const options = Object.freeze({
        ...(value === undefined ? {} : { ownerExitGraceMilliseconds: value }),
        cwd: "/",
        stdio: "pipe",
      });
      assert.throws(
        () => spawnOwned("unused", ["argument"], options),
        (error) => error === boundary,
      );
      const call = spawn.mock.calls.at(-1);
      assert(call !== undefined);
      const [command, args, received] = call.arguments;
      assert(args !== undefined && received !== undefined);
      assert.equal(command, "python3");
      assert.equal(args.length, value === undefined ? 3 : 4);
      assert.equal(args[1], '["unused","argument"]');
      if (value !== undefined) assert.equal(args[3], String(value));
      assert(!Object.hasOwn(received, "ownerExitGraceMilliseconds"));
      assert.equal(received.cwd, "/");
      assert.equal(options.ownerExitGraceMilliseconds, value);
    }
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
});

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
