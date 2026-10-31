// @ts-check
import { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

test("Compose captures healthy MinIO resource observations without logs or inspect secrets", async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "minio-diagnostics-"));
  try {
    const docker = resolve(fixture, "docker");
    writeFileSync(
      docker,
      `#!/bin/sh
case "$1" in
 ps) echo container123;;
 inspect) case "$3" in
  *Labels*) echo 'object-storage:running:healthy';;
  *) echo '{"running":true,"restarts":0,"health":"healthy","Env":"SECRET_SENTINEL"}';;
 esac;;
 stats) if [ "\${STALL_STATS:-0}" = 3 ]; then exec python3 -c 'print("SECRET_SENTINEL" * 500)'; fi; if [ "\${STALL_STATS:-0}" = 2 ]; then trap '' TERM; sleep 60 & echo $! >"$DESCENDANT_PID"; wait; fi; if [ "\${STALL_STATS:-0}" = 1 ]; then exec sleep 60; fi; echo '{"CPUPerc":"0.01%","MemUsage":"12MiB / 1GiB","NetIO":"2kB / 3kB","BlockIO":"0B / 1kB","PIDs":"9","Name":"SECRET_SENTINEL"}';;
 logs) echo 'SECRET_SENTINEL'; exit 97;;
esac
`,
      { mode: 0o755 },
    );
    const artifact = resolve(fixture, "artifacts");
    const result = spawnSync(
      "bash",
      ["scripts/compose-failure-diagnostics.sh", artifact, docker],
      {
        env: { ...process.env, PATH: `${fixture}:${process.env["PATH"]}` },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const files = readdirSync(artifact);
    assert.deepEqual(files, ["container123-minio.json"]);
    const file = files[0];
    assert.ok(file);
    const content = readFileSync(resolve(artifact, file), "utf8");
    assert.ok(!content.includes("SECRET_SENTINEL"));
    assert.ok(!result.stderr.includes("SECRET_SENTINEL"));
    const observation = z
      .object({
        state: z.object({ running: z.boolean() }),
        resources: z.object({ cpu: z.string() }),
      })
      .parse(JSON.parse(content));
    assert.equal(observation.state.running, true);
    assert.equal(observation.resources.cpu, "0.01%");
    assert.ok(content.length < 4096);
    const stalled = spawnSync(
      "bash",
      ["scripts/compose-failure-diagnostics.sh", artifact, docker],
      {
        env: {
          ...process.env,
          PATH: `${fixture}:${process.env["PATH"]}`,
          STALL_STATS: "1",
        },
        encoding: "utf8",
        timeout: 8000,
      },
    );
    assert.equal(stalled.status, 0, stalled.stderr);
    assert.equal(
      z
        .object({ resources: z.null() })
        .parse(JSON.parse(readFileSync(resolve(artifact, file), "utf8")))
        .resources,
      null,
    );
    const oversized = spawnSync(
      process.execPath,
      [
        "scripts/minio-failure-diagnostics.mjs",
        "container123",
        resolve(artifact, "oversized.json"),
      ],
      {
        env: {
          ...process.env,
          PATH: `${fixture}:${process.env["PATH"]}`,
          STALL_STATS: "3",
        },
        encoding: "utf8",
        timeout: 8000,
      },
    );
    assert.equal(oversized.status, 0, oversized.stderr);
    const oversizedContent = readFileSync(
      resolve(artifact, "oversized.json"),
      "utf8",
    );
    assert.equal(
      z.object({ resources: z.null() }).parse(JSON.parse(oversizedContent))
        .resources,
      null,
    );
    assert.ok(!oversizedContent.includes("SECRET_SENTINEL"));
    const pidFile = resolve(fixture, "descendant.pid");
    const hostile = spawnOwned(
      process.execPath,
      [
        "scripts/minio-failure-diagnostics.mjs",
        "container123",
        resolve(artifact, "hostile.json"),
      ],
      {
        env: {
          ...process.env,
          PATH: `${fixture}:${process.env["PATH"]}`,
          STALL_STATS: "2",
          DESCENDANT_PID: pidFile,
        },
        stdio: "ignore",
      },
    );
    let exceededBudget = false;
    // deterministic-test-allow duration-wait: failure budget for a hostile diagnostic subprocess; supervisor exit is the barrier.
    const deadline = setTimeout(() => {
      exceededBudget = true;
      void stopOwned(hostile, 50);
    }, 5500);
    try {
      const status = await commandExit(hostile);
      assert.equal(
        exceededBudget,
        false,
        "collector must bound a SIGTERM-resistant command tree",
      );
      assert.equal(status, 0);
      const descendant = Number(readFileSync(pidFile, "utf8").trim());
      assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    } finally {
      clearTimeout(deadline);
      await stopOwned(hostile, 50);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
