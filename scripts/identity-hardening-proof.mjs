// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { ensureCheckDatabase } from "./check-database.mjs";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import { startWithRoutes } from "./smoke-stand.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityCompose = resolve(root, "infra/identity/logto/compose.yaml");
const platformCompose = resolve(root, "compose.yaml");
const composeEnvironment = resolve(root, "infra/identity/logto/compose.env");
const pnpmExecutable = process.env["npm_execpath"];
if (pnpmExecutable === undefined) {
  throw new Error(
    "Run the identity hardening proof through the pinned pnpm CLI",
  );
}
const pnpmPath = pnpmExecutable;

const identityEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "inside-identity-proof-116",
  IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS: "60",
  IDENTITY_PROOF_API_PORT: "3501",
  IDENTITY_PROOF_LOGTO_ADMIN_PORT: "3402",
  IDENTITY_PROOF_LOGTO_PORT: "3401",
  IDENTITY_PROOF_MAILPIT_PORT: "3405",
  IDENTITY_PROOF_LEARNER_MCP_URL: "http://127.0.0.1:3502/mcp/learning",
  IDENTITY_PROOF_POSTGRES_PORT: "55433",
  IDENTITY_PROOF_SMTP_PORT: "3404",
  IDENTITY_PROOF_WEB_PORT: "3500",
};
const platformEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "inside-platform-proof-116",
  POSTGRES_HOST_PORT: identityEnvironment.IDENTITY_PROOF_POSTGRES_PORT,
};

const releaseLock = await acquireLocalSetupLock(
  "Another local session owns the machine-wide Platform setup lock",
);
/** @typedef {NodeJS.ProcessEnv} Environment */
/** @type {Set<import("node:child_process").ChildProcess>} */
const applicationProcesses = new Set();
let ownsIdentity = false;
let ownsPlatform = false;
let sensitiveOutputObserved = false;
/** @type {Set<import("node:child_process").ChildProcess>} */
const activeCommands = new Set();
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
let cleaningUp = false;
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void Promise.all(
      [...applicationProcesses, ...activeCommands].map((child) =>
        stopOwned(child),
      ),
    );
  });
}

try {
  await assertNoRunningProof();
  await resetStoppedProof();
  await runPnpm(["identity:proof:certs"], identityEnvironment);
  await runPnpm(["identity:proof:build"], identityEnvironment);
  ownsIdentity = true;
  await runCompose(
    identityCompose,
    ["up", "-d", "--wait"],
    identityEnvironment,
  );
  await runPnpm(["identity:proof:bootstrap"], identityEnvironment);

  ownsPlatform = true;
  await runCompose(
    platformCompose,
    ["up", "-d", "--wait", "postgres", "object-storage"],
    platformEnvironment,
  );
  const generatedEnvironment = parseEnv(
    await readFile(resolve(root, ".identity-proof/platform.env"), "utf8"),
  );
  const runtimeEnvironment = {
    ...identityEnvironment,
    ...generatedEnvironment,
    API_HOST: "127.0.0.1",
    API_PORT: identityEnvironment.IDENTITY_PROOF_API_PORT,
    MCP_HOST: "127.0.0.1",
    MCP_PORT: "3502",
    MCP_SERVER_URL: "http://127.0.0.1:3502/mcp",
    NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
  };
  ensureCheckDatabase({
    composeProject: platformEnvironment.COMPOSE_PROJECT_NAME,
  });
  await runPnpm(
    ["--filter", "@inside/backend", "db:migrate"],
    runtimeEnvironment,
  );
  const api = spawnApplication(
    ["--filter", "@inside/backend", "dev:api"],
    runtimeEnvironment,
  );
  await waitForResponse(
    api,
    `${requiredUrl(runtimeEnvironment, "BACKEND_BASE_URL")}/health`,
    (response) => response.ok,
  );
  const mcp = spawnApplication(
    ["--filter", "@inside/backend", "dev:mcp"],
    runtimeEnvironment,
  );
  await waitForResponse(
    mcp,
    "http://127.0.0.1:3502/_health/ready",
    (response) => response.ok,
  );
  // Порт web фиксирован: bootstrap регистрирует в Logto redirect URI именно на нём.
  const webPort = Number(identityEnvironment.IDENTITY_PROOF_WEB_PORT);
  const webBaseUrl = requiredUrl(runtimeEnvironment, "WEB_BASE_URL");
  // Адреса, которые проходит вход в `identity-proof.spec.ts`: сервер без любого из них
  // перезапускается. У адреса, который принимает только POST, маршрут отвечает на GET кодом 405.
  await startWithRoutes({
    baseUrl: webBaseUrl,
    routes: [
      "/",
      "/welcome",
      "/callback",
      "/auth/sign-in",
      "/auth/sign-out",
      "/auth/status",
      "/api/account",
      "/api/account/terms",
      "/api/home/materials",
      "/api/personal-home",
    ],
    start: () =>
      spawnApplication(
        [
          "--filter",
          "@inside/web",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(webPort),
        ],
        runtimeEnvironment,
      ),
    stop: (web) => stopOwned(web),
    // Отсутствующий маршрут отвечает 404, его ловит `startWithRoutes`; готовность ждёт любого
    // ответа сервера.
    ready: (web) =>
      waitForResponse(web, webBaseUrl, (response) => response.status < 500),
  });
  // Корпус #116 и совместимость SDK #992. Telegram-вход проверяется на своём стенде с provider (docs/verification).
  await runPnpm(
    ["--filter", "@inside/web", "test:identity", "identity-proof.spec.ts"],
    runtimeEnvironment,
  );
  if (sensitiveOutputObserved) {
    throw new Error(
      "Application runtime output contained a sensitive proof canary",
    );
  }
  await assertDatabaseInvariants(runtimeEnvironment);
  process.stdout.write(
    "Issue 116 proof passed: 10/10m recipient cap, outage recovery, one Account, no Platform session table, redacted audit.\n",
  );
} catch (error) {
  if (interruptedSignal === undefined) throw error;
} finally {
  cleaningUp = true;
  try {
    try {
      await stopApplications();
    } finally {
      await cleanup();
    }
  } finally {
    await releaseLock();
  }
}

