import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run local setup through the pinned pnpm CLI");
}

const releaseSetupLock = await acquireSetupLock();
const environmentPath = resolve(repositoryRoot, ".env");
if (!existsSync(environmentPath)) {
  copyFileSync(resolve(repositoryRoot, ".env.example"), environmentPath);
  process.stdout.write("Created .env from .env.example\n");
}
let ownsPostgres = false;
let interruptedSignal;
let shutdownPromise;
const activeProcesses = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  await runPnpm(["platform:doctor"]);
  if (await isPostgresRunning()) {
    throw new Error(
      "Platform Compose PostgreSQL is already running and belongs to another session. Use that owner's handoff or stop it before local:setup.",
    );
  }
  ownsPostgres = true;
  await runPnpm(["infra:up"]);
  await runPnpm(["smoke:fullstack"]);
  ownsPostgres = false;
  process.stdout.write(
    "Local Platform is ready. PostgreSQL remains running; use pnpm infra:down when finished.\n",
  );
} catch (error) {
  await shutdown();
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await releaseSetupLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

async function isPostgresRunning() {
  const result = await runPnpm(
    ["exec", "docker", "compose", "ps", "--services", "--status", "running"],
    true,
  );
  return result.output.split(/\s+/u).includes("postgres");
}

async function runPnpm(arguments_, capture = false) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
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

async function acquireSetupLock() {
  const lockTarget = resolve(tmpdir(), "inside-platform-local-setup");
  try {
    return await lockfile.lock(lockTarget, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      Reflect.has(error, "code") &&
      error.code === "ELOCKED"
    ) {
      throw new Error(
        "Another local setup owns the machine-wide setup lock. Wait for its handoff or stop that session before retrying.",
        { cause: error },
      );
    }
    throw error;
  }
}

function shutdown() {
  shutdownPromise ??= (async () => {
    await Promise.all([...activeProcesses].map((child) => stopProcess(child)));
    if (ownsPostgres) {
      ownsPostgres = false;
      await runCleanupPnpm(["infra:down"]).catch(() => undefined);
    }
  })();
  return shutdownPromise;
}

async function runCleanupPnpm(arguments_) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
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

async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await shutdown();
}
