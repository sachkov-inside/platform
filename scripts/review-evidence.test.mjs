// @ts-check
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { runReviewProcess } from "./review-evidence.test-support.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";

const cli = fileURLToPath(new URL("./review-evidence.mjs", import.meta.url));
/** @param {string[]} args @param {unknown} input */
async function run(args, input) {
  return runReviewProcess(process.execPath, [cli, ...args], {
    input: JSON.stringify(input),
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

test("publisher renders a review receipt without committing evidence into the reviewed head", async () => {
  const result = await run(["render"], receipt());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<!-- platform-review-evidence:v1 -->\n/u);
  assert.deepEqual(
    JSON.parse(result.stdout.split("\n").slice(1).join("\n")),
    receipt(),
  );
});

/** @param {number} number @param {string} base @param {string} candidate @param {string} source */
function queueEntry(number, base, candidate, source) {
  return {
    id: `MQE_${number}`,
    baseCommit: { oid: base },
    headCommit: { oid: candidate },
    pullRequest: { number, headRefOid: source, state: "OPEN" },
  };
}
/** @param {unknown[]} nodes @param {boolean} [hasNextPage] @param {string | null} [endCursor] */
function queuePage(nodes, hasNextPage = false, endCursor = null) {
  return {
    data: {
      repository: {
        mergeQueue: {
          entries: { nodes, pageInfo: { hasNextPage, endCursor } },
        },
      },
    },
  };
}

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-evidence-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {...string} args */
  async function git(...args) {
    const result = await runReviewProcess("git", args, { cwd });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  await git("init", "-b", "main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  writeFileSync(resolve(cwd, "base"), "base");
  await git("add", ".");
  await git("commit", "-m", "base");
  const base = await git("rev-parse", "HEAD");
  let targetBase = base;
  await git("checkout", "-b", "feature");
  writeFileSync(resolve(cwd, "feature"), "reviewed");
  await git("add", ".");
  await git("commit", "-m", "feature");
  const head = await git("rev-parse", "HEAD");
  await git("checkout", "main");
  // Force a synthetic merge even when main has not advanced.
  await git("merge", "--no-ff", "feature", "-m", "synthetic");
  let candidate = await git("rev-parse", "HEAD");
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
    "graphql:": queuePage([]),
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
  async function check({
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
        let path;
        if (url === 'https://api.github.com/graphql') {
          const body = JSON.parse(options.body);
          if (options.method !== 'POST' || !body.query.startsWith('query ReviewQueue(') || body.query.includes('mutation') || body.variables.owner !== 'sachkov-inside' || body.variables.name !== 'platform') throw new Error('Unexpected GraphQL operation');
          path = 'graphql:' + (body.variables.after ?? '');
        } else {
          if (options.method || !url.startsWith('https://api.github.com/repos/sachkov-inside/platform/')) throw new Error('Unexpected API call');
          path = url.split('/platform/')[1];
        }
        const route = routes[path];
        const value = route?.$responses ? (route.$responses.length > 1 ? route.$responses.shift() : route.$responses[0]) : route;
        return { ok: value !== undefined, status: value === undefined ? 404 : 200, json: async () => value };
      };`,
    );
    return runReviewProcess(
      process.execPath,
      ["--import", preload, cli, "verify"],
      {
        cwd,
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: resolve(cwd, "event.json"),
          GITHUB_REPOSITORY: body.repository,
          GITHUB_EVENT_NAME: eventName,
          REVIEW_CANDIDATE_SHA: candidate,
          GH_TOKEN: "test-read-token",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    );
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

test("CLI verifies authenticated external receipts against real PR and synthetic queue histories", async (t) => {
  const f = await fixture(t);
  for (const eventName of ["pull_request", "merge_group"]) {
    const result = await f.check({ eventName });
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

/** @param {import("node:test").TestContext} t */
async function squashFixture(t) {
  const f = await fixture(t);
  await f.git("checkout", "-b", "squash-queue", f.base);
  await f.git("merge", "--squash", "feature");
  await f.git("commit", "-m", "queue squash");
  const candidate = await f.git("rev-parse", "HEAD");
  f.setCandidate(candidate);
  f.routes[`commits/${candidate}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  f.routes["graphql:"] = queuePage([queueEntry(42, f.base, candidate, f.head)]);
  return { ...f, candidate };
}

test("CLI verifies a queue-bound squash whose reviewed head is not a candidate ancestor", async (t) => {
  const f = await squashFixture(t);
  const candidate = f.candidate;
  assert.notEqual(candidate, f.head);
  assert.equal(await f.git("merge-base", candidate, f.head), f.base);
  assert.equal(
    (await f.git("rev-list", "--parents", "-n", "1", candidate)).split(" ")
      .length,
    2,
  );
  const result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    z
      .object({ sources: z.array(z.object({ headSha: z.string() })) })
      .parse(JSON.parse(result.stdout)).sources[0]?.headSha,
    f.head,
  );
});

test("SEC-1856-1 rejects a stale receipt after current main enters the source history", async (t) => {
  const f = await fixture(t);
  await f.git("checkout", "feature");
  const prefix = f.head;
  writeFileSync(resolve(f.cwd, "after-prefix"), "reviewed after prefix");
  await f.git("add", "after-prefix");
  await f.git("commit", "-m", "source after prefix");
  const head = await f.git("rev-parse", "HEAD");
  f.pr.head.sha = head;
  f.pr.base.sha = prefix;
  f.body.headSha = head;
  f.publish();
  await f.git("checkout", "-b", "queue-after-prefix", prefix);
  await f.git("merge", "--squash", "feature");
  await f.git("commit", "-m", "queue after current main prefix");
  const candidate = await f.git("rev-parse", "HEAD");
  f.setCandidate(candidate);
  f.routes[`commits/${candidate}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  f.routes["graphql:"] = queuePage([queueEntry(42, prefix, candidate, head)]);
  const stale = await f.check({ eventName: "merge_group" });
  assert.equal(
    stale.status,
    1,
    "receipt B/H must not cover current comparison X/H",
  );
  assert.match(stale.stderr, /Missing or duplicate current review receipt/u);
  f.body.baseSha = prefix;
  f.publish();
  const current = await f.check({ eventName: "merge_group" });
  assert.equal(current.status, 0, current.stderr);
});

test("open squash verification requires current provider queue metadata", async (t) => {
  const f = await squashFixture(t);
  for (const responseRoutes of [
    { ...f.routes, "graphql:": queuePage([]) },
    {
      ...f.routes,
      "graphql:": queuePage([queueEntry(42, f.base, f.head, f.head)]),
    },
    {
      ...f.routes,
      "graphql:": queuePage([queueEntry(42, f.base, f.candidate, f.base)]),
    },
    {
      ...f.routes,
      "graphql:": { $responses: [f.routes["graphql:"], queuePage([])] },
    },
    {
      ...f.routes,
      "graphql:": {
        $responses: [
          f.routes["graphql:"],
          queuePage([queueEntry(42, f.base, f.head, f.head)]),
        ],
      },
    },
    {
      ...f.routes,
      "graphql:": { data: null, errors: [{ message: "query failed" }] },
    },
  ])
    assert.equal(
      (await f.check({ eventName: "merge_group", responseRoutes })).status,
      1,
    );
  // A native generated squash has no proven premerge REST association. Queue
  // headCommit -> PR metadata supplies that binding directly.
  const noRest = await f.check({
    eventName: "merge_group",
    responseRoutes: {
      ...f.routes,
      [`commits/${f.candidate}/pulls?per_page=100&page=1`]: [],
    },
  });
  assert.equal(noRest.status, 0, noRest.stderr);
});

test("queue metadata reads every page and rejects incomplete or changed entries", async (t) => {
  const f = await squashFixture(t);
  const entry = queueEntry(42, f.base, f.candidate, f.head);
  const pending = Array.from({ length: 100 }, (_, index) => ({
    ...queueEntry(1000 + index, f.base, f.base, f.base),
    baseCommit: null,
    headCommit: null,
  }));
  const responseRoutes = {
    ...f.routes,
    "graphql:": queuePage(pending, true, "next-page"),
    "graphql:next-page": queuePage([entry]),
  };
  const complete = await f.check({ eventName: "merge_group", responseRoutes });
  assert.equal(complete.status, 0, complete.stderr);
  for (const routes of [
    { ...responseRoutes, "graphql:next-page": undefined },
    {
      ...responseRoutes,
      "graphql:next-page": queuePage([], true, "next-page"),
    },
    { ...f.routes, "graphql:": { data: { repository: { mergeQueue: null } } } },
    { ...f.routes, "graphql:": queuePage([entry, entry]) },
    {
      ...f.routes,
      "graphql:": queuePage([{ ...entry, headCommit: { oid: "not-a-sha" } }]),
    },
    {
      ...f.routes,
      "graphql:": queuePage([
        { ...entry, pullRequest: { ...entry.pullRequest, state: "CLOSED" } },
      ]),
    },
    {
      ...f.routes,
      "graphql:": {
        $responses: [
          queuePage([entry]),
          queuePage([{ ...entry, id: "replacement-entry" }]),
        ],
      },
    },
    {
      ...f.routes,
      "graphql:": {
        $responses: [
          queuePage([entry]),
          queuePage([{ ...entry, baseCommit: { oid: f.head } }]),
        ],
      },
    },
  ])
    assert.equal(
      (await f.check({ eventName: "merge_group", responseRoutes: routes }))
        .status,
      1,
    );
});

test("CLI rejects squash tree matches without exact authenticated provenance", async (t) => {
  const f = await squashFixture(t);
  const path = `commits/${f.candidate}/pulls?per_page=100&page=1`;
  for (const responseRoutes of [
    { ...f.routes, "graphql:": queuePage([]) },
    {
      ...f.routes,
      [path]: [],
      "graphql:": queuePage([queueEntry(43, f.base, f.candidate, f.base)]),
      "pulls/43": { ...f.pr, number: 43, head: { sha: f.base } },
    },
    { ...f.routes, "pulls/42": { ...f.pr, number: 43 } },
    {
      ...f.routes,
      "pulls/42": { ...f.pr, base: { ...f.pr.base, ref: "other" } },
    },
    {
      ...f.routes,
      "pulls/42": {
        ...f.pr,
        state: "closed",
        merged: false,
        merge_commit_sha: f.candidate,
      },
    },
    {
      ...f.routes,
      "pulls/42": {
        ...f.pr,
        state: "closed",
        merged: true,
        merge_commit_sha: f.candidate,
      },
      "git/ref/heads/main": {
        ref: "refs/heads/main",
        object: { type: "commit", sha: f.base },
      },
    },
  ])
    assert.equal(
      (await f.check({ eventName: "merge_group", responseRoutes })).status,
      1,
    );
  writeFileSync(resolve(f.cwd, "unreviewed"), "unknown transition");
  await f.git("add", "unreviewed");
  await f.git("commit", "-m", "unknown after squash");
  const unknown = await f.git("rev-parse", "HEAD");
  f.setCandidate(unknown);
  f.routes["graphql:"] = queuePage([queueEntry(42, f.base, unknown, f.head)]);
  f.routes[`commits/${unknown}/pulls?per_page=100&page=1`] = [];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
});

test("CLI rejects ambiguous squash associations and source reuse", async (t) => {
  const f = await squashFixture(t);
  const duplicateReceipt = { ...f.body, pullRequest: 43 };
  const duplicate = {
    ...f.comment,
    id: 124,
    body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(duplicateReceipt)}`,
  };
  f.routes["pulls/43"] = { ...f.pr, number: 43 };
  f.routes["issues/43/comments?per_page=100&page=1"] = [duplicate];
  f.routes["issues/comments/124"] = duplicate;
  f.routes[`commits/${f.candidate}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
    { number: 43, state: "open" },
  ];
  f.routes["graphql:"] = queuePage([
    queueEntry(42, f.base, f.candidate, f.head),
    queueEntry(43, f.base, f.candidate, f.head),
  ]);
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
  // An extra no-op commit with the same tree is not another authorized squash.
  const tree = await f.git("rev-parse", `${f.candidate}^{tree}`);
  const duplicateCommit = await f.git(
    "commit-tree",
    tree,
    "-p",
    f.candidate,
    "-m",
    "repeat source",
  );
  await f.git("checkout", "--detach", duplicateCommit);
  f.setCandidate(duplicateCommit);
  f.routes["graphql:"] = queuePage([
    queueEntry(42, f.candidate, duplicateCommit, f.head),
  ]);
  f.routes[`commits/${duplicateCommit}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  f.routes[`commits/${f.candidate}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
});

test("CLI rejects forged squash trees, conflicting sources and unsupported parent topology", async (t) => {
  const f = await squashFixture(t);
  writeFileSync(resolve(f.cwd, "feature"), "forged resolution");
  await f.git("add", "feature");
  await f.git("commit", "--amend", "--no-edit");
  const forged = await f.git("rev-parse", "HEAD");
  f.setCandidate(forged);
  f.routes["graphql:"] = queuePage([queueEntry(42, f.base, forged, f.head)]);
  f.routes[`commits/${forged}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
  // The target independently adds the same path. A hand-resolved queue tree
  // must not turn a merge-tree conflict into an accepted reviewed transition.
  await f.git("checkout", "-b", "conflicting-main", f.base);
  writeFileSync(resolve(f.cwd, "feature"), "conflicting target");
  await f.git("add", "feature");
  await f.git("commit", "-m", "conflicting target");
  const target = await f.git("rev-parse", "HEAD");
  const tree = await f.git("rev-parse", `${f.candidate}^{tree}`);
  const conflict = await f.git(
    "commit-tree",
    tree,
    "-p",
    target,
    "-m",
    "hand resolved squash",
  );
  await f.git("checkout", "--detach", conflict);
  f.setCandidate(conflict);
  f.setTargetBase(target);
  f.routes["graphql:"] = queuePage([queueEntry(42, target, conflict, f.head)]);
  f.routes[`commits/${conflict}/pulls?per_page=100&page=1`] = [
    { number: 42, state: "open" },
  ];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
  const octopus = await f.git(
    "commit-tree",
    tree,
    "-p",
    f.base,
    "-p",
    f.head,
    "-p",
    forged,
    "-m",
    "unsupported octopus",
  );
  await f.git("checkout", "--detach", octopus);
  f.setCandidate(octopus);
  f.setTargetBase(f.base);
  f.routes["graphql:"] = queuePage([queueEntry(42, f.base, octopus, f.head)]);
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
});

/** @param {Awaited<ReturnType<typeof squashFixture>>} f */
async function addSecondSquash(f) {
  await f.git("checkout", "-b", "independent-second", f.base);
  writeFileSync(resolve(f.cwd, "second"), "second reviewed source");
  await f.git("add", "second");
  await f.git("commit", "-m", "independent second source");
  const second = await f.git("rev-parse", "HEAD");
  await f.git("checkout", "squash-queue");
  await f.git("merge", "--squash", second);
  await f.git("commit", "-m", "second queue squash");
  const candidate = await f.git("rev-parse", "HEAD");
  f.setCandidate(candidate);
  const secondReceipt = { ...f.body, pullRequest: 43, headSha: second };
  const secondPr = { ...f.pr, number: 43, head: { sha: second } };
  f.routes["pulls/43"] = secondPr;
  f.routes[`commits/${candidate}/pulls?per_page=100&page=1`] = [
    { number: 43, state: "open" },
  ];
  const comment = {
    ...f.comment,
    id: 124,
    body: `<!-- platform-review-evidence:v1 -->\n${JSON.stringify(secondReceipt)}`,
  };
  f.routes["issues/43/comments?per_page=100&page=1"] = [comment];
  f.routes["issues/comments/124"] = comment;
  f.routes["graphql:"] = queuePage([
    queueEntry(42, f.base, f.candidate, f.head),
    queueEntry(43, f.candidate, candidate, second),
  ]);
  return { secondPr, candidate };
}

test("CLI accounts for independent squash sources and a merged prefix while main advances", async (t) => {
  const f = await squashFixture(t);
  const { secondPr, candidate } = await addSecondSquash(f);
  let result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    z.object({ sources: z.array(z.unknown()) }).parse(JSON.parse(result.stdout))
      .sources.length,
    2,
  );
  assert.equal(
    (
      await f.check({
        eventName: "merge_group",
        responseRoutes: {
          ...f.routes,
          "issues/43/comments?per_page=100&page=1": [],
        },
      })
    ).status,
    1,
  );
  // Native queues can retain a preceding PR after it has merged, with the next
  // PR now targeting that newer authoritative main snapshot.
  f.routes["pulls/42"] = {
    ...f.pr,
    state: "closed",
    merged: true,
    merge_commit_sha: f.candidate,
  };
  f.routes["git/ref/heads/main"] = {
    ref: "refs/heads/main",
    object: { type: "commit", sha: f.candidate },
  };
  secondPr.base = { ...secondPr.base, sha: f.candidate };
  f.routes["graphql:"] = queuePage([
    queueEntry(43, f.candidate, candidate, secondPr.head.sha),
  ]);
  result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  // A later event can start at the merged prefix. Only the independent open
  // source then lies outside the trusted event base.
  f.setTargetBase(f.candidate);
  result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    z.object({ sources: z.array(z.unknown()) }).parse(JSON.parse(result.stdout))
      .sources.length,
    1,
  );
  f.setTargetBase(f.base);
  // Provider association plus merged status is insufficient without main membership.
  f.routes["git/ref/heads/main"] = {
    ref: "refs/heads/main",
    object: { type: "commit", sha: f.base },
  };
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
  f.routes["git/ref/heads/main"] = {
    ref: "refs/heads/main",
    object: { type: "commit", sha: f.candidate },
  };
  f.routes["pulls/43"] = {
    ...secondPr,
    state: "closed",
    merged: true,
    merge_commit_sha: candidate,
  };
  f.routes["git/ref/heads/main"] = {
    ref: "refs/heads/main",
    object: { type: "commit", sha: candidate },
  };
  assert.equal(
    (await f.check({ eventName: "merge_group" })).status,
    1,
    "a current queue still needs an open source",
  );
});

test("squash verification invalidates stale PR, task and comment snapshots", async (t) => {
  const f = await squashFixture(t);
  for (const [path, changed] of [
    ["pulls/42", { ...f.pr, head: { sha: f.base } }],
    ["pulls/42", { ...f.pr, body: `${f.pr.body} changed scope` }],
    ["issues/1856", { ...task, title: "changed scope" }],
    ["issues/comments/123", { ...f.comment, body: "changed review" }],
  ]) {
    const original = f.routes[String(path)];
    const value =
      path === "issues/comments/123"
        ? changed
        : { $responses: [original, changed] };
    assert.equal(
      (
        await f.check({
          eventName: "merge_group",
          responseRoutes: { ...f.routes, [String(path)]: value },
        })
      ).status,
      1,
    );
  }
});

test("CLI rejects missing, stale, duplicate, incomplete and blocking review evidence", async (t) => {
  const f = await fixture(t);
  const commentsPath = "issues/42/comments?per_page=100&page=1";
  for (const comments of [
    [],
    [f.comment, f.comment],
    [{ ...f.comment, body: "<!-- platform-review-evidence:v1 -->\n{" }],
  ]) {
    const result = await f.check({
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
    const result = await f.check({
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

test("CLI accepts complete dispositions and retained historical receipts", async (t) => {
  const f = await fixture(t);
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
  assert.equal((await f.check()).status, 0);
});

test("outsiders cannot forge a receipt or deny service by posting malformed review markers", async (t) => {
  const f = await fixture(t);
  f.comments.push({
    ...f.comment,
    author_association: "NONE",
    user: { login: "outsider" },
    body: "<!-- platform-review-evidence:v1 -->\n{",
  });
  const result = await f.check();
  assert.equal(result.status, 0, result.stderr);
});

test("CLI rejects API failures, revoked publishers, unrelated sources and modified synthetic trees", async (t) => {
  const f = await fixture(t);
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
      (await f.check({ eventName: "merge_group", responseRoutes })).status,
      1,
    );
  }
  writeFileSync(resolve(f.cwd, "feature"), "unreviewed merge resolution");
  await f.git("add", ".");
  await f.git("commit", "--amend", "--no-edit");
  f.setCandidate(await f.git("rev-parse", "HEAD"));
  const result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Synthetic merge differs/u);
});

test("CLI paginates comment and queue associations instead of trusting the first matching receipt", async (t) => {
  const f = await fixture(t);
  const irrelevant = { body: "ordinary discussion" };
  f.routes["issues/42/comments?per_page=100&page=1"] = Array.from(
    { length: 100 },
    () => irrelevant,
  );
  const secondPage = [f.comment];
  f.routes["issues/42/comments?per_page=100&page=2"] = secondPage;
  f.routes[`commits/${f.head}/pulls?per_page=100&page=1`] = Array.from(
    { length: 100 },
    () => ({ number: 42, state: "open" }),
  );
  f.routes[`commits/${f.head}/pulls?per_page=100&page=2`] = [
    { number: 42, state: "open" },
  ];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 0);
  secondPage.push(f.comment);
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
});

test("CLI verifies every reviewed source in a multi-PR queue", async (t) => {
  const f = await fixture(t);
  await f.git("checkout", "-b", "second", f.base);
  writeFileSync(resolve(f.cwd, "second"), "second reviewed source");
  await f.git("add", "second");
  await f.git("commit", "-m", "second source");
  const second = await f.git("rev-parse", "HEAD");
  await f.git("checkout", "main");
  await f.git("merge", "--no-ff", "second", "-m", "second synthetic");
  f.setCandidate(await f.git("rev-parse", "HEAD"));
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
  const result = await f.check({ eventName: "merge_group" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    z.object({ sources: z.array(z.unknown()) }).parse(JSON.parse(result.stdout))
      .sources.length,
    2,
  );
  f.routes["issues/43/comments?per_page=100&page=1"] = [];
  assert.equal((await f.check({ eventName: "merge_group" })).status, 1);
});

test("unrelated main advance retains exact comparison inputs but changed merge-base/head invalidates review", async (t) => {
  const f = await fixture(t);
  await f.git("checkout", "-b", "advanced-main", f.base);
  writeFileSync(resolve(f.cwd, "main-advance"), "unrelated target change");
  await f.git("add", "main-advance");
  await f.git("commit", "-m", "advance main");
  const target = await f.git("rev-parse", "HEAD");
  await f.git("merge", "--no-ff", "feature", "-m", "new synthetic");
  f.setCandidate(await f.git("rev-parse", "HEAD"));
  f.setTargetBase(target);
  assert.equal((await f.check()).status, 0);
  assert.equal((await f.check({ eventName: "merge_group" })).status, 0);
  // Updating the actual branch head requires new review, including an otherwise
  // innocuous merge of main into that branch.
  await f.git("checkout", "feature");
  await f.git("merge", "--no-ff", target, "-m", "update branch");
  f.pr.head.sha = await f.git("rev-parse", "HEAD");
  f.setCandidate(f.pr.head.sha);
  assert.equal((await f.check()).status, 1);
  f.body.headSha = f.pr.head.sha;
  f.publish();
  assert.equal(
    (await f.check()).status,
    1,
    "old comparison base must not match a changed merge base",
  );
  f.body.baseSha = target;
  f.publish();
  assert.equal((await f.check()).status, 0);
});

test("task scope edits invalidate receipts while labels and comments leave the task digest unchanged", async (t) => {
  const f = await fixture(t);
  f.routes["issues/1856"] = {
    ...task,
    labels: ["ready-for-agent"],
    comments: 5,
  };
  assert.equal((await f.check()).status, 0);
  for (const change of [
    { title: "Different task" },
    { body: "Changed acceptance criteria" },
    { pull_request: { url: "PR" } },
  ]) {
    f.routes["issues/1856"] = { ...task, ...change };
    assert.equal((await f.check()).status, 1);
  }
  const digest = await run(["task-digest"], { ...task, labels: ["other"] });
  assert.equal(digest.status, 0, digest.stderr);
  assert.equal(digest.stdout.trim(), taskSha256);
});

test("draft lifecycle does not require a new head to record applicable review", async (t) => {
  const f = await fixture(t);
  f.pr.draft = true;
  assert.equal((await f.check()).status, 0);
});

test("renderer rejects malformed structures and duplicate identities before publication", async () => {
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
    const result = await run(["render"], value);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});

test("CLI fails if PR, task or receipt changes during verification", async (t) => {
  const f = await fixture(t);
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
      (
        await f.check({
          responseRoutes: { ...f.routes, [String(path)]: route },
        })
      ).status,
      1,
    );
  }
});
