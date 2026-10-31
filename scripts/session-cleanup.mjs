// @ts-check
// Session cleanup (#1903). Ownership comes from rules, not from a journal: a worktree is removable
// when its PR is merged or closed, its state is clean and its HEAD is preserved by that merged PR or
// by a current remote branch. A process belongs to the worktree that contains its cwd. Temporary
// files match only the explicit rules below. Anything uncertain is kept and reported. The default
// run only reports; `--apply` acts on the plan after rechecking each worktree.
//
// The SessionEnd hook runs this file before dependencies may be installed, so it imports only Node.
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A temporary entry younger than this may belong to a check that is still running. */
export const temporaryMinimumAgeHours = 24;
const temporaryMinimumAgeMilliseconds =
  temporaryMinimumAgeHours * 60 * 60 * 1000;
/** A stopped process gets this long to exit after SIGTERM before SIGKILL. */
const processStopGraceMilliseconds = 5000;
const processPollMilliseconds = 100;
/** The newest PR commits returned per PR; an older local HEAD needs remote-branch proof instead. */
const pullRequestCommitWindow = 100;

/**
 * Entries in the OS temporary directory that repository scripts and tests create and remove on
 * success; an interrupted run leaves them behind. `source` names the creating file.
 */
export const temporaryRules = [
  {
    prefix: "inside-buyer-journey-",
    source: "scripts/buyer-journey-smoke.mjs",
  },
  {
    prefix: "inside-enrollment-smoke-",
    source: "scripts/enrollment-browser-smoke.mjs",
  },
  {
    prefix: "inside-fullstack-fixtures-",
    source: "scripts/full-stack-smoke.mjs",
  },
  {
    prefix: "inside-quality-proof-",
    source: "scripts/quality-tool-proofs.mjs",
  },
  {
    prefix: "inside-vitest-deps-",
    source: "apps/web/test/support/run-scoped-vite-cache.mjs",
  },
  {
    prefix: "inside-production-host-",
    source: "scripts/contracts/production-deployment.test.mjs",
  },
  {
    prefix: "inside-diagnostic-owner-",
    source: "scripts/contracts/diagnostic-process-ownership.test.mjs",
  },
  { prefix: "platform-stand-cli-", source: "scripts/local-stand.test.mjs" },
  { prefix: "session-cleanup-", source: "scripts/session-cleanup.test.mjs" },
];

/** Executables of agent sessions; a worktree with one running is in use. */
const agentExecutables = new Set([
  "claude",
  "codex",
  "opencode",
  "gemini",
  "cursor-agent",
  "aider",
  "Orca",
]);
const shellExecutables = new Set([
  "zsh",
  "bash",
  "sh",
  "fish",
  "dash",
  "ksh",
  "tcsh",
]);

/**
 * @typedef {"OPEN" | "CLOSED" | "MERGED"} PullRequestState
 * @typedef {{ number: number; state: PullRequestState; url: string; commits: string[]; complete: boolean }} PullRequest
 * @typedef {{ pid: number; ppid: number; args: string; cwd: string; ports: number[] }} ProcessInfo
 * @typedef {{
 *   github: { pullRequests(branches: ReadonlySet<string>): Promise<Map<string, PullRequest[]>> };
 *   processes: { list(): Promise<ProcessInfo[]>; stop(pid: number): Promise<boolean> };
 *   orca: { worktrees(): Promise<Set<string>>; remove(path: string): Promise<void> };
 *   docker: { composeDirectories(): Promise<{ project: string; directory: string }[]> };
 * }} Adapters
 * @typedef {{
 *   path: string;
 *   branch: string | undefined;
 *   head: string;
 *   action: "remove" | "prune" | "keep";
 *   reason: string;
 *   orca: boolean;
 * }} WorktreePlan
 * @typedef {{ pid: number; args: string; cwd: string; ports: number[]; action: "stop" | "keep"; reason: string }} ProcessPlan
 * @typedef {{ path: string; prefix: string; source: string }} TemporaryPlan
 * @typedef {{
 *   primary: string;
 *   current: string | undefined;
 *   worktrees: WorktreePlan[];
 *   processes: ProcessPlan[];
 *   temporary: TemporaryPlan[];
 *   notices: string[];
 *   warnings: string[];
 * }} CleanupPlan
 */

/**
 * @param {{ argv: string[]; cwd: string; now: Date; temporaryDirectory: string; selfPid: number; write(text: string): void } & Adapters} options
 * @returns {Promise<number>} exit status
 */
