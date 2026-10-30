// @ts-check
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";

const cli = fileURLToPath(new URL("./review-evidence.mjs", import.meta.url));
/** @param {string[]} args @param {unknown} input */
function run(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
}
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const task = { title: "Task", body: "Acceptance criteria" };
const taskSha256 = createHash("sha256")
  .update(JSON.stringify(task))
  .digest("hex");
/** @typedef {{role:string, agentId:string, transcript:string, outcome:string, findingsComplete:boolean, extra?:boolean, findings:Array<{id:string,severity:string,disposition:string,reason?:string,evidence?:string}>}} ReviewFixture */
/** @param {string} role @returns {ReviewFixture} */
function reviewFixture(role) {
  return {
    role,
    agentId: role.toLowerCase(),
    transcript: `native:${role}`,
    outcome: "passed",
    findingsComplete: true,
    findings: [],
  };
}
function receipt() {
  return {
    schemaVersion: 1,
    repository: "sachkov-inside/platform",
    pullRequest: 42,
    task: "https://github.com/sachkov-inside/platform/issues/1856",
    taskSha256,
    baseSha,
    headSha,
    implementer: { agentId: "author", transcript: "native:author" },
    reviews: /** @type {[ReviewFixture, ReviewFixture]} */ ([
      reviewFixture("Standards"),
      reviewFixture("Spec"),
    ]),
  };
}