if (interruptedSignal !== undefined)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;

async function assertNoRunningProof() {
  for (const [compose, environment] of /** @type {const} */ ([
    [identityCompose, identityEnvironment],
    [platformCompose, platformEnvironment],
  ])) {
    const output = await runCompose(
      compose,
      ["ps", "--services", "--status", "running"],
      environment,
      true,
    );
    if (output.trim().length > 0) {
      throw new Error(
        "The isolated issue 116 proof is already owned by another session",
      );
    }
  }
}

async function resetStoppedProof() {
  await runCompose(
    platformCompose,
    ["down", "--volumes", "--remove-orphans"],
    platformEnvironment,
  );
  await runCompose(
    identityCompose,
    ["down", "--volumes", "--remove-orphans"],
    identityEnvironment,
  );
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} url
 * @param {(response: Response) => boolean} accepts
 */
async function waitForResponse(child, url, accepts) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (
      interruptedSignal !== undefined ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      throw new Error("An application proof process exited before readiness");
    }
    const response = await globalThis
      .fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) })
      .catch(() => undefined);
    if (response !== undefined && accepts(response)) return;
    await delay(1_000);
  }
  throw new Error("Issue 116 application runtime did not become ready");
}

/**
 * @param {Environment} environment
 * @param {string} name
 */
