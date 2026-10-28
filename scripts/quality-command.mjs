// @ts-check
import { commandExit } from "./diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

/** Execute a bounded quality-tool command through the repository's process-tree supervisor.
 * @param {string} command
 * @param {string[]} args
 * @param {{timeout: number, cwd?: string | undefined, env?: NodeJS.ProcessEnv, input?: string, inherit?: boolean}} options
 */
export async function qualityCommand(command, args, options) {
  const child = spawnOwned(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    timeout: options.timeout,
    stdio: options.inherit === true ? "inherit" : "pipe",
  });
  let stdout = "";
  let stderr = "";
  try {
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
      stderr += chunk.toString();
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
    const status = await commandExit(child);
    return { status, stdout, stderr };
  } finally {
    await stopOwned(child);
  }
}
