// @ts-check
// Session cleanup (#1903). Ownership comes from rules, not from a journal. The rules are the
// decisions in `planWorktree`, `planProcess` and `temporaryRules`:
// - A worktree is removed when its PR is merged or closed, it has no changes or ignored local files
//   (`.env*`, `.reports/`), and its HEAD is in the merged PR's commits or in a current remote branch.
// - A process belongs to the deepest worktree that contains its cwd. It is stopped only when that
//   worktree is removed, or when its cwd no longer exists under a worktree directory.
// - Temporary entries match an explicit prefix and are older than the minimum age.
// Anything uncertain is kept and reported. The default run only reports; `--apply` acts on the plan
// after rechecking each worktree and each process.
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
import { homedir, tmpdir } from "node:os";
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
/** A stopped process gets this long to exit after SIGTERM, and again after SIGKILL. */
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

/** Executable names of agent sessions. */
const agentNames = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "cursor-agent",
  "aider",
];
/** Agent executables, plus Orca's agent launcher. */
const agentExecutables = new Set([...agentNames, "Orca"]);
/** Agents started through an interpreter show up only in their arguments. */
const agentArguments = new RegExp(
  `(?:^|/)(?:${agentNames.join("|")})(?:\\.[cm]?js)?(?:\\s|$)|@anthropic-ai/claude-code|@openai/codex|@google/gemini-cli`,
  "u",
);
const shellExecutables = new Set([
  "zsh",
  "bash",
  "sh",
  "fish",
  "dash",
  "ksh",
  "tcsh",
]);
const dockerUnknown = "Docker unavailable; Compose use is unknown";
const unpublished = "HEAD is not on any remote branch";
/** Ignored files that hold local work or configuration rather than build output. */
const ignoredLocalWork = /(?:^|\/)\.env[^/]*$|^\.reports(?:\/|$)/u;

