// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  addressFor,
  artifactTable,
  browserInvocation,
  doctorReport,
  evidenceRunName,
  listenerOwned,
  readOnlyStatement,
  sourceFreshness,
  verifySessionName,
  webBuildInput,
} from "./verify-platform-plan.mjs";

const urls = {
  web: "http://127.0.0.1:22189",
  api: "http://127.0.0.1:28403",
  mcp: null,
  signIn: "http://127.0.0.1:57150/sign-in",
};

test("each worktree and role drives its own browser session", () => {
  const owner = verifySessionName("/work/a", "owner");
  assert.match(owner, /^platform-verify-a-[0-9a-f]{10}-owner$/u);
  assert.match(
    verifySessionName("/Users/x/Worktrees/repo/Plan Verify_skill", "guest"),
    /^platform-verify-plan-verify-skill-[0-9a-f]{10}-guest$/u,
  );
  assert.notEqual(owner, verifySessionName("/work/b", "owner"));
  assert.notEqual(owner, verifySessionName("/work/a", "learner"));
  assert.equal(verifySessionName("/work/a", "owner"), owner);
});

test("the browser command names the session and drops the proxy for loopback", () => {
  const invocation = browserInvocation({
    worktree: "/work/a",
    role: "learner",
    args: ["open", "http://127.0.0.1:22189/"],
    environment: {
      PATH: "/bin",
      HTTP_PROXY: "http://127.0.0.1:10808",
      https_proxy: "http://127.0.0.1:10808",
      AGENT_BROWSER_NAMESPACE: "agents",
      AGENT_BROWSER_AUTO_CONNECT: "1",
      AGENT_BROWSER_PROFILE: "Default",
    },
  });
  assert.equal(invocation.command, "agent-browser");
  assert.deepEqual(invocation.args, [
    "--namespace",
    "agents",
    "--session",
    verifySessionName("/work/a", "learner"),
    "--args",
    "--disable-features=Translate,TcpPortRandomizationMac",
    "open",
    "http://127.0.0.1:22189/",
  ]);
  assert.equal(invocation.environment["PATH"], "/bin");
  assert.equal(invocation.environment["HTTP_PROXY"], undefined);
  assert.equal(invocation.environment["https_proxy"], undefined);
  assert.equal(invocation.environment["AGENT_BROWSER_AUTO_CONNECT"], undefined);
  assert.equal(invocation.environment["AGENT_BROWSER_PROFILE"], undefined);
  assert.equal(invocation.environment["AGENT_BROWSER_NAMESPACE"], undefined);
  const plain = browserInvocation({
    worktree: "/work/a",
    role: "owner",
    args: ["snapshot", "-i"],
    environment: {},
  });
  assert.equal(plain.args[0], "--session");
});

test("the browser command refuses to leave its own session", () => {
  for (const args of [
    ["close", "--all"],
    ["kill-all"],
    ["--session", "other", "open", "http://127.0.0.1/"],
    ["--namespace", "other", "snapshot"],
    ["--cdp", "9222", "snapshot"],
    ["--auto-connect", "snapshot"],
    ["--profile", "Default", "open", "http://127.0.0.1/"],
    ["--profile=Default", "open", "http://127.0.0.1/"],
    ["-p", "browserbase", "open", "http://127.0.0.1/"],
    ["--state", "auth.json", "open", "http://127.0.0.1/"],
    ["--session-name", "other", "snapshot"],
    ["--restore", "open", "http://127.0.0.1/"],
    ["--executable-path", "/Applications/Google Chrome.app", "snapshot"],
    ["--args", "--remote-debugging-port=9222", "snapshot"],
    ["--headed", "snapshot"],
    ["batch", "close --all"],
    ["connect", "9222"],
    [],
  ])
    assert.throws(
      () =>
        browserInvocation({
          worktree: "/work/a",
          role: "owner",
          args,
          environment: {},
        }),
      /own session|command/u,
    );
  // A value that merely equals a command name is the caller's text, not a command.
  assert.doesNotThrow(() =>
    browserInvocation({
      worktree: "/work/a",
      role: "owner",
      args: ["find", "role", "button", "click", "--name", "connect"],
      environment: {},
    }),
  );
});