export async function runSessionCleanup(options) {
  const { values } = parseArgs({
    args: options.argv,
    options: {
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "session-end": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    options.write(usage);
    return 0;
  }
  if (values.apply && values["session-end"])
    throw new Error(
      "--session-end only reports; it cannot be combined with --apply",
    );
  const plan = await planCleanup(options);
  if (values["session-end"]) {
    const summary = formatSessionEnd(plan);
    if (!summary) return 0;
    options.write(summary);
    // Claude Code shows SessionEnd output only for a non-zero status; nothing was changed.
    return 1;
  }
  if (!values.apply) {
    options.write(
      values.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : formatPlan(plan, false),
    );
    return 0;
  }
  const failures = await applyPlan(plan, options);
  options.write(
    values.json
      ? `${JSON.stringify({ ...plan, failures }, null, 2)}\n`
      : formatPlan(plan, true),
  );
  for (const failure of failures) options.write(`failed  ${failure}\n`);
  return failures.length ? 1 : 0;
}

const usage = `Usage: pnpm session:cleanup [--apply] [--json] [--session-end]

Lists worktrees, processes and temporary files that sessions left behind, with a reason for each.
--apply        Remove the listed worktrees and temporary files and stop the listed processes.
--json         Print the plan as JSON.
--session-end  Print only what remains, for the Claude Code SessionEnd hook; never changes anything.
`;

/** @param {{ cwd: string; now: Date; temporaryDirectory: string; selfPid: number } & Adapters} options @returns {Promise<CleanupPlan>} */
async function planCleanup(options) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const notices = [];
  const current = await gitText(options.cwd, [
    "rev-parse",
    "--show-toplevel",
  ]).then(canonical, () => undefined);
  const repository = current ?? options.cwd;
  const commonDirectory = canonical(
    await gitText(repository, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  const registered = parseWorktreeList(
    await gitText(repository, ["worktree", "list", "--porcelain"]),
  );
  const primaryEntry = registered[0];
  if (!primaryEntry) throw new Error("git reported no worktrees");
  const primary = primaryEntry.path;

  const [processList, orcaPaths, composeDirectories] = await Promise.all([
    options.processes.list().catch((/** @type {unknown} */ error) => {
      warnings.push(
        `process list unavailable, no process is stopped: ${message(error)}`,
      );
      return /** @type {ProcessInfo[]} */ ([]);
    }),
    options.orca.worktrees().catch((/** @type {unknown} */ error) => {
      warnings.push(`Orca worktree list unavailable: ${message(error)}`);
      return null;
    }),
    options.docker
      .composeDirectories()
      .catch((/** @type {unknown} */ error) => {
        warnings.push(
          `Docker unavailable, Compose projects were not checked: ${message(error)}`,
        );
        return /** @type {{ project: string; directory: string }[]} */ ([]);
      }),
  ]);
  const standPaths = readStandPaths(commonDirectory, warnings);
  const sessionTree = processTree(processList, options.selfPid);
  const processes = processList.filter((p) => !sessionTree.has(p.pid));
  const worktreePaths = registered.map((entry) => entry.path);

  /** @type {WorktreePlan[]} */
  const worktrees = [];
  /** @type {Map<string, WorktreePlan>} */
  const pending = new Map();
  for (const entry of registered.slice(1)) {
    if (entry.bare) continue;
    const orca = orcaPaths?.has(entry.path) ?? false;
    /** @param {WorktreePlan["action"]} action @param {string} reason */
    const decide = (action, reason) =>
      worktrees.push({
        path: entry.path,
        branch: entry.branch,
        head: entry.head,
        action,
        reason,
        orca,
      });
    const inside = processes.filter(
      (p) => deepestContaining(worktreePaths, p.cwd) === entry.path,
    );
    const agent = inside.find((p) => agentExecutables.has(executable(p.args)));
    const shell = inside.find((p) => isInteractiveShell(p.args));
    const compose = composeDirectories.find((c) =>
      isWithin(c.directory, entry.path),
    );
    if (entry.path === current)
      decide(
        "keep",
        "current session's worktree; a later cleanup run removes it after its PR merges",
      );
    else if (entry.locked) decide("keep", "locked worktree");
    else if (standPaths === undefined)
      decide("keep", "local stand state is unreadable");
    else if (standPaths.some((path) => isWithin(path, entry.path)))
      decide("keep", "local stand state references it");
    else if (compose)
      decide(
        "keep",
        `Compose project ${compose.project} uses it; follow docs/runbooks/local-stand.md`,
      );
    else if (agent)
      decide("keep", `agent session is running (PID ${agent.pid})`);
    else if (entry.prunable)
      decide("prune", "directory is missing; prune its registration");
    else if (!entry.branch) decide("keep", "detached HEAD has no PR");
    else if (orcaPaths === null) decide("keep", "Orca ownership is unknown");
    else if (shell && !orca)
      decide("keep", `terminal is open (PID ${shell.pid})`);
    else {
      const dirty = await worktreeChanges(entry.path);
      if (dirty) decide("keep", dirty);
      else {
        const plan = {
          path: entry.path,
          branch: entry.branch,
          head: entry.head,
          action: /** @type {const} */ ("keep"),
          reason: "",
          orca,
        };
        worktrees.push(plan);
        pending.set(entry.branch, plan);
      }
    }
  }
  if (pending.size)
    await decideByPullRequests(repository, pending, options.github, warnings);

  const removed = worktrees
    .filter((w) => w.action !== "keep")
    .map((w) => w.path);
  const kept = new Set(
    worktrees.filter((w) => w.action === "keep").map((w) => w.path),
  );
  const roots = worktreeRoots(primary, worktreePaths);
  /** @type {ProcessPlan[]} */
  const processPlans = [];
  for (const process of processes) {
    const owner = deepestContaining(worktreePaths, process.cwd);
    const base = {
      pid: process.pid,
      args: process.args,
      cwd: process.cwd,
      ports: process.ports,
    };
    const agent = agentExecutables.has(executable(process.args));
    if (owner && removed.includes(owner)) {
      processPlans.push({
        ...base,
        action: "stop",
        reason: "its worktree is removed",
      });
    } else if (
      !existsSync(process.cwd) &&
      roots.some((root) => isWithin(process.cwd, root))
    ) {
      processPlans.push(
        agent
          ? {
              ...base,
              action: "keep",
              reason: "agent session in a missing directory",
            }
          : {
              ...base,
              action: "stop",
              reason: "its working directory no longer exists",
            },
      );
    } else if (owner && owner === current && !agent && !isShell(process.args)) {
      processPlans.push({
        ...base,
        action: "keep",
        reason: "runs in the current worktree",
      });
    } else if (
      owner &&
      kept.has(owner) &&
      process.ports.length &&
      !agent &&
      !isShell(process.args)
    ) {
      processPlans.push({
        ...base,
        action: "keep",
        reason: "its worktree is kept",
      });
    }
  }

  const temporary = planTemporary(
    options.temporaryDirectory,
    options.now,
    processes,
  );
  const stashes = await gitText(repository, [
    "stash",
    "list",
    "--format=%gd%x09%gs",
  ]).catch(() => "");
  const removedBranches = new Set(
    worktrees.filter((w) => w.action === "remove").map((w) => w.branch),
  );
  for (const line of stashes.split("\n").filter(Boolean)) {
    const [reference, subject = ""] = line.split("\t");
    const branch = /^(?:WIP on|On) ([^:]+):/u.exec(subject)?.[1];
    if (branch && removedBranches.has(branch))
      notices.push(
        `${reference} on ${branch} is kept; stashes are never dropped`,
      );
  }
  for (const compose of composeDirectories) {
    if (
      !existsSync(compose.directory) &&
      roots.some((root) => isWithin(compose.directory, root))
    )
      notices.push(
        `Compose project ${compose.project} refers to missing ${compose.directory}; containers and volumes follow docs/runbooks/local-stand.md`,
      );
  }
  return {
    primary,
    current,
    worktrees,
    processes: processPlans,
    temporary,
    notices,
    warnings,
  };
}

/**
 * One GraphQL request decides every candidate branch; a missing answer keeps the worktree.
 * @param {string} repository
 * @param {Map<string, WorktreePlan>} pending
 * @param {Adapters["github"]} github
 * @param {string[]} warnings
 */
async function decideByPullRequests(repository, pending, github, warnings) {
  /** @type {Map<string, PullRequest[]>} */
  let pulls;
  try {
    pulls = await github.pullRequests(new Set(pending.keys()));
  } catch (error) {
    warnings.push(`GitHub PR data unavailable: ${message(error)}`);
    for (const plan of pending.values()) plan.reason = "PR data unavailable";
    return;
  }
  /** @type {Map<string, string> | null | undefined} */
  let remoteHeads;
  for (const [branch, plan] of pending) {
    const list = pulls.get(branch) ?? [];
    const open = list.find((pull) => pull.state === "OPEN");
    const finished = list.filter((pull) => pull.state !== "OPEN");
    if (!list.length) {
      plan.reason = "no PR for this branch";
      continue;
    }
    if (open) {
      plan.reason = `open PR #${open.number}`;
      continue;
    }
    const merged = finished.find(
      (pull) => pull.state === "MERGED" && pull.commits.includes(plan.head),
    );
    if (merged) {
      plan.action = "remove";
      plan.reason = `merged PR #${merged.number} contains HEAD`;
      continue;
    }
    remoteHeads ??= await readRemoteHeads(repository, warnings);
    const remote = remoteHeads
      ? await remoteBranchContaining(repository, plan.head, remoteHeads)
      : undefined;
    const pull = finished[0];
    if (remote && pull) {
      plan.action = "remove";
      plan.reason = `${pull.state === "MERGED" ? "merged" : "closed"} PR #${pull.number}; remote branch ${remote} contains HEAD`;
    } else {
      plan.reason = `${finished.map((p) => `${p.state.toLowerCase()} PR #${p.number}`).join(", ")}; HEAD is not preserved in a merged PR or remote branch`;
    }
  }
}

/** @param {string} repository @param {string[]} warnings @returns {Promise<Map<string, string> | null>} */
async function readRemoteHeads(repository, warnings) {
  try {
    const output = await gitText(repository, [
      "ls-remote",
      "--heads",
      "origin",
    ]);
    return new Map(
      output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [oid = "", ref = ""] = line.split("\t");
          return [ref.replace(/^refs\/heads\//u, ""), oid];
        }),
    );
  } catch (error) {
    warnings.push(`remote branches unavailable: ${message(error)}`);
    return null;
  }
}

/**
 * A remote-tracking ref proves preservation only while the remote still has a branch whose
 * current commit contains HEAD; a stale local ref proves nothing.
 * @param {string} repository @param {string} head @param {Map<string, string>} remoteHeads
 */
async function remoteBranchContaining(repository, head, remoteHeads) {
  const refs = await gitText(repository, [
    "for-each-ref",
    "--contains",
    head,
    "--format=%(refname)",
    "refs/remotes/origin",
  ]).catch(() => "");
  for (const ref of refs.split("\n").filter(Boolean)) {
    const name = ref.replace(/^refs\/remotes\/origin\//u, "");
    const oid = remoteHeads.get(name);
    if (
      oid &&
      (await gitSucceeds(repository, [
        "merge-base",
        "--is-ancestor",
        head,
        oid,
      ]))
    )
      return name;
  }
  return undefined;
}

/** @param {string} path @returns {Promise<string | undefined>} a reason when the worktree is not clean */
async function worktreeChanges(path) {
  const status = await gitText(path, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]).catch((error) => `status failed: ${message(error)}`);
  if (status.startsWith("status failed")) return status;
  if (status) return "uncommitted or untracked changes";
  for (const [marker, operation] of [
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
    ["BISECT_LOG", "bisect"],
  ]) {
    const markerPath = await gitText(path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      marker ?? "",
    ]);
    if (existsSync(markerPath)) return `${operation} in progress`;
  }
  return undefined;
}

/** @param {string} temporaryDirectory @param {Date} now @param {ProcessInfo[]} processes @returns {TemporaryPlan[]} */
function planTemporary(temporaryDirectory, now, processes) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(temporaryDirectory);
  } catch {
    return [];
  }
  /** @type {TemporaryPlan[]} */
  const plans = [];
  for (const name of names.sort()) {
    const rule = temporaryRules.find((candidate) =>
      name.startsWith(candidate.prefix),
    );
    if (!rule) continue;
    const path = join(temporaryDirectory, name);
    let modified;
    try {
      modified = lstatSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (now.getTime() - modified < temporaryMinimumAgeMilliseconds) continue;
    if (processes.some((p) => isWithin(p.cwd, path))) continue;
    plans.push({ path, prefix: rule.prefix, source: rule.source });
  }
  return plans;
}

/**
 * @param {CleanupPlan} plan
 * @param {{ temporaryDirectory: string } & Adapters} options
 * @returns {Promise<string[]>} failures
 */
async function applyPlan(plan, options) {
  /** @type {string[]} */
  const failures = [];
  for (const process of plan.processes.filter((p) => p.action === "stop")) {
    const stopped = await options.processes
      .stop(process.pid)
      .catch(() => false);
    if (!stopped) failures.push(`process ${process.pid} did not stop`);
  }
  let pruned = false;
  for (const worktree of plan.worktrees) {
    if (worktree.action === "prune") {
      if (!pruned) {
        await gitText(plan.primary, ["worktree", "prune"]).catch((error) =>
          failures.push(`git worktree prune: ${message(error)}`),
        );
        pruned = true;
      }
      continue;
    }
    if (worktree.action !== "remove" || !worktree.branch) continue;
    // Recheck right before deletion: the plan may be stale after other sessions acted.
    const head = await gitText(worktree.path, ["rev-parse", "HEAD"]).catch(
      () => "",
    );
    const changes = await worktreeChanges(worktree.path);
    if (head !== worktree.head || changes) {
      failures.push(
        `${worktree.path}: changed since planning (${changes ?? "HEAD moved"}); kept`,
      );
      continue;
    }
    try {
      if (worktree.orca) await options.orca.remove(worktree.path);
      else await gitText(plan.primary, ["worktree", "remove", worktree.path]);
    } catch (error) {
      failures.push(`${worktree.path}: ${message(error)}`);
      continue;
    }
    const branchHead = await gitText(plan.primary, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${worktree.branch}`,
    ]).catch(() => "");
    if (branchHead === worktree.head)
      await gitText(plan.primary, ["branch", "-D", worktree.branch]).catch(
        (error) =>
          failures.push(`branch ${worktree.branch}: ${message(error)}`),
      );
    else if (branchHead)
      failures.push(
        `branch ${worktree.branch} moved to ${branchHead.slice(0, 12)}; kept`,
      );
  }
  for (const entry of plan.temporary) {
    if (dirname(entry.path) !== options.temporaryDirectory) continue;
    try {
      rmSync(entry.path, { recursive: true, force: true });
    } catch (error) {
      failures.push(`${entry.path}: ${message(error)}`);
    }
  }
  return failures;
}

/** @param {CleanupPlan} plan @param {boolean} applied */
function formatPlan(plan, applied) {
  const verb = (/** @type {string} */ action) =>
    (applied
      ? { remove: "removed", prune: "pruned", stop: "stopped", keep: "kept" }[
          action
        ]
      : action) ?? action;
  const lines = [
    applied
      ? "Session cleanup applied"
      : "Session cleanup plan (nothing changed; pass --apply to act on it)",
    `Primary checkout ${plan.primary} is never changed.`,
    "",
    "Worktrees",
  ];
  const order = { remove: 0, prune: 1, keep: 2 };
  for (const w of [...plan.worktrees].sort(
    (a, b) => order[a.action] - order[b.action] || a.path.localeCompare(b.path),
  ))
    lines.push(
      `  ${verb(w.action).padEnd(7)} ${w.path}${w.branch ? ` [${w.branch}]` : ""}${w.orca ? " (Orca)" : ""}: ${w.reason}`,
    );
  if (!plan.worktrees.length) lines.push("  none besides the primary checkout");
  lines.push("", "Processes");
  for (const p of plan.processes)
    lines.push(
      `  ${verb(p.action).padEnd(7)} ${describeProcess(p)}: ${p.reason}`,
    );
  if (!plan.processes.length) lines.push("  none to report");
  lines.push("", "Temporary files");
  const byRule = Map.groupBy(plan.temporary, (entry) => entry.prefix);
  for (const [prefix, entries] of byRule) {
    lines.push(
      `  ${verb("remove").padEnd(7)} ${entries.length} × ${prefix}* older than ${temporaryMinimumAgeHours} h (${entries[0]?.source})`,
    );
  }
  if (!plan.temporary.length) lines.push("  none match the explicit rules");
  if (plan.notices.length)
    lines.push("", "Kept for the owner", ...plan.notices.map((n) => `  ${n}`));
  if (plan.warnings.length)
    lines.push("", "Warnings", ...plan.warnings.map((w) => `  ${w}`));
  return `${lines.join("\n")}\n`;
}

/** @param {CleanupPlan} plan @returns {string} empty when nothing remains for this session */
function formatSessionEnd(plan) {
  const removable = plan.worktrees.filter((w) => w.action !== "keep");
  const stoppable = plan.processes.filter((p) => p.action === "stop");
  const running = plan.processes.filter(
    (p) => p.action === "keep" && p.reason === "runs in the current worktree",
  );
  const lines = [];
  if (removable.length) {
    lines.push(`${removable.length} worktree(s) can be removed:`);
    for (const w of removable) lines.push(`  ${w.path}: ${w.reason}`);
  }
  if (stoppable.length) {
    lines.push(`${stoppable.length} process(es) can be stopped:`);
    for (const p of stoppable)
      lines.push(`  ${describeProcess(p)}: ${p.reason}`);
  }
  if (running.length) {
    lines.push(`${running.length} process(es) still run in this worktree:`);
    for (const p of running) lines.push(`  ${describeProcess(p)}`);
  }
  if (plan.temporary.length)
    lines.push(
      `${plan.temporary.length} temporary entr${plan.temporary.length === 1 ? "y" : "ies"} can be removed.`,
    );
  if (!lines.length) return "";
  return [
    "Session cleanup report (nothing was changed):",
    ...lines,
    ...plan.warnings.map((w) => `warning: ${w}`),
    "Review with `pnpm session:cleanup`; remove with `pnpm session:cleanup --apply`.",
    "",
  ].join("\n");
}

/** @param {{ pid: number; args: string; cwd: string; ports: number[] }} p */
function describeProcess(p) {
  const command = p.args.length > 80 ? `${p.args.slice(0, 77)}...` : p.args;
  return `PID ${p.pid} ${command} (cwd ${p.cwd}${p.ports.length ? `, ports ${p.ports.join(", ")}` : ""})`;
}

/**
 * @param {string} output
 * @returns {{ path: string; head: string; branch: string | undefined; bare: boolean; locked: boolean; prunable: boolean }[]}
 */
function parseWorktreeList(output) {
  return output
    .split(/\n\n+/u)
    .filter((block) => block.trim())
    .map((block) => {
      /** @type {Map<string, string>} */
      const fields = new Map();
      for (const line of block.split("\n")) {
        const space = line.indexOf(" ");
        fields.set(
          space < 0 ? line : line.slice(0, space),
          space < 0 ? "" : line.slice(space + 1),
        );
      }
      const path = fields.get("worktree") ?? "";
      return {
        path: existsSync(path) ? canonical(path) : path,
        head: fields.get("HEAD") ?? "",
        branch: fields.get("branch")?.replace(/^refs\/heads\//u, ""),
        bare: fields.has("bare"),
        locked: fields.has("locked"),
        prunable: fields.has("prunable"),
      };
    });
}

/**
 * Every string in the stand controller state that names a path keeps the worktree containing it.
 * @param {string} commonDirectory @param {string[]} warnings
 * @returns {string[] | undefined} undefined when existing state cannot be read
 */
function readStandPaths(commonDirectory, warnings) {
  const file = join(commonDirectory, "inside-platform-stand", "state.json");
  if (!existsSync(file)) return [];
  try {
    /** @type {unknown} */
    const state = JSON.parse(readFileSync(file, "utf8"));
    /** @type {string[]} */
    const paths = [];
    /** @param {unknown} value */
    const walk = (value) => {
      if (typeof value === "string" && isAbsolute(value))
        paths.push(existsSync(value) ? canonical(value) : value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null)
        Object.values(value).forEach(walk);
    };
    walk(state);
    return paths;
  } catch (error) {
    warnings.push(
      `local stand state ${file} is unreadable; every worktree is kept: ${message(error)}`,
    );
    return undefined;
  }
}

/**
 * Directories that hold worktrees: the primary checkout and the parent of every other worktree,
 * except the primary's own parent, which also holds unrelated projects.
 * @param {string} primary @param {string[]} worktreePaths
 */
function worktreeRoots(primary, worktreePaths) {
  const shared = dirname(primary);
  const roots = new Set([primary, `${primary}.worktrees`]);
  for (const path of worktreePaths.slice(1))
    if (dirname(path) !== shared) roots.add(dirname(path));
  return [...roots];
}

/**
 * The command running this cleanup: its ancestors, and every descendant of its direct parent, such as
 * the other commands of a shell pipeline. Background servers started earlier by the same session
 * hang off a further ancestor and stay visible.
 * @param {ProcessInfo[]} processes @param {number} selfPid
 */
function processTree(processes, selfPid) {
  const parents = new Map(processes.map((p) => [p.pid, p.ppid]));
  const tree = new Set([selfPid]);
  for (
    let pid = parents.get(selfPid);
    pid !== undefined && pid > 1 && !tree.has(pid);
    pid = parents.get(pid)
  )
    tree.add(pid);
  const launcher = parents.get(selfPid);
  const descendants = new Set(
    launcher !== undefined && launcher > 1 ? [selfPid, launcher] : [selfPid],
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const p of processes)
      if (!descendants.has(p.pid) && descendants.has(p.ppid)) {
        descendants.add(p.pid);
        grew = true;
      }
  }
  return new Set([...tree, ...descendants]);
}

/** @param {string[]} roots @param {string} path */
function deepestContaining(roots, path) {
  let best;
  for (const root of roots)
    if (isWithin(path, root) && (!best || root.length > best.length))
      best = root;
  return best;
}

/** True when `path` is `root` or inside it; `/a/wt2` is not inside `/a/wt`. @param {string} path @param {string} root */
export function isWithin(path, root) {
  const offset = relative(root, path);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

/** @param {string} args */
function executable(args) {
  const first = args.trim().split(/\s+/u)[0] ?? "";
  return basename(first.replace(/^-/u, ""));
}

/** @param {string} args */
function isShell(args) {
  return shellExecutables.has(executable(args));
}

/** A login or argument-less shell is an open terminal; `sh -c` runs a command. @param {string} args */
function isInteractiveShell(args) {
  if (!isShell(args)) return false;
  const words = args.trim().split(/\s+/u);
  return (
    words[0]?.startsWith("-") ||
    words.length === 1 ||
    words.slice(1).every((w) => /^-[il]+$/u.test(w))
  );
}

/** @param {string} path */
function canonical(path) {
  return realpathSync(path);
}

/** @param {unknown} error */
function message(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().split("\n")[0] ?? text;
}

/** @param {string} cwd @param {string[]} args */
async function gitText(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/** @param {string} cwd @param {string[]} args */
async function gitSucceeds(cwd, args) {
  return gitText(cwd, args).then(
    () => true,
    () => false,
  );
}

// Host adapters.

/** @param {string} command @param {string[]} args @param {string} [cwd] */
async function commandText(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** @param {string} repository @returns {Adapters["github"]} */
export function githubAdapter(repository) {
  return {
    async pullRequests(branches) {
      const url = await gitText(repository, ["remote", "get-url", "origin"]);
      const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(url);
      if (!match?.[1] || !match[2])
        throw new Error(`origin ${url} is not a GitHub repository`);
      const names = [...branches];
      const fields = `nodes { number state url isCrossRepository commits(last: ${pullRequestCommitWindow}) { totalCount nodes { commit { oid } } } }`;
      const query = `query($owner: String!, $name: String!${names.map((_, i) => `, $b${i}: String!`).join("")}) { repository(owner: $owner, name: $name) { ${names
        .map(
          (_, i) =>
            `b${i}: pullRequests(headRefName: $b${i}, first: 20, states: [OPEN, CLOSED, MERGED]) { ${fields} }`,
        )
        .join(" ")} } }`;
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${match[1]}`,
        "-F",
        `name=${match[2]}`,
      ];
      names.forEach((name, i) => args.push("-f", `b${i}=${name}`));
      /** @type {unknown} */
      const response = JSON.parse(await commandText("gh", args, repository));
      const data = field(field(response, "data"), "repository");
      return new Map(
        names.map((name, i) => [
          name,
          parsePullRequests(field(field(data, `b${i}`), "nodes")),
        ]),
      );
    },
  };
}

