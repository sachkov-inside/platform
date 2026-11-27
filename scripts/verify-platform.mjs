#!/usr/bin/env node
// @ts-check
// The helper of the `verify-platform` skill (.agents/skills/verify-platform/SKILL.md). It reads a
// light instance and drives this worktree's own browser sessions; it never starts, stops or
// changes an instance.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, statSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
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
  addScenario,
  addressFor,
  addressTargetSchema,
  browserInvocation,
  doctorReport,
  evidenceKindSchema,
  evidenceSourceSchema,
  isClip,
  listenerOwned,
  manifestProblems,
  manifestReport,
  manifestSchema,
  newManifest,
  readOnlyStatement,
  signedInRoleSchema,
  sourceFreshness,
  verdictSchema,
  verifyRoleSchema,
  webBuildInput,
} from "./verify-platform-plan.mjs";

const usage = `Usage: node scripts/verify-platform.mjs <command> [--worktree PATH]

doctor [--json]                 Read-only: is this worktree's light instance worth driving?
                                Exit 0 only when every check passes.
address <target> [path]         Print an address. Targets: owner, holder, learner, newcomer (sign
                                in and open the path), sign-out, web, api.
browser [--role ROLE] -- ARGS   Run agent-browser in this worktree's own session for the role
                                (owner by default; holder, learner, newcomer, guest).
sql "<select ...>"              Run one reading statement in the instance's database; prints CSV.
account <role>                  Print the Account ID of a signed-in role of this instance.
evidence start [--reset]        Create .evidence/ in the worktree root with manifest.json for
                                this commit and print its path. --reset empties an earlier run.
evidence path                   Print the evidence directory.
evidence add --title T --kind video|screenshot|table|numbers|none
             [--file "NAME::what it shows"]... --shows S --covers C --result PASS|PASS+NOTES|FAIL
             [--source light-instance|stand-test-data] [--notes N]
                                Add one scenario to the manifest; files are names in .evidence/.
evidence verdict <PASS|PASS+NOTES|FAIL> [--notes N]
                                Set the verdict of the run.
evidence check                  Exit 0 only when the manifest is complete: it is of this commit,
                                has scenarios, files fit their kind, exist and are at most
                                10 MB, a clip lasts at most 30 s, and the verdict is set, has
                                its notes and agrees with the scenarios.
report                          Print the verdict and scenarios from the manifest.
`;

