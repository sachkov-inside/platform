// @ts-check
// Git boundary: each case owns a temporary bare origin, primary checkout and worktrees driven by the
// real git CLI, bounded by the case budget and removed in t.after. GitHub, Orca, Docker,
// agent-worktree and the process table are doubles.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  isWithin,
  processAdapter,
  redact,
  runSessionCleanup,
  temporaryMinimumAgeHours,
  temporaryRules,
} from "./session-cleanup.mjs";

/**
 * @typedef {import("./session-cleanup.mjs").PullRequest} PullRequest
 * @typedef {import("./session-cleanup.mjs").ProcessInfo} ProcessInfo
 */

const now = new Date("2026-10-31T12:00:00Z");
const hour = 60 * 60 * 1000;
/** Stops a stuck git or process step; a passing case takes well under a second. */
const budget = { timeout: 30_000 };

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
}

/**
 * @param {number} pid @param {string} args @param {string} cwd
 * @param {Partial<ProcessInfo>} [extra]
 * @returns {ProcessInfo}
 */
function proc(pid, args, cwd, extra = {}) {
  return {
    pid,
    ppid: 1,
    command: args.split(" ")[0] ?? "",
    args,
    cwd,
    ports: [],
    ...extra,
  };
}

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "session-cleanup-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const primary = join(root, "platform");
  const temporary = join(root, "tmp");
  mkdirSync(temporary);
  git(root, ["init", "-q", "--bare", "-b", "main", origin]);
  git(root, ["clone", "-q", origin, primary]);
  git(primary, ["commit", "-q", "--allow-empty", "-m", "initial"]);
  git(primary, ["push", "-q", "origin", "main"]);
  /** @type {Map<string, PullRequest[]>} */
  const pulls = new Map();
  /** @type {ProcessInfo[]} */
  const processes = [];
  /** @type {Set<string>} */
  const orcaPaths = new Set();
  /** @type {Map<string, number>} */
  const tracked = new Map();
  /** @type {string[]} */
  const calls = [];
  /** @type {{ github: Error | undefined; docker: Error | undefined; compose: { project: string; directory: string }[]; onStop: ((pid: number) => void) | undefined }} */
  const state = {
    github: undefined,
    docker: undefined,
    compose: [],
    onStop: undefined,
  };
  let output = "";
  return {
    root,
    primary,
    temporary,
    processes,
    orcaPaths,
    tracked,
    calls,
    state,
    get output() {
      return output;
    },
    /**
     * @param {string} name
     * @param {{ commit?: boolean; push?: boolean }} [options]
     */
    worktree(name, { commit = true, push = false } = {}) {
      const path = join(root, "platform.worktrees", name.replaceAll("/", "-"));
      git(primary, ["worktree", "add", "-q", "-b", name, path, "main"]);
      if (commit) {
        writeFileSync(join(path, `${name.replaceAll("/", "-")}.txt`), name);
        git(path, ["add", "."]);
        git(path, ["commit", "-q", "-m", name]);
      }
      if (push) git(path, ["push", "-q", "origin", name]);
      return { path, head: git(path, ["rev-parse", "HEAD"]) };
    },
    /** @param {string} branch @param {Partial<PullRequest>} pull */
    pull(branch, pull) {
      const list = pulls.get(branch) ?? [];
      list.push({
        number: 100 + pulls.size,
        state: "MERGED",
        commits: [],
        complete: true,
        ...pull,
      });
      pulls.set(branch, list);
    },
    /** @param {string[]} argv @param {{ cwd?: string }} [options] */
    async run(argv, { cwd = primary } = {}) {
      output = "";
      return runSessionCleanup({
        argv,
        cwd,
        now,
        temporaryDirectory: temporary,
        selfPid: 999_999,
        github: {
          async pullRequests(branches) {
            calls.push(`github:${[...branches].sort().join(",")}`);
            if (state.github) throw state.github;
            return new Map([...branches].map((b) => [b, pulls.get(b) ?? []]));
          },
        },
        processes: {
          async list() {
            return processes;
          },
          async stop(planned) {
            calls.push(`stop:${planned.pid}`);
            state.onStop?.(planned.pid);
            const index = processes.findIndex((p) => p.pid === planned.pid);
            if (index >= 0) processes.splice(index, 1);
            return true;
          },
        },
        orca: {
          async worktrees() {
            return orcaPaths;
          },
          async remove(path) {
            calls.push(`orca-rm:${path}`);
            git(primary, ["worktree", "remove", path]);
          },
        },
        docker: {
          async composeDirectories() {
            if (state.docker) throw state.docker;
            return state.compose;
          },
        },
        tracker: {
          async trackedProcesses(path) {
            return tracked.get(path) ?? 0;
          },
        },
        write(text) {
          output += text;
        },
      });
    },
    branches() {
      return git(primary, ["branch", "--format=%(refname:short)"]).split("\n");
    },
  };
}

