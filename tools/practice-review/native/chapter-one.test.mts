import { watch, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessReport,
  assessSavedSubmission,
  chapterSnapshotSchema,
  unconsentedReviewCommands,
} from "./chapter-one/contracts.mjs";
// deterministic-test-allow unit-io: owned loopback relay contract; test cleanup closes both servers.
import { createServer } from "node:http";
import { startRelay } from "./chapter-one/relay.mjs";
import { command } from "./chapter-one/process.mjs";

void test("chapter lab refuses a snapshot that substitutes a legacy task", () => {
  assert.equal(chapterSnapshotSchema.safeParse({ tasks: [] }).success, false);
});

void test("a confident report cannot pass with missing criteria or a known defect", () => {
  const expected = { brief: ["confirmed"], repository: ["not_verified"] };
  assert.deepEqual(
    assessReport(
      {
        criteria: [
          {
            criterionId: "brief",
            status: "confirmed",
            evidence: "docs/brief.md",
            gap: "",
            obtainedByRun: false,
          },
        ],
      },
      expected,
    ),
    ["missing:repository"],
  );
  assert.deepEqual(
    assessReport(
      {
        criteria: [
          {
            criterionId: "brief",
            status: "confirmed",
            evidence: "docs/brief.md",
            gap: "",
            obtainedByRun: false,
          },
          {
            criterionId: "repository",
            status: "confirmed",
            evidence: "remote",
            gap: "",
            obtainedByRun: false,
          },
        ],
      },
      expected,
    ),
    ["status:repository:confirmed"],
  );
});

void test("not_verified needs a concrete gap and duplicated criteria cannot pass", () => {
  const criterion = {
    criterionId: "repository",
    status: "not_verified",
    evidence: "",
    gap: "",
    obtainedByRun: false,
  };
  assert.deepEqual(
    assessReport(
      { criteria: [criterion, criterion] },
      { repository: ["not_verified"] },
    ),
    ["gap:repository", "duplicate:repository", "gap:repository"],
  );
});

void test("the lab relay limits routes and models and never forwards the lab capability upstream", async (t) => {
  const observed: {
    path: string | undefined;
    authorization: string | undefined;
  }[] = [];
  const upstream = createServer((request, response) => {
    observed.push({
      path: request.url,
      authorization: request.headers.authorization,
    });
    request.resume();
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ ok: true }));
  });
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address !== null && typeof address !== "string");
  const upstreamUrl = `http://127.0.0.1:${String(address.port)}`;
  const relay = await startRelay({
    capability: "lab-only",
    model: "test-model",
    mcpUrl: `${upstreamUrl}/mcp`,
    learnerToken: () => Promise.resolve("synthetic-learner"),
    provider: {
      url: `${upstreamUrl}/responses`,
      headers: () =>
        Promise.resolve({ authorization: "Bearer synthetic-provider" }),
    },
  });
  t.after(() => relay.close());
  const base = `http://127.0.0.1:${String(relay.port)}`;
  const post = (path: string, body: unknown, token = "lab-only") =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/v1/responses", { model: "test-model" }, "wrong")).status,
    401,
  );
  assert.equal((await post("/arbitrary", {})).status, 404);
  assert.equal(
    (await post("/v1/responses", { model: "different-model" })).status,
    400,
  );
  assert.deepEqual(observed, []);
  assert.deepEqual(
    await (await post("/v1/responses", { model: "test-model" })).json(),
    { ok: true },
  );
  assert.deepEqual(
    await (await post("/mcp/learning", { method: "tools/list" })).json(),
    { ok: true },
  );
  assert.deepEqual(observed, [
    { path: "/responses", authorization: "Bearer synthetic-provider" },
    { path: "/mcp", authorization: "Bearer synthetic-learner" },
  ]);
  assert.equal(
    JSON.stringify(relay.observations).includes("synthetic-provider"),
    false,
  );
  assert.equal(
    JSON.stringify(relay.observations).includes("synthetic-learner"),
    false,
  );
});

