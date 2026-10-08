// @ts-check
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { spawnOwned, stopOwned } from "../owned-process.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const backendRequire = createRequire(
  new URL("../../apps/backend/package.json", import.meta.url),
);
const fixture = fileURLToPath(new URL("./launcher-ownership.py", import.meta.url));

for (const surface of ["production-web", "dev-api-vitest"]) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"]) {
    test(
      `${surface} terminates detached TCP load after owner ${signal}`,
      { timeout: 60_000 },
      async () => {
        // Resolve the installed runner. This contract never invokes an installer or app build.
        const vitest = resolve(
          dirname(backendRequire.resolve("vitest/package.json")),
          "vitest.mjs",
        );
        const child = spawnOwned(
          "python3",
          [
            fixture,
            "--root",
            root,
            "--node",
            process.execPath,
            "--vitest",
            vitest,
            "--surface",
            surface,
            "--signal",
            signal,
          ],
          {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
            signal: AbortSignal.timeout(55_000),
          },
        );
        /** @type {string[]} */
        const output = [];
        for (const stream of [child.stdout, child.stderr])
          stream?.on("data", (/** @type {Buffer} */ chunk) =>
            output.push(chunk.toString()),
          );
        try {
          /** @type {Promise<number | null>} */
          const exited = new Promise((accept, reject) => {
            child.once("error", reject);
            child.once("exit", (code) => accept(code));
          });
          assert.equal(await exited, 0, output.join(""));
        } finally {
          await stopOwned(child);
        }
      },
    );
  }
}
