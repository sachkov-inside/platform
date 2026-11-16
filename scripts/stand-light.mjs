// @ts-check
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { composePsql } from "./check-database.mjs";
import { fullStackRelease } from "./full-stack-environment.mjs";
import {
  assertLightDatabase,
  lightDirectory,
  lightInstanceName,
  lightRoleNames,
  lightStartupBudgetMilliseconds,
  listLightStates,
  readLightState,
  treeResidentKiB,
} from "./stand-light-plan.mjs";
import { processAlive } from "./stand-queue.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    worktree: { type: "string" },
    infrastructure: { type: "string" },
    mcp: { type: "boolean" },
    dev: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});
// The supervisor's own budget plus its adoption and record.
const startupBudgetMilliseconds = lightStartupBudgetMilliseconds + 60_000;
const stopBudgetMilliseconds = 60_000;
const recordPollMilliseconds = 500;
const stopPollMilliseconds = 250;
const dockerCommandMilliseconds = 20_000;
const gitCommandMilliseconds = 10_000;

if (values.help) {
  process.stdout
    .write(`Usage: pnpm stand:light [up|status|down] [--worktree PATH] [--mcp] [--dev] [--infrastructure PROJECT] [--json]

up      Start this worktree's web and API on free ports with their own database in the stand
        PostgreSQL and the synthetic sign-in. Several worktrees run instances side by side.
status  List the light instances of this repository with their addresses, age and memory.
down    Stop this worktree's instance and drop its database; nothing else is touched.

--mcp             Also start MCP.
--dev             Run web through next dev with reload on edits instead of a production build;
                  it needs more memory.
--infrastructure  Compose project whose PostgreSQL and object storage the instance uses
                  (default: inside-platform, the shared stand).
`);
} else {
  try {
    const command = z
      .enum(["up", "status", "down"])
      .parse(positionals[0] ?? "status");
    const requested = resolve(
      values.worktree ?? process.env["INIT_CWD"] ?? process.cwd(),
    );
    // `down` also stops the instance of a deleted worktree: its record keeps the real path, and the
    // records live in the common Git directory that this script's checkout shares.
    const deleted = command === "down" && !existsSync(requested);
    const worktree = deleted
      ? requested
      : await realpath(git(requested, ["rev-parse", "--show-toplevel"]));
    const checkout = deleted
      ? dirname(dirname(fileURLToPath(import.meta.url)))
      : worktree;
    const common = await realpath(
      resolve(checkout, git(checkout, ["rev-parse", "--git-common-dir"])),
    );
    const directory = lightDirectory(join(common, "inside-platform-stand"));
    if (command === "status") await status(directory);
    else if (command === "down") await down(directory, worktree);
    else await up(directory, worktree);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Invalid input; use --help"
        : error instanceof Error
          ? error.message
          : "Light instance command failed";
    if (values.json)
      process.stdout.write(`${JSON.stringify({ status: "error", message })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

/** @param {string} directory @param {string} worktree */
async function up(directory, worktree) {
  const pnpmPath = process.env["npm_execpath"];
  if (!pnpmPath)
    throw new Error("Run the light instance through pnpm stand:light");
  const composeProject = values.infrastructure ?? "inside-platform";
  const postgres = publishedPort(composeProject, "postgres", 5432);
  const storage = publishedPort(composeProject, "object-storage", 9000);
  const { id } = lightInstanceName(worktree);
  const previous = await readLightState(directory, id);
  if (previous && processAlive(previous.pid))
    throw new Error(
      `A light instance of this worktree is already running (${previous.urls.web}); run pnpm stand:light down first`,
    );
  if (previous) await removeLeftovers(directory, previous);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const logPath = join(directory, `${id}.log`);
  const log = await open(logPath, "w", 0o600);
  const started = performance.now();
  // deterministic-test-allow process-cleanup: the detached instance supervisor outlives this command by design; `pnpm stand:light down` stops it and its owned tree, verified by the two-instance teardown run.
  const supervisor = spawn(
    process.execPath,
    [join(dirname(fileURLToPath(import.meta.url)), "stand-light-instance.mjs")],
    {
      cwd: worktree,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
        OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${String(storage)}`,
        OBJECT_STORAGE_SIGNED_GET_ENDPOINT: `http://127.0.0.1:${String(storage)}`,
        STAND_LIGHT_CONFIGURATION: JSON.stringify({
          worktree,
          directory,
          pnpmPath,
          composeProject,
          postgresPort: postgres,
          mcp: values.mcp ?? false,
          web: values.dev ? "development" : "production",
        }),
      },
    },
  );
  // The launched process hands over to a detached copy and exits 0; another status is a crash.
  let crashed = false;
  supervisor.once("exit", (code) => {
    crashed = code !== 0;
  });
  supervisor.unref();
  await log.close();
  const deadline = Date.now() + startupBudgetMilliseconds;
  for (;;) {
    const state = await readLightState(directory, id);
    if (state?.phase === "ready") {
      const seconds = (performance.now() - started) / 1_000;
      if (values.json)
        process.stdout.write(
          `${JSON.stringify({ status: "ready", bootSeconds: Math.round(seconds), ...state })}\n`,
        );
      else
        process.stdout.write(
          [
            `Light instance ready in ${seconds.toFixed(0)} s (web: ${state.web})`,
            `Web: ${state.urls.web}`,
            `API: ${state.urls.api}`,
            ...(state.urls.mcp ? [`MCP: ${state.urls.mcp}`] : []),
            `Sign in: ${state.urls.signIn ?? ""}?as=<${lightRoleNames.join("|")}>&next=/`,
            `Database: ${state.database}`,
            `Log: ${logPath}`,
            "Stop: pnpm stand:light down",
            "",
          ].join("\n"),
        );
      return;
    }
    if (state?.phase === "failed" || crashed || Date.now() > deadline) {
      if (state && processAlive(state.pid)) process.kill(state.pid, "SIGTERM");
      throw new Error(
        `Light instance did not start: ${state?.failure ?? "startup budget exceeded"}; see ${logPath}, then run pnpm stand:light down`,
      );
    }
    await pause(recordPollMilliseconds);
  }
}