/**
 * @typedef {"OPEN" | "CLOSED" | "MERGED"} PullRequestState
 * @typedef {{ number: number; state: PullRequestState; commits: string[]; complete: boolean }} PullRequest
 * @typedef {{ pid: number; ppid: number; command: string; args: string; cwd: string; ports: number[] }} ProcessInfo
 * @typedef {{
 *   github: { pullRequests(branches: ReadonlySet<string>): Promise<Map<string, PullRequest[]>> };
 *   processes: { list(): Promise<ProcessInfo[]>; stop(process: ProcessInfo): Promise<boolean> };
 *   orca: { worktrees(): Promise<Set<string>>; remove(path: string): Promise<void> };
 *   docker: { composeDirectories(): Promise<{ project: string; directory: string }[]> };
 *   tracker: { trackedProcesses(path: string): Promise<number> };
 * }} Adapters
 * @typedef {{
 *   path: string;
 *   branch: string | undefined;
 *   head: string;
 *   action: "remove" | "prune" | "keep";
 *   reason: string;
 *   orca: boolean;
 * }} WorktreePlan
 * @typedef {"removed" | "missing" | "current" | "kept"} ProcessScope
 * @typedef {ProcessInfo & { worktree: string | undefined; scope: ProcessScope; action: "stop" | "keep"; reason: string }} ProcessPlan
 * @typedef {{ path: string; prefix: string; source: string }} TemporaryPlan
 * @typedef {{
 *   primary: string;
 *   current: string | undefined;
 *   currentState: string[];
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
        ? `${JSON.stringify(plan, redactArguments, 2)}\n`
        : formatPlan(plan, false),
    );
    return 0;
  }
  const failures = await applyPlan(plan, options);
  options.write(
    values.json
      ? `${JSON.stringify({ ...plan, failures }, redactArguments, 2)}\n`
      : formatPlan(plan, true),
  );
  for (const failure of failures) options.write(`failed  ${failure}\n`);
  return failures.length ? 1 : 0;
}

const usage = `Usage: pnpm session:cleanup [--apply] [--json] [--session-end]

Lists the worktrees, processes and temporary files that sessions leave behind, with a reason for
each decision. The rules are documented at the top of scripts/session-cleanup.mjs.
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
  ]).then(canonicalIfPresent, () => undefined);
  const repository = current ?? options.cwd;
  const commonDirectory = canonicalIfPresent(
    await gitText(repository, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  const registered = parseWorktreeList(
    await gitText(repository, ["worktree", "list", "--porcelain"]),
  );
  const primary = registered[0]?.path;
  if (!primary) throw new Error("git reported no worktrees");

  const worktreePaths = registered.map((entry) => entry.path);
  /** @type {string | undefined} */
  let dockerError;
  const [processList, orcaListed, composeDirectories] = await Promise.all([
    options.processes.list().catch((/** @type {unknown} */ error) => {
      warnings.push(
        `process list unavailable; no process is stopped and every worktree is kept: ${message(error)}`,
      );
      return null;
    }),
    options.orca.worktrees().catch((/** @type {unknown} */ error) => {
      warnings.push(`Orca worktree list unavailable: ${message(error)}`);
      return null;
    }),
    options.docker
      .composeDirectories()
      .catch((/** @type {unknown} */ error) => {
        dockerError = message(error);
        return null;
      }),
  ]);
  // Orca lists the workspaces of every repository; only this repository's worktrees count.
  const orcaPaths =
    orcaListed &&
    new Set([...orcaListed].filter((path) => worktreePaths.includes(path)));
  const sessionTree = processTree(processList ?? [], options.selfPid);
  const processes = (processList ?? []).filter((p) => !sessionTree.has(p.pid));
  const context = {
    current,
    worktreePaths,
    processes,
    orcaPaths,
    composeDirectories,
    standPaths: readStandPaths(commonDirectory, warnings),
    processesKnown: processList !== null,
  };

  /** @type {WorktreePlan[]} */
  const worktrees = [];
  /** @type {Map<string, WorktreePlan>} */
  const pending = new Map();
  for (const entry of registered.slice(1)) {
    if (entry.bare) continue;
    const plan = {
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      orca: orcaPaths?.has(entry.path) ?? false,
      ...(await planWorktree(entry, context)),
    };
    worktrees.push(plan);
    if (plan.action === "keep" && !plan.reason && entry.branch)
      pending.set(entry.branch, plan);
  }
  if (worktrees.some((w) => w.reason === dockerUnknown))
    warnings.push(
      `Docker unavailable; Compose use is unknown, so candidate worktrees are kept: ${dockerError}`,
    );
  const currentEntry = registered.find((entry) => entry.path === current);
  const currentState =
    current && current !== primary
      ? await worktreeState(current, { requirePublished: true })
      : [];
  // A squash-merged branch is preserved by its PR even after its remote branch is deleted.
  const currentBranch = currentState.includes(unpublished)
    ? currentEntry?.branch
    : undefined;
  const requested = new Set(pending.keys());
  if (currentBranch) requested.add(currentBranch);
  /** @type {Map<string, PullRequest[]> | undefined} */
  let pulls;
  if (requested.size)
    pulls = await options.github
      .pullRequests(requested)
      .catch((/** @type {unknown} */ error) => {
        warnings.push(`GitHub PR data unavailable: ${message(error)}`);
        return undefined;
      });
  if (pending.size)
    await decideByPullRequests(repository, pending, pulls, warnings);
  const currentMerge =
    currentBranch &&
    pulls
      ?.get(currentBranch)
      ?.find(
        (pull) =>
          pull.state === "MERGED" &&
          pull.commits.includes(currentEntry?.head ?? ""),
      );
  if (currentMerge)
    currentState.splice(
      currentState.indexOf(unpublished),
      1,
      `merged PR #${currentMerge.number} contains HEAD; a later cleanup run removes this worktree`,
    );
  for (const plan of pending.values()) {
    if (plan.action !== "remove") continue;
    const tracked = await options.tracker
      .trackedProcesses(plan.path)
      .catch((/** @type {unknown} */ error) => {
        plan.action = "keep";
        plan.reason = `agent-worktree status failed: ${message(error)}`;
        return 0;
      });
    if (tracked) {
      plan.action = "keep";
      plan.reason = `agent-worktree tracks ${tracked} process(es); run pnpm worktree:cleanup in it`;
    }
  }
  const keptPrunable = registered.some(
    (entry) =>
      entry.prunable &&
      worktrees.some((w) => w.path === entry.path && w.action === "keep"),
  );
  for (const plan of worktrees)
    if (plan.action === "prune" && keptPrunable) {
      plan.action = "keep";
      plan.reason =
        "directory is missing, but git worktree prune would also drop a kept registration";
    }

  const removed = new Set(
    worktrees.filter((w) => w.action !== "keep").map((w) => w.path),
  );
  const kept = new Set(
    worktrees.filter((w) => w.action === "keep").map((w) => w.path),
  );
  const roots = worktreeRoots(primary, worktreePaths, orcaPaths);
  /** @type {ProcessPlan[]} */
  const processPlans = processes.flatMap((process) => {
    const worktree = deepestContaining(context.worktreePaths, process.cwd);
    const decision = planProcess(process, worktree, {
      current,
      removed,
      kept,
      roots,
    });
    return decision ? [{ ...process, worktree, ...decision }] : [];
  });

  const temporary = planTemporary(
    options.temporaryDirectory,
    options.now,
    processes,
  );
  const removedBranches = new Set(
    worktrees.filter((w) => w.action === "remove").map((w) => w.branch),
  );
  const stashes = await gitText(repository, [
    "stash",
    "list",
    "--format=%gd%x09%gs",
  ]).catch(() => "");
  for (const line of stashes.split("\n").filter(Boolean)) {
    const [reference, subject = ""] = line.split("\t");
    const branch = /^(?:WIP on|On) ([^:]+):/u.exec(subject)?.[1];
    if (branch && removedBranches.has(branch))
      notices.push(
        `${reference} on ${branch} is kept; stashes are never dropped`,
      );
  }
  for (const compose of composeDirectories ?? [])
    if (
      !existsSync(compose.directory) &&
      roots.some((root) => isWithin(compose.directory, root))
    )
      notices.push(
        `Compose project ${compose.project} refers to missing ${compose.directory}; its containers and volumes follow docs/runbooks/local-stand.md`,
      );
  return {
    primary,
    current,
    currentState,
    worktrees,
    processes: processPlans,
    temporary,
    notices,
    warnings,
  };
}