test("publisher renders a review receipt without committing evidence into the reviewed head", () => {
  const result = run(["render"], receipt());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<!-- platform-review-evidence:v1 -->\n/u);
  assert.deepEqual(
    JSON.parse(result.stdout.split("\n").slice(1).join("\n")),
    receipt(),
  );
});

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-evidence-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {...string} args */
  function git(...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(resolve(cwd, "base"), "base");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  let targetBase = base;
  git("checkout", "-b", "feature");
  writeFileSync(resolve(cwd, "feature"), "reviewed");
  git("add", ".");
  git("commit", "-m", "feature");
  const head = git("rev-parse", "HEAD");
  git("checkout", "main");
  // Force a synthetic merge even when main has not advanced.
  git("merge", "--no-ff", "feature", "-m", "synthetic");
  let candidate = git("rev-parse", "HEAD");
  const body = receipt();
  body.baseSha = base;
  body.headSha = head;
  const pr = {
    number: 42,
    state: "open",
    draft: false,
    body: body.task,
    base: { sha: base, ref: "main", repo: { full_name: body.repository } },
    head: { sha: head },
  };
  const comment = {
    id: 123,
    user: { login: "publisher" },
    author_association: "COLLABORATOR",
    body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(body)}`,
  };
  const comments = [comment];
  /** @type {Record<string, unknown>} */
  const routes = {
    "issues/1856": task,
    "issues/comments/123": comment,
    "pulls/42": pr,
    "issues/42/comments?per_page=100&page=1": comments,
    "collaborators/publisher/permission": { permission: "write" },
    [`commits/${head}/pulls?per_page=100&page=1`]: [
      { number: 42, state: "open" },
    ],
  };
  function fhead() {
    return pr.head.sha;
  }
  /** @param {{eventName?: string, event?: unknown, responseRoutes?: Record<string, unknown>}} [options] */
  function check({
    eventName = "pull_request",
    event,
    responseRoutes = routes,
  } = {}) {
    const eventValue =
      event ??
      (eventName === "pull_request"
        ? {
            number: 42,
            pull_request: { base: { sha: targetBase }, head: { sha: fhead() } },
          }
        : { merge_group: { base_sha: targetBase, head_sha: candidate } });
    writeFileSync(resolve(cwd, "event.json"), JSON.stringify(eventValue));
    const preload = resolve(cwd, "github-fixture.mjs");
    writeFileSync(
      preload,
      `const routes = ${JSON.stringify(responseRoutes)};
      globalThis.fetch = async (url, options) => {
        if (options.method || !url.startsWith('https://api.github.com/repos/sachkov-inside/platform/')) throw new Error('Unexpected API call');
        const path = url.split('/platform/')[1];
        const route = routes[path];
        const value = route?.$responses ? (route.$responses.length > 1 ? route.$responses.shift() : route.$responses[0]) : route;
        return { ok: value !== undefined, status: value === undefined ? 404 : 200, json: async () => value };
      };`,
    );
    return spawnSync(process.execPath, ["--import", preload, cli, "verify"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: resolve(cwd, "event.json"),
        GITHUB_REPOSITORY: body.repository,
        GITHUB_EVENT_NAME: eventName,
        REVIEW_CANDIDATE_SHA: candidate,
        GH_TOKEN: "test-read-token",
        GITHUB_STEP_SUMMARY: "",
      },
    });
  }
  return {
    cwd,
    git,
    base,
    head,
    body,
    pr,
    comment,
    routes,
    comments,
    check,
    /** @param {string} value */
    setCandidate(value) {
      candidate = value;
    },
    /** @param {string} value */
    setTargetBase(value) {
      targetBase = value;
      pr.base.sha = value;
    },
    publish() {
      comment.body = `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(body)}`;
    },
  };
}

test("CLI verifies authenticated external receipts against real PR and synthetic queue histories", (t) => {
  const f = fixture(t);
  for (const eventName of ["pull_request", "merge_group"]) {
    const result = f.check({ eventName });
    assert.equal(result.status, 0, result.stderr);
    const report = z
      .object({
        status: z.string(),
        sources: z.array(
          z.object({ headSha: z.string(), commentId: z.number() }),
        ),
      })
      .parse(JSON.parse(result.stdout));
    assert.equal(report.status, "verified");
    assert.ok(report.sources[0]);
    assert.equal(report.sources[0].headSha, f.head);
    assert.equal(report.sources[0].commentId, 123);
  }
});

test("CLI rejects missing, stale, duplicate, incomplete and blocking review evidence", (t) => {
  const f = fixture(t);
  const commentsPath = "issues/42/comments?per_page=100&page=1";
  for (const comments of [
    [],
    [f.comment, f.comment],
    [{ ...f.comment, body: "<!-- platform-review-evidence:v1 -->\n{" }],
  ]) {
    const result = f.check({
      responseRoutes: { ...f.routes, [commentsPath]: comments },
    });
    assert.equal(result.status, 1, result.stdout);
  }
  /** @type {Array<(r: ReturnType<typeof receipt>) => void>} */
  const mutations = [
    (r) => {
      r.headSha = "c".repeat(40);
    },
    (r) => {
      r.baseSha = "c".repeat(40);
    },
    (r) => {
      r.reviews.pop();
    },
    (r) => {
      r.reviews[1].role = "Standards";
    },
    (r) => {
      r.reviews[1].agentId = r.reviews[0].agentId;
    },
    (r) => {
      r.reviews[0].agentId = r.implementer.agentId;
    },
    (r) => {
      r.reviews[1].transcript = r.reviews[0].transcript;
    },
    (r) => {
      r.reviews[0].outcome = "in-progress";
    },
    (r) => {
      r.reviews[0].findingsComplete = false;
    },
    (r) => {
      r.reviews[0].findings.push({
        id: "B1",
        severity: "blocking",
        disposition: "deferred",
        reason: "later",
        evidence: "native:report",
      });
    },
    (r) => {
      r.reviews[0].findings.push({
        id: "B1",
        severity: "blocking",
        disposition: "fixed",
      });
    },
    (r) => {
      r.task = "https://github.com/sachkov-inside/platform/issues/999";
    },
    (r) => {
      r.reviews[0].extra = true;
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(f.body);
    mutate(value);
    const result = f.check({
      responseRoutes: {
        ...f.routes,
        [commentsPath]: [
          {
            ...f.comment,
            body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(value)}`,
          },
        ],
      },
    });
    assert.equal(result.status, 1, JSON.stringify(value));
  }
});

