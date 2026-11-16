// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  addScenario,
  addressFor,
  browserInvocation,
  doctorReport,
  listenerOwned,
  manifestProblems,
  manifestReport,
  manifestSchema,
  newManifest,
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
  assert.match(owner, /^verify-a-[0-9a-f]{10}-owner$/u);
  const long = verifySessionName(
    "/Users/x/Worktrees/repo/Plan Verify_skill-and-more",
    "learner",
  );
  assert.match(long, /^verify-plan-verify-[0-9a-f]{10}-learner$/u);
  // The session name becomes part of a Unix socket path of at most 103 bytes.
  assert.ok(long.length <= 38, long);
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
    ["--json", "connect", "9222"],
    ["--json", "batch", "close --all"],
    ["upgrade"],
    ["open", "--proxy", "http://127.0.0.1:1", "http://127.0.0.1/"],
    ["open", "--engine", "lightpanda", "http://127.0.0.1/"],
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
    addressFor(urls, "holder", "/account"),
    "http://127.0.0.1:57150/sign-in?as=holder&next=%2Faccount",
  );
  assert.equal(
    addressFor(urls, "newcomer", "/account"),
    "http://127.0.0.1:57150/sign-in?as=newcomer&next=%2Faccount",
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
    'select "pg_terminate_backend"(1)',
    "select pg_terminate_backend/**/(1)",
    'select pg_catalog."pg_cancel_backend"(1)',
    "select 1 -- pg",
    "select setval('s', 1)",
    "select set_config('default_transaction_read_only', 'off', false)",
    "\\copy x to stdout",
    "",
  ])
    assert.throws(() => readOnlyStatement(sql), /one reading statement/u);
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

const scenario = {
  title: "Владелец выдаёт продукт, ученик видит закрытый материал",
  kind: /** @type {const} */ ("video"),
  files: [{ path: "grant.webm", shows: "выдача в карточке человека" }],
  shows: "Карточка показывает «Доступ открыт», материал открылся у ученика",
  source: /** @type {const} */ ("light-instance"),
  covers: "#2211: владелец выдаёт продукт",
  result: /** @type {const} */ ("PASS"),
  notes: null,
};
const run = {
  commit: "5ee19bba09148cb474f9a0d83f3f7f5bf321e048",
  branch: "feat/1-change",
  base: "1111111111111111111111111111111111111111",
  patchId: "2222222222222222222222222222222222222222",
  uncommittedFiles: [],
  uncommittedDiffSha256: null,
  startedAt: "2026-11-16T15:00:00.000Z",
};

test("a manifest collects scenarios under unique ids", () => {
  let manifest = newManifest(run);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.verdict, null);
  manifest = addScenario(manifest, scenario);
  manifest = addScenario(manifest, { ...scenario, kind: "none", files: [] });
  assert.deepEqual(
    manifest.scenarios.map((item) => item.id),
    ["s01", "s02"],
  );
  assert.equal(
    manifestSchema.parse(manifest).scenarios[0]?.title,
    scenario.title,
  );
  assert.throws(
    () => addScenario(manifest, { ...scenario, title: "две\nстроки" }),
    /one line/u,
  );
  assert.throws(
    () => addScenario(manifest, { ...scenario, files: [] }),
    /needs at least one file/u,
  );
  assert.throws(
    () => addScenario(manifest, { ...scenario, kind: "none" }),
    /takes no files/u,
  );
  assert.throws(
    () =>
      addScenario(manifest, {
        ...scenario,
        files: [{ path: "grant.png", shows: "x" }],
      }),
    /kind video takes clips/u,
  );
  assert.throws(
    () => addScenario(manifest, { ...scenario, kind: "screenshot" }),
    /takes no clip/u,
  );
  assert.throws(
    () => addScenario(manifest, { ...scenario, source: "stand-test-data" }),
    /shared stand keeps no file/u,
  );
  assert.doesNotThrow(() =>
    addScenario(manifest, {
      ...scenario,
      source: "stand-test-data",
      kind: "none",
      files: [],
    }),
  );
  assert.throws(
    () =>
      addScenario(manifest, {
        ...scenario,
        files: [{ path: "../outside.png", shows: "x" }],
      }),
    /stay inside \.evidence/u,
  );
});

test("a manifest is checked against its files and GitHub's attachment limit", () => {
  const manifest = {
    ...addScenario(newManifest(run), scenario),
    verdict: /** @type {const} */ ("PASS"),
  };
  const megabyte = 1_000_000;
  assert.deepEqual(
    manifestProblems(manifest, {
      "grant.webm": { bytes: 2 * megabyte, seconds: 7 },
    }),
    [],
  );
  assert.deepEqual(manifestProblems(manifest, {}), [
    "s01: grant.webm is not a file in .evidence",
  ]);
  assert.deepEqual(
    manifestProblems(manifest, {
      "grant.webm": { bytes: 10 * megabyte + 1, seconds: 45 },
    }),
    [
      "s01: grant.webm is 10.0 MB; GitHub attaches at most 10 MB",
      "s01: grant.webm lasts 45 s; record one clip of at most 30 s per scenario",
    ],
  );
  assert.deepEqual(
    manifestProblems(
      { ...manifest, verdict: null },
      { "grant.webm": { bytes: 0, seconds: null } },
    ),
    [
      "s01: grant.webm is empty",
      "s01: the length of grant.webm is unknown; install ffprobe or check it by hand",
      "the run has no verdict; set it with: evidence verdict <PASS|PASS+NOTES|FAIL>",
    ],
  );
  const clip = { "grant.webm": { bytes: 1, seconds: 12 } };
  const failed = addScenario(manifest, {
    ...scenario,
    kind: "none",
    files: [],
    result: "FAIL",
    notes: "кнопка не нажимается",
  });
  assert.deepEqual(manifestProblems(failed, clip), [
    "the verdict is PASS but scenario s02 is FAIL",
  ]);
  assert.deepEqual(
    manifestProblems({ ...manifest, verdict: "PASS+NOTES" }, clip),
    ["the verdict PASS+NOTES needs notes"],
  );
  assert.deepEqual(
    manifestProblems(
      {
        ...manifest,
        verdict: "FAIL",
        notes: "doctor не прошёл",
        scenarios: [
          { ...scenario, id: "s01", kind: "screenshot" },
          { ...scenario, id: "s01", kind: "none", files: [], result: "FAIL" },
        ],
      },
      clip,
    ),
    [
      "s01: a scenario of kind screenshot takes no clip; use kind video for it",
      "s01: the id is used twice",
    ],
  );
  assert.deepEqual(manifestProblems({ ...manifest, scenarios: [] }, {}), [
    "the run has no scenarios",
  ]);
});

test("the report is built from the manifest alone", () => {
  const manifest = {
    ...addScenario(newManifest(run), scenario),
    verdict: /** @type {const} */ ("PASS+NOTES"),
    notes: "Список «Люди» не показывает имя из кабинета.",
  };
  const text = manifestReport(manifest);
  assert.match(text, /^Verdict: PASS\+NOTES$/mu);
  assert.match(text, /Commit: `5ee19bba09148cb474f9a0d83f3f7f5bf321e048`/u);
  assert.match(text, /patch-id `2{40}`/u);
  assert.match(text, /Notes: Список «Люди»/u);
  assert.match(
    text,
    /\| s01 \| Владелец выдаёт продукт, ученик видит закрытый материал \| video \| `grant\.webm` \| light-instance \| PASS \|/u,
  );
});
