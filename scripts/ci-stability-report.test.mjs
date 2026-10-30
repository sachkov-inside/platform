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
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
      }),
      pullRequests: z.array(z.number()),
      priority: z.string(),
      firstFailure: z.object({ run: z.number(), source: z.string() }),
      rechecks: z.array(z.object({ outcome: z.string() })),
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

/** @param {Record<string, unknown>} responses @param {string[]} [args] */
function report(responses, args = []) {
  const root = mkdtempSync(resolve(tmpdir(), "ci-history-"));
  try {
    writeFileSync(resolve(root, "responses.json"), JSON.stringify(responses));
    const gh = resolve(root, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env node\nconst fs=require('node:fs');const p=process.argv.at(-1);fs.appendFileSync(process.env.STABILITY_CALLS,p+'\\n');if(process.argv.slice(2,5).join(' ')!=='api --method GET')process.exit(2);const data=JSON.parse(fs.readFileSync(process.env.STABILITY_FIXTURE,'utf8'));if(!(p in data)){console.error('missing fixture '+p);process.exit(1)}const v=data[p];process.stdout.write(v==='__OVERSIZED_LOG__'?'private failure payload '+ 'x'.repeat(1048576+65536):typeof v==='string'?v:JSON.stringify(v));`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/ci-stability-report.mjs",
        "sachkov-inside/platform",
        resolve(root, "report"),
        "--until=2026-10-30T00:00:00Z",
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env["PATH"]}`,
          STABILITY_FIXTURE: resolve(root, "responses.json"),
          STABILITY_CALLS: resolve(root, "calls.txt"),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    return {
      ...outputSchema.parse(
        JSON.parse(readFileSync(resolve(root, "report/history.json"), "utf8")),
      ),
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

test("CLI groups a real test signature across PRs and retains first failure and rerun outcome", () => {
  const result = report({
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

test("distinct file/project identities survive and arbitrary failure text stays unknown", () => {
  const parsed = observations(
    "2026-10-29T01:01:00Z apps/web test:module:  FAIL  apps/web/test/access.test.ts > denies access\n  1) [desktop-chromium] › test/e2e/login.spec.ts:3:2 › login\n  2) [mobile-chromium] › test/e2e/login.spec.ts:3:2 › login\n✖ anonymous test\nError: failed to load\nnot ok 4 - ambiguous",
    "unit",
  );
  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((row) => row.project),
    ["", "desktop-chromium", "mobile-chromium"],
  );
  const result = report({
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

test("pagination follows runs and jobs and reports an exhausted page budget", () => {
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
  const full = report(responses);
  assert.equal(full.coverage.complete, true);
  assert.equal(full.jobs.length, 3);
  const limited = report(responses, ["--max-pages=1"]);
  assert.equal(limited.coverage.complete, false);
  assert.deepEqual(limited.coverage.incomplete, [
    "workflow_runs: pagination limit",
    "jobs: pagination limit",
  ]);
});

test("malformed, missing, truncated and type-ambiguous API inputs retain incomplete evidence", () => {
  for (const response of [
    "{broken",
    { workflow_runs: [], total_count: "1" },
    { workflow_runs: [{ ...run(1, 11), run_attempt: "2" }], total_count: 1 },
  ]) {
    const result = report({ [runsPath]: response });
    assert.equal(result.coverage.complete, false);
    assert.equal(result.causes.length, 0);
  }
  const noJobs = report({
    [runsPath]: { total_count: 1, workflow_runs: [run(1, 11)] },
  });
  assert.equal(noJobs.coverage.complete, false);
  const truncated = report({
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

test("provider/setup errors, cancellation and new evidence completion do not become test signatures", () => {
  const result = report({
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

test("overlapping PR runs retain the earliest completed failure rather than run creation order", () => {
  const result = report({
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

test("failed oversized log reads exhaust the shared budget instead of receiving unlimited free retries", () => {
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
  const result = report(responses);
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

test("failed log commands with no captured stdout still consume their reserved allowance", () => {
  const result = report({
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
