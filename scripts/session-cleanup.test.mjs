// @ts-check
// Git boundary: each case owns a temporary bare origin, primary checkout and worktrees driven by the
// real git CLI. GitHub, Orca, Docker and the process table are doubles.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
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
  runSessionCleanup,
  temporaryRules,
} from "./session-cleanup.mjs";

const now = new Date("2026-10-31T12:00:00Z");

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
 * @typedef {{ number: number; state: "OPEN" | "CLOSED" | "MERGED"; url: string; commits: string[]; complete: boolean }} FixturePullRequest
 * @typedef {{ pid: number; ppid: number; args: string; cwd: string; ports: number[] }} FixtureProcess
 */

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
  /** @type {Map<string, FixturePullRequest[]>} */
  const pulls = new Map();
  /** @type {FixtureProcess[]} */
  const processes = [];
  /** @type {Set<string>} */
  const orcaPaths = new Set();
  /** @type {string[]} */
  const calls = [];
  /** @type {{ github: Error | undefined; orca: Error | undefined; docker: Error | undefined; compose: { project: string; directory: string }[]; onStop: (() => void) | undefined }} */
  const state = {
    github: undefined,
    orca: undefined,
    docker: undefined,
    compose: [],
    onStop: undefined,
  };
  let output = "";
  return {
    root,
    primary,
    temporary,
    pulls,
    processes,
    orcaPaths,
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
    /** @param {string} branch @param {Partial<FixturePullRequest>} pull */
    pull(branch, pull) {
      const list = pulls.get(branch) ?? [];
      list.push({
        number: 100 + pulls.size,
        state: "MERGED",
        url: `https://github.com/example/platform/pull/${100 + pulls.size}`,
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
          async stop(pid) {
            calls.push(`stop:${pid}`);
            state.onStop?.();
            const index = processes.findIndex((p) => p.pid === pid);
            if (index >= 0) processes.splice(index, 1);
            return true;
          },
        },
        orca: {
          async worktrees() {
            if (state.orca) throw state.orca;
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
        write(text) {
          output += text;
        },
      });
    },
    /** @param {string} cwd */
    branches(cwd = primary) {
      return git(cwd, ["branch", "--format=%(refname:short)"]).split("\n");
    },
  };
}