/** Reads one property of a parsed CLI response. @param {unknown} value @param {string} key @returns {unknown} */
function field(value, key) {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, key))
    throw new Error(`CLI response lacks ${key}`);
  /** @type {unknown} */
  const result = Object.getOwnPropertyDescriptor(value, key)?.value;
  return result;
}

/** @param {unknown} nodes @returns {PullRequest[]} */
function parsePullRequests(nodes) {
  if (!Array.isArray(nodes)) throw new Error("GitHub response lacks PR nodes");
  return nodes.flatMap((/** @type {unknown} */ node) => {
    const state = field(node, "state");
    const number = field(node, "number");
    const url = field(node, "url");
    if (field(node, "isCrossRepository") === true) return [];
    if (
      (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") ||
      typeof number !== "number" ||
      typeof url !== "string"
    )
      throw new Error("GitHub returned an unexpected PR");
    const commits = field(node, "commits");
    const total = field(commits, "totalCount");
    const list = field(commits, "nodes");
    if (typeof total !== "number" || !Array.isArray(list))
      throw new Error("GitHub returned unexpected PR commits");
    const oids = list.map((/** @type {unknown} */ entry) => {
      const oid = field(field(entry, "commit"), "oid");
      if (typeof oid !== "string")
        throw new Error("GitHub returned an unexpected commit");
      return oid;
    });
    return [
      { number, state, url, commits: oids, complete: total <= oids.length },
    ];
  });
}

/** @param {{ graceMilliseconds?: number }} [options] @returns {Adapters["processes"]} */
export function processAdapter({
  graceMilliseconds = processStopGraceMilliseconds,
} = {}) {
  return {
    async list() {
      const user = String(process.getuid?.() ?? "");
      const [cwdOutput, psOutput, listenOutput] = await Promise.all([
        commandText("lsof", [
          "-w",
          "-a",
          "-d",
          "cwd",
          "-u",
          user,
          "-Fpn",
        ]).catch(lsofOutput),
        commandText("ps", ["-axww", "-o", "pid=,ppid=,args="]),
        commandText("lsof", [
          "-w",
          "-nP",
          "-a",
          "-iTCP",
          "-sTCP:LISTEN",
          "-u",
          user,
          "-Fpn",
        ]).catch(lsofOutput),
      ]);
      const cwds = lsofRecords(cwdOutput);
      /** @type {Map<number, number[]>} */
      const ports = new Map();
      for (const [pid, names] of lsofMultiRecords(listenOutput))
        ports.set(pid, [
          ...new Set(
            names
              .map((n) => Number(/:(\d+)$/u.exec(n)?.[1]))
              .filter(Number.isInteger),
          ),
        ]);
      return psOutput
        .split("\n")
        .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line))
        .flatMap((m) => {
          if (!m) return [];
          const pid = Number(m[1]);
          const cwd = cwds.get(pid);
          return cwd
            ? [
                {
                  pid,
                  ppid: Number(m[2]),
                  args: m[3] ?? "",
                  cwd,
                  ports: ports.get(pid) ?? [],
                },
              ]
            : [];
        });
    },
    async stop(pid) {
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      /** @param {number} milliseconds */
      const waitForExit = async (milliseconds) => {
        const deadline = performance.now() + milliseconds;
        while (alive() && performance.now() < deadline)
          await new Promise((r) => setTimeout(r, processPollMilliseconds));
        return !alive();
      };
      if (!alive()) return true;
      process.kill(pid, "SIGTERM");
      if (await waitForExit(graceMilliseconds)) return true;
      process.kill(pid, "SIGKILL");
      return waitForExit(graceMilliseconds);
    },
  };
}

