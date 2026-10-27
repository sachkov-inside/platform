import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { spawnOwned, stopOwned } from "../../owned-process.mjs";
import { commandExit } from "../../diagnostic-command.mjs";
import { bounded } from "./lifetime.mjs";
const execute = promisify(execFile);
const probe = fileURLToPath(new URL("./failure-probe.mjs", import.meta.url));
for (const scenario of [
  "success",
  "hung-child",
  "slow-header",
  "slow-body",
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
  "kill-acquiring",
  "cleanup-failure",
]) {
  await test(`real diagnostic lifetime: ${scenario}`, async (t) => {
    const parent = process.env.DOMAIN_TRANSFER_LIFETIME_EVIDENCE_DIRECTORY;
    const output = parent
      ? resolve(parent, scenario)
      : await mkdtemp(resolve(tmpdir(), "domain-lifetime-"));
    await mkdir(output, { recursive: true });
    if (!parent) t.after(() => rm(output, { recursive: true, force: true }));
    let environment = process.env;
    if (scenario === "cleanup-failure") {
      const realDocker = (await execute("which", ["docker"])).stdout.trim();
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      const wrapper = resolve(output, "bin");
      await mkdir(wrapper, { recursive: true });
      const script = resolve(wrapper, "docker");
      await writeFile(
        script,
        '#!/bin/sh\nif [ "$1" = container ] && [ "$2" = inspect ] && [ -e ' +
          quote(resolve(output, "fail-observation")) +
          " ]; then echo 'synthetic owned inspector unavailable' >&2; exit 42; fi\nexec " +
          quote(realDocker) +
          ' "$@"\n',
      );
      await chmod(script, 0o700);
      environment = { ...process.env, PATH: `${wrapper}:${process.env.PATH}` };
    }
    const child = spawnOwned(
      process.execPath,
      [probe, scenario.startsWith("SIG") ? "wait-interrupt" : scenario, output],
      { stdio: ["ignore", "pipe", "pipe"], env: environment },
    );
    let log = "",
      target;
    const ready = new Promise((yes, no) => {
      child.once("error", no);
      child.once("exit", () => {
        if (!target) no(new Error(log));
      });
      child.stdout.on("data", (chunk) => {
        log += chunk;
        for (const line of log.split("\n")) {
          try {
            const value = JSON.parse(line);
            if (
              (scenario === "kill-acquiring" &&
                value.phase === "owned-Docker-acquisition-started") ||
              (scenario !== "kill-acquiring" && value.phase === "probe-ready")
            ) {
              target = value;
              yes(value);
            }
          } catch {
            // stdout also contains ordinary diagnostic lines before the machine-readable marker.
          }
        }
      });
    });
    child.stderr.on("data", (chunk) => (log += chunk));
    try {
      await bounded("proof resource readiness", 30_000, () => ready);
      if (scenario.startsWith("SIG")) process.kill(target.pid, scenario);
      if (scenario === "kill-acquiring") {
        process.kill(target.pid, "SIGKILL");
      }
      const code = await bounded("proof process completion", 30_000, () =>
        commandExit(child),
      );
      assert.equal(
        code,
        scenario === "success"
          ? 0
          : scenario === "SIGINT"
            ? 130
            : scenario === "SIGTERM"
              ? 143
              : scenario === "SIGKILL" || scenario === "kill-acquiring"
                ? 137
                : 1,
        log,
      );
      const daemonObserved = [
        "SIGKILL",
        "kill-acquiring",
        "cleanup-failure",
      ].includes(scenario);
      const evidence = await bounded(
        "external cleanup evidence",
        30_000,
        async (signal) => {
          while (true) {
            signal.throwIfAborted();
            try {
              return JSON.parse(
                await readFile(
                  resolve(
                    output,
                    daemonObserved
                      ? "daemon-lifetime.json"
                      : "docker-owner.json",
                  ),
                  "utf8",
                ),
              );
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
              await setTimeout(10);
            }
          }
        },
      );
      if (
        scenario === "SIGKILL" ||
        scenario === "kill-acquiring" ||
        scenario === "cleanup-failure"
      ) {
        assert.equal(
          evidence.cause,
          scenario === "kill-acquiring" ? "bootstrap_expired" : "lease_closed",
          JSON.stringify(evidence),
        );
      } else assert.equal(evidence.success, true, JSON.stringify(evidence));
      await bounded(
        "actual owned container destruction",
        15_000,
        async (signal) => {
          while (true) {
            signal.throwIfAborted();
            try {
              await execute("docker", ["container", "inspect", evidence.name], {
                timeout: 10_000,
              });
            } catch (error) {
              if (String(error.stderr).includes("No such container")) break;
              throw error;
            }
            await setTimeout(25);
          }
        },
      );
      if (scenario !== "SIGKILL" && scenario !== "kill-acquiring") {
        const result = JSON.parse(
          await readFile(resolve(output, "probe.json"), "utf8"),
        );
        assert.equal(result.activeChildren, 0);
        if (scenario === "cleanup-failure") {
          assert(result.cleanup.some((outcome) => !outcome.success));
          assert.equal(
            result.failure,
            "Original forced failure before cleanup",
          );
        } else assert(result.cleanup.every((outcome) => outcome.success));
        if (scenario !== "success" && scenario !== "cleanup-failure")
          assert.match(result.failure, /failure budget exceeded|interrupted/u);
      }
    } finally {
      await stopOwned(child);
      await writeFile(resolve(output, "process.log"), log);
    }
  });
}
