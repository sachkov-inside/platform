// Один стенд: приложение целиком плюс вход. Одна команда доводит его до состояния, в котором
// владелец входит по коду из письма и покупает, не переключая окружения.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmPath = process.env.npm_execpath;
if (pnpmPath === undefined) {
  throw new Error("Run the local stand through the pinned pnpm CLI");
}

// Вход отвечает по одному адресу и браузеру, и приложению внутри сети, поэтому порт у него один.
const standPorts = {
  IDENTITY_PROOF_LOGTO_PORT: process.env.LOGTO_HOST_PORT ?? "3301",
  IDENTITY_PROOF_LOGTO_ADMIN_PORT: process.env.LOGTO_ADMIN_HOST_PORT ?? "3302",
  IDENTITY_PROOF_API_PORT: process.env.API_HOST_PORT ?? "3001",
  IDENTITY_PROOF_WEB_PORT: process.env.WEB_HOST_PORT ?? "3000",
  // Ящик на стенде один, и bootstrap называет человеку его адрес, а не адрес прежнего окружения.
  IDENTITY_PROOF_MAILPIT_PORT: process.env.MAIL_CAPTURE_HOST_PORT ?? "8025",
};
const environment = { ...process.env, ...standPorts };

await run(pnpmPath, ["identity:proof:certs"]);
// Сначала поднимается вход: bootstrap настраивает уже работающий Logto, а не наоборот.
await compose(["up", "--detach", "--build", "--wait", "logto-postgres", "logto"]);
await run(pnpmPath, ["identity:proof:bootstrap"], {
  ...environment,
  // База Logto стенда живёт в основном проекте, а не в одноразовом окружении.
  LOGTO_STAND_COMPOSE_FILE: resolve(root, "compose.yaml"),
  NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
});
// Остальной стенд поднимается после bootstrap: только теперь у веба и API есть значения входа.
await compose(["up", "--detach", "--build", "--wait"]);

process.stdout.write([
  "",
  "Стенд поднят одной командой. Дальше всё в одном окружении:",
  `  приложение        http://127.0.0.1:${standPorts.IDENTITY_PROOF_WEB_PORT}`,
  `  вход              https://identity.inside.localhost:${standPorts.IDENTITY_PROOF_LOGTO_PORT}`,
  `  письма            http://127.0.0.1:${process.env.MAIL_CAPTURE_HOST_PORT ?? "8025"}`,
  `  двойник банка     http://127.0.0.1:${process.env.BANK_DOUBLE_HOST_PORT ?? "8090"}`,
  "",
  "Остановить: docker compose --profile identity down",
  "",
].join("\n"));

function compose(argumentList) {
  return run("docker", ["compose", "--profile", "identity", ...argumentList]);
}

function run(command, argumentList, runtimeEnvironment = environment) {
  return new Promise((resolve_, reject) => {
    const child = spawn(command, argumentList, {
      cwd: root, env: runtimeEnvironment, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) resolve_(undefined);
      else reject(new Error(`${command} ${argumentList.join(" ")} failed with code ${String(code)}`));
    });
  });
}
