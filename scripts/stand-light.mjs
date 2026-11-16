// @ts-check
import { execFileSync, spawn } from "node:child_process";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { composePsql } from "./check-database.mjs";
import {
  assertLightDatabase,
  lightDirectory,
  lightInstanceName,
  listLightStates,
  readLightState,
  treeResidentKiB,
} from "./stand-light-plan.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    worktree: { type: "string" },
    infrastructure: { type: "string" },
    mcp: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});
const startupBudgetMilliseconds = 10 * 60_000;
const stopBudgetMilliseconds = 60_000;

if (values.help) {
  process.stdout
    .write(`Usage: pnpm stand:light [up|status|down] [--worktree PATH] [--mcp] [--infrastructure PROJECT] [--json]

up      Start this worktree's web and API on free ports with their own database in the stand
        PostgreSQL and the synthetic sign-in. Several worktrees run instances side by side.
status  List the light instances of this repository with their addresses, age and memory.
down    Stop this worktree's instance and drop its database; nothing else is touched.

--mcp             Also start MCP.
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
    const worktree = await realpath(
      git(requested, ["rev-parse", "--show-toplevel"]),
    );
    const common = await realpath(
      resolve(worktree, git(worktree, ["rev-parse", "--git-common-dir"])),
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
  if (previous && alive(previous.pid))
    throw new Error(
      `A light instance of this worktree is already running (${previous.urls.web}); run pnpm stand:light down first`,
    );
  if (previous) await removeLeftovers(directory, previous);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const logPath = join(directory, `${id}.log`);
  const log = await open(logPath, "w", 0o600);
  const started = performance.now();
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
        }),
      },
    },
  );
  supervisor.unref();
  await log.close();
  // The launched process hands over to a detached copy and exits 0; another status is a crash.
  let crashed = false;
  supervisor.once("exit", (code) => {
    crashed = code !== 0;
  });
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
            `Light instance ready in ${seconds.toFixed(0)} s`,
            `Web: ${state.urls.web}`,
            `API: ${state.urls.api}`,
            ...(state.urls.mcp ? [`MCP: ${state.urls.mcp}`] : []),
            `Sign in as owner: ${state.urls.signIn ?? ""}?as=owner&next=/`,
            `Sign in as learner: ${state.urls.signIn ?? ""}?as=learner&next=/`,
            `Database: ${state.database}`,
            `Log: ${logPath}`,
            "Stop: pnpm stand:light down",
            "",
          ].join("\n"),
        );
      return;
    }
    if (state?.phase === "failed" || crashed || Date.now() > deadline) {
      if (state && alive(state.pid)) process.kill(state.pid, "SIGTERM");
      throw new Error(
        `Light instance did not start: ${state?.failure ?? "startup budget exceeded"}; see ${logPath}, then run pnpm stand:light down`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
}

/** @param {string} directory @param {string} worktree */
async function down(directory, worktree) {
  const { id } = lightInstanceName(worktree);
  const state = await readLightState(directory, id);
  if (!state) {
    process.stdout.write("No light instance for this worktree\n");
    return;
  }
  if (alive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    const deadline = Date.now() + stopBudgetMilliseconds;
    while (alive(state.pid) && Date.now() < deadline)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    if (alive(state.pid))
      throw new Error(
        `Light instance supervisor ${String(state.pid)} did not stop`,
      );
  }
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
    cwd: state.worktree,
    composeProject: state.composeProject,
    run: execFileSync,
  })(
    `drop database if exists ${assertLightDatabase(state.database)} with (force)`,
  );
  await rm(join(directory, `${state.id}.json`), { force: true });
}

/** @param {string} directory */
async function status(directory) {
  const states = await listLightStates(directory);
  const processes = processTable();
  const report = states.map((state) => ({
    ...state,
    running: alive(state.pid),
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
      `${item.worktree}: ${item.running ? item.phase : "not running"}, ${item.urls.web}, ${String(Math.floor(item.ageSeconds / 60))} min, ${String(item.residentMiB)} MiB resident\n`,
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
      { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] },
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

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