test("dry run lists a squash-merged clean worktree for removal and changes nothing", async (t) => {
  const context = fixture(t);
  const task = context.worktree("feat/1-done");
  context.pull("feat/1-done", { commits: [task.head] });

  const status = await context.run([]);

  assert.equal(status, 0);
  assert.match(context.output, /remove\s+.*feat\/1-done/u);
  assert.match(context.output, /merged PR #100/u);
  assert.ok(existsSync(task.path));
  assert.ok(context.branches().includes("feat/1-done"));
});

test("open PRs, missing PRs and local changes keep their worktrees", async (t) => {
  const context = fixture(t);
  const open = context.worktree("feat/2-open");
  context.pull("feat/2-open", { state: "OPEN", commits: [open.head] });
  context.worktree("feat/3-no-pr");
  const dirty = context.worktree("feat/4-dirty");
  context.pull("feat/4-dirty", { commits: [dirty.head] });
  writeFileSync(join(dirty.path, "draft.txt"), "unsaved");

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
  assert.doesNotMatch(context.output, /^\s+remove\s/mu);
  assert.doesNotMatch(
    context.output,
    new RegExp(`(remove|keep)\\s+${context.primary} `, "u"),
  );
});

test("commits outside a merged PR need a current remote branch that contains HEAD", async (t) => {
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

  await context.run([]);

  assert.match(
    context.output,
    /keep\s+\S+feat-5-ahead .*HEAD is not preserved/u,
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
});

test("the current worktree, stand state, Compose projects and agent sessions keep worktrees", async (t) => {
  const context = fixture(t);
  const current = context.worktree("feat/8-current");
  const stand = context.worktree("feat/9-stand");
  const compose = context.worktree("feat/10-compose");
  const agent = context.worktree("feat/11-agent");
  for (const task of [current, stand, compose, agent])
    context.pull(git(task.path, ["branch", "--show-current"]), {
      commits: [task.head],
    });
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
  context.processes.push({
    pid: 501,
    ppid: 1,
    args: "/Users/dev/.local/bin/claude --resume",
    cwd: agent.path,
    ports: [],
  });

  await context.run([], { cwd: join(current.path) });

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
});

test("unreadable stand state keeps every worktree", async (t) => {
  const context = fixture(t);
  const task = context.worktree("feat/12-done");
  context.pull("feat/12-done", { commits: [task.head] });
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
});

test("processes stop only in removed worktrees or missing directories under worktree roots", async (t) => {
  const context = fixture(t);
  const done = context.worktree("feat/13-done");
  context.pull("feat/13-done", { commits: [done.head] });
  const sibling = context.worktree("feat/13-done2");
  context.pull("feat/13-done2", { state: "OPEN", commits: [sibling.head] });
  const gone = join(context.root, "platform.worktrees", "deleted-task");
  context.processes.push(
    {
      pid: 601,
      ppid: 1,
      args: "node storybook dev -p 6006",
      cwd: join(done.path, "apps"),
      ports: [6006],
    },
    {
      pid: 602,
      ppid: 1,
      args: "node next dev",
      cwd: sibling.path,
      ports: [3005],
    },
    { pid: 603, ppid: 1, args: "node vite", cwd: gone, ports: [] },
    { pid: 604, ppid: 1, args: "claude", cwd: gone, ports: [] },
    {
      pid: 605,
      ppid: 1,
      args: "node unrelated",
      cwd: join(context.root, "elsewhere", "gone"),
      ports: [],
    },
    {
      pid: 606,
      ppid: 1,
      args: "node dev-server",
      cwd: context.primary,
      ports: [3000],
    },
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
});

test("unavailable GitHub keeps every candidate and reports the reason", async (t) => {
  const context = fixture(t);
  const task = context.worktree("feat/14-done");
  context.pull("feat/14-done", { commits: [task.head] });
  context.state.github = new Error("API rate limit exceeded");

  const status = await context.run([]);

  assert.equal(status, 0);
  assert.match(context.output, /keep\s+\S+feat-14-done .*PR data unavailable/u);
  assert.match(
    context.output,
    /GitHub PR data unavailable: API rate limit exceeded/u,
  );
});

test("one GitHub request covers all candidates and none is made without candidates", async (t) => {
  const context = fixture(t);
  await context.run([]);
  assert.deepEqual(context.calls, []);
  context.worktree("feat/15-a");
  context.worktree("feat/15-b");
  context.worktree("feat/15-dirty");
  writeFileSync(
    join(context.root, "platform.worktrees", "feat-15-dirty", "x.txt"),
    "x",
  );

  await context.run([]);

  assert.deepEqual(context.calls, ["github:feat/15-a,feat/15-b"]);
});

test("apply removes eligible worktrees and branches, stops their processes and keeps stashes", async (t) => {
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
  context.processes.push({
    pid: 701,
    ppid: 1,
    args: "node storybook",
    cwd: plain.path,
    ports: [6006],
  });

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
});

test("apply rechecks a worktree and keeps it when it changed after planning", async (t) => {
  const context = fixture(t);
  const task = context.worktree("feat/19-done");
  context.pull("feat/19-done", { commits: [task.head] });
  context.processes.push({
    pid: 801,
    ppid: 1,
    args: "node watcher",
    cwd: task.path,
    ports: [],
  });
  context.state.onStop = () =>
    writeFileSync(join(task.path, "late.txt"), "written after planning");

  const status = await context.run(["--apply"]);

  assert.equal(status, 1);
  assert.ok(existsSync(task.path));
  assert.ok(context.branches().includes("feat/19-done"));
  assert.match(
    context.output,
    /changed since planning \(uncommitted or untracked changes\); kept/u,
  );
});

test("apply removes only old temporary entries that match an explicit rule", async (t) => {
  const context = fixture(t);
  const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  const fresh = new Date(now.getTime() - 60 * 60 * 1000);
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
  context.processes.push({
    pid: 901,
    ppid: 1,
    args: "node smoke",
    cwd: busy,
    ports: [],
  });

  await context.run(["--apply"]);

  assert.equal(existsSync(stale), false);
  assert.ok(existsSync(recent));
  assert.ok(existsSync(foreign));
  assert.ok(existsSync(busy));
});

test("session-end reports what remains with status 1 and changes nothing", async (t) => {
  const context = fixture(t);
  assert.equal(await context.run(["--session-end"]), 0);
  assert.equal(context.output, "");
  const task = context.worktree("feat/20-done");
  context.pull("feat/20-done", { commits: [task.head] });
  const current = context.worktree("feat/21-current");
  context.processes.push({
    pid: 1001,
    ppid: 1,
    args: "node storybook dev -p 6006",
    cwd: current.path,
    ports: [6006],
  });

  const status = await context.run(["--session-end"], { cwd: current.path });

  assert.equal(status, 1);
  assert.match(
    context.output,
    /^Session cleanup report \(nothing was changed\):/u,
  );
  assert.match(
    context.output,
    /1 worktree\(s\) can be removed:\n {2}\S+feat-20-done: merged PR/u,
  );
  assert.match(
    context.output,
    /1 process\(es\) still run in this worktree:\n {2}PID 1001 node storybook/u,
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
});

test("the running command and its pipeline are hidden while earlier background servers stay visible", async (t) => {
  const context = fixture(t);
  context.processes.push(
    {
      pid: 10,
      ppid: 1,
      args: "/Users/dev/.local/bin/claude",
      cwd: context.primary,
      ports: [],
    },
    {
      pid: 20,
      ppid: 10,
      args: "/bin/zsh -c node scripts/session-cleanup.mjs | cut -c1-80",
      cwd: context.primary,
      ports: [],
    },
    {
      pid: 999_999,
      ppid: 20,
      args: "node scripts/session-cleanup.mjs",
      cwd: context.primary,
      ports: [],
    },
    { pid: 21, ppid: 20, args: "cut -c1-80", cwd: context.primary, ports: [] },
    {
      pid: 30,
      ppid: 10,
      args: "/bin/zsh -c pnpm storybook",
      cwd: context.primary,
      ports: [],
    },
    {
      pid: 31,
      ppid: 30,
      args: "node storybook dev -p 6006",
      cwd: context.primary,
      ports: [6006],
    },
  );

  await context.run([]);

  assert.match(
    context.output,
    /keep\s+PID 31 node storybook dev -p 6006 .*: runs in the current worktree/u,
  );
  assert.doesNotMatch(context.output, /PID (10|20|21|999999) /u);
});

test("every temporary rule names a file that creates that prefix", () => {
  for (const rule of temporaryRules)
    assert.ok(
      readFileSync(rule.source, "utf8").includes(rule.prefix),
      `${rule.source} creates ${rule.prefix}`,
    );
});

// Process adapter boundary: a real child process owned by this test, cleaned up in t.after.
test("the process adapter reports a child's cwd and stops it after SIGTERM is ignored", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "session-cleanup-")),
  );
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
    ],
    {
      cwd: directory,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  t.after(() => {
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((ready) => child.stdout.once("data", ready));
  const adapter = processAdapter({ graceMilliseconds: 200 });
  const pid = child.pid ?? 0;

  const listed = (await adapter.list()).find((p) => p.pid === pid);
  const exited = new Promise((done) =>
    child.once("exit", (_code, signal) => done(signal)),
  );
  const stopped = await adapter.stop(pid);

  assert.equal(listed?.cwd, directory);
  assert.equal(stopped, true);
  assert.equal(await exited, "SIGKILL");
});
