#!/usr/bin/env node
// @ts-check
// The helper of the `verify-platform` skill (.agents/skills/verify-platform/SKILL.md). It reads a
// light instance and drives this worktree's own browser sessions; it never starts, stops or
// changes an instance.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  assertLightDatabase,
  lightDirectory,
  lightInstanceName,
  readLightState,
} from "./stand-light-plan.mjs";
import { processAlive } from "./stand-queue.mjs";
import {
  addressFor,
  artifactTable,
  browserInvocation,
  doctorReport,
  evidenceRunName,
  listenerOwned,
  readOnlyStatement,
  sourceFreshness,
  verifyRoles,
  webBuildInput,
} from "./verify-platform-plan.mjs";

const usage = `Usage: node scripts/verify-platform.mjs <command> [--worktree PATH]

doctor [--json]                 Read-only: is this worktree's light instance worth driving?
                                Exit 0 only when every check passes.
address <target> [path]         Print an address. Targets: owner, learner (sign in and open the
                                path), sign-out, web, api.
browser [--role ROLE] -- ARGS   Run agent-browser in this worktree's own session for the role
                                (owner by default; learner, guest).
sql "<select ...>"              Run one reading statement in the instance's database; prints CSV.
evidence start [--label TEXT]   Create this run's evidence directory, record commit and patch,
                                print the path.
evidence path                   Print the current run's evidence directory.
report                          Print the verdict skeleton with the artifact list of the run.
`;

const commandMilliseconds = 20_000;
const requestMilliseconds = 10_000;
const roleSchema = z.enum(verifyRoles);
const runSchema = z.object({
  directory: z.string(),
  commit: z.string(),
  branch: z.string(),
  base: z.string().nullable(),
  patchId: z.string().nullable(),
  uncommittedFiles: z.array(z.string()),
  uncommittedDiffSha256: z.string().nullable(),
  label: z.string().nullable(),
  startedAt: z.string(),
});
const authStatusSchema = z.object({
  state: z.string(),
  canManageMaterials: z.boolean(),
});
const apiHealthSchema = z.object({
  status: z.string(),
  database: z.string(),
});
const homeSchema = z.object({
  facets: z.object({ formats: z.array(z.object({ count: z.number() })) }),
});

// `browser` passes everything after its own options to agent-browser untouched.
const separator = process.argv.indexOf("--");
const own =
  separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator);
const passed = separator === -1 ? [] : process.argv.slice(separator + 1);
/** @type {{ worktree?: string; role?: string; label?: string; json?: boolean; help?: boolean }} */
let values = {};
/** @type {string[]} */
let positionals = [];