/**
 * Local rules for one worktree. An empty keep reason marks a candidate that PR data decides.
 * @param {ReturnType<typeof parseWorktreeList>[number]} entry
 * @param {{
 *   current: string | undefined;
 *   worktreePaths: string[];
 *   processes: ProcessInfo[];
 *   orcaPaths: Set<string> | null;
 *   composeDirectories: { project: string; directory: string }[] | null;
 *   standPaths: string[] | undefined;
 *   processesKnown: boolean;
 * }} context
 * @returns {Promise<Pick<WorktreePlan, "action" | "reason">>}
 */
async function planWorktree(entry, context) {
  /** @param {WorktreePlan["action"]} action @param {string} reason */
  const decide = (action, reason) => ({ action, reason });
  const inside = context.processes.filter(
    (p) => deepestContaining(context.worktreePaths, p.cwd) === entry.path,
  );
  const agent = inside.find(isAgent);
  const terminal = inside.find(isInteractiveShell);
  const compose = context.composeDirectories?.find((c) =>
    isWithin(c.directory, entry.path),
  );
  if (entry.path === context.current)
    return decide(
      "keep",
      "current session's worktree; a later cleanup run removes it after its PR merges",
    );
  if (entry.locked) return decide("keep", "locked worktree");
  if (context.standPaths === undefined)
    return decide("keep", "local stand state is unreadable");
  if (context.standPaths.some((path) => isWithin(path, entry.path)))
    return decide("keep", "local stand state references it");
  if (compose)
    return decide(
      "keep",
      `Compose project ${compose.project} uses it; follow docs/runbooks/local-stand.md`,
    );
  if (agent)
    return decide("keep", `agent session is running (PID ${agent.pid})`);
  if (terminal) return decide("keep", `terminal is open (PID ${terminal.pid})`);
  if (!context.processesKnown)
    return decide("keep", "process list unavailable");
  if (context.orcaPaths === null)
    return decide("keep", "Orca ownership is unknown");
  if (entry.prunable)
    return context.orcaPaths.has(entry.path)
      ? decide("keep", "Orca worktree directory is missing; remove it in Orca")
      : decide("prune", "directory is missing; prune its registration");
  if (!entry.branch) return decide("keep", "detached HEAD has no PR");
  if (context.composeDirectories === null) return decide("keep", dockerUnknown);
  const local = await worktreeState(entry.path);
  if (local.length) return decide("keep", local.join("; "));
  return decide("keep", "");
}

