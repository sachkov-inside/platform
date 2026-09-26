/**
 * Поднимает production-сборку web для браузерных проверок: e2e с подставленным в браузере BFF и
 * переходы (#670). Предзагрузка ссылок и кеш маршрутов работают только в `next start`, а dev
 * компилирует маршрут при первом открытии и меряет машину, поэтому обе проверки идут здесь.
 *
 * Сборка требует неизменяемую идентичность выпуска рядом с приложением. Файл пишется на время
 * прогона и убирается при выходе; чужой файл не заменяется. `PRODUCTION_WEB_SKIP_BUILD=1`
 * запускает уже готовую сборку: так проверки одного прогона делят одну сборку.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applicationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const identityPath = resolve(applicationDirectory, "release-identity.json");
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

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required`);
  return value;
}

let child;
function cleanup() {
  rmSync(identityPath, { force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child?.kill(signal);
    cleanup();
    process.exit(0);
  });
}
process.once("exit", cleanup);

function run(args) {
  return new Promise((resolveRun, reject) => {
    child = spawn("pnpm", ["exec", "next", ...args], {
      cwd: applicationDirectory,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`next ${args[0]} exited with ${String(code)}`));
    });
  });
}

if (process.env.PRODUCTION_WEB_SKIP_BUILD !== "1") await run(["build"]);
await run(["start", "--hostname", "127.0.0.1", "--port", port]);
