// @ts-check
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [action, ...args] = process.argv.slice(2);

try {
  if (
    !["prepare", "status", "cleanup"].includes(action ?? "") ||
    (action === "prepare" &&
      (args.length !== 2 || args[0] !== "--task" || !args[1]?.trim()))
  ) {
    throw new Error("usage: pnpm worktree:prepare --task ISSUE");
  }
  const hostCommand = findHostCommand();
  if (hostCommand !== undefined) {
    const host = spawnSync(hostCommand, [action ?? "", ...args], {
      cwd: root,
      stdio: "inherit",
    });
    if (host.error) throw host.error;
    process.exit(host.status ?? 1);
  }
  if (action !== "prepare")
    throw new Error(
      "agent-worktree is not installed. Install the optional host resource CLI for status and cleanup; no resources were changed.",
    );
  /** @type {unknown} */
  const config = JSON.parse(
    readFileSync(resolve(root, ".worktree-resources.json"), "utf8"),
  );
  if (
    typeof config !== "object" ||
    config === null ||
    !("prepare" in config) ||
    !Array.isArray(config.prepare)
  ) {
    throw new Error("Invalid worktree prepare configuration");
  }
  console.error(
    "agent-worktree is not installed; resource tracking is unavailable. Running project preparation only.",
  );
  const commands = config.prepare.map(parseCommand);
  for (const command of commands) {
    const result = spawnSync(command.executable, command.args, {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

/** @param {unknown} command */
function parseCommand(command) {
  if (!Array.isArray(command))
    throw new Error("prepare commands must be non-empty argv arrays");
  const values = /** @type {unknown[]} */ (command);
  const argv = values.map((value) => {
    if (typeof value !== "string" || !value.length)
      throw new Error("prepare commands must be non-empty argv arrays");
    return value;
  });
  const executable = argv[0];
  if (executable === undefined)
    throw new Error("prepare commands must be non-empty argv arrays");
  return { executable, args: argv.slice(1) };
}

/** Resolve presence before launch: ENOENT can also mean a missing shebang interpreter. */
function findHostCommand() {
  for (const directory of (process.env["PATH"] ?? "/usr/bin:/bin").split(
    delimiter,
  )) {
    const command = resolve(root, directory, "agent-worktree");
    try {
      // lstat retains dangling symlinks as installed but broken commands, which must fail closed.
      lstatSync(command);
      return command;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(String(error.code))
      )
        continue;
      throw error;
    }
  }
  return undefined;
}