/**
 * @param {ProcessInfo} process
 * @param {string | undefined} worktree
 * @param {{ current: string | undefined; removed: Set<string>; kept: Set<string>; roots: string[] }} context
 * @returns {Pick<ProcessPlan, "scope" | "action" | "reason"> | undefined} undefined when not reported
 */
function planProcess(process, worktree, context) {
  const agent = isAgent(process);
  const session = agent || isShell(process);
  if (worktree && context.removed.has(worktree))
    return agent
      ? { scope: "removed", action: "keep", reason: "agent session" }
      : { scope: "removed", action: "stop", reason: "its worktree is removed" };
  if (
    !existsSync(process.cwd) &&
    context.roots.some((root) => isWithin(process.cwd, root))
  )
    return agent
      ? {
          scope: "missing",
          action: "keep",
          reason: "agent session in a missing directory",
        }
      : {
          scope: "missing",
          action: "stop",
          reason: "its working directory no longer exists",
        };
  if (worktree && worktree === context.current && !session)
    return {
      scope: "current",
      action: "keep",
      reason: "runs in the current worktree",
    };
  if (
    worktree &&
    context.kept.has(worktree) &&
    process.ports.length &&
    !session
  )
    return { scope: "kept", action: "keep", reason: "its worktree is kept" };
  return undefined;
}

/**
 * Decides every candidate branch from the run's single GraphQL answer; no answer keeps them all.
 * @param {string} repository
 * @param {Map<string, WorktreePlan>} pending
 * @param {Map<string, PullRequest[]> | undefined} pulls
 * @param {string[]} warnings
 */
async function decideByPullRequests(repository, pending, pulls, warnings) {
  if (!pulls) {
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
      continue;
    }
    const truncated = finished.some((p) => p.state === "MERGED" && !p.complete);
    plan.reason = `${finished.map((p) => `${p.state.toLowerCase()} PR #${p.number}`).join(", ")}; HEAD is not preserved in ${truncated ? `the newest ${pullRequestCommitWindow} PR commits` : "a merged PR"} or a remote branch`;
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

/**
 * Reasons why removing the worktree could lose local work; empty when it holds none. A merged
 * squash PR preserves HEAD even after its remote branch is deleted, so only the current worktree's
 * report asks whether HEAD is on a remote branch.
 * @param {string} path
 * @param {{ requirePublished?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
async function worktreeState(path, { requirePublished = false } = {}) {
  try {
    if (await gitText(path, ["status", "--porcelain", "--untracked-files=all"]))
      return ["uncommitted or untracked changes"];
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
      if (existsSync(markerPath)) return [`${operation} in progress`];
    }
    // The pathspec also finds matches inside wholly ignored directories.
    const ignored = await gitText(path, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ":(glob)**/.env*",
      ":(glob).reports/**",
    ]);
    const local = ignored
      .split("\n")
      .map((line) => line.replace(/\/$/u, ""))
      .filter((line) => ignoredLocalWork.test(line));
    if (local.length)
      return [
        `ignored local files: ${[...new Set(local.map((line) => line.replace(/^(\.reports)\/.*$/u, "$1")))].slice(0, 3).join(", ")}`,
      ];
    if (!requirePublished) return [];
    const published = await gitText(path, [
      "for-each-ref",
      "--contains",
      "HEAD",
      "--count=1",
      "--format=%(refname)",
      "refs/remotes",
    ]);
    return published ? [] : [unpublished];
  } catch (error) {
    return [`git state unreadable: ${message(error)}`];
  }
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
 * Each worktree is rechecked before its processes stop, so a worktree that changed after planning
 * keeps both. A process stops only while its command and cwd still match the plan.
 * @param {CleanupPlan} plan
 * @param {{ temporaryDirectory: string } & Adapters} options
 * @returns {Promise<string[]>} failures
 */
