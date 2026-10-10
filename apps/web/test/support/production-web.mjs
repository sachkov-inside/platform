// @ts-check
/**
 * Поднимает production-сборку web для браузерных проверок: e2e с подставленным в браузере BFF и
 * переходы (#670). Предзагрузка ссылок и кеш маршрутов работают только в `next start`, а dev
 * компилирует маршрут при первом открытии и меряет машину, поэтому обе проверки идут здесь.
 *
 * Сборка требует неизменяемую идентичность выпуска рядом с приложением. Файл пишется на время
 * прогона и убирается при выходе; чужой файл не заменяется. `PRODUCTION_WEB_SKIP_BUILD=1`
 * запускает уже готовую сборку: так проверки одного прогона делят одну сборку.
 */
import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applicationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const identityPath = resolve(applicationDirectory, "release-identity.json");
const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");
const port = required("PRODUCTION_WEB_PORT");
const backendBaseUrl = required("PRODUCTION_WEB_BACKEND_URL");
const release = { release: "v1", sourceSha: "1".repeat(40) };
const environment = {
  ...process.env,
  BACKEND_BASE_URL: backendBaseUrl,
  // `instant-navigation.spec.ts` подделывает сессию этими значениями; e2e сессию не читает.
  LOGTO_APP_ID: "inside-web-navigation",
  LOGTO_APP_SECRET: "inside-web-navigation-secret",
  LOGTO_AUDIENCE: backendBaseUrl,
  LOGTO_COOKIE_SECRET: "inside-navigation-logto-cookie-secret-key",
  LOGTO_ENDPOINT: "http://127.0.0.1:1",
  NODE_ENV: "production",
  PLATFORM_RELEASE_VERSION: release.release,
  PLATFORM_SOURCE_SHA: release.sourceSha,
  WEB_BASE_URL: `http://127.0.0.1:${port}`,
};

const identity = `${JSON.stringify(release)}\n`;
// Прерванный прогон оставляет собственный файл: его можно занять снова, чужой — нельзя.
if (
  existsSync(identityPath) &&
  readFileSync(identityPath, "utf8") !== identity
) {
  throw new Error(`Refusing to replace ${identityPath}`);
}
rmSync(identityPath, { force: true });
writeFileSync(identityPath, identity, { mode: 0o444 });

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required`);
  return value;
}

/** @type {import("node:child_process").ChildProcess | undefined} */
let child;
function cleanup() {
  rmSync(identityPath, { force: true });
}
/** @type {NodeJS.Signals | undefined} */
let interrupted;
/** @type {NodeJS.Signals[]} */
const signals = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.once(signal, () => {
    interrupted = signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    if (child !== undefined) void stopOwned(child);
  });
}
process.once("exit", cleanup);

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function run(args) {
  return new Promise((resolveRun, reject) => {
    child = spawnOwned(process.execPath, [nextCli, ...args], {
      cwd: applicationDirectory,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || interrupted !== undefined) resolveRun();
      else reject(new Error(`next ${args[0]} exited with ${String(code)}`));
    });
  });
}

try {
  if (process.env["PRODUCTION_WEB_SKIP_BUILD"] !== "1") await run(["build"]);
  if (interrupted === undefined)
    await run(["start", "--hostname", "127.0.0.1", "--port", port]);
} finally {
  if (child !== undefined) await stopOwned(child);
  cleanup();
}