test(
  "dry run lists a squash-merged clean worktree for removal and changes nothing",
  budget,
  async (t) => {
    const context = fixture(t);
    const task = context.worktree("feat/1-done");
    context.pull("feat/1-done", { commits: [task.head] });

    const status = await context.run([]);

    assert.equal(status, 0);
    assert.match(
      context.output,
      /remove\s+\S+feat-1-done \[feat\/1-done\]: merged PR #100 contains HEAD/u,
    );
    assert.ok(existsSync(task.path));
    assert.ok(context.branches().includes("feat/1-done"));
  },
);

test(
  "open PRs, missing PRs and local changes keep their worktrees",
  budget,
  async (t) => {
    const context = fixture(t);
    const open = context.worktree("feat/2-open");
    context.pull("feat/2-open", { state: "OPEN", commits: [open.head] });
    context.worktree("feat/3-no-pr");
    const dirty = context.worktree("feat/4-dirty");
    context.pull("feat/4-dirty", { commits: [dirty.head] });
    writeFileSync(join(dirty.path, "draft.txt"), "unsaved");
    const env = context.worktree("feat/4-env");
    writeFileSync(join(env.path, ".gitignore"), ".env\n");
    git(env.path, ["add", "."]);
    git(env.path, ["commit", "-q", "-m", "ignore env"]);
    context.pull("feat/4-env", {
      commits: [git(env.path, ["rev-parse", "HEAD"])],
    });
    writeFileSync(join(env.path, ".env"), "LOCAL=1");

    await context.run([]);

    assert.match(
      context.output,
      /keep\s+\S+feat-2-open \[feat\/2-open\]: open PR #100/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-3-no-pr \[feat\/3-no-pr\]: no PR for this branch/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-4-dirty \[feat\/4-dirty\]: uncommitted or untracked changes/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-4-env \[feat\/4-env\]: ignored local files: \.env/u,
    );
    assert.doesNotMatch(context.output, /^\s+remove\s/mu);
    assert.doesNotMatch(
      context.output,
      new RegExp(`(remove|keep)\\s+${context.primary} `, "u"),
    );
  },
);

test(
  "commits outside a merged PR need a current remote branch that contains HEAD",
  budget,
  async (t) => {
    const context = fixture(t);
    const ahead = context.worktree("feat/5-ahead");
    context.pull("feat/5-ahead", { commits: [ahead.head] });
    writeFileSync(join(ahead.path, "later.txt"), "later");
    git(ahead.path, ["add", "."]);
    git(ahead.path, ["commit", "-q", "-m", "later"]);
    const pushed = context.worktree("feat/6-closed", { push: true });
    context.pull("feat/6-closed", { state: "CLOSED" });
    const stale = context.worktree("feat/7-stale", { push: true });
    context.pull("feat/7-stale", { state: "CLOSED" });
    git(context.primary, ["push", "-q", "origin", "--delete", "feat/7-stale"]);
    git(context.primary, [
      "update-ref",
      "refs/remotes/origin/feat/7-stale",
      stale.head,
    ]);
    context.worktree("feat/7-long");
    context.pull("feat/7-long", { commits: ["0".repeat(40)], complete: false });

    await context.run([]);

    assert.match(
      context.output,
      /keep\s+\S+feat-5-ahead .*HEAD is not preserved in a merged PR or a remote branch/u,
    );
    assert.match(
      context.output,
      new RegExp(
        `remove\\s+${pushed.path} .*closed PR #\\d+; remote branch feat/6-closed contains HEAD`,
        "u",
      ),
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-7-stale .*HEAD is not preserved/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-7-long .*not preserved in the newest 100 PR commits/u,
    );
  },
);