async function applyPlan(plan, options) {
  /** @type {string[]} */
  const failures = [];
  /** @param {ProcessPlan} process */
  const stop = async (process) => {
    const stopped = await options.processes.stop(process).catch(() => false);
    if (!stopped)
      failures.push(`process ${process.pid} did not stop or changed; kept`);
    return stopped;
  };
  for (const process of plan.processes)
    if (process.action === "stop" && process.scope === "missing")
      await stop(process);
  for (const worktree of plan.worktrees) {
    if (worktree.action !== "remove" || !worktree.branch) continue;
    // Recheck right before acting: other sessions may have changed the worktree since planning.
    const head = await gitText(worktree.path, ["rev-parse", "HEAD"]).catch(
      () => "",
    );
    const local = await worktreeState(worktree.path);
    if (head !== worktree.head || local.length) {
      failures.push(
        `${worktree.path}: changed since planning (${local.join("; ") || "HEAD moved"}); kept`,
      );
      continue;
    }
    let stoppedAll = true;
    for (const process of plan.processes)
      if (process.action === "stop" && process.worktree === worktree.path)
        stoppedAll = (await stop(process)) && stoppedAll;
    if (!stoppedAll) {
      failures.push(`${worktree.path}: a process is still running; kept`);
      continue;
    }
    try {
      if (worktree.orca) await options.orca.remove(worktree.path);
      else await gitText(plan.primary, ["worktree", "remove", worktree.path]);
    } catch (error) {
      failures.push(`${worktree.path}: ${message(error)}`);
      continue;
    }
    // update-ref deletes the branch only while it still points at the proven HEAD.
    const reference = `refs/heads/${worktree.branch}`;
    if (
      await gitSucceeds(plan.primary, [
        "rev-parse",
        "--verify",
        "--quiet",
        reference,
      ])
    ) {
      if (
        await gitSucceeds(plan.primary, [
          "update-ref",
          "-d",
          reference,
          worktree.head,
        ])
      )
        await gitSucceeds(plan.primary, [
          "config",
          "--remove-section",
          `branch.${worktree.branch}`,
        ]);
      else failures.push(`branch ${worktree.branch} moved; kept`);
    }
  }
  if (plan.worktrees.some((w) => w.action === "prune"))
    await gitText(plan.primary, ["worktree", "prune"]).catch((error) =>
      failures.push(`git worktree prune: ${message(error)}`),
    );
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
  if (plan.currentState.length)
    lines.push("", `Current worktree: ${plan.currentState.join("; ")}`);
  lines.push("", "Processes");
  for (const p of plan.processes)
    lines.push(
      `  ${verb(p.action).padEnd(7)} ${describeProcess(p)}: ${p.reason}`,
    );
  if (!plan.processes.length) lines.push("  none to report");
  lines.push("", "Temporary files");
  for (const [prefix, entries] of Map.groupBy(
    plan.temporary,
    (entry) => entry.prefix,
  ))
    lines.push(
      `  ${verb("remove").padEnd(7)} ${entries.length} × ${prefix}* older than ${temporaryMinimumAgeHours} h (${entries[0]?.source})`,
    );
  if (!plan.temporary.length) lines.push("  none match the explicit rules");
  if (plan.notices.length)
    lines.push("", "Kept for the owner", ...plan.notices.map((n) => `  ${n}`));
  if (plan.warnings.length)
    lines.push("", "Warnings", ...plan.warnings.map((w) => `  ${w}`));
  return `${lines.join("\n")}\n`;
}