function requiredUrl(environment, name) {
  const value = environment[name];
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

/**
 * База, в которую стенд мигрировал и с которой работал API: проверка смотрит туда же.
 *
 * @param {Environment} environment
 */
function applicationDatabase(environment) {
  const url = environment["DATABASE_URL"];
  if (url === undefined)
    throw new Error("The proof runtime has no DATABASE_URL");
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** @param {Environment} environment */
async function assertDatabaseInvariants(environment) {
  const platformEffects = await runCompose(
    platformCompose,
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "inside",
      "-d",
      applicationDatabase(environment),
      "-Atc",
      "select (select count(*) from accounts.accounts)::text || '|' || coalesce(to_regclass('identity_principals.platform_sessions')::text, 'absent')",
    ],
    platformEnvironment,
    true,
  );
  if (platformEffects.trim() !== "1|absent") {
    throw new Error(
      `Expected one Account and no Platform session table, observed ${platformEffects.trim()}`,
    );
  }

  const secretCanaries = [
    environment["LOGTO_APP_SECRET"],
    environment["LOGTO_COOKIE_SECRET"],
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => `payload::text like ${sqlLiteral(`%${value}%`)}`);
  const auditPredicate = [
    "payload::text ~ '@example\\.test'",
    "payload::text like '%provider-payload-canary-116%'",
    "payload::text like '%proof-code-canary-116%'",
    "payload::text like '%proof-jwt-canary-116%'",
    "payload::text like '%proof-state-canary-116%'",
    ...secretCanaries,
  ].join(" or ");
  const leakedAuditValues = await runCompose(
    identityCompose,
    [
      "exec",
      "-T",
      "logto-postgres",
      "psql",
      "-U",
      "logto",
      "-d",
      "logto",
      "-Atc",
      `select count(*) from logs where ${auditPredicate}`,
    ],
    identityEnvironment,
    true,
  );
  if (leakedAuditValues.trim() !== "0") {
    throw new Error("Logto audit contained a sensitive proof canary");
  }
}

/**
 * @param {string[]} arguments_
 * @param {Environment} environment
 */
function spawnApplication(arguments_, environment) {
  if (interruptedSignal !== undefined)
    throw new Error("Identity proof interrupted");
  const child = spawnOwned(process.execPath, [pnpmPath, ...arguments_], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  applicationProcesses.add(child);
  for (const source of [child.stdout, child.stderr]) {
    source?.on("data", (/** @type {Buffer} */ chunk) =>
      observeOutput(chunk.toString(), environment),
    );
  }
  child.once("error", (error) => process.stderr.write(`${String(error)}\n`));
  return child;
}

/**
 * @param {string} output
 * @param {Environment} environment
 */
function observeOutput(output, environment) {
  const canaries = [
    "provider-payload-canary-116",
    "proof-code-canary-116",
    "proof-jwt-canary-116",
    "proof-state-canary-116",
    environment["LOGTO_APP_SECRET"],
    environment["LOGTO_COOKIE_SECRET"],
  ].filter(
    /** @returns {value is string} */
    (value) => typeof value === "string" && value.length > 0,
  );
  if (
    canaries.some((canary) => output.includes(canary)) ||
    /[a-z0-9._+-]+@example\.test/iu.test(output)
  ) {
    sensitiveOutputObserved = true;
  }
}

async function stopApplications() {
  for (const child of [...applicationProcesses].reverse())
    await stopOwned(child);
}

async function cleanup() {
  /** @type {unknown[]} */
  const failures = [];
  if (ownsPlatform) {
    ownsPlatform = false;
    try {
      await runCompose(
        platformCompose,
        ["down", "--volumes", "--remove-orphans"],
        platformEnvironment,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (ownsIdentity) {
    ownsIdentity = false;
    try {
      await runCompose(
        identityCompose,
        ["down", "--volumes", "--remove-orphans"],
        identityEnvironment,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const [compose, environment] of /** @type {const} */ ([
    [platformCompose, platformEnvironment],
    [identityCompose, identityEnvironment],
  ])) {
    try {
      const remaining = await runCompose(
        compose,
        ["ps", "--services", "--status", "running"],
        environment,
        true,
      );
      if (remaining.trim().length > 0) {
        failures.push(
          new Error(`Proof cleanup left running services: ${remaining.trim()}`),
        );
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Issue 116 proof cleanup did not complete",
    );
  }
}

/**
 * @param {string} compose
 * @param {string[]} arguments_
 * @param {Environment} environment
 * @param {boolean} [capture]
 */
function runCompose(compose, arguments_, environment, capture = false) {
  return run(
    "docker",
    ["compose", "--env-file", composeEnvironment, "-f", compose, ...arguments_],
    environment,
    capture,
  );
}

/**
 * @param {string[]} arguments_
 * @param {Environment} environment
 */
function runPnpm(arguments_, environment) {
  return run(process.execPath, [pnpmPath, ...arguments_], environment, false);
}

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {Environment} environment
 * @param {boolean} capture
 */
async function run(command, arguments_, environment, capture) {
  if (interruptedSignal !== undefined && !cleaningUp)
    throw new Error("Identity proof interrupted");
  const child = spawnOwned(command, arguments_, {
    cwd: root,
    env: environment,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...(cleaningUp ? { timeout: 60_000 } : {}),
  });
  activeCommands.add(child);
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
    if (exitCode !== 0)
      throw new Error(`${command} ${arguments_.join(" ")} failed`);
  } finally {
    await stopOwned(child);
    activeCommands.delete(child);
  }
  return output;
}

/** @param {string} value */
function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