/** lsof exits 1 when some processes are unreadable but still prints the rest. @param {unknown} error */
function lsofOutput(error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    typeof error.stdout === "string"
  )
    return error.stdout;
  throw error;
}

/** @param {string} output */
function lsofMultiRecords(output) {
  /** @type {Map<number, string[]>} */
  const records = new Map();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid)
      records.set(pid, [...(records.get(pid) ?? []), line.slice(1)]);
  }
  return records;
}

/** @param {string} output */
function lsofRecords(output) {
  return new Map(
    [...lsofMultiRecords(output)].map(([pid, names]) => [pid, names[0] ?? ""]),
  );
}

/** @param {string} repository @returns {Adapters["orca"]} */
export function orcaAdapter(repository) {
  return {
    async worktrees() {
      const found = await commandText(
        "orca",
        ["worktree", "list", "--json"],
        repository,
      ).catch((/** @type {unknown} */ error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      });
      if (found === undefined) return new Set();
      const result = field(JSON.parse(found), "result");
      if (field(result, "truncated") !== false)
        throw new Error("Orca returned a truncated worktree list");
      const rows = field(result, "worktrees");
      if (!Array.isArray(rows))
        throw new Error("Orca returned no worktree list");
      return new Set(
        rows.flatMap((/** @type {unknown} */ row) => {
          const path = field(row, "path");
          return typeof path === "string" && existsSync(path)
            ? [canonical(path)]
            : [];
        }),
      );
    },
    async remove(path) {
      await commandText(
        "orca",
        ["worktree", "rm", "--worktree", `path:${path}`, "--json"],
        repository,
      );
    },
  };
}

