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
  watch,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

test("Compose captures healthy MinIO resource observations without logs or inspect secrets", async (t) => {
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
    for (const mode of ["healthy", "stalled", "oversized"]) {
      const command = mode === "oversized" ? process.execPath : "bash";
      const destination = resolve(artifact, "container123-minio.json");
      const args =
        mode === "oversized"
          ? [
              "scripts/minio-failure-diagnostics.mjs",
              "container123",
              destination,
            ]
          : ["scripts/compose-failure-diagnostics.sh", artifact, docker];
      const child = spawnOwned(command, args, {
        env: {
          ...process.env,
          PATH: `${fixture}:${process.env["PATH"]}`,
          STALL_STATS:
            mode === "healthy" ? "0" : mode === "stalled" ? "1" : "3",
        },
        stdio: "ignore",
      });
      t.after(() => stopOwned(child, 50));
      const cancel = () => {
        void stopOwned(child, 50);
      };
      t.signal.addEventListener("abort", cancel, { once: true });
      if (t.signal.aborted) cancel();
      let exceededBudget = false;
      // deterministic-test-allow duration-wait: launcher failure budget; supervisor exit proves cleanup before fixture deletion.
      const deadline = setTimeout(() => {
        exceededBudget = true;
        cancel();
      }, 8000);
      try {
        assert.equal(await commandExit(child), 0);
        assert.equal(exceededBudget, false);
        const files = readdirSync(artifact);
        assert.deepEqual(files, ["container123-minio.json"]);
        const content = readFileSync(destination, "utf8");
        assert.ok(!content.includes("SECRET_SENTINEL"));
        assert.ok(content.length < 4096);
        if (mode === "healthy") {
          const observation = z
            .object({
              state: z.object({ running: z.boolean() }),
              resources: z.object({ cpu: z.string() }),
            })
            .parse(JSON.parse(content));
          assert.equal(observation.state.running, true);
          assert.equal(observation.resources.cpu, "0.01%");
        } else {
          assert.equal(
            z.object({ resources: z.null() }).parse(JSON.parse(content))
              .resources,
            null,
          );
        }
      } finally {
        clearTimeout(deadline);
        t.signal.removeEventListener("abort", cancel);
        await stopOwned(child, 50);
      }
    }
    for (const mode of [
      "collector-deadline",
      "launcher-timeout",
      "launcher-interruption",
    ]) {
      const pidFile = resolve(fixture, `${mode}.pid`);
      let descendant = 0;
      let ready = () => {};
      const readiness = new Promise((resolveReady) => {
        ready = () => {
          resolveReady(undefined);
        };
      });
      const watcher = watch(fixture, (_event, filename) => {
        if (filename !== `${mode}.pid`) return;
        try {
          descendant = Number(readFileSync(pidFile, "utf8").trim());
          if (Number.isSafeInteger(descendant) && descendant > 0) ready();
        } catch {
          /* The create event may precede the committed PID write. */
        }
      });
      t.after(() => {
        watcher.close();
      });
      const child = spawnOwned(
        process.execPath,
        [
          "scripts/minio-failure-diagnostics.mjs",
          "container123",
          resolve(artifact, `${mode}.json`),
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
      t.after(() => stopOwned(child, 50));
      const cancel = () => {
        void stopOwned(child, 50);
      };
      t.signal.addEventListener("abort", cancel, { once: true });
      if (t.signal.aborted) cancel();
      const exit = commandExit(child);
      let exceededBudget = false;
      // deterministic-test-allow duration-wait: bounds readiness and hostile-tree shutdown, never a success barrier.
      const failureBudget = setTimeout(() => {
        exceededBudget = true;
        cancel();
      }, 10000);
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let launcherDeadline;
      try {
        await Promise.race([
          readiness,
          exit.then(() => {
            throw new Error("Collector exited before descendant readiness");
          }),
        ]);
        if (mode === "launcher-timeout") {
          // deterministic-test-allow duration-wait: exercise the launcher's deadline cleanup after the descendant readiness barrier.
          launcherDeadline = setTimeout(cancel, 50);
        } else if (mode === "launcher-interruption") {
          assert.equal(child.kill("SIGTERM"), true);
        }
        const status = await exit;
        assert.equal(
          exceededBudget,
          false,
          "collector must bound a SIGTERM-resistant command tree",
        );
        if (mode === "collector-deadline") assert.equal(status, 0);
        else assert.notEqual(status, 0);
        assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
      } finally {
        watcher.close();
        clearTimeout(failureBudget);
        clearTimeout(launcherDeadline);
        t.signal.removeEventListener("abort", cancel);
        await stopOwned(child, 50);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Docker-only checkout captures safe diagnostics without node_modules", async (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), "minio-preinstall-"));
  try {
    for (const file of [
      "compose-failure-diagnostics.sh",
      "minio-failure-diagnostics.mjs",
      "owned-process.mjs",
      "diagnostic-command.mjs",
      "owned-process.py",
      "heavy-check/lock.py",
      "heavy-check/processes.py",
      "owned-process/ownership.py",
    ]) {
      const destination = resolve(fixture, "scripts", file);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      copyFileSync(resolve("scripts", file), destination);
    }
    assert.equal(existsSync(resolve(fixture, "node_modules")), false);
    const docker = resolve(fixture, "docker");
    writeFileSync(
      docker,
      `#!/bin/sh
case "$1" in
 ps) if [ "\${FAIL_PS:-0}" = 1 ]; then exit 27; fi; printf 'minio123\\nweb456\\n';;
 inspect) case "$3" in
  *Labels*) if [ "$4" = minio123 ]; then echo "object-storage:\${MINIO_LIFECYCLE:-running:healthy}"; else echo 'web:exited:unhealthy'; fi;;
  *'json .State}}'*) echo '{"Status":"exited","ExitCode":23}';;
  *) echo '{"running":true,"restarts":0,"health":"healthy","Env":"SECRET_SENTINEL"}';;
 esac;;
 stats) echo '{"CPUPerc":"0.01%","MemUsage":"12MiB / 1GiB","NetIO":"2kB / 3kB","BlockIO":"0B / 1kB","PIDs":"9"}';;
 logs) if [ "$4" = minio123 ]; then echo SECRET_SENTINEL; else echo 'original web failure'; fi;;
esac
`,
      { mode: 0o755 },
    );
    for (const mode of ["healthy", "collector-unavailable", "ps-failure"]) {
      if (mode === "collector-unavailable")
        rmSync(resolve(fixture, "scripts/minio-failure-diagnostics.mjs"));
      const artifact = resolve(fixture, `artifacts-${mode}`);
      const child = spawnOwned(
        "bash",
        ["scripts/compose-failure-diagnostics.sh", artifact, docker],
        {
          cwd: fixture,
          env: {
            ...process.env,
            PATH: `${fixture}:${process.env["PATH"]}`,
            MINIO_LIFECYCLE:
              mode === "collector-unavailable"
                ? "exited:unhealthy"
                : "running:healthy",
            FAIL_PS: mode === "ps-failure" ? "1" : "0",
          },
          stdio: "ignore",
        },
      );
      t.after(() => stopOwned(child, 50));
      const cancel = () => {
        void stopOwned(child, 50);
      };
      t.signal.addEventListener("abort", cancel, { once: true });
      if (t.signal.aborted) cancel();
      // deterministic-test-allow duration-wait: bounds the preinstall CLI fixture; supervisor exit proves cleanup before deletion.
      const deadline = setTimeout(cancel, 8000);
      try {
        assert.equal(await commandExit(child), mode === "ps-failure" ? 1 : 0);
        if (mode === "ps-failure") {
          assert.deepEqual(readdirSync(artifact), []);
          continue;
        }
        const minio = readFileSync(
          resolve(artifact, "minio123-minio.json"),
          "utf8",
        );
        assert.ok(!minio.includes("SECRET_SENTINEL"));
        if (mode === "healthy") {
          assert.equal(
            z
              .object({ state: z.object({ running: z.boolean() }) })
              .parse(JSON.parse(minio)).state.running,
            true,
          );
        } else {
          assert.deepEqual(JSON.parse(minio), {
            collector: "unavailable",
            state: { status: "exited", health: "unhealthy" },
            resources: null,
          });
          assert.equal(existsSync(resolve(artifact, "minio123.log")), false);
        }
        assert.equal(
          readFileSync(resolve(artifact, "web456-state.json"), "utf8").trim(),
          '{"Status":"exited","ExitCode":23}',
        );
        assert.equal(
          readFileSync(resolve(artifact, "web456.log"), "utf8").trim(),
          "original web failure",
        );
      } finally {
        clearTimeout(deadline);
        t.signal.removeEventListener("abort", cancel);
        await stopOwned(child, 50);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
