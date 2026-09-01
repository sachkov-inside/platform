import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import lockfile from "proper-lockfile";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityCompose = resolve(root, "infra/identity/logto/compose.yaml");
const platformCompose = resolve(root, "compose.yaml");
const composeEnvironment = resolve(root, "infra/identity/logto/compose.env");
const pnpmPath = process.env.npm_execpath;
if (pnpmPath === undefined) {
  throw new Error("Run the identity hardening proof through the pinned pnpm CLI");
}

const identityEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "inside-identity-proof-116",
  IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS: "60",
  IDENTITY_PROOF_API_PORT: "3501",
  IDENTITY_PROOF_LOGTO_ADMIN_PORT: "3402",
  IDENTITY_PROOF_LOGTO_PORT: "3401",
  IDENTITY_PROOF_MAILPIT_PORT: "3405",
  IDENTITY_PROOF_POSTGRES_PORT: "55433",
  IDENTITY_PROOF_SMTP_PORT: "3404",
  IDENTITY_PROOF_WEB_PORT: "3500",
};
const platformEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "inside-platform-proof-116",
  POSTGRES_HOST_PORT: identityEnvironment.IDENTITY_PROOF_POSTGRES_PORT,
};

const releaseLock = await acquireOwnershipLock();
const applicationProcesses = new Set();
let ownsIdentity = false;
let ownsPlatform = false;
let sensitiveOutputObserved = false;

try {
  await assertNoRunningProof();
  await resetStoppedProof();
  await runPnpm(["identity:proof:certs"], identityEnvironment);
  await runPnpm(["identity:proof:build"], identityEnvironment);
  ownsIdentity = true;
  await runCompose(identityCompose, ["up", "-d", "--wait"], identityEnvironment);
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
    NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem"),
  };
  await runPnpm(["--filter", "@inside/backend", "db:migrate"], runtimeEnvironment);
  spawnApplication(
    ["--filter", "@inside/backend", "dev:api"],
    runtimeEnvironment,
  );
  spawnApplication(
    [
      "--filter",
      "@inside/web",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      identityEnvironment.IDENTITY_PROOF_WEB_PORT,
    ],
    runtimeEnvironment,
  );
  await waitForRuntime(runtimeEnvironment);
  await runPnpm(["--filter", "@inside/web", "test:identity"], runtimeEnvironment);
  if (sensitiveOutputObserved) {
    throw new Error("Application runtime output contained a sensitive proof canary");
  }
  await assertDatabaseInvariants(runtimeEnvironment);
  process.stdout.write(
    "Issue 116 proof passed: 10/10m recipient cap, outage recovery, one Account, no Platform session table, redacted audit.\n",
  );
} finally {
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

async function assertNoRunningProof() {
  for (const [compose, environment] of [
    [identityCompose, identityEnvironment],
    [platformCompose, platformEnvironment],
  ]) {
    const output = await runCompose(
      compose,
      ["ps", "--services", "--status", "running"],
      environment,
      true,
    );
    if (output.trim().length > 0) {
      throw new Error("The isolated issue 116 proof is already owned by another session");
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

async function waitForRuntime(environment) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ([...applicationProcesses].some((child) => child.exitCode !== null)) {
      throw new Error("An application proof process exited before readiness");
    }
    const responses = await Promise.all([
      globalThis.fetch(environment.WEB_BASE_URL).catch(() => undefined),
      globalThis.fetch(`${environment.BACKEND_BASE_URL}/health`).catch(() => undefined),
    ]);
    if (responses.every((response) => response?.ok)) return;
    await delay(1_000);
  }
  throw new Error("Issue 116 application runtime did not become ready");
}

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
      "inside",
      "-Atc",
      "select (select count(*) from accounts.accounts)::text || '|' || coalesce(to_regclass('identity_principals.platform_sessions')::text, 'absent')",
    ],
    platformEnvironment,
    true,
  );
  if (platformEffects.trim() !== "1|absent") {
    throw new Error(`Expected one Account and no Platform session table, observed ${platformEffects.trim()}`);
  }

  const secretCanaries = [environment.LOGTO_APP_SECRET, environment.LOGTO_COOKIE_SECRET]
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

function spawnApplication(arguments_, environment) {
  const child = spawn(process.execPath, [pnpmPath, ...arguments_], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  applicationProcesses.add(child);
  for (const source of [child.stdout, child.stderr]) {
    source?.on("data", (chunk) => observeOutput(chunk.toString(), environment));
  }
  child.once("exit", () => applicationProcesses.delete(child));
}

function observeOutput(output, environment) {
  const canaries = [
    "provider-payload-canary-116",
    "proof-code-canary-116",
    "proof-jwt-canary-116",
    "proof-state-canary-116",
    environment.LOGTO_APP_SECRET,
    environment.LOGTO_COOKIE_SECRET,
  ].filter((value) => typeof value === "string" && value.length > 0);
  if (
    canaries.some((canary) => output.includes(canary)) ||
    /[a-z0-9._+-]+@example\.test/iu.test(output)
  ) {
    sensitiveOutputObserved = true;
  }
}

async function stopApplications() {
  const processes = [...applicationProcesses];
  for (const child of processes) child.kill("SIGTERM");
  await Promise.race([
    Promise.all(processes.map((child) => new Promise((resolveExit) => child.once("exit", resolveExit)))),
    delay(5_000),
  ]);
  for (const child of processes) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function cleanup() {
  const failures = [];
  if (ownsPlatform) {
    ownsPlatform = false;
    try {
      await runCompose(platformCompose, ["down", "--volumes", "--remove-orphans"], platformEnvironment);
    } catch (error) {
      failures.push(error);
    }
  }
  if (ownsIdentity) {
    ownsIdentity = false;
    try {
      await runCompose(identityCompose, ["down", "--volumes", "--remove-orphans"], identityEnvironment);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const [compose, environment] of [
    [platformCompose, platformEnvironment],
    [identityCompose, identityEnvironment],
  ]) {
    try {
      const remaining = await runCompose(compose, ["ps", "--services", "--status", "running"], environment, true);
      if (remaining.trim().length > 0) {
        failures.push(new Error(`Proof cleanup left running services: ${remaining.trim()}`));
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Issue 116 proof cleanup did not complete");
  }
}

function runCompose(compose, arguments_, environment, capture = false) {
  return run(
    "docker",
    ["compose", "--env-file", composeEnvironment, "-f", compose, ...arguments_],
    environment,
    capture,
  );
}

function runPnpm(arguments_, environment) {
  return run(process.execPath, [pnpmPath, ...arguments_], environment, false);
}

async function run(command, arguments_, environment, capture) {
  const child = spawn(command, arguments_, {
    cwd: root,
    env: environment,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let output = "";
  if (capture) {
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  }
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  if (exitCode !== 0) throw new Error(`${command} ${arguments_.join(" ")} failed`);
  return output;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function acquireOwnershipLock() {
  const lockTarget = resolve(tmpdir(), "inside-platform-local-setup");
  try {
    return await lockfile.lock(lockTarget, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000,
    });
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ELOCKED") {
      throw new Error("Another local session owns the machine-wide Platform setup lock", { cause: error });
    }
    throw error;
  }
}
