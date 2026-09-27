// @ts-check
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { isolateIdentityProofEnvironment } from "./identity-proof-environment.mjs";
import { runIdentityProofSession } from "./identity-proof-session.mjs";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofCompose = resolve(root, "infra/identity/logto/compose.yaml");
const platformCompose = resolve(root, "compose.yaml");
const composeEnvironment = resolve(root, "infra/identity/logto/compose.env");
const pnpmExecutable = process.env["npm_execpath"];
if (pnpmExecutable === undefined) {
  throw new Error("Run the identity proof through the pinned pnpm CLI");
}
const pnpmPath = pnpmExecutable;

const releaseLock = await acquireLocalSetupLock(
  "Another local session owns the machine-wide Platform setup lock. Wait for its handoff before starting the identity proof.",
);
/** @type {Set<import("node:child_process").ChildProcess>} */
const activeProcesses = new Set();
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void stopActiveProcesses();
  });
}

try {
  const environment = isolateIdentityProofEnvironment(process.env, [
    await readFile(resolve(root, ".env.example"), "utf8"),
    await readFile(resolve(root, ".env"), "utf8").catch(() => ""),
  ]);
  await runIdentityProofSession({
    environment,
    readGeneratedEnvironment: async () =>
      parseEnv(
        await readFile(resolve(root, ".identity-proof/platform.env"), "utf8"),
      ),
    runCompose,
    runPnpm: (arguments_, runtimeEnvironment) =>
      runPnpm(arguments_, false, runtimeEnvironment),
    shouldStop: () => interruptedSignal !== undefined,
  });
} catch (error) {
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await releaseLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

/** @type {import("./identity-proof-session.mjs").RunCompose} */
async function runCompose(project, arguments_, environment, capture = false) {
  const compose = project === "identity" ? proofCompose : platformCompose;
  const result = await runPnpm(
    [
      "exec",
      "docker",
      "compose",
      "--env-file",
      composeEnvironment,
      "-f",
      compose,
      ...arguments_,
    ],
    capture,
    environment,
  );
  return result.output;
}

/**
 * @param {string[]} arguments_
 * @param {boolean} [capture]
 * @param {NodeJS.ProcessEnv} [environment]
 */
async function runPnpm(arguments_, capture = false, environment = process.env) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: root,
    env: environment,
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
    throw new Error(
      `pnpm ${arguments_.join(" ")} failed${capture ? `:\n${output}` : ""}`,
    );
  }
  return { output };
}

async function stopActiveProcesses() {
  await Promise.all([...activeProcesses].map((child) => stopProcess(child)));
}

/** @param {import("node:child_process").ChildProcess} child */
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
