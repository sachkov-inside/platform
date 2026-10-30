// @ts-check
import { z } from "zod";
import { observations } from "./ci-stability-report.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const outputSchema = z.object({
  coverage: z.object({
    complete: z.boolean(),
    incomplete: z.array(z.string()),
    requests: z.number(),
    logBytes: z.number(),
    logBudgetBytesCharged: z.number(),
    logBudgetScope: z.string(),
  }),
  causes: z.array(
    z.object({
      identity: z.string(),
      test: z.object({
        file: z.string(),
        project: z.string(),
        name: z.string(),
        suite: z.string(),
      }),
      pullRequests: z.array(z.number()),
      priority: z.string(),
      firstFailure: z.object({
        run: z.number(),
        source: z.string(),
        name: z.string(),
      }),
      failures: z.array(z.object({ name: z.string() })),
      rechecks: z.array(
        z.object({
          run: z.number(),
          attempt: z.number(),
          source: z.string(),
          outcome: z.string(),
        }),
      ),
    }),
  ),
  jobs: z.array(
    z.object({
      durationSeconds: z.number().nullable(),
      classification: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});

/** Real CLI boundary; fake gh is the only external provider.
 * @param {string} root @param {string[]} [args]
 */
async function collect(root, args = []) {
  const child = spawnOwned(
    process.execPath,
    [
      "scripts/ci-stability-report.mjs",
      "sachkov-inside/platform",
      resolve(root, "report"),
      "--until=2026-10-30T00:00:00Z",
      ...args,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${root}:${process.env["PATH"]}`,
        STABILITY_FIXTURE: resolve(root, "responses.json"),
        STABILITY_CALLS: resolve(root, "calls.txt"),
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  // deterministic-test-allow duration-wait: bounds the real CLI contract; supervisor close, after whole-tree cleanup, is completion.
  const timeout = setTimeout(() => {
    void stopOwned(child, 100);
  }, 10000);
  try {
    /** @type {Promise<number | null>} */
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const status = await closed;
    return { status, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    await stopOwned(child, 100);
  }
}

/** @param {Record<string, unknown>} responses @param {string[]} [args] */
async function report(responses, args = []) {
  const root = mkdtempSync(resolve(tmpdir(), "ci-history-"));
  try {
    writeFileSync(resolve(root, "responses.json"), JSON.stringify(responses));
    const gh = resolve(root, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env node\nconst fs=require('node:fs');const p=process.argv.at(-1);fs.appendFileSync(process.env.STABILITY_CALLS,p+'\\n');if(process.argv.slice(2,5).join(' ')!=='api --method GET')process.exit(2);const data=JSON.parse(fs.readFileSync(process.env.STABILITY_FIXTURE,'utf8'));if(!(p in data)){console.error('missing fixture '+p);process.exit(1)}const v=data[p];const allow=process.argv.includes('--allow-escape-sequences');if(allow&&!p.endsWith('/logs'))process.exit(3);if(typeof v==='string'&&v.includes('\\x1b')&&!allow){console.error('the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway');process.exit(1)}process.stdout.write(v==='__OVERSIZED_LOG__'?'private failure payload '+ 'x'.repeat(1048576+65536):typeof v==='string'?v:JSON.stringify(v));`,
    );
    chmodSync(gh, 0o755);
    const result = await collect(root, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const history = readFileSync(resolve(root, "report/history.json"), "utf8");
    return {
      ...outputSchema.parse(JSON.parse(history)),
      history,
      summary: readFileSync(resolve(root, "report/summary.md"), "utf8"),
      apiReads: readFileSync(resolve(root, "calls.txt"), "utf8")
        .trim()
        .split("\n"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const prefix = "repos/sachkov-inside/platform/actions";
/** @param {number} id @param {number} pr @param {number} [attempt] */
const run = (id, pr, attempt = 1) => ({
  id,
  run_attempt: attempt,
  head_sha: `source${id}`,
  created_at: "2026-10-29T01:00:00Z",
  html_url: `https://github.com/sachkov-inside/platform/actions/runs/${id}`,
  pull_requests: [{ number: pr }],
});
/** @param {number} id @param {string} conclusion */
const job = (id, conclusion) => ({
  id,
  name: "Unit checks (modules)",
  conclusion,
  started_at: "2026-10-29T01:00:00Z",
  completed_at: "2026-10-29T01:01:00Z",
  steps: [],
});
const runsPath = `${prefix}/workflows/ci.yml/runs?created=2026-10-23T00%3A00%3A00.000Z..2026-10-30T00%3A00%3A00.000Z&per_page=100&page=1`;

test("CLI groups a real test signature across PRs and retains first failure and rerun outcome", async () => {
  const result = await report({
    [runsPath]: { total_count: 2, workflow_runs: [run(1, 11, 2), run(2, 22)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(101, "failure")],
    },
    [`${prefix}/runs/1/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(102, "success")],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(201, "failure")],
    },
    [`${prefix}/jobs/101/logs`]:
      " FAIL  apps/web/test/access.test.ts > access > denies expired session\nAssertionError: unrelated sensitive payload",
    [`${prefix}/jobs/201/logs`]:
      " FAIL  apps/web/test/access.test.ts > access > denies expired session\nAssertionError: another payload",
  });
  assert.equal(result.causes.length, 1);
  assert.ok(result.causes[0]);
  assert.ok(result.causes[0].rechecks[0]);
  assert.ok(result.jobs[0]);
  assert.deepEqual(result.causes[0].pullRequests, [11, 22]);
  assert.equal(result.causes[0].priority, "diagnose-recurring");
  assert.equal(result.causes[0].firstFailure.run, 1);
  assert.equal(
    result.causes[0].rechecks[0].outcome,
    "job-success-test-unconfirmed",
  );
  assert.equal(result.jobs[0].durationSeconds, 60);
  assert.doesNotMatch(JSON.stringify(result), /sensitive payload|flaky/u);
});

test("CLI reads ANSI failure logs through gh and groups sanitized signatures across PRs", async () => {
  const log =
    "\u001b[31m FAIL \u001b[0m apps/web/test/access.test.ts > access > denies expired session\nAssertionError: private transport payload";
  const result = await report({
    [runsPath]: { total_count: 2, workflow_runs: [run(1, 11), run(2, 22)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(101, "failure")],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(201, "failure")],
    },
    [`${prefix}/jobs/101/logs`]: log,
    [`${prefix}/jobs/201/logs`]: log,
  });
  assert.deepEqual(
    result.jobs.map((row) => row.classification),
    ["test-failure-unclassified", "test-failure-unclassified"],
  );
  assert.equal(result.coverage.complete, true);
  assert.equal(result.causes.length, 1);
  assert.ok(result.causes[0]);
  assert.deepEqual(result.causes[0].pullRequests, [11, 22]);
  assert.equal(result.causes[0].priority, "diagnose-recurring");
  assert.equal(result.causes[0].test.name, "access > denies expired session");
  assert.equal(result.coverage.logBytes, 2 * Buffer.byteLength(log));
  assert.equal(
    result.coverage.logBudgetBytesCharged,
    2 * Buffer.byteLength(log),
  );
  assert.doesNotMatch(
    result.history + result.summary,
    /private transport payload|\\u001b/u,
  );
  assert.ok(!result.summary.includes("\u001b"));
});

test("distinct file/project identities survive and arbitrary failure text stays unknown", async () => {
  const parsed = observations(
    "2026-10-29T01:01:00Z apps/web test:module:  FAIL  apps/web/test/access.test.ts > denies access\n  1) [desktop-chromium] › test/e2e/login.spec.ts:3:2 › login\n  2) [mobile-chromium] › test/e2e/login.spec.ts:3:2 › login\n✖ anonymous test\nError: failed to load\nnot ok 4 - ambiguous",
    "unit",
  );
  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((row) => row.project),
    ["", "desktop-chromium", "mobile-chromium"],
  );
  const result = await report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 3,
      jobs: [job(1, "failure"), job(2, "cancelled"), job(3, "success")],
    },
    [`${prefix}/jobs/1/logs`]: "Error: failed to load",
  });
  assert.equal(result.causes.length, 0);
  assert.deepEqual(
    result.jobs.map((row) => row.classification),
    ["unknown", "cancelled", "success"],
  );
});

test("pagination follows runs and jobs and reports an exhausted page budget", async () => {
  const jobsPath = `${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`;
  const responses = {
    [runsPath]: { total_count: 2, workflow_runs: [run(1, 11)] },
    [runsPath.replace("&page=1", "&page=2")]: {
      total_count: 2,
      workflow_runs: [run(2, 22)],
    },
    [jobsPath]: { total_count: 2, jobs: [job(1, "success")] },
    [jobsPath.replace("&page=1", "&page=2")]: {
      total_count: 2,
      jobs: [job(2, "cancelled")],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(3, "success")],
    },
  };
  const full = await report(responses);
  assert.equal(full.coverage.complete, true);
  assert.equal(full.jobs.length, 3);
  const limited = await report(responses, ["--max-pages=1"]);
  assert.equal(limited.coverage.complete, false);
  assert.deepEqual(limited.coverage.incomplete, [
    "workflow_runs: pagination limit",
    "jobs: pagination limit",
  ]);
});

test("malformed, missing, truncated and type-ambiguous API inputs retain incomplete evidence", async () => {
  for (const response of [
    "{broken",
    { workflow_runs: [], total_count: "1" },
    { workflow_runs: [{ ...run(1, 11), run_attempt: "2" }], total_count: 1 },
  ]) {
    const result = await report({ [runsPath]: response });
    assert.equal(result.coverage.complete, false);
    assert.equal(result.causes.length, 0);
  }
  const noJobs = await report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11)] },
  });
  assert.equal(noJobs.coverage.complete, false);
  const truncated = await report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11, 4)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(1, "failure")],
    },
    [`${prefix}/jobs/1/logs`]: "x".repeat(1048577),
  });
  assert.equal(truncated.coverage.complete, false);
  assert.ok(truncated.coverage.incomplete.includes("run 1: attempt limit"));
  assert.ok(
    truncated.coverage.incomplete.includes(
      "job 1: logs unavailable or bounded",
    ),
  );
  assert.equal(truncated.jobs[0]?.classification, "unknown");
});

test("provider/setup errors, cancellation and new evidence completion do not become test signatures", async () => {
  const result = await report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11, 2)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 4,
      jobs: [
        job(1, "failure"),
        {
          ...job(2, "failure"),
          steps: [{ name: "Set up Platform", conclusion: "failure" }],
        },
        job(3, "cancelled"),
        { ...job(4, "failure"), name: "Independent review evidence" },
      ],
    },
    [`${prefix}/runs/1/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [{ ...job(5, "success"), name: "Independent review evidence" }],
    },
    [`${prefix}/jobs/1/logs`]:
      "The runner has lost communication with the server",
    [`${prefix}/jobs/2/logs`]: "package registry unavailable",
    [`${prefix}/jobs/4/logs`]: "Missing review receipt",
  });
  assert.equal(result.causes.length, 0);
  assert.deepEqual(
    result.jobs.map((row) => row.classification),
    [
      "provider-failure",
      "setup-failure",
      "cancelled",
      "unknown",
      "evidence-completion",
    ],
  );
});

/** @param {string} source */
function requireReadOnlyHistory(source) {
  assert.match(source, /cron: "17 6 \* \* 1"/u);
  assert.match(source, /permissions:\n {2}contents: read\n {2}actions: read/u);
  assert.match(source, /timeout-minutes: 8$/mu);
  assert.match(source, /persist-credentials: false/u);
  assert.match(source, /node scripts\/ci-stability-report.mjs/u);
  assert.match(source, /retention-days: 7/u);
  assert.doesNotMatch(
    source,
    /\bwrite\b|secrets\.|pnpm check|run-nightly-flake-hunt|continue-on-error|pull_request_target/u,
  );
}
test("regular collection remains read-only, bounded and separate from the manual hunt", () => {
  const source = readFileSync(
    new URL("../.github/workflows/ci-stability-report.yml", import.meta.url),
    "utf8",
  );
  requireReadOnlyHistory(source);
  for (const mutation of [
    source.replace("actions: read", "actions: write"),
    source.replace("timeout-minutes: 8", "timeout-minutes: 80"),
    source.replace("retention-days: 7", "retention-days: 30"),
  ])
    assert.throws(() => requireReadOnlyHistory(mutation));
  const hunt = readFileSync(
    new URL("../.github/workflows/nightly-flake-hunt.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(hunt, /\n {2}schedule:/u);
});

test("workspace-relative Vitest failures use their package prefix or pnpm command directory", () => {
  const input =
    "apps/web test:module:  FAIL  test/module/access.test.ts > denies access\n> @inside/backend@0.0.0 /home/runner/work/platform/platform/apps/backend\n FAIL  test/unit/access.test.ts > denies access";
  assert.deepEqual(
    observations(input, "unit").map((row) => row.file),
    [
      "apps/web/test/module/access.test.ts",
      "apps/backend/test/unit/access.test.ts",
    ],
  );
});

test("overlapping PR runs retain the earliest completed failure rather than run creation order", async () => {
  const result = await report({
    [runsPath]: { total_count: 2, workflow_runs: [run(1, 11), run(2, 22)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [{ ...job(1, "failure"), completed_at: "2026-10-29T02:00:00Z" }],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(2, "failure")],
    },
    [`${prefix}/jobs/1/logs`]:
      " FAIL  scripts/access.test.mjs > rejects invalid input",
    [`${prefix}/jobs/2/logs`]:
      " FAIL  scripts/access.test.mjs > rejects invalid input",
  });
  assert.equal(result.causes[0]?.firstFailure.run, 2);
});

test("failed oversized log reads exhaust the shared budget instead of receiving unlimited free retries", async () => {
  /** @type {Record<string,unknown>} */
  const responses = {
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 24,
      jobs: Array.from({ length: 24 }, (_, i) => job(i + 1, "failure")),
    },
  };
  for (let id = 1; id <= 24; id++)
    responses[`${prefix}/jobs/${id}/logs`] = "__OVERSIZED_LOG__";
  const result = await report(responses);
  assert.equal(result.coverage.complete, false);
  assert.ok(
    result.apiReads.filter((path) => path.endsWith("/logs")).length <= 20,
  );
  assert.ok(result.coverage.logBytes > 0);
  assert.ok(result.coverage.logBudgetBytesCharged >= 20971520);
  assert.ok(result.coverage.logBudgetBytesCharged >= result.coverage.logBytes);
  assert.match(result.coverage.logBudgetScope, /hidden gh\/network buffering/u);
  assert.equal(result.jobs.length, 24);
  assert.equal(result.causes.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /private failure payload/u);
});

test("failed log commands with no captured stdout still consume their reserved allowance", async () => {
  const result = await report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 24,
      jobs: Array.from({ length: 24 }, (_, i) => job(i + 1, "failure")),
    },
  });
  assert.equal(
    result.apiReads.filter((path) => path.endsWith("/logs")).length,
    20,
  );
  assert.equal(result.coverage.logBytes, 0);
  assert.equal(result.coverage.logBudgetBytesCharged, 20971520);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.jobs.length, 24);
});

test("CLI follows one test across PR shard moves while retaining job provenance and project separation", async () => {
  const result = await report({
    [runsPath]: { total_count: 2, workflow_runs: [run(1, 11), run(2, 22)] },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [
        { ...job(101, "failure"), name: "Web browser (desktop-chromium, 1/2)" },
      ],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [
        { ...job(201, "failure"), name: "Web browser (desktop-chromium, 2/2)" },
      ],
    },
    [`${prefix}/jobs/101/logs`]:
      "  1) [desktop-chromium] › test/e2e/login.spec.ts:3:2 › login",
    [`${prefix}/jobs/201/logs`]:
      "  1) [desktop-chromium] › test/e2e/login.spec.ts:3:2 › login\n  2) [mobile-chromium] › test/e2e/login.spec.ts:3:2 › login",
  });
  assert.equal(result.causes.length, 2);
  const desktop = result.causes.find(
    (cause) => cause.test.project === "desktop-chromium",
  );
  assert.ok(desktop);
  assert.equal(desktop.test.suite, "Web browser");
  assert.deepEqual(desktop.pullRequests, [11, 22]);
  assert.equal(desktop.priority, "diagnose-recurring");
  assert.deepEqual(
    desktop.failures.map((failure) => failure.name),
    [
      "Web browser (desktop-chromium, 1/2)",
      "Web browser (desktop-chromium, 2/2)",
    ],
  );
});

test("CLI retains deduplicated later attempts from every run observing a recurring signature", async () => {
  const failure =
    " FAIL  apps/web/test/access.test.ts > access > denies expired session";
  const result = await report({
    [runsPath]: {
      total_count: 2,
      workflow_runs: [run(1, 11, 2), run(2, 22, 3)],
    },
    [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(101, "failure")],
    },
    [`${prefix}/runs/1/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(102, "success")],
    },
    [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(201, "failure")],
    },
    [`${prefix}/runs/2/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(202, "failure")],
    },
    [`${prefix}/runs/2/attempts/3/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [job(203, "success")],
    },
    [`${prefix}/jobs/101/logs`]: failure,
    [`${prefix}/jobs/201/logs`]: failure,
    [`${prefix}/jobs/202/logs`]: failure,
  });
  assert.equal(result.causes.length, 1);
  assert.deepEqual(result.causes[0]?.rechecks, [
    {
      run: 1,
      attempt: 2,
      source: "source1",
      outcome: "job-success-test-unconfirmed",
    },
    {
      run: 2,
      attempt: 2,
      source: "source2",
      outcome: "test-failure-unclassified",
    },
    {
      run: 2,
      attempt: 3,
      source: "source2",
      outcome: "job-success-test-unconfirmed",
    },
  ]);
  assert.match(
    result.summary,
    /run 2, attempt 3, source source2: job-success-test-unconfirmed/u,
  );
});

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}

const treeSchema = z.object({
  pid: z.number().int().positive(),
  gh: z.number().int().positive(),
  collector: z.number().int().positive(),
});

for (const mode of ["success", "failure", "timeout", "SIGTERM", "SIGKILL"]) {
  test(
    `CLI ${mode} cleans real gh and signal-resistant detached descendants before returning`,
    { timeout: 30000 },
    async () => {
      const root = mkdtempSync(resolve(tmpdir(), "ci-history-tree-"));
      const record = resolve(root, "tree.json");
      const watcher = watch(root);
      // Watch before acquisition; signals are triggered by committed descendant readiness, never a pause.
      watcher.on("change", () => {
        if ((mode === "SIGTERM" || mode === "SIGKILL") && existsSync(record)) {
          const tree = treeSchema.parse(
            JSON.parse(readFileSync(record, "utf8")),
          );
          if (alive(tree.collector)) process.kill(tree.collector, mode);
        }
      });
      try {
        if (mode === "failure")
          writeFileSync(resolve(root, "report"), "output is a file");
        writeFileSync(
          resolve(root, "gh"),
          `#!${process.execPath}
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const leaf = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid)"], {detached:true, stdio:['ignore','ignore','ignore','ipc']});
leaf.once('message', pid => {
  fs.writeFileSync(${JSON.stringify(record + ".tmp")}, JSON.stringify({pid, gh:process.pid, collector:process.ppid}));
  fs.renameSync(${JSON.stringify(record + ".tmp")}, ${JSON.stringify(record)});
  if (${JSON.stringify(mode === "success" || mode === "failure")}) {
    process.stdout.write(JSON.stringify({total_count:0, workflow_runs:[]}), () => process.exit(0));
  }
});
setInterval(()=>{},1000);
`,
          { mode: 0o755 },
        );
        const result = await collect(root);
        assert.ok(
          existsSync(record),
          "real gh descendant reached readiness before the failure budget",
        );
        const tree = treeSchema.parse(JSON.parse(readFileSync(record, "utf8")));
        if (mode === "success") assert.equal(result.status, 0, result.stderr);
        else assert.notEqual(result.status, 0);
        for (const pid of [tree.pid, tree.gh, tree.collector])
          assert.equal(
            alive(pid),
            false,
            `owned process ${pid} must be gone before fixture removal`,
          );
      } finally {
        watcher.close();
        // Failure fallback handles the red contract too; the supervisor owns normal cleanup.
        if (existsSync(record)) {
          const tree = treeSchema.parse(
            JSON.parse(readFileSync(record, "utf8")),
          );
          for (const pid of [tree.pid, tree.gh, tree.collector])
            if (alive(pid)) process.kill(pid, "SIGKILL");
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

for (const shardNames of [
  ["1", "2"],
  ["1/2", "2/2"],
]) {
  test(`CLI follows Full-stack browser across PR shards ${shardNames.join(" to ")} with distinct projects`, async () => {
    const firstName = `Full-stack browser (desktop-chromium, ${shardNames[0]})`;
    const nextName = `Full-stack browser (desktop-chromium, ${shardNames[1]})`;
    const result = await report({
      [runsPath]: { total_count: 2, workflow_runs: [run(1, 11), run(2, 22)] },
      [`${prefix}/runs/1/attempts/1/jobs?per_page=100&page=1`]: {
        total_count: 1,
        jobs: [{ ...job(101, "failure"), name: firstName }],
      },
      [`${prefix}/runs/2/attempts/1/jobs?per_page=100&page=1`]: {
        total_count: 1,
        jobs: [{ ...job(201, "failure"), name: nextName }],
      },
      [`${prefix}/jobs/101/logs`]:
        "  1) [desktop-chromium] › test/full-stack/access.spec.ts:3:2 › access",
      [`${prefix}/jobs/201/logs`]:
        "  1) [desktop-chromium] › test/full-stack/access.spec.ts:3:2 › access\n  2) [mobile-chromium] › test/full-stack/access.spec.ts:3:2 › access",
    });
    assert.equal(result.causes.length, 2);
    const desktop = result.causes.find(
      (cause) => cause.test.project === "desktop-chromium",
    );
    assert.ok(desktop);
    assert.equal(desktop.test.suite, "Full-stack browser");
    assert.deepEqual(desktop.pullRequests, [11, 22]);
    assert.equal(desktop.priority, "diagnose-recurring");
    assert.deepEqual(
      desktop.failures.map((failure) => failure.name),
      [firstName, nextName],
    );
    const mobile = result.causes.find(
      (cause) => cause.test.project === "mobile-chromium",
    );
    assert.ok(mobile);
    assert.notEqual(mobile.identity, desktop.identity);
    assert.deepEqual(mobile.pullRequests, [22]);
  });
}
