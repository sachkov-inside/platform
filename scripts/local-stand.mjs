// Один стенд: приложение целиком плюс вход. Одна команда доводит его до состояния, в котором
// владелец входит по коду из письма и покупает, не переключая окружения.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run the local stand through the pinned pnpm CLI");
}

// Порт входа не настраивается: OIDC сверяет issuer точным совпадением строки, поэтому адрес
// должен быть один и тот же и для браузера, и для приложения внутри сети Compose.
const logtoPort = "3301";
const logtoAdminPort = "3302";
// Bootstrap описывает вход теми же адресами, по которым стенд опубликован наружу.
const standPorts = {
  IDENTITY_PROOF_LOGTO_PORT: logtoPort,
  IDENTITY_PROOF_LOGTO_ADMIN_PORT: logtoAdminPort,
  IDENTITY_PROOF_API_PORT: process.env.API_HOST_PORT ?? "3001",
  IDENTITY_PROOF_WEB_PORT: process.env.WEB_HOST_PORT ?? "3000",
  IDENTITY_PROOF_MAILPIT_PORT: process.env.MAIL_CAPTURE_HOST_PORT ?? "8025",
};
const environment = { ...process.env, ...standPorts };

const releaseStandLock = await acquireStandLock();
let shouldCleanupCompose = false;
let interruptedSignal;
let shutdownPromise;
const activeProcesses = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  // Предпосылки проверяются первыми: без Docker занятость стека не узнать, и отказ должен
  // объяснять причину, а не падать на первом же вызове.
  await runPnpm(["platform:doctor"]);
  if (await isComposeRunning()) {
    throw new Error(
      "The Platform Compose stack is already running and belongs to another session. Use that owner's handoff, or stop the stand with docker compose --profile identity down before pnpm local:stand.",
    );
  }
  await runPnpm(["identity:proof:certs"]);
  shouldCleanupCompose = true;
  // Сначала поднимается вход: bootstrap настраивает уже работающий Logto, а не наоборот.
  await compose(["up", "--detach", "--build", "--wait", "logto-postgres", "logto"]);
  await runPnpm(["identity:proof:bootstrap"], { LOGTO_ON_STAND: "true" });
  // Остальной стенд поднимается после bootstrap: только теперь у веба и API есть значения входа.
  await compose(["up", "--detach", "--build", "--wait"]);
  shouldCleanupCompose = false;
  process.stdout.write([
    "",
    "Стенд поднят одной командой. Дальше всё в одном окружении:",
    `  приложение        http://127.0.0.1:${standPorts.IDENTITY_PROOF_WEB_PORT}`,
    `  вход              https://identity.inside.localhost:${logtoPort}`,
    `  письма            http://127.0.0.1:${standPorts.IDENTITY_PROOF_MAILPIT_PORT}`,
    `  двойник банка     http://127.0.0.1:${process.env.BANK_DOUBLE_HOST_PORT ?? "8090"}`,
    "",
    "Остановить: docker compose --profile identity down",
    "",
  ].join("\n"));
} catch (error) {
  await shutdown();
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await releaseStandLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

async function isComposeRunning() {
  const result = await compose(["ps", "--services", "--status", "running"], {
    capture: true,
  });
  return result.output.trim().length > 0;
}

function compose(arguments_, options = {}) {
  return run("docker", ["compose", "--profile", "identity", ...arguments_], options);
}

function runPnpm(arguments_, extraEnvironment = {}) {
  return run(process.execPath, [pnpmPath, ...arguments_], { extraEnvironment });
}

async function run(command, arguments_, { capture = false, extraEnvironment = {} } = {}) {
  const label = `${command === process.execPath ? "pnpm" : command} ${arguments_.join(" ")}`;
  const child = spawn(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...environment, ...extraEnvironment },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  activeProcesses.add(child);
  // Несостоявшийся запуск процесса — такая же неудача команды, как ненулевой код возврата, и
  // сообщать о нём надо тем же текстом.
  const failedToStart = new Promise((_, rejectStart) => {
    child.once("error", (error) => {
      rejectStart(new Error(`${label} failed to start`, { cause: error }));
    });
  });
  let output = "";
  if (capture) {
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
  }
  try {
    const exitCode = await Promise.race([
      new Promise((resolveExit) => {
        child.once("exit", (code) => resolveExit(code));
      }),
      failedToStart,
    ]);
    if (exitCode !== 0) {
      throw new Error(`${label} failed${capture ? `:\n${output}` : ""}`);
    }
  } finally {
    activeProcesses.delete(child);
  }
  return { output };
}

/**
 * Стенд владеет тем же проектом Compose, портами и томом PostgreSQL, что и локальная установка,
 * поэтому замок у них общий: два старта одновременно означали бы две сборки одного стенда.
 */
async function acquireStandLock() {
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
    if (shouldCleanupCompose) {
      shouldCleanupCompose = false;
      // Недоведённый стенд не оставляем поднятым: следующий запуск должен начинать с чистого места.
      await compose(["down"]).catch(() => undefined);
    }
  })();
  return shutdownPromise;
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