test("CLI accepts complete dispositions and retained historical receipts", (t) => {
  const f = fixture(t);
  f.body.reviews[0].findings.push({
    id: "B1",
    severity: "blocking",
    disposition: "fixed",
    reason: "corrected in reviewed head",
    evidence: "native:standards:followup",
  });
  f.publish();
  const old = structuredClone(f.body);
  old.headSha = "d".repeat(40);
  f.comments.push({
    ...f.comment,
    id: 122,
    body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(old)}`,
  });
  assert.equal(f.check().status, 0);
});

test("outsiders cannot forge a receipt or deny service by posting malformed review markers", (t) => {
  const f = fixture(t);
  f.comments.push({
    ...f.comment,
    author_association: "NONE",
    user: { login: "outsider" },
    body: "<!-- platform-review-evidence:v1 -->\n{",
  });
  const result = f.check();
  assert.equal(result.status, 0, result.stderr);
});

test("CLI rejects API failures, revoked publishers, unrelated sources and modified synthetic trees", (t) => {
  const f = fixture(t);
  for (const responseRoutes of [
    { ...f.routes, "pulls/42": undefined },
    {
      ...f.routes,
      "collaborators/publisher/permission": { permission: "read" },
    },
    {
      ...f.routes,
      "pulls/42": { ...f.pr, base: { ...f.pr.base, sha: "f".repeat(40) } },
    },
    { ...f.routes, [`commits/${f.head}/pulls?per_page=100&page=1`]: [] },
  ]) {
    assert.equal(
      f.check({ eventName: "merge_group", responseRoutes }).status,
      1,
    );
  }
  writeFileSync(resolve(f.cwd, "feature"), "unreviewed merge resolution");
  f.git("add", ".");
  f.git("commit", "--amend", "--no-edit");
  f.setCandidate(f.git("rev-parse", "HEAD"));
  const result = f.check({ eventName: "merge_group" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Synthetic merge differs/u);
});

test("CLI paginates comment and queue associations instead of trusting the first matching receipt", (t) => {
  const f = fixture(t);
  const irrelevant = { body: "ordinary discussion" };
  f.routes["issues/42/comments?per_page=100&page=1"] = Array.from(
    { length: 100 },
    () => irrelevant,
  );
  const secondPage = [f.comment];
  f.routes["issues/42/comments?per_page=100&page=2"] = secondPage;
  f.routes[`commits/${f.head}/pulls?per_page=100&page=1`] = Array.from(
    { length: 100 },
    () => ({ state: "closed" }),
  );
  f.routes[`commits/${f.head}/pulls?per_page=100&page=2`] = [
    { number: 42, state: "open" },
  ];
  assert.equal(f.check({ eventName: "merge_group" }).status, 0);
  secondPage.push(f.comment);
  assert.equal(f.check({ eventName: "merge_group" }).status, 1);
});

test("CLI verifies every reviewed source in a multi-PR queue", (t) => {
  const f = fixture(t);
  f.git("checkout", "-b", "second", f.base);
  writeFileSync(resolve(f.cwd, "second"), "second reviewed source");
  f.git("add", "second");
  f.git("commit", "-m", "second source");
  const second = f.git("rev-parse", "HEAD");
  f.git("checkout", "main");
  f.git("merge", "--no-ff", "second", "-m", "second synthetic");
  f.setCandidate(f.git("rev-parse", "HEAD"));
  const secondReceipt = structuredClone(f.body);
  secondReceipt.pullRequest = 43;
  secondReceipt.headSha = second;
  f.routes["pulls/43"] = { ...f.pr, number: 43, head: { sha: second } };
  f.routes[`commits/${second}/pulls?per_page=100&page=1`] = [
    { number: 43, state: "open" },
  ];
  const secondComment = {
    ...f.comment,
    id: 124,
    body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(secondReceipt)}`,
  };
  f.routes["issues/43/comments?per_page=100&page=1"] = [secondComment];
  f.routes["issues/comments/124"] = secondComment;
  const result = f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    z.object({ sources: z.array(z.unknown()) }).parse(JSON.parse(result.stdout))
      .sources.length,
    2,
  );
  f.routes["issues/43/comments?per_page=100&page=1"] = [];
  assert.equal(f.check({ eventName: "merge_group" }).status, 1);
});

