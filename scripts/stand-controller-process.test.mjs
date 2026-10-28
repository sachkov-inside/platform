// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { commandExit } from "./diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { controlStand } from "./stand-controller.mjs";

test("abrupt controller death preserves the review and never reports the unfinished runtime ready (owned subprocess contract)", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-crash-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, "controller.mjs");
  await writeFile(
    script,
    `import {writeFile} from 'node:fs/promises';
import {controlStand} from ${JSON.stringify(new URL("./stand-controller.mjs", import.meta.url).href)};
import {acquireLocalSetupLock} from ${JSON.stringify(new URL("./local-setup-lock.mjs", import.meta.url).href)};
const directory = ${JSON.stringify(directory)};
await controlStand({command:'show',worktree:'/fixture/a'}, {
  directory, controller:'/fixture/controller',
  acquire: () => acquireLocalSetupLock('busy', directory+'/lock'),
  source: async (root) => ({root,head:'fixture',fingerprint:'source',build:'build',schema:'schema',infrastructure:'infra',identity:'identity'}),
  inspect: async () => ({daemon:'fixture',containers:[]}),
  prepare: async ({generation}) => {
    await writeFile(directory+'/runtime.json', JSON.stringify({generation}));
    // A pending promise holds no event-loop handle. Without this referenced timer Node exits
    // with status 13 (unsettled top-level await) and races the parent's SIGKILL.
    setInterval(() => {}, 2 ** 31 - 1);
    process.stdout.write(JSON.stringify({pid:process.pid})+'\\n');
    await new Promise(() => {});
  },
  ready: async () => { throw new Error('unfinished'); }
});`,
  );
  const child = spawnOwned(process.execPath, [script], { timeout: 10_000 });
  t.after(() => stopOwned(child));
  const started = new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
      if (output.includes("\n")) {
        try {
          resolve(
            z
              .object({ pid: z.number().int().positive() })
              .parse(JSON.parse(output.trim())).pid,
          );
        } catch (error) {
          reject(error);
        }
      }
    });
    child.once("error", reject);
    child.once("exit", () =>
      reject(new Error("Controller exited before the preparation barrier")),
    );
  });
  const pid = z
    .number()
    .int()
    .positive()
    .parse(await started);
  process.kill(pid, "SIGKILL");
  // owned-process.py reports a signal death as 128 + signal: a self-exit (status 13) fails here.
  assert.equal(await commandExit(child), 128 + constants.signals.SIGKILL);
  await stopOwned(child);
  const runtime = z
    .object({ generation: z.uuid() })
    .parse(JSON.parse(await readFile(join(directory, "runtime.json"), "utf8")));
  const result = await controlStand(
    { command: "status", worktree: "/fixture/b" },
    {
      directory,
      controller: "/fixture/controller",
      inspect: async () => ({
        daemon: "fixture",
        containers: [
          {
            id: "partial-web",
            service: "web",
            image: "partial-image",
            generation: runtime.generation,
            running: true,
            health: "healthy",
          },
        ],
      }),
    },
  );
  assert.equal(result.status, "recovery");
  assert.equal(result.reservation?.worktree, "/fixture/a");
});
