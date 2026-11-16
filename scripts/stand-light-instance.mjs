// @ts-check
// The supervisor of one light instance. `pnpm stand:light up` starts it detached; it owns the
// instance's processes and database until SIGTERM from `pnpm stand:light down`.
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import { composePsql } from "./check-database.mjs";
import { commandExit } from "./diagnostic-command.mjs";
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

// Owned processes stop when any ancestor of their owner exits (owned-process.py). The instance
// outlives the `up` command, so its supervisor first leaves that ancestry: it starts a copy of
// itself and exits, and the copy waits until it is adopted by launchd (PID 1).
if (process.env["STAND_LIGHT_DETACHED"] !== "1") {
  spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, STAND_LIGHT_DETACHED: "1" },
  }).unref();
  process.exit(0);
}
while (process.ppid !== 1)
  await new Promise((resolve) => setTimeout(resolve, 50));

const configuration = z
  .strictObject({
    worktree: z.string(),
    directory: z.string(),
    pnpmPath: z.string(),
    composeProject: z.string(),
    postgresPort: z.number().int().positive(),
    mcp: z.boolean(),
  })
  .parse(JSON.parse(process.env["STAND_LIGHT_CONFIGURATION"] ?? "null"));
const startupBudgetMilliseconds = 10 * 60_000;
const { id, database, appId } = lightInstanceName(configuration.worktree);
const statePath = join(configuration.directory, `${id}.json`);
const startedAt = new Date().toISOString();
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

/** @type {import("./stand-light-plan.mjs").LightState} */
const state = {
  version: 1,
  id,
  worktree: configuration.worktree,
  pid: process.pid,
  phase: "starting",
  startedAt,
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
  const apiBaseUrl = `http://127.0.0.1:${String(ports.api)}`;
  const identity = await startFullStackIdentity({
    apiBaseUrl,
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

  const webAgents = join(configuration.worktree, "apps/web/AGENTS.md");
  const webAgentsText = await readFile(webAgents, "utf8");
  start(["--filter", "@inside/backend", "dev:api"], environment.shared);
  start(
    [
      "--filter",
      "@inside/web",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(ports.web),
    ],
    environment.shared,
  );
  if (environment.mcp)
    start(["--filter", "@inside/backend", "dev:mcp"], environment.mcp);

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
  await waitFor(`${environment.urls.web}/_health/ready`, deadline);
  // `next dev` rewrites the Next.js block of apps/web/AGENTS.md at startup; the checkout keeps
  // its committed text.
  if ((await readFile(webAgents, "utf8")) !== webAgentsText)
    await writeFile(webAgents, webAgentsText);
  state.phase = "ready";
  state.readyAt = new Date().toISOString();
  await writeState();
} catch (error) {
  state.phase = "failed";
  state.failure =
    error instanceof Error ? error.message : "Light instance failed to start";
  process.stderr.write(`${state.failure}\n`);
  await writeState().catch(() => undefined);
  await stop(1);
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function start(args, env) {
  const child = spawnOwned(...pnpmInvocation(configuration.pnpmPath, args), {
    cwd: configuration.worktree,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  child.once("exit", (code) => {
    if (stopping || state.phase === "stopping") return;
    state.phase = "failed";
    state.failure = `${args.join(" ")} exited with ${String(code)}`;
    void writeState();
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
    if (state.phase === "failed")
      throw new Error(state.failure ?? "A process exited");
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within the startup budget`);
}

async function writeState() {
  await mkdir(configuration.directory, { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
}

/**
 * Removes the instance's processes, servers, database and record, and nothing else. A failed
 * start keeps its record with the failure until `down`, so the caller can read why.
 * @param {number} code
 */
function stop(code) {
  stopping ??= (async () => {
    const failed = state.phase === "failed";
    if (!failed) {
      state.phase = "stopping";
      await writeState().catch(() => undefined);
    }
    await Promise.all(children.map((child) => stopOwned(child, 10_000)));
    for (const close of closers) await close().catch(() => undefined);
    if (databaseCreated)
      psql(
        `drop database if exists ${assertLightDatabase(database)} with (force)`,
      );
    if (!failed) await rm(statePath, { force: true });
    process.exit(code);
  })();
  return stopping;
}