void test("owned command preserves failure status and rejects timeout", async () => {
  assert.equal(
    (
      await command(process.execPath, ["-e", "process.exit(7)"], {
        acceptFailure: true,
      })
    ).code,
    7,
  );
  await assert.rejects(
    command(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeoutMs: 50,
    }),
    /timeout/,
  );
});

void test("worktree inspection reads, but worktree creation and project execution require consent", () => {
  assert.deepEqual(
    unconsentedReviewCommands([
      "git worktree list --porcelain",
      "git ls-files --stage",
    ]),
    [],
  );
  assert.deepEqual(
    unconsentedReviewCommands([
      "git worktree add /tmp/new",
      "node scripts/check.mjs",
    ]),
    ["git worktree add /tmp/new", "node scripts/check.mjs"],
  );
});

void test("failed or mismatched receipt cannot borrow a previous matching report", () => {
  const confirmed = {
    code: "aie-ch1-harness",
    taskVersion: 2,
    note: "checked",
    serviceMark: {
      repositoryUrl: null,
      branch: "main",
      commit: null,
      uncommittedChanges: false,
    },
    reviewReport: {
      summary: "checked",
      criteria: [
        {
          criterionId: "brief",
          status: "not_verified" as const,
          evidence: "",
          gap: "remote absent",
          obtainedByRun: false,
        },
      ],
    },
  };
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const receipt = {
    ok: true,
    value: { submissionId: id, code: confirmed.code, taskVersion: 2 },
  };
  const history = {
    ok: true,
    value: { submissions: [{ ...confirmed, submissionId: id }] },
  };
  assert.deepEqual(assessSavedSubmission(confirmed, receipt, history), []);
  assert.notDeepEqual(
    assessSavedSubmission(
      confirmed,
      { ok: false, error: { code: "task_version_changed" } },
      history,
    ),
    [],
  );
  assert.notDeepEqual(
    assessSavedSubmission(
      confirmed,
      {
        ...receipt,
        value: {
          ...receipt.value,
          submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      },
      history,
    ),
    [],
  );
  assert.notDeepEqual(
    assessSavedSubmission(confirmed, receipt, {
      ok: true,
      value: {
        submissions: [
          {
            ...confirmed,
            submissionId: id,
            serviceMark: { ...confirmed.serviceMark, commit: "a".repeat(40) },
          },
        ],
      },
    }),
    [],
  );
});

void test("interruption and timeout reap a SIGTERM-ignoring descendant after its leader exits", async () => {
  for (const interruption of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), "inside-chapter-process-"));
    const ready = join(directory, "ready");
    const pending = join(directory, "pending");
    const controller = new AbortController();
    let descendant = 0;
    const watcher = watch(directory, (_event, filename) => {
      if (filename === "ready") {
        descendant = Number(readFileSync(ready, "utf8"));
        if (interruption) controller.abort();
      }
    });
    const childCode =
      "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)";
    const leaderCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>{fs.writeFileSync(${JSON.stringify(pending)},String(c.pid));fs.renameSync(${JSON.stringify(pending)},${JSON.stringify(ready)})});setInterval(()=>{},1000)`;
    try {
      await assert.rejects(
        command(process.execPath, ["-e", leaderCode], {
          signal: controller.signal,
          timeoutMs: interruption ? 15000 : 1500,
        }),
        interruption ? /interrupted/ : /timeout/,
      );
      assert.ok(descendant > 0);
      assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    } finally {
      watcher.close();
      if (descendant > 0) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {
          /* Already reaped. */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
});

void test("quoted search alternatives and readonly Git options stay reading; execution and redirection do not", () => {
  assert.deepEqual(
    unconsentedReviewCommands([
      `/bin/bash -c "rg -n 'DATABASE_URL|SELECT|Pool' apps; git --no-optional-locks status --porcelain=v1; rg --files | sort"`,
      `git config --local --get-regexp '^remote\\..*\\.url$'`,
    ]),
    [],
  );
  for (const command of [
    "cat AGENTS.md; node scripts/check.mjs",
    "cat AGENTS.md > /project/copy",
    "cat $(node scripts/check.mjs)",
    "git config --local user.name learner",
    "/project/cat AGENTS.md",
  ]) {
    assert.ok(unconsentedReviewCommands([command]).length > 0, command);
  }
});
