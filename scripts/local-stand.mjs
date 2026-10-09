// @ts-check
// Один стенд: приложение целиком плюс вход. Одна команда доводит его до состояния, в котором
// владелец входит по коду из письма и покупает, не переключая окружения.
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";
import { statfsSync } from "node:fs";
import { z } from "zod";
import {
  createStandBuildBudget,
  dockerDesktopStoragePath,
} from "./local-stand-budget.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmExecutable = process.env["npm_execpath"];

if (pnpmExecutable === undefined) {
  throw new Error("Run the local stand through the pinned pnpm CLI");
}
const pnpmPath = pnpmExecutable;

// Порт входа не настраивается: OIDC сверяет issuer точным совпадением строки, поэтому адрес
// должен быть один и тот же и для браузера, и для приложения внутри сети Compose.
const logtoPort = "3301";
const logtoAdminPort = "3302";
// Bootstrap описывает вход теми же адресами, по которым стенд опубликован наружу.
const standPorts = {
  IDENTITY_PROOF_LOGTO_PORT: logtoPort,
  IDENTITY_PROOF_LOGTO_ADMIN_PORT: logtoAdminPort,
  IDENTITY_PROOF_API_PORT: process.env["API_HOST_PORT"] ?? "3001",
  IDENTITY_PROOF_WEB_PORT: process.env["WEB_HOST_PORT"] ?? "3000",
  IDENTITY_PROOF_MAILPIT_PORT: process.env["MAIL_CAPTURE_HOST_PORT"] ?? "8025",
};
// `--production-web` поднимает web production-сборкой: только в ней работают предзагрузка ссылок и
// кеш маршрутов, по которым владелец оценивает скорость переходов (ADR 0027). По умолчанию web
// остаётся в режиме разработки с горячей перезагрузкой.
const productionWeb = process.argv.slice(2).includes("--production-web");
const composeFiles = productionWeb
  ? [
      "--file",
      "compose.yaml",
      "--file",
      "config/compose/local/learner-setup.compose.yaml",
      "--file",
      "config/compose/local/production-web.compose.yaml",
    ]
  : [
      "--file",
      "compose.yaml",
      "--file",
      "config/compose/local/learner-setup.compose.yaml",
    ];
// The stand is always the shared project, even when a shell still names the disposable smoke one.
const environment = {
  ...process.env,
  ...standPorts,
  COMPOSE_PROJECT_NAME: "inside-platform",
};
const smokeProject = "inside-platform-smoke";

ensureSharedIdentityDirectory(repositoryRoot);
const releaseStandLock = await acquireLocalSetupLock(
  "Another local setup owns the machine-wide setup lock. Wait for its handoff or stop that session before retrying.",
);
let shouldCleanupCompose = false;
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
/** @type {Promise<void> | undefined} */
let shutdownPromise;
/** @type {Set<import("node:child_process").ChildProcess>} */
const activeProcesses = new Set();
/** @type {ReturnType<typeof createStandBuildBudget> | undefined} */
let buildBudget;
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    void handleSignal(signal);
  });
}

