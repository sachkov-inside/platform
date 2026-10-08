// @ts-check
import { createServer } from "node:net";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkDatabaseUrl, ensureCheckDatabase } from "./check-database.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
ensureSharedIdentityDirectory(root);
const webBaseUrl = process.env["WEB_BASE_URL"];
const backendBaseUrl = process.env["BACKEND_BASE_URL"];
if (webBaseUrl === undefined || backendBaseUrl === undefined) {
  throw new Error(
    "This launcher requires explicit loopback URLs and NODE_ENV=development",
  );
}
const web = new URL(webBaseUrl);
const api = new URL(backendBaseUrl);
if (
  web.hostname !== "127.0.0.1" ||
  api.hostname !== "127.0.0.1" ||
  process.env["NODE_ENV"] !== "development"
) {
  throw new Error(
    "This launcher requires explicit loopback URLs and NODE_ENV=development",
  );
}
for (const port of [Number(web.port), Number(api.port), 3602]) {
  if (!Number.isInteger(port) || port < 1)
    throw new Error("Explicit local ports are required");
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(`Port ${String(port)} is already owned by another process`),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(accept));
  });
}
const databaseUrl =
  process.env["DATABASE_URL"] ??
  (ensureCheckDatabase({ cwd: root }),
  checkDatabaseUrl(process.env["POSTGRES_HOST_PORT"] ?? 5432));
if (new URL(databaseUrl).pathname === "/inside")
  throw new Error(
    "The Telegram sign-in launcher must not migrate or seed the stand database",
  );
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  LOCAL_SEED_DEMO: "published",
  API_HOST: "127.0.0.1",
  API_PORT: api.port,
  MCP_HOST: "127.0.0.1",
  MCP_PORT: "3602",
  MCP_SERVER_URL: "http://127.0.0.1:3602/mcp",
  NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
};
const commands = [
  [
    "--filter",
    "@inside/web",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    web.port,
  ],
  ...[
    "dev:api",
    "dev:mcp",
    "dev:material-assets-worker",
    "dev:profile-avatars-worker",
    "dev:video-deletions-worker",
  ].map((command) => ["--filter", "@inside/backend", command]),
];
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
let stopping = false;
/** @type {Promise<void> | undefined} */
let stopPromise;
function stop() {
  stopping = true;
  stopPromise ??= Promise.all(children.map((child) => stopOwned(child))).then(
    () => undefined,
  );
  return stopPromise;
}
for (const signal of /** @type {const} */ (["SIGTERM", "SIGINT"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void stop();
  });
}
/** @param {string[]} args */
function start(args) {
  if (stopping) throw new Error("Telegram sign-in launcher interrupted");
  const child = spawnOwned("pnpm", args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  children.push(child);
  return child;
}
try {
  for (const command of ["db:migrate", "db:seed"]) {
    const child = start(["--filter", "@inside/backend", command]);
    try {
      if ((await commandExit(child)) !== 0)
        throw new Error(`Local setup failed: ${command}`);
    } finally {
      await stopOwned(child);
    }
  }
  const services = commands.map((args) => start(args));
  process.exitCode =
    (await Promise.race(services.map((child) => commandExit(child)))) || 1;
} catch (error) {
  if (interruptedSignal === undefined) throw error;
} finally {
  await stop();
}
if (interruptedSignal !== undefined)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