test(
  "the current worktree, stand state, Compose projects, agents and terminals keep worktrees",
  budget,
  async (t) => {
    const context = fixture(t);
    const current = context.worktree("feat/8-current");
    const stand = context.worktree("feat/9-stand");
    const compose = context.worktree("feat/10-compose");
    const agent = context.worktree("feat/11-agent");
    const nodeAgent = context.worktree("feat/11-node-agent");
    const spacedAgent = context.worktree("feat/11-spaced-agent");
    const terminal = context.worktree("feat/11-terminal");
    for (const task of [
      current,
      stand,
      compose,
      agent,
      nodeAgent,
      spacedAgent,
      terminal,
    ])
      context.pull(git(task.path, ["branch", "--show-current"]), {
        commits: [task.head],
      });
    context.orcaPaths.add(terminal.path);
    const standState = join(context.primary, ".git", "inside-platform-stand");
    mkdirSync(standState);
    writeFileSync(
      join(standState, "state.json"),
      JSON.stringify({ source: { root: stand.path } }),
    );
    context.state.compose.push({
      project: "inside-platform",
      directory: compose.path,
    });
    context.processes.push(
      proc(501, "/Users/dev/.local/bin/claude --resume", agent.path),
      proc(
        502,
        "node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
        nodeAgent.path,
      ),
      proc(
        503,
        "/Users/dev/Library/Application Support/Claude/claude-code/2.1.308/claude --print",
        spacedAgent.path,
        {
          command:
            "/Users/dev/Library/Application Support/Claude/claude-code/2.1.308/claude",
        },
      ),
      proc(504, "-/bin/zsh -l", terminal.path, { command: "-zsh" }),
    );

    await context.run([], { cwd: current.path });

    assert.match(
      context.output,
      /keep\s+\S+feat-8-current .*current session's worktree/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-9-stand .*local stand state references it/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-10-compose .*Compose project inside-platform uses it/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-11-agent .*agent session is running \(PID 501\)/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-11-node-agent .*agent session is running \(PID 502\)/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-11-spaced-agent .*agent session is running \(PID 503\)/u,
    );
    assert.match(
      context.output,
      /keep\s+\S+feat-11-terminal .*\(Orca\): terminal is open \(PID 504\)/u,
    );
  },
);

test(
  "unreadable stand state or unavailable Docker keeps candidate worktrees",
  budget,
  async (t) => {
    const context = fixture(t);
    const task = context.worktree("feat/12-done");
    context.pull("feat/12-done", { commits: [task.head] });
    context.state.docker = new Error("Cannot connect to the Docker daemon");

    await context.run([]);

    assert.match(
      context.output,
      /keep\s+\S+feat-12-done .*Docker unavailable; Compose use is unknown/u,
    );
    context.state.docker = undefined;
    mkdirSync(join(context.primary, ".git", "inside-platform-stand"));
    writeFileSync(
      join(context.primary, ".git", "inside-platform-stand", "state.json"),
      "{",
    );

    await context.run([]);

    assert.match(
      context.output,
      /keep\s+\S+feat-12-done .*local stand state is unreadable/u,
    );
    assert.match(
      context.output,
      /local stand state .* is unreadable; every worktree is kept/u,
    );
  },
);

