// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { qualityCommand } from "./quality-command.mjs";

const fixture = fileURLToPath(
  new URL("./fixtures/quality-command.mjs", import.meta.url),
);
for (const [mode, expected] of /** @type {const} */ ([
  ["success", 0],
  ["failure", 7],
  ["timeout", 143],
  ["interruption", 143],
])) {
  test(
    `quality command owned-process contract cleans detached load after ${mode}`,
    { timeout: 20_000 },
    async () => {
      const result = await qualityCommand(process.execPath, [fixture, mode], {
        timeout: 5_000,
      });
      assert.equal(result.status, expected, result.stderr);
      const pids = z
        .object({
          owner: z.number().int().positive(),
          descendant: z.number().int().positive(),
        })
        .parse(JSON.parse(result.stdout.trim()));
      for (const pid of Object.values(pids)) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
    },
  );
}
