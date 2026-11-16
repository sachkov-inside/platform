// @ts-check
// The supervisor of one light instance. `pnpm stand:light up` starts it detached; it owns the
// instance's processes, database and release identity file until SIGTERM from `pnpm stand:light down`.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import { composePsql } from "./check-database.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { fullStackRelease } from "./full-stack-environment.mjs";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";
import { reservePort } from "./smoke-stand.mjs";
import {
  assertLightDatabase,
  lightEnvironment,
  lightInstanceName,
  lightSignInHandler,
  lightSubjects,
} from "./stand-light-plan.mjs";

const adoptionPollMilliseconds = 50;
const adoptionBudgetMilliseconds = 10_000;
const startupBudgetMilliseconds = 15 * 60_000;
const readinessPollMilliseconds = 500;
const readinessRequestMilliseconds = 30_000;
const processStopGraceMilliseconds = 10_000;

// Owned processes stop when any ancestor of their owner exits (owned-process.py). The instance
// outlives the `up` command, so its supervisor first leaves that ancestry: it starts a copy of
// itself and exits, and the copy waits until launchd (PID 1) adopts it.
if (process.env["STAND_LIGHT_DETACHED"] !== "1") {
  spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, STAND_LIGHT_DETACHED: "1" },
  }).unref();
  process.exit(0);
}
const adoptionDeadline = Date.now() + adoptionBudgetMilliseconds;
while (process.ppid !== 1) {
  if (Date.now() > adoptionDeadline) {
    process.stderr.write(
      "The light instance supervisor was not adopted by launchd; its processes would stop with the caller\n",
    );
    process.exit(1);
  }
  await pause(adoptionPollMilliseconds);
}

const configuration = z
  .strictObject({
    worktree: z.string(),
    directory: z.string(),
    pnpmPath: z.string(),
    composeProject: z.string(),
    postgresPort: z.number().int().positive(),
    mcp: z.boolean(),
    web: z.enum(["production", "development"]),
  })
  .parse(JSON.parse(process.env["STAND_LIGHT_CONFIGURATION"] ?? "null"));
const { id, database, appId } = lightInstanceName(configuration.worktree);
const statePath = join(configuration.directory, `${id}.json`);
const releaseIdentityPath = join(
  configuration.worktree,
  "apps/web/release-identity.json",
);
const releaseIdentity = `${JSON.stringify(fullStackRelease)}\n`;
const webAgentsPath = join(configuration.worktree, "apps/web/AGENTS.md");
const psql = composePsql({
  cwd: configuration.worktree,
  composeProject: configuration.composeProject,
  run: execFileSync,
});
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {(() => Promise<void>)[]} */
const closers = [];
/** @type {Promise<void> | undefined} */
let stopping;
let databaseCreated = false;
let releaseIdentityWritten = false;
/** @type {string | undefined} */
let webAgentsText;

/** @type {import("./stand-light-plan.mjs").LightState} */
const state = {
  version: 1,
  id,
  worktree: configuration.worktree,
  pid: process.pid,
  phase: "starting",
  web: configuration.web,
  startedAt: new Date().toISOString(),
  readyAt: null,
  database,
  composeProject: configuration.composeProject,
  urls: {
    web: "http://127.0.0.1/",
    api: "http://127.0.0.1/",
    mcp: null,
    signIn: null,
  },
  failure: null,
};

process.once("SIGTERM", () => void stop(0));
process.once("SIGINT", () => void stop(130));