/** @param {CleanupPlan} plan @returns {string} empty when nothing remains to report */
function formatSessionEnd(plan) {
  const removable = plan.worktrees.filter((w) => w.action !== "keep");
  const stoppable = plan.processes.filter((p) => p.action === "stop");
  const running = plan.processes.filter((p) => p.scope === "current");
  const lines = [];
  if (plan.currentState.length)
    lines.push(`This worktree: ${plan.currentState.join("; ")}.`);
  if (running.length) {
    lines.push(`${running.length} process(es) still run in this worktree:`);
    for (const p of running) lines.push(`  ${describeProcess(p)}`);
  }
  if (removable.length) {
    lines.push(`${removable.length} worktree(s) can be removed:`);
    for (const w of removable) lines.push(`  ${w.path}: ${w.reason}`);
  }
  if (stoppable.length) {
    lines.push(`${stoppable.length} process(es) can be stopped:`);
    for (const p of stoppable)
      lines.push(`  ${describeProcess(p)}: ${p.reason}`);
  }
  if (plan.temporary.length)
    lines.push(
      `${plan.temporary.length} temporary entr${plan.temporary.length === 1 ? "y" : "ies"} can be removed.`,
    );
  lines.push(...plan.warnings.map((w) => `Warning: ${w}`));
  if (!lines.length) return "";
  return [
    "Session cleanup report (nothing was changed):",
    ...lines,
    "Review with `pnpm session:cleanup`; act on it with `pnpm session:cleanup --apply`.",
    "",
  ].join("\n");
}

/** @param {ProcessPlan} p */
function describeProcess(p) {
  const command = redact(p.args);
  const shown = command.length > 80 ? `${command.slice(0, 77)}...` : command;
  return `PID ${p.pid} ${shown} (cwd ${p.cwd}${p.ports.length ? `, ports ${p.ports.join(", ")}` : ""})`;
}

/** JSON replacer that masks printed command lines; the plan keeps exact ones for identity checks. @param {string} key @param {unknown} value */
function redactArguments(key, value) {
  return key === "args" && typeof value === "string" ? redact(value) : value;
}