test("addresses sign a role in or point at the instance", () => {
  assert.equal(
    addressFor(urls, "owner", "/authoring/people"),
    "http://127.0.0.1:57150/sign-in?as=owner&next=%2Fauthoring%2Fpeople",
  );
  assert.equal(
    addressFor(urls, "learner", "/"),
    "http://127.0.0.1:57150/sign-in?as=learner&next=%2F",
  );
  assert.equal(
    addressFor(urls, "sign-out", "/"),
    "http://127.0.0.1:57150/sign-out?next=%2F",
  );
  assert.equal(
    addressFor(urls, "web", "/materials/x?a=1"),
    "http://127.0.0.1:22189/materials/x?a=1",
  );
  assert.equal(
    addressFor(urls, "api", "/health"),
    "http://127.0.0.1:28403/health",
  );
  for (const path of ["materials", "//evil.test/", "/\\evil.test"])
    assert.throws(() => addressFor(urls, "web", path), /path/u);
  assert.throws(
    () => addressFor({ ...urls, signIn: null }, "owner", "/"),
    /sign-in/u,
  );
});

test("a production web build is stale once the source changed after start", () => {
  const startedAt = "2026-11-16T14:30:44.962Z";
  const started = Date.parse(startedAt);
  const fresh = sourceFreshness({
    web: "production",
    startedAt,
    headMovedAtMs: started - 60_000,
    changedFiles: [{ path: "apps/web/src/a.tsx", modifiedAtMs: started - 1 }],
  });
  assert.equal(fresh.ok, true);
  const committed = sourceFreshness({
    web: "production",
    startedAt,
    headMovedAtMs: started + 1_000,
    changedFiles: [],
  });
  assert.equal(committed.ok, false);
  assert.match(committed.detail, /HEAD moved/u);
  const edited = sourceFreshness({
    web: "production",
    startedAt,
    headMovedAtMs: started - 60_000,
    changedFiles: [
      { path: "apps/web/src/a.tsx", modifiedAtMs: started + 5 },
      { path: "apps/web/src/gone.tsx", modifiedAtMs: null },
    ],
  });
  assert.equal(edited.ok, false);
  assert.match(edited.detail, /apps\/web\/src\/a\.tsx/u);
  assert.match(edited.detail, /apps\/web\/src\/gone\.tsx/u);
});

test("changes outside the web build leave the instance fresh", () => {
  const startedAt = "2026-11-16T14:30:44.962Z";
  const started = Date.parse(startedAt);
  const result = sourceFreshness({
    web: "production",
    startedAt,
    headMovedAtMs: started - 60_000,
    changedFiles: [
      { path: "apps/backend/src/a.ts", modifiedAtMs: started + 5 },
      { path: ".agents/skills/verify-platform/SKILL.md", modifiedAtMs: null },
      { path: "scripts/verify-platform.mjs", modifiedAtMs: started + 5 },
    ],
  });
  assert.equal(result.ok, true);
  for (const path of [
    "tsconfig.base.json",
    "tsconfig.next-app.json",
    "pnpm-workspace.yaml",
    "patches/a.patch",
    "apps/web/src/a.tsx",
    "packages/contracts/index.ts",
    "pnpm-lock.yaml",
    "package.json",
  ])
    assert.equal(webBuildInput(path), true, path);
});

test("a development web server reloads edits, so later changes stay fresh", () => {
  const startedAt = "2026-11-16T14:30:44.962Z";
  const result = sourceFreshness({
    web: "development",
    startedAt,
    headMovedAtMs: Date.parse(startedAt) + 1_000,
    changedFiles: [],
  });
  assert.equal(result.ok, true);
});