try {
  const ports = {
    web: await reservePort(),
    api: await reservePort(),
    mcp: configuration.mcp ? await reservePort() : undefined,
  };
  const webBaseUrl = `http://127.0.0.1:${String(ports.web)}`;
  const identity = await startFullStackIdentity({
    apiBaseUrl: `http://127.0.0.1:${String(ports.api)}`,
    webBaseUrl,
    appId,
    ...(ports.mcp === undefined
      ? {}
      : {
          learningResource: `http://127.0.0.1:${String(ports.mcp)}/mcp/learning`,
        }),
  });
  closers.push(() => identity.close());
  const signIn = lightSignInHandler(identity, webBaseUrl);
  const signInServer = createServer((request, response) => {
    void signIn(request.method ?? "GET", request.url ?? "/").then(
      ({ status, headers }) => response.writeHead(status, headers).end(),
      () => response.writeHead(500).end(),
    );
  });
  await new Promise((resolve) =>
    signInServer.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  closers.push(
    () =>
      new Promise((resolve) => {
        signInServer.closeAllConnections();
        signInServer.close(() => resolve());
      }),
  );
  const signInAddress = signInServer.address();
  if (signInAddress === null || typeof signInAddress === "string")
    throw new Error("Sign-in server has no TCP port");
  const environment = lightEnvironment({
    database,
    postgresPort: configuration.postgresPort,
    ports,
    identity: identity.environment,
    defaults: parseEnv(
      await readFile(join(configuration.worktree, ".env.example"), "utf8"),
    ),
    base: process.env,
    webMode: configuration.web,
  });
  state.urls = {
    web: environment.urls.web,
    api: environment.urls.api,
    mcp: environment.urls.mcp ?? null,
    signIn: `http://127.0.0.1:${String(signInAddress.port)}/sign-in`,
  };
  await writeState();

  // A fresh database on every start: the instance never inherits data of an earlier run.
  psql(`drop database if exists ${assertLightDatabase(database)} with (force)`);
  psql(`create database ${assertLightDatabase(database)}`);
  databaseCreated = true;
  for (const script of ["db:migrate", "db:seed", "release:bootstrap-owner"])
    await runPnpm(["--filter", "@inside/backend", script], environment.shared);

  webAgentsText = await readFile(webAgentsPath, "utf8");
  start(["--filter", "@inside/backend", "dev:api"], environment.shared);
  if (environment.mcp)
    start(["--filter", "@inside/backend", "dev:mcp"], environment.mcp);
  const webAddress = ["--hostname", "127.0.0.1", "--port", String(ports.web)];
  if (configuration.web === "production") {
    // The production build requires a release identity beside the application; an interrupted
    // instance leaves its own file, which it may take again, never another one.
    if (
      existsSync(releaseIdentityPath) &&
      (await readFile(releaseIdentityPath, "utf8")) !== releaseIdentity
    )
      throw new Error(`Refusing to replace ${releaseIdentityPath}`);
    await rm(releaseIdentityPath, { force: true });
    await writeFile(releaseIdentityPath, releaseIdentity, { mode: 0o444 });
    releaseIdentityWritten = true;
    await runPnpm(["--filter", "@inside/web", "build"], environment.web);
    start(["--filter", "@inside/web", "start", ...webAddress], environment.web);
  } else
    start(["--filter", "@inside/web", "dev", ...webAddress], environment.web);

  const deadline = Date.now() + startupBudgetMilliseconds;
  await waitFor(`${environment.urls.api}/health`, deadline);
  // The learner signs in without the web callback that establishes an Account on first sign-in.
  const learner = await identity.createAccessToken(lightSubjects.learner);
  const established = await fetch(`${environment.urls.api}/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${learner.token}` },
  });
  if (established.status !== 201)
    throw new Error(
      `Learner Account establishment returned HTTP ${String(established.status)}`,
    );
  if (environment.urls.mcp)
    await waitFor(
      `${environment.urls.mcp.replace(/\/mcp$/u, "")}/.well-known/oauth-protected-resource/mcp`,
      deadline,
    );
  // Web readiness compares release identities, and the host API runs in development mode, as
  // in the full-stack smoke; API readiness is checked above, so web only has to be alive.
  await waitFor(`${environment.urls.web}/_health/live`, deadline);
  await restoreWebAgents();
  state.phase = "ready";
  state.readyAt = new Date().toISOString();
  await writeState();
} catch (error) {
  await fail(
    error instanceof Error ? error.message : "Light instance failed to start",
  );
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function start(args, env) {
  const child = spawnOwned(...pnpmInvocation(configuration.pnpmPath, args), {
    cwd: configuration.worktree,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  // An instance with a missing process is not usable: stop the rest and keep the failure.
  child.once("exit", (code) => {
    if (stopping === undefined)
      void fail(`${args.join(" ")} exited with ${String(code)}`);
  });
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
async function runPnpm(args, env) {
  const child = spawnOwned(...pnpmInvocation(configuration.pnpmPath, args), {
    cwd: configuration.worktree,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const code = await commandExit(child);
  if (code !== 0)
    throw new Error(`pnpm ${args.join(" ")} failed (${String(code)})`);
}

/** @param {string} url @param {number} deadline */
async function waitFor(url, deadline) {
  while (Date.now() < deadline) {
    if (stopping !== undefined) throw new Error("The instance is stopping");
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(readinessRequestMilliseconds),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await pause(readinessPollMilliseconds);
  }
  throw new Error(`${url} did not answer within the startup budget`);
}

/** `next dev` and `next build` rewrite the Next.js block of apps/web/AGENTS.md; keep the committed text. */
async function restoreWebAgents() {
  if (
    webAgentsText !== undefined &&
    (await readFile(webAgentsPath, "utf8")) !== webAgentsText
  )
    await writeFile(webAgentsPath, webAgentsText);
}

async function writeState() {
  await mkdir(configuration.directory, { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
}

/** @param {string} failure */
async function fail(failure) {
  if (stopping !== undefined) return;
  state.phase = "failed";
  state.failure = failure;
  process.stderr.write(`${failure}\n`);
  await writeState().catch(() => undefined);
  await stop(1);
}

/**
 * Removes the instance's processes, servers, database, release identity file and record, and
 * nothing else. A failed instance keeps its record with the failure until `down`, so the caller
 * can read why. Every step runs even when an earlier one fails.
 * @param {number} code
 */
function stop(code) {
  stopping ??= (async () => {
    const failed = state.phase === "failed";
    if (!failed) {
      state.phase = "stopping";
      await writeState().catch(() => undefined);
    }
    await Promise.allSettled(
      children.map((child) => stopOwned(child, processStopGraceMilliseconds)),
    );
    for (const close of closers) await close().catch(() => undefined);
    let exitCode = code;
    try {
      if (databaseCreated)
        psql(
          `drop database if exists ${assertLightDatabase(database)} with (force)`,
        );
    } catch (error) {
      exitCode = 1;
      process.stderr.write(
        `Dropping ${database} failed; pnpm stand:light down retries it: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
    if (releaseIdentityWritten)
      await rm(releaseIdentityPath, { force: true }).catch(() => undefined);
    await restoreWebAgents().catch(() => undefined);
    if (!failed && exitCode === code)
      await rm(statePath, { force: true }).catch(() => undefined);
    process.exit(exitCode);
  })();
  return stopping;
}

/** @param {number} milliseconds */
function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