/** Masks argument values that look like credentials before a command line is printed. @param {string} args */
export function redact(args) {
  return args
    .replace(/(\bBearer\s+)\S+/giu, "$1***")
    .replace(
      /(\b[\w.-]*(?:token|secret|password|passwd|key|auth|credential)[\w.-]*(?:=|:|\s+))(?!\*\*\*)\S+/giu,
      "$1***",
    )
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abpr]-)[\w-]+/gu, "***")
    .replace(/(\/\/[^/\s:@]+:)[^@\s]+@/gu, "$1***@");
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
      return {
        path: canonicalIfPresent(fields.get("worktree") ?? ""),
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
 * The controller (`scripts/stand-controller.mjs`) owns this file; it imports npm dependencies, so
 * this dependency-free script reads the location itself.
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
        paths.push(canonicalIfPresent(value));
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
 * Directories that hold this repository's worktrees: the primary checkout, every `*.worktrees`
 * container and the parents of Orca worktrees. A broad directory such as home is never a root.
 * @param {string} primary @param {string[]} worktreePaths @param {Set<string> | null} orcaPaths
 */
function worktreeRoots(primary, worktreePaths, orcaPaths) {
  const roots = new Set([primary, `${primary}.worktrees`]);
  for (const path of worktreePaths.slice(1))
    if (basename(dirname(path)).endsWith(".worktrees"))
      roots.add(dirname(path));
  for (const path of orcaPaths ?? [])
    if (path !== primary) roots.add(dirname(path));
  const broad = new Set([
    "/",
    canonicalIfPresent(homedir()),
    canonicalIfPresent(tmpdir()),
    dirname(primary),
  ]);
  return [...roots].filter((root) => !broad.has(root));
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

/** @param {ProcessInfo} process */
function isAgent(process) {
  return (
    agentExecutables.has(basename(process.command)) ||
    agentArguments.test(process.args)
  );
}

/** @param {ProcessInfo} process */
function isShell(process) {
  return shellExecutables.has(basename(process.command).replace(/^-/u, ""));
}

/** A shell without `-c` is an open terminal; `sh -c` runs a command. @param {ProcessInfo} process */
function isInteractiveShell(process) {
  return isShell(process) && !/(?:^|\s)-[A-Za-z]*c(?:\s|$)/u.test(process.args);
}

/** @param {string} path */
function canonicalIfPresent(path) {
  return existsSync(path) ? realpathSync(path) : path;
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

/** Runs a host CLI that may be absent; undefined when it is not installed. @param {string} command @param {string[]} args @param {string} [cwd] */
async function optionalCommand(command, args, cwd) {
  return commandText(command, args, cwd).catch(
    (/** @type {unknown} */ error) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      throw error;
    },
  );
}

/** @param {string} repository @returns {Adapters["github"]} */
export function githubAdapter(repository) {
  return {
    async pullRequests(branches) {
      const url = await gitText(repository, ["remote", "get-url", "origin"]);
      const match =
        /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(
          url,
        );
      if (!match?.[1] || !match[2])
        throw new Error(`origin ${url} is not a GitHub repository`);
      const names = [...branches];
      const fields = `nodes { number state isCrossRepository commits(last: ${pullRequestCommitWindow}) { totalCount nodes { commit { oid } } } }`;
      const query = `query($owner: String!, $name: String!${names.map((_, i) => `, $b${i}: String!`).join("")}) { repository(owner: $owner, name: $name) { ${names
        .map(
          (_, i) =>
            `b${i}: pullRequests(headRefName: $b${i}, first: 20, states: [OPEN, CLOSED, MERGED]) { ${fields} }`,
        )
        .join(" ")} } }`;
      // -f passes raw strings: no type conversion and no @file reads.
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `owner=${match[1]}`,
        "-f",
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
    if (field(node, "isCrossRepository") === true) return [];
    if (
      (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") ||
      typeof number !== "number"
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
    return [{ number, state, commits: oids, complete: total <= oids.length }];
  });
}

/** @param {{ graceMilliseconds?: number }} [options] @returns {Adapters["processes"]} */
export function processAdapter({
  graceMilliseconds = processStopGraceMilliseconds,
} = {}) {
  const user = String(process.getuid?.() ?? "");
  /** @param {string[]} pids */
  const describe = async (pids) => {
    const [commandOutput, argsOutput] = await Promise.all([
      commandText("ps", ["-ww", "-o", "pid=,ppid=,comm=", ...pids]).catch(
        partialOutput,
      ),
      commandText("ps", ["-ww", "-o", "pid=,args=", ...pids]).catch(
        partialOutput,
      ),
    ]);
    /** @type {Map<number, { ppid: number; command: string; args: string }>} */
    const rows = new Map();
    const argsByPid = new Map(
      argsOutput.split("\n").flatMap((line) => {
        const m = /^\s*(\d+)\s(.*)$/u.exec(line);
        return m ? [[Number(m[1]), (m[2] ?? "").trim()]] : [];
      }),
    );
    for (const line of commandOutput.split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)\s(.*)$/u.exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      rows.set(pid, {
        ppid: Number(m[2]),
        command: (m[3] ?? "").trim(),
        args: argsByPid.get(pid) ?? "",
      });
    }
    return rows;
  };
  /** @param {number} pid */
  const currentCwd = async (pid) =>
    lsofRecords(
      await commandText("lsof", [
        "-w",
        "-a",
        "-d",
        "cwd",
        "-p",
        String(pid),
        "-Fpn",
      ]).catch(partialOutput),
    ).get(pid);
  return {
    async list() {
      const [cwdOutput, listenOutput] = await Promise.all([
        commandText("lsof", [
          "-w",
          "-a",
          "-d",
          "cwd",
          "-u",
          user,
          "-Fpn",
        ]).catch(partialOutput),
        commandText("lsof", [
          "-w",
          "-nP",
          "-a",
          "-iTCP",
          "-sTCP:LISTEN",
          "-u",
          user,
          "-Fpn",
        ]).catch(partialOutput),
      ]);
      const cwds = lsofRecords(cwdOutput);
      const rows = await describe(["-ax"]);
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
      return [...rows].flatMap(([pid, row]) => {
        const cwd = cwds.get(pid);
        return cwd ? [{ pid, ...row, cwd, ports: ports.get(pid) ?? [] }] : [];
      });
    },
    async stop(planned) {
      const same = async () => {
        const row = (await describe(["-p", String(planned.pid)])).get(
          planned.pid,
        );
        return (
          row?.command === planned.command &&
          row.args === planned.args &&
          (await currentCwd(planned.pid)) === planned.cwd
        );
      };
      const alive = () => {
        try {
          process.kill(planned.pid, 0);
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
      if (!(await same())) return false;
      process.kill(planned.pid, "SIGTERM");
      if (await waitForExit(graceMilliseconds)) return true;
      if (!(await same())) return false;
      process.kill(planned.pid, "SIGKILL");
      return waitForExit(graceMilliseconds);
    },
  };
}

/** ps exits 1 when a selected PID is gone and lsof when some processes are unreadable; both still print the rest. @param {unknown} error */
function partialOutput(error) {
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
      const found = await optionalCommand(
        "orca",
        ["worktree", "list", "--json"],
        repository,
      );
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
          return typeof path === "string" ? [canonicalIfPresent(path)] : [];
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
      const output = await optionalCommand("docker", [
        "ps",
        "--all",
        "--filter",
        "label=com.docker.compose.project",
        "--format",
        '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}',
      ]);
      if (output === undefined) return [];
      return [...new Set(output.split("\n").filter(Boolean))].flatMap(
        (line) => {
          const [project = "", directory = ""] = line.split("\t");
          return directory
            ? [{ project, directory: canonicalIfPresent(directory) }]
            : [];
        },
      );
    },
  };
}

/** Processes the optional agent-worktree host CLI tracks for a worktree. @returns {Adapters["tracker"]} */
export function trackerAdapter() {
  return {
    async trackedProcesses(path) {
      const output = await optionalCommand("agent-worktree", ["status"], path);
      if (output === undefined) return 0;
      const processes = field(JSON.parse(output), "processes");
      if (!Array.isArray(processes))
        throw new Error("agent-worktree returned no process list");
      return processes.length;
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // pnpm runs scripts from the package root and passes the caller's directory in INIT_CWD.
  const cwd =
    process.env["npm_lifecycle_event"] === "session:cleanup" &&
    process.env["INIT_CWD"]
      ? process.env["INIT_CWD"]
      : process.cwd();
  runSessionCleanup({
    argv: process.argv.slice(2),
    cwd,
    now: new Date(),
    temporaryDirectory: canonicalIfPresent(tmpdir()),
    selfPid: process.pid,
    github: githubAdapter(cwd),
    processes: processAdapter(),
    orca: orcaAdapter(cwd),
    docker: dockerAdapter(),
    tracker: trackerAdapter(),
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