test("a port belongs to the instance only when its listener descends from the supervisor", () => {
  const table = [
    { pid: 100, ppid: 1 },
    { pid: 110, ppid: 100 },
    { pid: 111, ppid: 110 },
    { pid: 200, ppid: 1 },
  ];
  assert.equal(listenerOwned(table, 111, 100), true);
  assert.equal(listenerOwned(table, 100, 100), true);
  assert.equal(listenerOwned(table, 200, 100), false);
  assert.equal(listenerOwned(table, undefined, 100), false);
  // A cycle in a torn process table ends the walk.
  assert.equal(
    listenerOwned(
      [
        { pid: 5, ppid: 6 },
        { pid: 6, ppid: 5 },
      ],
      5,
      100,
    ),
    false,
  );
});

test("the database helper accepts one reading statement", () => {
  assert.equal(
    readOnlyStatement(" select count(*) from accounts.accounts; "),
    "select count(*) from accounts.accounts",
  );
  assert.equal(
    readOnlyStatement("WITH a AS (select 1) select * from a"),
    "WITH a AS (select 1) select * from a",
  );
  for (const sql of [
    "delete from accounts.accounts",
    "select 1; drop table x",
    "set default_transaction_read_only = off",
    "select pg_terminate_backend(pid) from pg_stat_activity",
    "select pg_cancel_backend (1)",
    "select setval('s', 1)",
    "select set_config('default_transaction_read_only', 'off', false)",
    "\\copy x to stdout",
    "",
  ])
    assert.throws(() => readOnlyStatement(sql), /one reading statement/u);
});

test("a run directory name carries time, branch and commit", () => {
  assert.equal(
    evidenceRunName({
      now: new Date("2026-11-16T14:30:44.962Z"),
      branch: "feat/2211-verify-platform-skill",
      commit: "5ee19bba09148cb474f9a0d83f3f7f5bf321e048",
    }),
    "20261116T143044Z-feat-2211-verify-platform-skill-5ee19bb",
  );
  assert.equal(
    evidenceRunName({
      now: new Date("2026-11-16T14:30:44.962Z"),
      branch: "",
      commit: "5ee19bba09148cb474f9a0d83f3f7f5bf321e048",
    }),
    "20261116T143044Z-detached-5ee19bb",
  );
});

test("the doctor fails when any check fails and says which", () => {
  const good = doctorReport([
    { name: "process", ok: true, detail: "supervisor 100 is running" },
    { name: "source", ok: true, detail: "built after the last change" },
  ]);
  assert.equal(good.ok, true);
  assert.match(good.text, /^ok {4}process: supervisor 100 is running$/mu);
  assert.match(good.text, /worth driving/u);
  const bad = doctorReport([
    { name: "process", ok: true, detail: "supervisor 100 is running" },
    { name: "sign-in", ok: false, detail: "owner is a guest" },
  ]);
  assert.equal(bad.ok, false);
  assert.match(bad.text, /^FAIL {2}sign-in: owner is a guest$/mu);
  assert.match(bad.text, /Do not drive/u);
  assert.equal(doctorReport([]).ok, false);
});

test("the artifact table lists every file with size and digest", () => {
  const table = artifactTable([
    { path: "owner/01-before.png", bytes: 2048, sha256: "a".repeat(64) },
    { path: "owner/grant.webm", bytes: 1_572_864, sha256: "b".repeat(64) },
  ]);
  assert.equal(
    table,
    [
      "| Artifact | Size | SHA-256 |",
      "|---|---|---|",
      `| \`owner/01-before.png\` | 2.0 KiB | \`${"a".repeat(12)}\` |`,
      `| \`owner/grant.webm\` | 1.5 MiB | \`${"b".repeat(12)}\` |`,
    ].join("\n"),
  );
  assert.equal(artifactTable([]), "No artifacts.");
});
