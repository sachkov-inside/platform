// @ts-check
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  runOwnedProcess,
  processGroupExists,
} from "./observability-umami/process-owner.mjs";
import { signalProcessGroup } from "./process-group-signal.mjs";

const FIXTURE_BUDGET_MS = 5000;
const SIGNAL_GRACE_MS = 50;
const CHILD_CLEANUP_MS = 2000;
const PROBE_INTERVAL_MS = 20;

/** @template T @param {Promise<T>} fact @returns {Promise<T>} */
async function boundedFact(fact) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    /** @type {Promise<never>} */
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("fixture process exit deadline")),
        FIXTURE_BUDGET_MS + CHILD_CLEANUP_MS,
      );
    });
    return await Promise.race([fact, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} report */
async function ready(report) {
  const deadline = performance.now() + FIXTURE_BUDGET_MS;
  while (true) {
    try {
      const value = /** @type {unknown} */ (
        JSON.parse(await readFile(report, "utf8"))
      );
      assert.ok(value !== null && typeof value === "object");
      assert.ok(
        "pgid" in value &&
          Number.isSafeInteger(value.pgid) &&
          Number(value.pgid) > 0,
      );
      assert.ok(
        "port" in value &&
          Number.isSafeInteger(value.port) &&
          Number(value.port) > 0,
      );
      return { pgid: Number(value.pgid), port: Number(value.port) };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      if (performance.now() >= deadline)
        throw new Error("fixture registration timeout", { cause: error });
      await delay(PROBE_INTERVAL_MS);
    }
  }
}

/** @param {number | undefined} group */
async function cleanupGroup(group) {
  if (group === undefined) return;
  signalProcessGroup(group, "SIGKILL");
  const deadline = performance.now() + CHILD_CLEANUP_MS;
  while (processGroupExists(group)) {
    if (performance.now() >= deadline)
      throw new Error("fixture fallback group cleanup timeout");
    await delay(PROBE_INTERVAL_MS);
  }
}

/** @param {number} port */
async function socketClosed(port) {
  const socket = createConnection({ host: "127.0.0.1", port });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", () =>
        reject(new Error("owned fixture port remains open")),
      );
      socket.once("error", (error) => {
        if ("code" in error && error.code === "ECONNREFUSED")
          resolve(undefined);
        else reject(error);
      });
      socket.setTimeout(CHILD_CLEANUP_MS, () =>
        reject(new Error("socket closure probe timed out")),
      );
    });
  } finally {
    socket.destroy();
  }
}

// deterministic-test-allow unit-io: real POSIX groups and owned loopback sockets; bounded registration and finally cleanup, no providers.
for (const mode of [
  "success",
  "failure",
  "timeout",
  "worker_sigterm",
  "worker_sigkill",
]) {
  test(`Umami contract owner closes descendants after ${mode}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "umami-owner-"));
    const report = join(directory, "ready.json");
    let group;
    try {
      const outcome = runOwnedProcess(
        "python3",
        ["scripts/observability-umami/process-fixture.py", mode, report],
        {
          timeoutMs: FIXTURE_BUDGET_MS,
          terminateGraceMs: SIGNAL_GRACE_MS,
          cleanupBudgetMs: CHILD_CLEANUP_MS,
        },
      );
      const state = await ready(report);
      group = state.pgid;
      const result = await outcome;
      assert.equal(result.pid, group);
      assert.equal(processGroupExists(group), false);
      await socketClosed(state.port);
      if (mode === "success") assert.equal(result.code, 0);
      if (mode === "failure") assert.equal(result.code, 7);
      if (mode === "timeout") assert.equal(result.reason, "timeout");
      if (mode === "worker_sigterm") assert.equal(result.signal, "SIGTERM");
      if (mode === "worker_sigkill") assert.equal(result.signal, "SIGKILL");
    } finally {
      await cleanupGroup(group);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("Umami contract owner handles its SIGTERM outside the Python group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "umami-owner-"));
  const report = join(directory, "ready.json");
  const owner = spawn(
    process.execPath,
    ["scripts/observability-umami/process-owner.mjs", report],
    { stdio: "ignore" },
  );
  const exited = once(owner, "exit");
  let group;
  try {
    const state = await ready(report);
    group = state.pgid;
    assert.notEqual(owner.pid, group);
    owner.kill("SIGTERM");
    await boundedFact(exited);
    assert.equal(processGroupExists(group), false);
    await socketClosed(state.port);
  } finally {
    owner.kill("SIGTERM");
    try {
      await boundedFact(exited);
    } finally {
      owner.kill("SIGKILL");
      await cleanupGroup(group);
      await rm(directory, { recursive: true, force: true });
    }
  }
});
