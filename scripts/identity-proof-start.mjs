import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import lockfile from "proper-lockfile";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofCompose = resolve(root, "infra/identity/logto/compose.yaml");
const pnpmPath = process.env.npm_execpath;
if (pnpmPath === undefined) {
  throw new Error("Run the identity proof through the pinned pnpm CLI");
}

const releaseLock = await acquireOwnershipLock();
const activeProcesses = new Set();
let ownsIdentity = false;
let ownsPlatform = false;
let interruptedSignal;
let shutdownPromise;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void shutdown();
  });
}

try {
  if (await composeServiceRunning([], "postgres")) {
    throw new Error(
      "Platform Compose PostgreSQL is already running and belongs to another session. Stop it through its owner's handoff before starting the identity proof.",
    );
  }
  if (await composeHasRunningServices(["-f", proofCompose])) {
    throw new Error(
      "The disposable Logto proof is already running and belongs to another session. Stop it through its owner's handoff before starting a new proof.",
    );
  }

  ownsIdentity = true;
  await runPnpm(["identity:proof:up"]);
  ownsPlatform = true;
  await runPnpm(["infra:up"]);
  await runPnpm(["--filter", "@inside/backend", "db:migrate"]);
  await runPnpm(["identity:proof:dev"]);
} catch (error) {
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await shutdown();
  await releaseLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

async function composeServiceRunning(composeArguments, service) {
  const result = await runPnpm(
    [
      "exec",
      "docker",
      "compose",
      ...composeArguments,
      "ps",
      "--services",
      "--status",
      "running",
    ],
    true,
  );
  return result.output.split(/\s+/u).includes(service);
}

async function composeHasRunningServices(composeArguments) {
  const result = await runPnpm(
    [
      "exec",
      "docker",
      "compose",
      ...composeArguments,
      "ps",
      "--services",
      "--status",
      "running",
    ],
    true,
  );
  return result.output.trim().length > 0;
}

async function runPnpm(arguments_, capture = false) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: root,
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  activeProcesses.add(child);
  let output = "";
  if (capture) {
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
  }
  const exitCode = await new Promise((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  activeProcesses.delete(child);
  if (exitCode !== 0) {
    throw new Error(`pnpm ${arguments_.join(" ")} failed${capture ? `:\n${output}` : ""}`);
  }
  return { output };
}

async function acquireOwnershipLock() {
  const lockTarget = resolve(tmpdir(), "inside-platform-local-setup");
  try {
    return await lockfile.lock(lockTarget, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000,
    });
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ELOCKED") {
      throw new Error(
        "Another local session owns the machine-wide Platform setup lock. Wait for its handoff before starting the identity proof.",
        { cause: error },
      );
    }
    throw error;
  }
}

function shutdown() {
  shutdownPromise ??= (async () => {
    await Promise.all([...activeProcesses].map((child) => stopProcess(child)));
    if (ownsPlatform) {
      ownsPlatform = false;
      await runCleanupPnpm(["infra:down"]).catch(() => undefined);
    }
    if (ownsIdentity) {
      ownsIdentity = false;
      await runCleanupPnpm(["identity:proof:down"]).catch(() => undefined);
    }
  })();
  return shutdownPromise;
}

async function runCleanupPnpm(arguments_) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  if (exitCode !== 0) {
    throw new Error(`pnpm ${arguments_.join(" ")} failed during cleanup`);
  }
}

async function stopProcess(child) {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}
