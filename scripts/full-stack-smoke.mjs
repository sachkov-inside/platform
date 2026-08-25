import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run the full-stack smoke through the pinned pnpm CLI");
}

const environmentPath = resolve(repositoryRoot, ".env");
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}
const apiPort = process.env.API_PORT ?? "3001";
const apiBaseUrl =
  process.env.BACKEND_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const webBaseUrl = "http://127.0.0.1:3000";
const childEnvironment = { ...process.env };
childEnvironment.NODE_ENV ??= "development";
const processes = [];
const activeProcesses = new Set();
let cleanupPromise;
let interruptedSignal;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  await runPnpm(["--filter", "@inside/backend", "db:migrate"]);
  await runPnpm(["--filter", "@inside/backend", "db:seed"]);
  await runPnpm(["--filter", "@inside/web", "build"], {
    ...childEnvironment,
    NODE_ENV: "production",
  });

  processes.push(
    startPnpm("API", ["dev:api"], childEnvironment),
    startPnpm(
      "Web",
      [
        "--filter",
        "@inside/web",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3000",
      ],
      {
        ...childEnvironment,
        NODE_ENV: "production",
        BACKEND_BASE_URL: apiBaseUrl,
      },
    ),
  );

  const health = await waitForJson(`${apiBaseUrl}/health`, processes);
  assertHealth(health);
  await waitForHttp(webBaseUrl, processes);
  await runPnpm(["--filter", "@inside/web", "smoke:backend"], {
    ...childEnvironment,
    BACKEND_BASE_URL: apiBaseUrl,
  });
  await runPnpm(["--filter", "@inside/web", "test:fullstack"], {
    ...childEnvironment,
    FULLSTACK_WEB_BASE_URL: webBaseUrl,
  });

  process.stdout.write(
    `Full-stack smoke passed: Reader ${webBaseUrl}/materials/inside-platform-overview; live API ${apiBaseUrl}; PostgreSQL reachable\n`,
  );
} catch (error) {
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await cleanup();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

function startPnpm(name, arguments_, environment, detached = true) {
  const output = [];
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: repositoryRoot,
    detached: detached && process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { name, child, output, detached };
  activeProcesses.add(entry);
  child.once("exit", () => activeProcesses.delete(entry));
  child.stdout?.on("data", (chunk) => retainOutput(output, chunk));
  child.stderr?.on("data", (chunk) => retainOutput(output, chunk));
  return entry;
}

async function runPnpm(arguments_, environment = childEnvironment) {
  const entry = startPnpm("pnpm", arguments_, environment, false);
  const exitCode = await new Promise((resolveExit) => {
    entry.child.once("exit", (code) => resolveExit(code));
  });
  if (exitCode !== 0) {
    throw new Error(`pnpm ${arguments_.join(" ")} failed:\n${entry.output.join("")}`);
  }
}

async function waitForJson(url, entries) {
  const response = await waitForHttp(url, entries);
  return response.json();
}

async function waitForHttp(url, entries) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertProcessesRunning(entries);
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) {
        return response;
      }
      const body = (await response.text()).slice(0, 1_000);
      throw new Error(
        `${url} returned HTTP ${String(response.status)}${body.length > 0 ? `:\n${body}` : ""}\n${formatProcessOutput(entries)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("returned HTTP")) {
        throw error;
      }
      // A connection failure means the process is still starting.
    }
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for ${url}\n${formatProcessOutput(entries)}`);
}

function assertHealth(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.process !== "api" ||
    value.status !== "ok" ||
    value.database !== "reachable"
  ) {
    throw new Error(`Unexpected API health response: ${JSON.stringify(value)}`);
  }
}

function assertProcessesRunning(entries) {
  const stopped = entries.find(({ child }) => child.exitCode !== null);
  if (stopped !== undefined) {
    throw new Error(`${stopped.name} exited early:\n${stopped.output.join("")}`);
  }
}

async function stopProcess({ child, detached }) {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32" || !detached) {
    child.kill("SIGTERM");
  } else {
    signalProcessGroup(child.pid, "SIGTERM");
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) {
    if (process.platform === "win32" || !detached) {
      child.kill("SIGKILL");
    } else {
      signalProcessGroup(child.pid, "SIGKILL");
    }
  }
}

function cleanup() {
  cleanupPromise ??= Promise.all(
    [...activeProcesses].map((entry) => stopProcess(entry)),
  ).then(() => undefined);
  return cleanupPromise;
}

async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await cleanup();
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ESRCH") {
      throw error;
    }
  }
}

function retainOutput(output, chunk) {
  output.push(chunk.toString());
  while (output.join("").length > 40_000) {
    output.shift();
  }
}

function formatProcessOutput(entries) {
  return entries.map(({ name, output }) => `${name}:\n${output.join("")}`).join("\n");
}