/** @param {string} directory @param {string} worktree */
async function down(directory, worktree) {
  const { id } = lightInstanceName(worktree);
  const state = await readLightState(directory, id);
  if (!state) {
    // A deleted worktree has no checkout to resolve; a wrong path must not look like success.
    if (!existsSync(worktree)) {
      const known = (await listLightStates(directory)).map(
        (item) => item.worktree,
      );
      throw new Error(
        `No light instance for ${worktree}; recorded worktrees: ${known.join(", ") || "none"}`,
      );
    }
    process.stdout.write("No light instance for this worktree\n");
    return;
  }
  if (processAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    const deadline = Date.now() + stopBudgetMilliseconds;
    while (processAlive(state.pid) && Date.now() < deadline)
      await pause(stopPollMilliseconds);
    if (processAlive(state.pid))
      throw new Error(
        `Light instance supervisor ${String(state.pid)} did not stop`,
      );
  }
  // A supervisor that stopped cleanly removed its record and database; a crashed one left them.
  if (await readLightState(directory, state.id))
    await removeLeftovers(directory, state);
  process.stdout.write(
    `Stopped light instance ${state.id}; dropped ${state.database}\n`,
  );
}

/**
 * After the supervisor has ended: its supervised processes ended with it; drop the database if a
 * crash left it and remove the record.
 * @param {string} directory @param {import("./stand-light-plan.mjs").LightState} state
 */
async function removeLeftovers(directory, state) {
  composePsql({
    // The worktree may be deleted already; Compose selects the project by name.
    cwd: undefined,
    composeProject: state.composeProject,
    run: execFileSync,
  })(
    `drop database if exists ${assertLightDatabase(state.database)} with (force)`,
  );
  await rm(join(directory, `${state.id}.json`), { force: true });
  if (!existsSync(state.worktree)) return;
  // A crashed supervisor also leaves the release identity it wrote; another file stays.
  const identity = join(state.worktree, "apps/web/release-identity.json");
  if (
    existsSync(identity) &&
    (await readFile(identity, "utf8")) ===
      `${JSON.stringify(fullStackRelease)}\n`
  )
    await rm(identity, { force: true });
  if (
    git(state.worktree, ["status", "--porcelain", "--", "apps/web/AGENTS.md"])
  )
    process.stderr.write(
      "apps/web/AGENTS.md differs from the commit; next may have rewritten its Next.js block before the crash. Check it with git diff.\n",
    );
}

/** @param {number} milliseconds */
function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {string} directory */
async function status(directory) {
  const states = await listLightStates(directory);
  const processes = processTable();
  const report = states.map((state) => ({
    ...state,
    running: processAlive(state.pid),
    residentMiB: Math.round(treeResidentKiB(processes, state.pid) / 1024),
    ageSeconds: Math.floor((Date.now() - Date.parse(state.startedAt)) / 1_000),
  }));
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ instances: report })}\n`);
    return;
  }
  if (report.length === 0) process.stdout.write("No light instances\n");
  for (const item of report)
    process.stdout.write(
      `${item.worktree}: ${item.running ? item.phase : "not running"}${item.failure ? ` (${item.failure})` : ""}, web ${item.web} ${item.urls.web}, ${String(Math.floor(item.ageSeconds / 60))} min, ${String(item.residentMiB)} MiB resident\n`,
    );
}

/** @returns {{ pid: number; ppid: number; rss: number }[]} */
function processTable() {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .map(([pid = 0, ppid = 0, rss = 0]) => ({ pid, ppid, rss }));
}

/**
 * @param {string} project @param {string} service @param {number} port
 */
function publishedPort(project, service, port) {
  let output;
  try {
    output = execFileSync(
      "docker",
      ["compose", "--project-name", project, "port", service, String(port)],
      {
        encoding: "utf8",
        timeout: dockerCommandMilliseconds,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    throw new Error(
      `The ${service} of Compose project ${project} is not running; the light instance needs the stand infrastructure`,
      { cause: error },
    );
  }
  const published = /^127\.0\.0\.1:(\d+)$/u.exec(output)?.[1];
  if (published === undefined)
    throw new Error(
      `The ${service} of ${project} must be published on 127.0.0.1`,
    );
  return Number(published);
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: gitCommandMilliseconds,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