try {
  ({ values, positionals } = parseArgs({
    args: own,
    allowPositionals: true,
    options: {
      worktree: { type: "string" },
      role: { type: "string" },
      label: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  }));
  const command = positionals[0];
  if (values.help || command === undefined) process.stdout.write(usage);
  else {
    const context = await resolveContext();
    if (command === "doctor") await doctor(context);
    else if (command === "address") await address(context);
    else if (command === "browser") browser(context);
    else if (command === "sql") await sql(context);
    else if (command === "evidence") await evidence(context);
    else if (command === "report") await report(context);
    else throw new Error(`Unknown command ${command}; use --help`);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof z.ZodError ? "Invalid input; use --help" : error instanceof Error ? error.message : "verify-platform failed"}\n`,
  );
  process.exitCode = 1;
}

/**
 * @typedef {object} Context
 * @property {string} worktree
 * @property {string} standDirectory the stand state directory under the Git common directory
 * @property {string} id the light instance identity of this worktree
 */

/** @returns {Promise<Context>} */
async function resolveContext() {
  const requested = resolve(
    values.worktree ?? process.env["INIT_CWD"] ?? process.cwd(),
  );
  const worktree = await realpath(
    git(requested, ["rev-parse", "--show-toplevel"]),
  );
  const common = await realpath(
    resolve(worktree, git(worktree, ["rev-parse", "--git-common-dir"])),
  );
  return {
    worktree,
    standDirectory: join(common, "inside-platform-stand"),
    id: lightInstanceName(worktree).id,
  };
}

/** @param {Context} context */
async function instanceState(context) {
  const state = await readLightState(
    lightDirectory(context.standDirectory),
    context.id,
  );
  if (state === null)
    throw new Error(
      "No light instance for this worktree; start one with pnpm stand:light up",
    );
  return state;
}

/** @param {Context} context */
async function doctor(context) {
  /** @type {{ name: string; ok: boolean; detail: string }[]} */
  const checks = [];
  const state = await readLightState(
    lightDirectory(context.standDirectory),
    context.id,
  );
  if (state === null)
    checks.push({
      name: "process",
      ok: false,
      detail:
        "no light instance for this worktree; start one with pnpm stand:light up",
    });
  else {
    const alive = processAlive(state.pid);
    checks.push({
      name: "process",
      ok: alive && state.phase === "ready",
      detail: alive
        ? `supervisor ${String(state.pid)} is ${state.phase}${state.failure ? ` (${state.failure})` : ""}`
        : `supervisor ${String(state.pid)} is gone; run pnpm stand:light down, then up`,
    });
    checks.push({
      name: "source",
      ...sourceFreshness({
        web: state.web,
        startedAt: state.startedAt,
        headMovedAtMs: headMovedAtMs(context.worktree),
        changedFiles: [
          ...changedFiles(context.worktree),
          ...buildInputsWrittenSince(
            context.worktree,
            Date.parse(state.startedAt),
          ),
        ],
      }),
    });
    const table = processTable();
    for (const role of /** @type {const} */ (["web", "api"])) {
      const port = Number(new URL(state.urls[role]).port);
      const listener = listeningProcess(port);
      checks.push({
        name: `${role} port`,
        ok: listenerOwned(table, listener, state.pid),
        detail:
          listener === undefined
            ? `nothing listens on ${String(port)}`
            : `${String(port)} is held by process ${String(listener)}, ${listenerOwned(table, listener, state.pid) ? "a child of this instance" : "which is not this instance"}`,
      });
    }
    checks.push(await check("api health", () => apiHealth(state.urls.api)));
    checks.push(await check("web", () => webUsable(state.urls.web)));
    for (const role of /** @type {const} */ (["owner", "learner"]))
      checks.push(
        await check(`${role} sign-in`, () => signInValid(state.urls, role)),
      );
  }
  const result = doctorReport(checks);
  if (values.json)
    process.stdout.write(
      `${JSON.stringify({
        ok: result.ok,
        checks,
        worktree: context.worktree,
        commit: git(context.worktree, ["rev-parse", "HEAD"]),
        instance: state,
      })}\n`,
    );
  else process.stdout.write(`${result.text}\n`);
  if (!result.ok) process.exitCode = 1;
}

/**
 * @param {string} name
 * @param {() => Promise<string>} run returns the detail of a passed check, throws on failure
 */
async function check(name, run) {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : "check failed",
    };
  }
}

/** @param {string} api */
async function apiHealth(api) {
  const response = await fetch(`${api}/health`, {
    signal: AbortSignal.timeout(requestMilliseconds),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`/health answered HTTP ${String(response.status)}`);
  }
  const health = apiHealthSchema.parse(await response.json());
  if (health.status !== "ready")
    throw new Error(`status ${health.status}, database ${health.database}`);
  return `ready, database ${health.database}`;
}

/** Usable means the seeded catalogue reaches the page data, not that a process answers. */
/** @param {string} web */
async function webUsable(web) {
  const live = await fetch(`${web}/_health/live`, {
    signal: AbortSignal.timeout(requestMilliseconds),
  });
  await live.body?.cancel();
  if (!live.ok)
    throw new Error(`/_health/live answered HTTP ${String(live.status)}`);
  const home = await fetch(`${web}/api/home/materials`, {
    signal: AbortSignal.timeout(requestMilliseconds),
  });
  if (!home.ok)
    throw new Error(`/api/home/materials answered HTTP ${String(home.status)}`);
  const materials = homeSchema
    .parse(await home.json())
    .facets.formats.reduce((total, format) => total + format.count, 0);
  if (materials === 0) throw new Error("the home feed has no seeded materials");
  return `alive, the home feed serves ${String(materials)} seeded materials`;
}

/**
 * @param {{ web: string; api: string; signIn: string | null }} urls
 * @param {"owner" | "learner"} role
 */
async function signInValid(urls, role) {
  const signIn = await fetch(addressFor(urls, role, "/"), {
    redirect: "manual",
    signal: AbortSignal.timeout(requestMilliseconds),
  });
  await signIn.body?.cancel();
  const cookie = signIn.headers.getSetCookie()[0]?.split(";")[0];
  if (signIn.status !== 302 || cookie === undefined)
    throw new Error(
      `the sign-in server answered HTTP ${String(signIn.status)}`,
    );
  const response = await fetch(`${urls.web}/auth/status`, {
    headers: { cookie },
    signal: AbortSignal.timeout(requestMilliseconds),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`/auth/status answered HTTP ${String(response.status)}`);
  }
  const status = authStatusSchema.parse(await response.json());
  const expected = role === "owner";
  if (
    status.state !== "authenticated" ||
    status.canManageMaterials !== expected
  )
    throw new Error(
      `web sees ${status.state}, authoring ${status.canManageMaterials ? "allowed" : "denied"}`,
    );
  return `web sees an authenticated account, authoring ${expected ? "allowed" : "denied"}`;
}

/** @param {Context} context */
async function address(context) {
  const target = z
    .enum(["owner", "learner", "sign-out", "web", "api"])
    .parse(positionals[1]);
  const state = await instanceState(context);
  process.stdout.write(
    `${addressFor(state.urls, target, positionals[2] ?? "/")}\n`,
  );
}

/** @param {Context} context */
function browser(context) {
  const invocation = browserInvocation({
    worktree: context.worktree,
    role: roleSchema.parse(values.role ?? "owner"),
    args: passed.length > 0 ? passed : positionals.slice(1),
    environment: process.env,
  });
  const result = spawnSync(invocation.command, invocation.args, {
    env: invocation.environment,
    stdio: "inherit",
  });
  if (result.error)
    throw new Error(`agent-browser did not run: ${result.error.message}`, {
      cause: result.error,
    });
  process.exitCode = result.status ?? 1;
}

/** @param {Context} context */
async function sql(context) {
  const statement = readOnlyStatement(positionals[1] ?? "");
  const state = await instanceState(context);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      state.composeProject,
      "exec",
      "-T",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "inside",
      "-d",
      assertLightDatabase(state.database),
      "--csv",
      "-c",
      statement,
    ],
    { stdio: "inherit", timeout: commandMilliseconds },
  );
  if (result.error)
    throw new Error(
      `The database query did not finish: ${result.error.message}`,
      {
        cause: result.error,
      },
    );
  process.exitCode = result.status ?? 1;
}

/** @param {Context} context */
async function evidence(context) {
  const root = join(context.standDirectory, "verify");
  const pointer = join(root, `current-${context.id}.json`);
  const action = z.enum(["start", "path"]).parse(positionals[1]);
  if (action === "path") {
    process.stdout.write(`${(await currentRun(context)).directory}\n`);
    return;
  }
  const commit = git(context.worktree, ["rev-parse", "HEAD"]);
  const branch = git(context.worktree, ["branch", "--show-current"]);
  const directory = join(
    root,
    evidenceRunName({ now: new Date(), branch, commit }),
  );
  if (existsSync(directory))
    throw new Error(
      `${directory} already exists; start the next run a second later`,
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const base = optionalGit(context.worktree, [
    "merge-base",
    "origin/main",
    "HEAD",
  ]);
  const uncommitted = changedFiles(context.worktree).map((file) => file.path);
  /** @type {z.infer<typeof runSchema>} */
  const run = {
    directory,
    commit,
    branch,
    base,
    patchId:
      base === null || base === commit
        ? null
        : execFileSync("git", ["patch-id", "--stable"], {
            cwd: context.worktree,
            encoding: "utf8",
            input: gitBuffer(context.worktree, ["diff", base, "HEAD"]),
            timeout: commandMilliseconds,
          }).split(" ")[0] || null,
    uncommittedFiles: uncommitted,
    uncommittedDiffSha256:
      uncommitted.length === 0
        ? null
        : await uncommittedDigest(context.worktree, uncommitted),
    label: values.label ?? null,
    startedAt: new Date().toISOString(),
  };
  const text = `${JSON.stringify(run, null, 2)}\n`;
  await writeFile(join(directory, "run.json"), text, { mode: 0o600 });
  await writeFile(pointer, text, { mode: 0o600 });
  process.stdout.write(`${directory}\n`);
}

/** @param {Context} context */
async function currentRun(context) {
  const pointer = join(
    context.standDirectory,
    "verify",
    `current-${context.id}.json`,
  );
  if (!existsSync(pointer))
    throw new Error(
      "No evidence run for this worktree; create one with: node scripts/verify-platform.mjs evidence start",
    );
  return runSchema.parse(JSON.parse(await readFile(pointer, "utf8")));
}

/** @param {Context} context */
async function report(context) {
  const run = await currentRun(context);
  const names = (await readdir(run.directory, { recursive: true })).sort();
  /** @type {{ path: string; bytes: number; sha256: string }[]} */
  const files = [];
  for (const name of names) {
    const path = join(run.directory, name);
    if (!statSync(path).isFile() || name === "run.json") continue;
    files.push({
      path: relative(run.directory, path),
      bytes: statSync(path).size,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    });
  }
  process.stdout.write(
    [
      "Verdict: <PASS | PASS+NOTES | FAIL>",
      "",
      `- Commit: \`${run.commit}\` on \`${run.branch || "detached HEAD"}\``,
      `- Patch: ${run.base === null ? "base origin/main is unknown" : run.patchId === null ? `no commits beyond \`${run.base}\`` : `\`${run.base.slice(0, 12)}..${run.commit.slice(0, 12)}\`, patch-id \`${run.patchId}\``}`,
      `- Uncommitted: ${run.uncommittedFiles.length === 0 ? "none" : `${String(run.uncommittedFiles.length)} file(s), diff sha256 \`${run.uncommittedDiffSha256 ?? ""}\`: ${run.uncommittedFiles.join(", ")}`}`,
      `- Evidence: \`${run.directory}\``,
      "- Exercised: <feature file, sub-feature IDs, entry points>",
      "- Side effects checked: <query and the rows it returned>",
      "- Not exercised: <what was left out and why>",
      "- Notes: <defects, deviations, anything the owner should look at>",
      "",
      artifactTable(files),
      "",
    ].join("\n"),
  );
}

