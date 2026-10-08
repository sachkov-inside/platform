// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const supervisor = fileURLToPath(
  new URL("./owned-process.py", import.meta.url),
);
/** @type {WeakMap<import('node:child_process').ChildProcess, import('node:stream').Writable>} */
const controls = new WeakMap();
/** @type {WeakMap<import('node:child_process').ChildProcess, Promise<void>>} */
const stops = new WeakMap();

/**
 * The returned child is the supervisor. Its exit follows command-tree cleanup; its status is
 * the command's status. A private pipe lets supervision survive exit or SIGKILL of this owner.
 * On macOS, descendants that replace their environment must preserve INSIDE_OWNED_PROCESS_*
 * entries: a detached process with lost ancestry and no readable marker cannot be rediscovered.
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnOwned(command, args = [], options = {}) {
  const configured = options.stdio ?? "pipe";
  const streams =
    typeof configured === "string"
      ? [configured, configured, configured]
      : [
          configured[0] ?? "pipe",
          configured[1] ?? "pipe",
          configured[2] ?? "pipe",
        ];
  const child = spawn(
    "python3",
    [supervisor, JSON.stringify([command, ...args]), String(process.ppid)],
    {
      ...options,
      // Inner owners retain outer markers even when the caller supplies a fresh environment.
      env:
        options.env === undefined
          ? process.env
          : {
              ...options.env,
              ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) =>
                  key.startsWith("INSIDE_OWNED_PROCESS_"),
                ),
              ),
            },
      detached: true,
      stdio: [...streams, "pipe"],
    },
  );
  // Preserve spawn's asynchronous error event when Python itself cannot start.
  if (child.pid === undefined) return child;
  try {
    const control = child.stdio[3];
    if (control === null || control === undefined || !("write" in control))
      throw new Error("Process supervision requires a writable control pipe");
    controls.set(child, control);
    // The supervisor can finish before its owner requests cleanup.
    control.on("error", () => {});
    return child;
  } finally {
    // If ownership setup fails, do not hand an unsupervised child back to the caller.
    if (!controls.has(child)) child.kill("SIGTERM");
  }
}

/** @param {import('node:child_process').ChildProcess} child */
export function isOwnedProcess(child) {
  return controls.has(child);
}

/**
 * Stop the supervised command tree, escalate after the grace period, and await the supervisor.
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [graceMilliseconds]
 * @returns {Promise<void>}
 */
export async function stopOwned(child, graceMilliseconds = 5000) {
  const stopping = stops.get(child);
  if (stopping !== undefined) return stopping;
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const control = controls.get(child);
  if (control === undefined)
    throw new Error("Process has no ownership supervisor");
  if (!Number.isFinite(graceMilliseconds) || graceMilliseconds < 0)
    throw new RangeError("Process stop grace must be finite and nonnegative");
  /** @type {Promise<void>} */
  const finished = new Promise((resolve) => {
    // AbortError can precede cleanup; only actual supervisor exit settles the stop.
    const ignoreError = () => {};
    child.on("error", ignoreError);
    child.once("exit", () => {
      child.off("error", ignoreError);
      resolve();
    });
  });
  stops.set(child, finished);
  control.end(`${String(graceMilliseconds)}\n`);
  await finished;
}
