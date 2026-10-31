// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const processBudgetMilliseconds = 10000;
const shutdownGraceMilliseconds = 100;

/** Real Node/Git/Bash contract boundary. Completion includes supervised tree cleanup.
 * Normal exits preserve command status; timeout/abort return 124/130 even if the
 * command exited successfully while its descendants were still being cleaned.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, input?: string,
 *   timeoutMilliseconds?: number, signal?: AbortSignal}} [options]
 */
export async function runProcess(command, args, options = {}) {
  const {
    input,
    signal,
    timeoutMilliseconds = processBudgetMilliseconds,
    ...spawnOptions
  } = options;
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0)
    throw new RangeError("Process budget must be finite and positive");
  const child = spawnOwned(command, args, spawnOptions);
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let interrupted = false;
  /** @type {Promise<number | null>} */
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const interrupt = () => {
    interrupted = true;
    void stopOwned(child, shutdownGraceMilliseconds);
  };
  // deterministic-test-allow duration-wait: failure budget for real Node/Git/Bash commands; supervisor close follows complete tree cleanup.
  const timeout = setTimeout(() => {
    timedOut = true;
    void stopOwned(child, shutdownGraceMilliseconds);
  }, timeoutMilliseconds);
  try {
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    // A command can fail before consuming input; close/status owns that outcome.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) interrupt();
    const status = await closed;
    return {
      status: timedOut ? 124 : interrupted ? 130 : status,
      stdout,
      stderr,
      timedOut,
      interrupted,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", interrupt);
    await stopOwned(child, shutdownGraceMilliseconds);
  }
}