test("unrelated main advance retains exact comparison inputs but changed merge-base/head invalidates review", (t) => {
  const f = fixture(t);
  f.git("checkout", "-b", "advanced-main", f.base);
  writeFileSync(resolve(f.cwd, "main-advance"), "unrelated target change");
  f.git("add", "main-advance");
  f.git("commit", "-m", "advance main");
  const target = f.git("rev-parse", "HEAD");
  f.git("merge", "--no-ff", "feature", "-m", "new synthetic");
  f.setCandidate(f.git("rev-parse", "HEAD"));
  f.setTargetBase(target);
  assert.equal(f.check().status, 0);
  assert.equal(f.check({ eventName: "merge_group" }).status, 0);
  // Updating the actual branch head requires new review, including an otherwise
  // innocuous merge of main into that branch.
  f.git("checkout", "feature");
  f.git("merge", "--no-ff", target, "-m", "update branch");
  f.pr.head.sha = f.git("rev-parse", "HEAD");
  f.setCandidate(f.pr.head.sha);
  assert.equal(f.check().status, 1);
  f.body.headSha = f.pr.head.sha;
  f.publish();
  assert.equal(
    f.check().status,
    1,
    "old comparison base must not match a changed merge base",
  );
  f.body.baseSha = target;
  f.publish();
  assert.equal(f.check().status, 0);
});

test("task scope edits invalidate receipts while labels and comments leave the task digest unchanged", (t) => {
  const f = fixture(t);
  f.routes["issues/1856"] = {
    ...task,
    labels: ["ready-for-agent"],
    comments: 5,
  };
  assert.equal(f.check().status, 0);
  for (const change of [
    { title: "Different task" },
    { body: "Changed acceptance criteria" },
    { pull_request: { url: "PR" } },
  ]) {
    f.routes["issues/1856"] = { ...task, ...change };
    assert.equal(f.check().status, 1);
  }
  const digest = run(["task-digest"], { ...task, labels: ["other"] });
  assert.equal(digest.status, 0, digest.stderr);
  assert.equal(digest.stdout.trim(), taskSha256);
});

test("draft lifecycle does not require a new head to record applicable review", (t) => {
  const f = fixture(t);
  f.pr.draft = true;
  assert.equal(f.check().status, 0);
});

test("renderer rejects malformed structures and duplicate identities before publication", () => {
  const valid = receipt();
  for (const value of [
    null,
    [],
    {},
    { ...valid, reviews: null },
    { ...valid, implementer: null },
    { ...valid, taskSha256: "wrong" },
    {
      ...valid,
      reviews: [valid.reviews[0], { ...valid.reviews[1], agentId: " author " }],
    },
  ]) {
    const result = run(["render"], value);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});

test("CLI fails if PR, task or receipt changes during verification", (t) => {
  const f = fixture(t);
  const changes = [
    ["pulls/42", { ...f.pr, head: { sha: "e".repeat(40) } }],
    ["issues/1856", { ...task, body: "updated while verifying" }],
    ["issues/comments/123", { ...f.comment, body: "edited receipt" }],
  ];
  for (const [path, changed] of changes) {
    const original = f.routes[String(path)];
    const route =
      path === "issues/comments/123"
        ? changed
        : { $responses: [original, changed] };
    assert.equal(
      f.check({ responseRoutes: { ...f.routes, [String(path)]: route } })
        .status,
      1,
    );
  }
});
