import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { z } from "zod";
import { watchCrashWorker } from "../integration/setup/crash-worker.js";
import { crashWorkerSignals } from "../integration/setup/crash-worker-protocol.js";

test("SIGKILL closes the compiler descendant's inherited stderr before settling the crash worker", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "notification-crash-process-"),
  );
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const pidFile = join(directory, "compiler.pid");
  const fixture = join(directory, "worker.cjs");
  await writeFile(
    fixture,
    `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const compiler = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "inherit"] });
compiler.once("spawn", () => {
  writeFileSync(${JSON.stringify(pidFile)}, String(compiler.pid));
  process.send(${JSON.stringify(crashWorkerSignals.ready)});
});
setInterval(() => {}, 1000);
`,
  );
  const child = fork(fixture, [], {
    execArgv: [],
    detached: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const closed = once(child, "close");
  // Independent cleanup owns the entire group even when the monitor under test hangs.
  onTestFinished(async () => {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        ))
          throw error;
      }
    }
    await closed;
  });
  const worker = watchCrashWorker(child);
  await worker.reaches(crashWorkerSignals.ready, 5_000);
  const compilerPid = z.coerce
    .number()
    .int()
    .positive()
    .parse(await readFile(pidFile, "utf8"));
  const death = await worker.kill();
  expect(death.signal).toBe("SIGKILL");
  // The descendant may await adoption/reaping, but it must no longer be running.
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(compilerPid)], {
    encoding: "utf8",
  });
  expect(state.error).toBeUndefined();
  expect(state.stdout.trim()).toMatch(/^(?:Z\S*)?$/u);
});
