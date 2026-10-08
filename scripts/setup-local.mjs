// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The smoke needs published demonstration content, so this verified stack is a disposable project
// beside the shared stand, which keeps the owner's product data.
const smokeProject = "inside-platform-smoke";
Object.assign(process.env, {
  COMPOSE_PROJECT_NAME: smokeProject,
  LOCAL_SEED_VIEW: "checks",
});
const pnpmExecutable = process.env["npm_execpath"];

if (pnpmExecutable === undefined) {
  throw new Error("Run local setup through the pinned pnpm CLI");
}
const pnpmPath = pnpmExecutable;

const releaseSetupLock = await acquireLocalSetupLock(
  "Another local setup owns the machine-wide setup lock. Wait for its handoff or stop that session before retrying.",
);
const environmentPath = resolve(repositoryRoot, ".env");
if (!existsSync(environmentPath)) {
  copyFileSync(resolve(repositoryRoot, ".env.example"), environmentPath);
  process.stdout.write("Created .env from .env.example\n");
}
let shouldCleanupCompose = false;
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
/** @type {Promise<void> | undefined} */
let shutdownPromise;
/** @type {Set<import("node:child_process").ChildProcess>} */
const activeProcesses = new Set();
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  await runPnpm(["platform:doctor"]);
  if (await isComposeRunning()) {
    throw new Error(
      "A Platform Compose stack is already running and owns the local ports. Use that owner's handoff or stop it before local:setup.",
    );
  }
  shouldCleanupCompose = true;
  await runPnpm(["compose:up"]);
  await runPnpm(["compose:smoke"]);
  shouldCleanupCompose = false;
  process.stdout.write(
    `Verified demo Platform is ready at http://127.0.0.1:3000; stop it with COMPOSE_PROJECT_NAME=${smokeProject} docker compose down --volumes.\n`,
  );
} catch (error) {
  await shutdown();
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await Promise.all([...activeProcesses].map((child) => stopOwned(child)));
  await releaseSetupLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

async function isComposeRunning() {
  for (const project of ["inside-platform", smokeProject]) {
    const result = await runPnpm(
      [
        "exec",
        "docker",
        "compose",
        "--project-name",
        project,
        "ps",
        "--services",
        "--status",
        "running",
      ],
      true,
    );
    if (result.output.trim().length > 0) return true;
  }
  return false;
}

/**
 * @param {string[]} arguments_
 * @param {boolean} [capture]
 */
async function runPnpm(arguments_, capture = false) {
  if (interruptedSignal !== undefined)
    throw new Error("Local session interrupted");
  const child = spawnOwned(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  activeProcesses.add(child);
  let output = "";
  if (capture) {
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    });
  }
  try {
    const exitCode = await commandExit(child);
    if (exitCode !== 0) {
      throw new Error(
        `pnpm ${arguments_.join(" ")} failed${capture ? `:\n${output}` : ""}`,
      );
    }
  } finally {
    await stopOwned(child);
    activeProcesses.delete(child);
  }
  return { output };
}

function shutdown() {
  shutdownPromise ??= (async () => {
    await Promise.all([...activeProcesses].map((child) => stopOwned(child)));
    if (shouldCleanupCompose) {
      shouldCleanupCompose = false;
      await runCleanupPnpm([
        "exec",
        "docker",
        "compose",
        "down",
        "--volumes",
      ]).catch(() => undefined);
    }
  })();
  return shutdownPromise;
}

/** @param {string[]} arguments_ */
async function runCleanupPnpm(arguments_) {
  const child = spawnOwned(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    timeout: 60_000,
  });
  activeProcesses.add(child);
  try {
    const exitCode = await commandExit(child);
    if (exitCode !== 0) {
      throw new Error(`pnpm ${arguments_.join(" ")} failed during cleanup`);
    }
  } finally {
    await stopOwned(child);
    activeProcesses.delete(child);
  }
}

/** @param {NodeJS.Signals} signal */
async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await Promise.all([...activeProcesses].map((child) => stopOwned(child)));
  await shutdown();
}
