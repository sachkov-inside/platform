// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const supervisor = fileURLToPath(
  new URL("./owned-process.py", import.meta.url),
);
/** @type {WeakMap<import('node:child_process').ChildProcess, import('node:stream').Writable>} */
const controls = new WeakMap();

/**
 * The returned child is the supervisor. Its exit follows command-tree cleanup; its status is
 * the command's status. A private pipe lets supervision survive exit or SIGKILL of this owner.
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
    [supervisor, JSON.stringify([command, ...args])],
    {
      ...options,
      detached: true,
      stdio: [...streams, "pipe"],
    },
  );
  const control = child.stdio[3];
  if (control !== null && control !== undefined && "write" in control) {
    controls.set(child, control);
    // The supervisor can finish before its owner requests cleanup.
    control.on("error", () => {});
  }
  return child;
}

/** @param {import('node:child_process').ChildProcess} child */
export function isOwnedProcess(child) {
  return controls.has(child);
}

/**
 * Stop the entire command tree, escalate after the grace period, and await the supervisor.
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [graceMilliseconds]
 * @returns {Promise<void>}
 */
export async function stopOwned(child, graceMilliseconds = 5000) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const finished = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  const control = controls.get(child);
  if (control === undefined)
    throw new Error("Process has no ownership supervisor");
  control.end(`${String(graceMilliseconds)}\n`);
  await finished;
}