try {
  // Предпосылки проверяются первыми: без Docker занятость стека не узнать, и отказ должен
  // объяснять причину, а не падать на первом же вызове.
  await runPnpm(["platform:doctor"]);
  if (productionWeb) {
    const status = await run(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { capture: true },
    );
    if (status.output.trim().length > 0) {
      throw new Error(
        "Commit source changes before starting the production web stand so its release identity names the exact source revision.",
      );
    }
    const revision = await run("git", ["rev-parse", "HEAD"], { capture: true });
    Object.assign(environment, {
      STAND_WEB_SOURCE_SHA: z.hash("sha1").parse(revision.output.trim()),
    });
  }
  if (await isComposeRunning()) {
    throw new Error(
      "The Platform Compose stack is already running and belongs to another session. Use that owner's handoff, or stop the stand with docker compose --profile identity down before pnpm local:stand.",
    );
  }
  const storage =
    process.platform === "darwin"
      ? dockerDesktopStoragePath(
          (
            await run(
              "lsof",
              ["-n", "-F", "n", "-c", "/com\\.dock/", "-c", "/Virtual/"],
              {
                capture: true,
              },
            )
          ).output,
        )
      : (
          await run("docker", ["info", "--format", "{{.DockerRootDir}}"], {
            capture: true,
          })
        ).output.trim();
  buildBudget = createStandBuildBudget(() => {
    const disk = statfsSync(storage);
    return disk.bavail * disk.bsize;
  });
  process.stdout.write(
    `Local stand disk: ${(buildBudget.initialFreeBytes / 1024 ** 3).toFixed(2)} GiB available on Docker storage.\n`,
  );
  // BuildKit checks the current context on every start, including cache hits. Only API exports the
  // shared backend image; exporting ten command-only variants caused parallel layer unpacking.
  for (const service of ["api", "web", "rabbitmq", "logto"]) {
    await compose(["build", service]);
  }
  await runPnpm(["identity:proof:certs"]);
  shouldCleanupCompose = true;
  // Сначала поднимается вход: bootstrap настраивает уже работающий Logto, а не наоборот.
  await compose([
    "up",
    "--detach",
    "--no-build",
    "--wait",
    "logto-postgres",
    "logto",
  ]);
  await runPnpm(["identity:proof:bootstrap"], { LOGTO_ON_STAND: "true" });
  // Остальной стенд поднимается после bootstrap: только теперь у веба и API есть значения входа.
  await compose(["up", "--detach", "--no-build", "--wait"]);
  shouldCleanupCompose = false;
  process.stdout.write(
    [
      "",
      "Стенд поднят одной командой. Дальше всё в одном окружении:",
      `  приложение        http://127.0.0.1:${standPorts.IDENTITY_PROOF_WEB_PORT}${productionWeb ? " (production-сборка: после правок кода пересоберите стенд)" : ""}`,
      `  вход              https://identity.inside.localhost:${logtoPort}`,
      `  письма            http://127.0.0.1:${standPorts.IDENTITY_PROOF_MAILPIT_PORT}`,
      `  двойник банка     http://127.0.0.1:${process.env["BANK_DOUBLE_HOST_PORT"] ?? "8090"}`,
      "",
      "Остановить: docker compose --profile identity down",
      "",
    ].join("\n"),
  );
} catch (error) {
  await shutdown();
  if (interruptedSignal === undefined) {
    throw error;
  }
} finally {
  await Promise.all([...activeProcesses].map((child) => stopOwned(child)));
  await releaseStandLock();
}

if (interruptedSignal !== undefined) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}

async function isComposeRunning() {
  const stand = await compose(["ps", "--services", "--status", "running"], {
    capture: true,
  });
  // The disposable smoke project holds the same ports.
  const smoke = await run(
    "docker",
    [
      "compose",
      "--project-name",
      smokeProject,
      "ps",
      "--services",
      "--status",
      "running",
    ],
    { capture: true },
  );
  return `${stand.output}${smoke.output}`.trim().length > 0;
}

/**
 * @typedef {{ capture?: boolean; extraEnvironment?: Record<string, string>; cleanup?: boolean }} RunOptions
 */

/**
 * @param {string[]} arguments_
 * @param {RunOptions} [options]
 */
function compose(arguments_, options = {}) {
  return run(
    "docker",
    ["compose", ...composeFiles, "--profile", "identity", ...arguments_],
    options,
  );
}

/**
 * @param {string[]} arguments_
 * @param {Record<string, string>} [extraEnvironment]
 */
function runPnpm(arguments_, extraEnvironment = {}) {
  return run(process.execPath, [pnpmPath, ...arguments_], { extraEnvironment });
}

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {RunOptions} [options]
 */
async function run(
  command,
  arguments_,
  { capture = false, extraEnvironment = {}, cleanup = false } = {},
) {
  const label = `${command === process.execPath ? "pnpm" : command} ${arguments_.join(" ")}`;
  if (interruptedSignal !== undefined && !cleanup)
    throw new Error("Local session interrupted");
  const child = spawnOwned(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...environment, ...extraEnvironment },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...(capture ? { timeout: 20_000 } : cleanup ? { timeout: 60_000 } : {}),
  });
  activeProcesses.add(child);
  /** @type {unknown} */
  let budgetFailure;
  const budgetMonitor =
    cleanup || buildBudget === undefined
      ? undefined
      : setInterval(() => {
          try {
            buildBudget?.assertAvailable();
          } catch (error) {
            budgetFailure = error;
            void stopOwned(child);
          }
        }, 250);
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
    if (budgetFailure !== undefined) throw budgetFailure;
    if (!cleanup) buildBudget?.assertAvailable();
    if (exitCode !== 0) {
      throw new Error(`${label} failed${capture ? `:\n${output}` : ""}`);
    }
  } finally {
    clearInterval(budgetMonitor);
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
      // Недоведённый стенд не оставляем поднятым: следующий запуск должен начинать с чистого места.
      await compose(["down"], { cleanup: true }).catch(() => undefined);
    }
  })();
  return shutdownPromise;
}

/** @param {NodeJS.Signals} signal */
async function handleSignal(signal) {
  interruptedSignal ??= signal;
  await Promise.all([...activeProcesses].map((child) => stopOwned(child)));
  await shutdown();
}