/** @returns {Adapters["docker"]} */
export function dockerAdapter() {
  return {
    async composeDirectories() {
      const output = await commandText("docker", [
        "ps",
        "--all",
        "--filter",
        "label=com.docker.compose.project",
        "--format",
        '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}',
      ]);
      const seen = new Set();
      return output
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          const [project = "", directory = ""] = line.split("\t");
          if (!directory || seen.has(line)) return [];
          seen.add(line);
          return [
            {
              project,
              directory: existsSync(directory)
                ? canonical(directory)
                : directory,
            },
          ];
        });
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cwd = process.env["INIT_CWD"] ?? process.cwd();
  runSessionCleanup({
    argv: process.argv.slice(2),
    cwd,
    now: new Date(),
    temporaryDirectory: canonical(tmpdir()),
    selfPid: process.pid,
    github: githubAdapter(cwd),
    processes: processAdapter(),
    orca: orcaAdapter(cwd),
    docker: dockerAdapter(),
    // Claude Code prints a SessionEnd hook's stderr; the regular plan goes to stdout.
    write: (text) =>
      (process.argv.includes("--session-end")
        ? process.stderr
        : process.stdout
      ).write(text),
  }).then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      process.stderr.write(`session-cleanup: ${message(error)}\n`);
      process.exitCode = 1;
    },
  );
}