test(
  "processes stop only in removed worktrees or missing directories under worktree roots",
  budget,
  async (t) => {
    const context = fixture(t);
    const done = context.worktree("feat/13-done");
    context.pull("feat/13-done", { commits: [done.head] });
    const sibling = context.worktree("feat/13-done2");
    context.pull("feat/13-done2", { state: "OPEN", commits: [sibling.head] });
    const gone = join(context.root, "platform.worktrees", "deleted-task");
    context.processes.push(
      proc(601, "node storybook dev -p 6006", join(done.path, "apps"), {
        ports: [6006],
      }),
      proc(602, "node next dev", sibling.path, { ports: [3005] }),
      proc(603, "node vite", gone),
      proc(604, "claude", gone),
      proc(605, "node unrelated", join(context.root, "elsewhere", "gone")),
      proc(606, "node dev-server", context.primary, { ports: [3000] }),
    );

    await context.run([]);

    assert.match(
      context.output,
      /stop\s+PID 601 node storybook dev -p 6006 .*ports 6006\): its worktree is removed/u,
    );
    assert.match(context.output, /keep\s+PID 602 .*: its worktree is kept/u);
    assert.match(
      context.output,
      /stop\s+PID 603 .*: its working directory no longer exists/u,
    );
    assert.match(
      context.output,
      /keep\s+PID 604 .*: agent session in a missing directory/u,
    );
    assert.match(
      context.output,
      /keep\s+PID 606 .*: runs in the current worktree/u,
    );
    assert.doesNotMatch(context.output, /PID 605/u);
    assert.equal(
      isWithin(join(context.root, "a", "wt2"), join(context.root, "a", "wt")),
      false,
    );
  },
);

test("printed command lines mask credential values", () => {
  assert.equal(
    redact(
      "node seed.js --token=abc123 --db postgres://app:hunter2@localhost/db API_KEY=xyz",
    ),
    "node seed.js --token=*** --db postgres://app:***@localhost/db API_KEY=***",
  );
});

test(
  "unavailable GitHub keeps every candidate and reports the reason",
  budget,
  async (t) => {
    const context = fixture(t);
    const task = context.worktree("feat/14-done");
    context.pull("feat/14-done", { commits: [task.head] });
    context.state.github = new Error("API rate limit exceeded");

    const status = await context.run([]);

    assert.equal(status, 0);
    assert.match(
      context.output,
      /keep\s+\S+feat-14-done .*PR data unavailable/u,
    );
    assert.match(
      context.output,
      /GitHub PR data unavailable: API rate limit exceeded/u,
    );
  },
);

test(
  "one GitHub request covers all candidates and none is made without candidates",
  budget,
  async (t) => {
    const context = fixture(t);
    await context.run([]);
    assert.deepEqual(context.calls, []);
    context.worktree("feat/15-a");
    context.worktree("feat/15-b");
    const dirty = context.worktree("feat/15-dirty");
    writeFileSync(join(dirty.path, "x.txt"), "x");

    await context.run([]);

    assert.deepEqual(context.calls, ["github:feat/15-a,feat/15-b"]);
  },
);

test(
  "apply removes eligible worktrees and branches, stops their processes and keeps stashes",
  budget,
  async (t) => {
    const context = fixture(t);
    const plain = context.worktree("feat/16-plain");
    context.pull("feat/16-plain", { commits: [plain.head] });
    const orca = context.worktree("feat/17-orca");
    context.pull("feat/17-orca", { commits: [orca.head] });
    context.orcaPaths.add(orca.path);
    const open = context.worktree("feat/18-open");
    context.pull("feat/18-open", { state: "OPEN" });
    writeFileSync(join(plain.path, "stash.txt"), "stash");
    git(plain.path, ["add", "."]);
    git(plain.path, ["stash", "push", "-q", "-m", "safety"]);
    context.processes.push(
      proc(701, "node storybook", plain.path, { ports: [6006] }),
    );

    const status = await context.run(["--apply"]);

    assert.equal(status, 0, context.output);
    assert.equal(existsSync(plain.path), false);
    assert.equal(existsSync(orca.path), false);
    assert.ok(existsSync(open.path));
    assert.deepEqual(context.branches().sort(), ["feat/18-open", "main"]);
    assert.deepEqual(
      context.calls.filter((c) => !c.startsWith("github:")),
      ["stop:701", `orca-rm:${orca.path}`],
    );
    assert.match(git(context.primary, ["stash", "list"]), /safety/u);
    assert.match(context.output, /removed\s+\S+feat-16-plain/u);
  },
);