const commandMilliseconds = 20_000;
const requestMilliseconds = 10_000;
const authStatusSchema = z.object({
  accountId: z.string().nullable(),
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
/** @type {{ worktree?: string; role?: string; json?: boolean; help?: boolean; reset?: boolean; title?: string; kind?: string; file?: string[]; shows?: string; covers?: string; result?: string; source?: string; notes?: string }} */
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
      reset: { type: "boolean" },
      title: { type: "string" },
      kind: { type: "string" },
      file: { type: "string", multiple: true },
      shows: { type: "string" },
      covers: { type: "string" },
      result: { type: "string" },
      source: { type: "string" },
      notes: { type: "string" },
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
    else if (command === "account") await account(context);
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
    for (const role of signedInRoleSchema.options)
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
 * What web says about a browser that signed in as the role.
 * @param {{ web: string; api: string; signIn: string | null }} urls
 * @param {z.infer<typeof signedInRoleSchema>} role
 */
async function signedInStatus(urls, role) {
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
  return authStatusSchema.parse(await response.json());
}

/**
 * @param {{ web: string; api: string; signIn: string | null }} urls
 * @param {z.infer<typeof signedInRoleSchema>} role
 */
async function signInValid(urls, role) {
  const status = await signedInStatus(urls, role);
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
async function account(context) {
  const role = signedInRoleSchema.parse(positionals[1]);
  const status = await signedInStatus(
    (await instanceState(context)).urls,
    role,
  );
  if (status.accountId === null)
    throw new Error(`web sees ${role} as ${status.state}, without an Account`);
  process.stdout.write(`${status.accountId}\n`);
}

/** @param {Context} context */
async function address(context) {
  const target = addressTargetSchema.parse(positionals[1]);
  const state = await instanceState(context);
  process.stdout.write(
    `${addressFor(state.urls, target, positionals[2] ?? "/")}\n`,
  );
}

/** @param {Context} context */
function browser(context) {
  const role = verifyRoleSchema.parse(values.role ?? "owner");
  const invocation = browserInvocation({
    worktree: context.worktree,
    role,
    args: passed.length > 0 ? passed : positionals.slice(1),
    environment: process.env,
  });
  const receipt = process.env["INSIDE_LIGHT_VERIFICATION"];
  if (process.platform === "darwin" && !receipt)
    throw new Error("Drive a light instance on Mac through pnpm verify:light");
  if (receipt) {
    if (process.env["INSIDE_LIGHT_VERIFICATION_WORKTREE"] !== context.worktree)
      throw new Error(
        "The verification session belongs to a different worktree",
      );
    execFileSync("python3", [
      fileURLToPath(new URL("./heavy-check/lock.py", import.meta.url)),
      "--owns",
    ]);
    appendFileSync(join(receipt, "roles"), `${role}\n`);
  }
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

/**
 * `.evidence` in the worktree root. A symbolic link there would send files elsewhere.
 * @param {Context} context
 */
function evidenceDirectory(context) {
  const directory = join(context.worktree, ".evidence");
  if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(
      `${directory} is a symbolic link; evidence needs a directory`,
    );
  return directory;
}

/** @param {Context} context */
async function readManifest(context) {
  const path = join(evidenceDirectory(context), "manifest.json");
  if (!existsSync(path))
    throw new Error(
      "No evidence run in this worktree; create one with: node scripts/verify-platform.mjs evidence start",
    );
  return manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** @param {Context} context @param {import("./verify-platform-plan.mjs").Manifest} manifest */
async function writeManifest(context, manifest) {
  await writeFile(
    join(evidenceDirectory(context), "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/** @param {Context} context */
async function evidence(context) {
  const directory = evidenceDirectory(context);
  const action = z
    .enum(["start", "path", "add", "verdict", "check"])
    .parse(positionals[1]);
  if (action === "start") await startEvidence(context);
  else if (action === "path") {
    await readManifest(context);
    process.stdout.write(`${directory}\n`);
  } else if (action === "add") {
    const manifest = await readManifest(context);
    const next = addScenario(manifest, {
      title: values.title ?? "",
      kind: evidenceKindSchema.parse(values.kind),
      files: (values.file ?? []).map((item) => {
        const separator = item.indexOf("::");
        return separator === -1
          ? { path: item, shows: "" }
          : {
              path: item.slice(0, separator),
              shows: item.slice(separator + 2),
            };
      }),
      shows: values.shows ?? "",
      source: evidenceSourceSchema.parse(values.source ?? "light-instance"),
      covers: values.covers ?? "",
      result: verdictSchema.parse(values.result),
      notes: values.notes ?? null,
    });
    await writeManifest(context, next);
    process.stdout.write(`Added scenario ${next.scenarios.at(-1)?.id ?? ""}\n`);
  } else if (action === "verdict") {
    await writeManifest(context, {
      ...(await readManifest(context)),
      verdict: verdictSchema.parse(positionals[2]),
      notes: values.notes ?? null,
    });
  } else {
    const manifest = await readManifest(context);
    /** @type {Record<string, { bytes: number; seconds: number | null }>} */
    const facts = {};
    for (const { path } of manifest.scenarios.flatMap((item) => item.files)) {
      const absolute = join(directory, path);
      // A link, the file's own or a directory's on the way, would have the check read outside
      // .evidence.
      const entry = lstatSync(absolute, { throwIfNoEntry: false });
      if (
        entry?.isFile() &&
        (await realpath(absolute)) === join(await realpath(directory), path)
      )
        facts[path] = { bytes: entry.size, seconds: clipLength(absolute) };
    }
    const head = git(context.worktree, ["rev-parse", "HEAD"]);
    const uncommitted = changedFiles(context.worktree).map((file) => file.path);
    const digest =
      uncommitted.length === 0
        ? null
        : await uncommittedDigest(context.worktree, uncommitted);
    const problems = [
      ...(manifest.commit === head
        ? []
        : [
            `the manifest is of ${manifest.commit.slice(0, 12)}, HEAD is ${head.slice(0, 12)}; verify this commit after: evidence start --reset`,
          ]),
      ...(manifest.commit !== head || manifest.uncommittedDiffSha256 === digest
        ? []
        : [
            "the uncommitted changes differ from the ones the run started with; verify them after: evidence start --reset",
          ]),
      ...manifestProblems(manifest, facts),
    ];
    process.stdout.write(
      problems.length === 0
        ? `The manifest is complete: ${String(manifest.scenarios.length)} scenario(s), verdict ${manifest.verdict ?? ""}\n`
        : `${problems.join("\n")}\n`,
    );
    if (problems.length > 0) process.exitCode = 1;
  }
}

/** @param {Context} context */
async function startEvidence(context) {
  const directory = evidenceDirectory(context);
  const commit = git(context.worktree, ["rev-parse", "HEAD"]);
  const base = optionalGit(context.worktree, [
    "merge-base",
    "origin/main",
    "HEAD",
  ]);
  const uncommitted = changedFiles(context.worktree).map((file) => file.path);
  const run = {
    commit,
    branch: git(context.worktree, ["branch", "--show-current"]),
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
    startedAt: new Date().toISOString(),
  };
  // --reset empties the directory whatever it holds, a broken manifest included.
  if (values.reset) await rm(directory, { recursive: true, force: true });
  else if (existsSync(join(directory, "manifest.json"))) {
    const earlier = await readManifest(context);
    if (
      earlier.commit !== commit ||
      earlier.uncommittedDiffSha256 !== run.uncommittedDiffSha256
    )
      throw new Error(
        `.evidence holds a run of ${earlier.commit.slice(0, 12)}${earlier.commit === commit ? " with other uncommitted changes" : ""}; start over with: evidence start --reset`,
      );
    process.stdout.write(`${directory}\n`);
    return;
  }
  await mkdir(directory, { recursive: true });
  await writeManifest(context, newManifest(run));
  process.stdout.write(`${directory}\n`);
}

/** The length of a clip in seconds, or null when ffprobe cannot tell. */
/** @param {string} path */
function clipLength(path) {
  if (!isClip(path)) return null;
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8", timeout: commandMilliseconds },
  );
  const seconds = Number(result.stdout.trim());
  return result.status === 0 && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : null;
}

/** @param {Context} context */
async function report(context) {
  process.stdout.write(`${manifestReport(await readManifest(context))}\n`);
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