/**
 * One digest over the tracked diff and the content of every changed or untracked file.
 * @param {string} worktree @param {readonly string[]} paths
 */
async function uncommittedDigest(worktree, paths) {
  const hash = createHash("sha256").update(
    gitBuffer(worktree, ["diff", "HEAD"]),
  );
  for (const path of paths) {
    hash.update(`\0${path}\0`);
    const absolute = join(worktree, path);
    if (existsSync(absolute) && statSync(absolute).isFile())
      hash.update(await readFile(absolute));
  }
  return hash.digest("hex");
}

/**
 * Tracked build inputs written after the instance started. This also catches an edit that was
 * built in and then reverted: the file equals HEAD again, but web was built from the edit.
 * The instance itself rewrites `apps/web/AGENTS.md` and `next-env.d.ts` while it starts.
 * @param {string} worktree @param {number} startedAtMs
 * @returns {{ path: string; modifiedAtMs: number | null }[]}
 */
function buildInputsWrittenSince(worktree, startedAtMs) {
  /** @type {{ path: string; modifiedAtMs: number | null }[]} */
  const files = [];
  for (const path of gitBuffer(worktree, ["ls-files", "-z"])
    .toString("utf8")
    .split("\0")) {
    if (
      !webBuildInput(path) ||
      path === "apps/web/AGENTS.md" ||
      path === "apps/web/next-env.d.ts"
    )
      continue;
    const absolute = join(worktree, path);
    if (!existsSync(absolute)) continue;
    const modifiedAtMs = statSync(absolute).mtimeMs;
    if (modifiedAtMs > startedAtMs) files.push({ path, modifiedAtMs });
  }
  return files;
}

