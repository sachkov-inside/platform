// @ts-check
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { signalProcessGroup } from "../process-group-signal.mjs";

const POLL_INTERVAL_MS = 20;
const OUTPUT_BYTES = 1_048_576;
const CONTRACT_TIMEOUT_MS = 30_000;
const TERMINATE_GRACE_MS = 250;
const CLEANUP_BUDGET_MS = 3000;

/** @param {number} pid */
export function processGroupExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("invalid owned process group");
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
    }
    throw error;
  }
}

/** @param {number} pid @param {number} graceMs @param {number} budgetMs */
async function stopGroup(pid, graceMs, budgetMs) {
  signalProcessGroup(pid, "SIGTERM");
  const started = performance.now();
  let escalated = false;
  while (processGroupExists(pid)) {
    const elapsed = performance.now() - started;
    if (!escalated && elapsed >= graceMs) {
      signalProcessGroup(pid, "SIGKILL");
      escalated = true;
    }
    if (elapsed >= budgetMs)
      throw new Error("owned Python process group did not disappear");
    await delay(POLL_INTERVAL_MS);
  }
}

/** @template T @param {Promise<T>} fact @param {number} budgetMs @returns {Promise<T>} */
async function boundedFact(fact, budgetMs) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    /** @type {Promise<never>} */
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("owned process exit/descriptor deadline")),
        budgetMs,
      );
    });
    return await Promise.race([fact, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Node caller owns this group; Python finally blocks are not the cleanup boundary.
 * @param {string} command
 * @param {string[]} args
 * @param {{timeoutMs?: number, terminateGraceMs?: number, cleanupBudgetMs?: number}} [options]
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, pid: number | undefined, reason: "exit" | "timeout" | "interrupted" | "output_limit", stdout: string, stderr: string}>}
 */
export async function runOwnedProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? CONTRACT_TIMEOUT_MS;
  const graceMs = options.terminateGraceMs ?? TERMINATE_GRACE_MS;
  const cleanupMs = options.cleanupBudgetMs ?? CLEANUP_BUDGET_MS;
  if (
    ![timeoutMs, graceMs, cleanupMs].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    graceMs >= cleanupMs
  ) {
    throw new Error("invalid owned process budgets");
  }
  /** @type {((value: undefined) => void) | undefined} */
  let abort;
  /** @type {Promise<void>} */
  const aborted = new Promise((resolve) => {
    abort = resolve;
  });
  /** @type {"exit" | "timeout" | "interrupted" | "output_limit"} */
  let reason = "exit";
  const interrupt = () => {
    reason = "interrupted";
    abort?.(undefined);
  };
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  /** @param {unknown} chunk @param {"stdout" | "stderr"} stream */
  const collect = (chunk, stream) => {
    if (typeof chunk !== "string") {
      reason = "output_limit";
      abort?.(undefined);
      return;
    }
    bytes += Buffer.byteLength(chunk);
    if (bytes > OUTPUT_BYTES) {
      reason = "output_limit";
      abort?.(undefined);
      return;
    }
    if (stream === "stdout") stdout += chunk;
    else stderr += chunk;
  };
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  let cleanupAttempted = false;
  const worker = spawn(command, args, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const pid = worker.pid;
  try {
    timer = setTimeout(() => {
      reason = "timeout";
      abort?.(undefined);
    }, timeoutMs);
    process.on("SIGTERM", interrupt);
    process.on("SIGINT", interrupt);
    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    worker.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    /** @type {Promise<{code: number | null, signal: NodeJS.Signals | null}>} */
    const ended = new Promise((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code, signal) => resolve({ code, signal }));
    });
    /** @type {Promise<void>} */
    const closed = new Promise((resolve) => {
      worker.once("close", () => resolve());
    });
    await Promise.race([ended, aborted]);
    clearTimeout(timer);
    cleanupAttempted = true;
    if (pid !== undefined) await stopGroup(pid, graceMs, cleanupMs);
    // Group absence commits closure of inherited sockets and output descriptors.
    await boundedFact(closed, cleanupMs);
    const status = await boundedFact(ended, cleanupMs);
    return { ...status, pid, reason, stdout, stderr };
  } finally {
    clearTimeout(timer);
    try {
      if (!cleanupAttempted && pid !== undefined)
        await stopGroup(pid, graceMs, cleanupMs);
    } finally {
      process.off("SIGTERM", interrupt);
      process.off("SIGINT", interrupt);
    }
  }
}

// Owned fixture CLI exists only for the interruption process contract.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = process.argv[2];
  if (report === undefined) throw new Error("fixture report path required");
  const result = await runOwnedProcess("python3", [
    "scripts/observability-umami/process-fixture.py",
    "owner_interruption",
    report,
  ]);
  process.exitCode = result.code === 0 && result.reason === "exit" ? 0 : 1;
}