test(
  "apply keeps a worktree and its processes when it changed after planning",
  budget,
  async (t) => {
    const context = fixture(t);
    const task = context.worktree("feat/19-done");
    context.pull("feat/19-done", { commits: [task.head] });
    const gone = join(context.root, "platform.worktrees", "deleted-task");
    context.processes.push(
      proc(801, "node watcher", task.path),
      proc(802, "node orphan", gone),
    );
    // The orphan stops first; its stop stands in for another session writing after planning.
    context.state.onStop = (pid) => {
      if (pid === 802)
        writeFileSync(join(task.path, "late.txt"), "written after planning");
    };

    const status = await context.run(["--apply"]);

    assert.equal(status, 1);
    assert.ok(existsSync(task.path));
    assert.ok(context.branches().includes("feat/19-done"));
    assert.deepEqual(
      context.calls.filter((c) => c.startsWith("stop:")),
      ["stop:802"],
    );
    assert.match(
      context.output,
      /changed since planning \(uncommitted or untracked changes\); kept/u,
    );
  },
);

test(
  "agent-worktree previews and missing Orca directories keep their worktrees",
  budget,
  async (t) => {
    const context = fixture(t);
    const preview = context.worktree("feat/20-preview");
    context.pull("feat/20-preview", { commits: [preview.head] });
    context.tracked.set(preview.path, 1);
    const missing = context.worktree("feat/20-missing");
    context.orcaPaths.add(missing.path);
    rmSync(missing.path, { recursive: true, force: true });
    const plainMissing = context.worktree("feat/20-plain-missing");
    rmSync(plainMissing.path, { recursive: true, force: true });

    await context.run(["--apply"]);

    assert.ok(existsSync(preview.path));
    assert.match(
      context.output,
      /kept\s+\S+feat-20-preview .*agent-worktree tracks 1 process\(es\)/u,
    );
    assert.match(
      context.output,
      /kept\s+\S+feat-20-missing .*Orca worktree directory is missing; remove it in Orca/u,
    );
    assert.match(
      context.output,
      /kept\s+\S+feat-20-plain-missing .*git worktree prune would also drop a kept registration/u,
    );
    assert.match(
      git(context.primary, ["worktree", "list"]),
      /feat-20-plain-missing/u,
    );
  },
);

test(
  "apply removes only old temporary entries that match an explicit rule",
  budget,
  async (t) => {
    const context = fixture(t);
    const old = new Date(now.getTime() - (temporaryMinimumAgeHours + 1) * hour);
    const fresh = new Date(now.getTime() - hour);
    /** @param {string} name @param {Date} time */
    const entry = (name, time) => {
      const path = join(context.temporary, name);
      mkdirSync(path);
      utimesSync(path, time, time);
      return path;
    };
    const stale = entry("inside-buyer-journey-abc123", old);
    const recent = entry("inside-enrollment-smoke-def456", fresh);
    const foreign = entry("com.google.Chrome.xyz", old);
    const busy = entry("inside-fullstack-fixtures-ghi789", old);
    context.processes.push(proc(901, "node smoke", busy));

    await context.run(["--apply"]);

    assert.equal(existsSync(stale), false);
    assert.ok(existsSync(recent));
    assert.ok(existsSync(foreign));
    assert.ok(existsSync(busy));
  },
);