/** When HEAD last changed: a commit, checkout, merge or reset. */
/** @param {string} worktree */
function headMovedAtMs(worktree) {
  const entry = optionalGit(worktree, [
    "reflog",
    "show",
    "-1",
    "--date=unix",
    "--format=%gd",
    "HEAD",
  ]);
  const seconds =
    /\{(\d+)\}/u.exec(entry ?? "")?.[1] ??
    git(worktree, ["log", "-1", "--format=%ct"]);
  return Number(seconds) * 1_000;
}

/**
 * Files that differ from HEAD, with the time of their last edit.
 * @param {string} worktree
 * @returns {{ path: string; modifiedAtMs: number | null }[]}
 */
function changedFiles(worktree) {
  const entries = gitBuffer(worktree, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  /** @type {{ path: string; modifiedAtMs: number | null }[]} */
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const path = entry.slice(3);
    // A rename lists its source as the next entry.
    if (entry.startsWith("R") || entry.startsWith("C")) index += 1;
    const absolute = join(worktree, path);
    files.push({
      path,
      modifiedAtMs: existsSync(absolute) ? statSync(absolute).mtimeMs : null,
    });
  }
  return files;
}

/** @returns {{ pid: number; ppid: number }[]} */
function processTable() {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .map(([pid = 0, ppid = 0]) => ({ pid, ppid }));
}

/** @param {number} port */
function listeningProcess(port) {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-Fp"],
    { encoding: "utf8", timeout: commandMilliseconds },
  );
  const pid = /^p(\d+)$/mu.exec(result.stdout)?.[1];
  return pid === undefined ? undefined : Number(pid);
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

/** @param {string} root @param {string[]} args */
function gitBuffer(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    timeout: commandMilliseconds,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** @param {string} root @param {string[]} args */
function optionalGit(root, args) {
  try {
    return git(root, args) || null;
  } catch {
    return null;
  }
}