test(
  "session-end reports what remains with status 1 and changes nothing",
  budget,
  async (t) => {
    const context = fixture(t);
    assert.equal(await context.run(["--session-end"]), 0);
    assert.equal(context.output, "");
    const task = context.worktree("feat/21-done");
    context.pull("feat/21-done", { commits: [task.head] });
    const current = context.worktree("feat/22-current");
    writeFileSync(join(current.path, "notes.txt"), "unsaved");
    context.processes.push(
      proc(1001, "node storybook dev -p 6006", current.path, { ports: [6006] }),
    );

    const status = await context.run(["--session-end"], { cwd: current.path });

    assert.equal(status, 1);
    assert.match(
      context.output,
      /^Session cleanup report \(nothing was changed\):/u,
    );
    assert.match(
      context.output,
      /This worktree: uncommitted or untracked changes\./u,
    );
    assert.match(
      context.output,
      /1 process\(es\) still run in this worktree:\n {2}PID 1001 node storybook/u,
    );
    assert.match(
      context.output,
      /1 worktree\(s\) can be removed:\n {2}\S+feat-21-done: merged PR/u,
    );
    assert.ok(existsSync(task.path));
    assert.deepEqual(
      context.calls.filter((c) => !c.startsWith("github:")),
      [],
    );
    await assert.rejects(
      context.run(["--session-end", "--apply"]),
      /cannot be combined with --apply/u,
    );
  },
);

test(
  "session-end reports unpublished work and warnings even when nothing can be removed",
  budget,
  async (t) => {
    const context = fixture(t);
    const current = context.worktree("feat/23-current");
    context.worktree("feat/23-other");
    context.state.github = new Error("API rate limit exceeded");

    const status = await context.run(["--session-end"], { cwd: current.path });

    assert.equal(status, 1);
    assert.match(
      context.output,
      /This worktree: HEAD is not on any remote branch\./u,
    );
    assert.match(
      context.output,
      /Warning: GitHub PR data unavailable: API rate limit exceeded/u,
    );
  },
);

test(
  "the running command and its pipeline are hidden while earlier background servers stay visible",
  budget,
  async (t) => {
    const context = fixture(t);
    context.processes.push(
      proc(10, "/Users/dev/.local/bin/claude", context.primary),
      proc(
        20,
        "/bin/zsh -c node scripts/session-cleanup.mjs | cut -c1-80",
        context.primary,
        { ppid: 10 },
      ),
      proc(999_999, "node scripts/session-cleanup.mjs", context.primary, {
        ppid: 20,
      }),
      proc(21, "cut -c1-80", context.primary, { ppid: 20 }),
      proc(30, "/bin/zsh -c pnpm storybook", context.primary, { ppid: 10 }),
      proc(31, "node storybook dev -p 6006", context.primary, {
        ppid: 30,
        ports: [6006],
      }),
    );

    await context.run([]);

    assert.match(
      context.output,
      /keep\s+PID 31 node storybook dev -p 6006 .*: runs in the current worktree/u,
    );
    assert.doesNotMatch(context.output, /PID (10|20|21|30|999999) /u);
  },
);

test("every temporary rule names a file that creates that prefix", () => {
  for (const rule of temporaryRules)
    assert.ok(
      readFileSync(rule.source, "utf8").includes(rule.prefix),
      `${rule.source} creates ${rule.prefix}`,
    );
});

// Process adapter boundary: real child processes owned by this test, bounded by the case budget and
// killed in t.after.
test(
  "the process adapter reports a child's cwd, refuses a changed process and stops one that ignores SIGTERM",
  budget,
  async (t) => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "session-cleanup-")),
    );
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
      ],
      { cwd: directory, stdio: ["ignore", "pipe", "ignore"] },
    );
    t.after(() => {
      child.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    });
    await once(child.stdout, "data");
    const adapter = processAdapter({ graceMilliseconds: 200 });
    const pid = child.pid ?? 0;

    const listed = (await adapter.list()).find((p) => p.pid === pid);
    assert.equal(listed?.cwd, directory);
    assert.ok(listed);
    assert.equal(
      await adapter.stop({ ...listed, args: `${listed.args} --changed` }),
      false,
    );
    const exited = once(child, "exit");
    const stopped = await adapter.stop(listed);

    assert.equal(stopped, true);
    assert.equal((await exited)[1], "SIGKILL");
  },
);
