// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import nodeReporter from "./nightly-node-reporter.mjs";
import { planSuite } from "./run-nightly-flake-hunt.mjs";
import {
  aggregate,
  normalizeVitest,
  normalizePlaywright,
  publishFailures,
} from "./nightly-flake-report.mjs";

test("counts a first failure even when the remaining independent samples pass", () => {
  /** @param {string} status */
  const sample = (status) =>
    normalizeVitest(
      {
        testResults: [
          {
            name: "/checkout/apps/web/test/a.test.ts",
            assertionResults: [{ fullName: "suite test", status }],
          },
        ],
      },
      "/checkout",
      "module",
    );
  const rows = aggregate([
    sample("failed"),
    sample("passed"),
    sample("passed"),
    sample("passed"),
    sample("passed"),
  ]);
  assert.equal(rows[0]?.failed, 1);
  assert.equal(rows[0]?.attempts, 5);
});

test("integration samples distinguish the parallel and serial selection commands", () => {
  assert.deepEqual(
    planSuite("integration").map((command) => [command.name, command.args]),
    [
      ["integration", ["run", "test:integration:parallel"]],
      ["integration-serial", ["run", "test:integration:serial"]],
    ],
  );
});

test("unit samples use workspace package test scripts and the root native launcher", () => {
  const commands = planSuite("unit");
  for (const name of [
    "access-capabilities",
    "backend",
    "legal",
    "module",
    "telegram",
  ])
    assert.ok(
      commands.some((command) => command.name === name),
      `Missing ${name}`,
    );
  const tooling = commands.find((command) => command.name === "tooling");
  assert.ok(tooling?.args.includes("--test-concurrency=2"));
  assert.ok(
    tooling?.args.some((arg) => arg.endsWith("heavy-check-lock.test.mjs")),
  );
  assert.ok(
    commands
      .filter((command) => command.engine === "vitest")
      .every((command) => command.args[0] === "run"),
  );
  assert.ok(
    commands.some(
      (command) =>
        command.args.includes("apps/backend/node_modules/tsx/dist/cli.mjs") &&
        command.args.some((arg) => arg.endsWith("native.test.mts")),
    ),
  );
});

test("Node reporter follows explicit parent IDs when nested tests enqueue after another suite", async () => {
  async function* events() {
    for (const [
      testId,
      parentId,
      name,
      nesting,
    ] of /** @type {[number, number, string, number][]} */ ([
      [1, 0, "A", 0],
      [2, 0, "B", 0],
      [4, 2, "leaf", 1],
      [3, 1, "leaf", 1],
    ]))
      yield {
        type: "test:enqueue",
        data: {
          testId,
          parentId,
          name,
          nesting,
          file: "a.test.mjs",
          entryFile: "a.test.mjs",
        },
      };
    for (const [testId, parentId] of [
      [4, 2],
      [3, 1],
    ])
      yield {
        type: "test:pass",
        data: {
          testId,
          parentId,
          name: "leaf",
          nesting: 1,
          file: "a.test.mjs",
          entryFile: "a.test.mjs",
          details: { type: "test" },
        },
      };
  }
  let raw = "";
  for await (const chunk of nodeReporter(events())) raw += chunk;
  const rows = normalizeVitest(JSON.parse(raw), "/checkout", "unit");
  assert.deepEqual(
    rows.map((row) => row.name),
    ["B > leaf", "A > leaf"],
  );
});

test("the executable alternating fixture stays red and the reporter CLI creates then updates one issue", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "platform-flake-cli-"));
  try {
    const artifacts = resolve(directory, "artifacts");
    const run = spawnSync(
      process.execPath,
      ["scripts/run-nightly-flake-hunt.mjs", "fixture", artifacts],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 1, run.stderr);
    const state = resolve(directory, "issues.json");
    writeFileSync(state, "[]");
    writeFileSync(
      resolve(directory, "gh"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.DENY_WRITE === "1" && args.includes("--method")) process.exit(1);
const issues = JSON.parse(fs.readFileSync(process.env.ISSUE_STATE, "utf8"));
if (args.includes("--slurp")) { console.log(JSON.stringify([issues])); process.exit(0); }
const body = JSON.parse(fs.readFileSync(0, "utf8"));
if (args.includes("POST")) issues.push({ number: 42, ...body });
if (args.includes("PATCH")) issues[0].body = body.body;
fs.writeFileSync(process.env.ISSUE_STATE, JSON.stringify(issues));
console.log("{}");
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env["PATH"]}`,
      ISSUE_STATE: state,
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REPOSITORY: "example/repo",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_SHA: "abc",
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_STEP_SUMMARY: resolve(directory, "step-summary.md"),
    };
    const reportArgs = [
      "scripts/nightly-flake-report.mjs",
      artifacts,
      "--publish",
    ];
    const first = spawnSync(process.execPath, reportArgs, {
      env,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, reportArgs, {
      env: { ...env, GITHUB_RUN_ID: "2" },
      encoding: "utf8",
    });
    assert.equal(second.status, 0, second.stderr);
    const issues = z
      .array(
        z.object({
          number: z.number(),
          body: z.string(),
          labels: z.array(z.string()),
        }),
      )
      .parse(JSON.parse(readFileSync(state, "utf8")));
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.body ?? "", /3\/5/u);
    assert.match(issues[0]?.body ?? "", /actions\/runs\/2/u);
    assert.deepEqual(issues[0]?.labels, ["needs-triage"]);
    const denied = spawnSync(process.execPath, reportArgs, {
      env: { ...env, DENY_WRITE: "1" },
      encoding: "utf8",
    });
    assert.notEqual(denied.status, 0);
    const branch = spawnSync(process.execPath, reportArgs, {
      env: { ...env, DENY_WRITE: "1", GITHUB_REF: "refs/heads/branch" },
      encoding: "utf8",
    });
    assert.equal(branch.status, 0, branch.stderr);
    assert.match(
      readFileSync(resolve(artifacts, "summary.md"), "utf8"),
      /60\.0%/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizes Playwright projects and suite names without merging equal leaf titles", () => {
  const rows = normalizePlaywright(
    {
      suites: [
        {
          title: "a.spec.ts",
          file: "test/a.spec.ts",
          suites: [
            {
              title: "parent",
              specs: [
                {
                  title: "test",
                  file: "test/a.spec.ts",
                  tests: [
                    {
                      projectName: "mobile",
                      expectedStatus: "passed",
                      results: [{ status: "timedOut" }],
                    },
                    {
                      projectName: "desktop",
                      expectedStatus: "failed",
                      results: [{ status: "failed" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    "/checkout",
    "web-e2e",
  );
  assert.equal(rows[0]?.status, "failed");
  assert.equal(rows[0]?.name, "a.spec.ts > parent > test");
  assert.equal(rows[1]?.status, "passed");
  assert.notEqual(rows[0]?.project, rows[1]?.project);
});

test("rejects malformed reporter data instead of producing a green empty summary", () => {
  assert.throws(() => normalizeVitest({}, "/checkout", "unit"));
  assert.throws(() =>
    normalizePlaywright({ suites: [] }, "/checkout", "web-e2e"),
  );
});

test("Playwright JSON preserves describe names and resolves its testDir to a repository file", () => {
  const rows = normalizePlaywright(
    {
      config: { rootDir: "/checkout/apps/web/test/e2e" },
      suites: [
        {
          title: "a.spec.ts",
          file: "a.spec.ts",
          suites: [
            {
              title: "first suite",
              file: "a.spec.ts",
              specs: [
                {
                  title: "same leaf",
                  file: "a.spec.ts",
                  tests: [
                    {
                      projectName: "desktop",
                      expectedStatus: "passed",
                      results: [{ status: "passed" }],
                    },
                  ],
                },
              ],
            },
            {
              title: "second suite",
              file: "a.spec.ts",
              specs: [
                {
                  title: "same leaf",
                  file: "a.spec.ts",
                  tests: [
                    {
                      projectName: "desktop",
                      expectedStatus: "passed",
                      results: [{ status: "failed" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    "/checkout",
    "web-e2e",
  );
  assert.equal(rows[0]?.file, "apps/web/test/e2e/a.spec.ts");
  assert.notEqual(rows[0]?.name, rows[1]?.name);
  assert.equal(aggregate([rows]).length, 2);
});

test("scheduled reporting only grants issue writes to trusted main code and receives test data as artifacts", () => {
  const workflow = readFileSync(
    ".github/workflows/nightly-flake-hunt.yml",
    "utf8",
  );
  assert.match(workflow, /schedule:\n\s+- cron:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(
    workflow,
    /pull_request|pull_request_target|workflow_run/u,
  );
  const [tests, report = ""] = workflow.split("  report-failures:");
  assert.doesNotMatch(tests ?? "", /issues: write/u);
  assert.match(report, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(
    report,
    /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/u,
  );
  assert.match(report, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(report, /issues: write/u);
  assert.match(report, /uses: actions\/download-artifact@[a-f0-9]{40}/u);
  assert.doesNotMatch(report, /run:.*(?:bash|node) ci-artifacts\//u);
  for (const line of workflow
    .split("\n")
    .filter((line) => line.includes("uses: actions/")))
    assert.match(line, /@[a-f0-9]{40} # v\d+\.\d+\.\d+/u);
});

test("fixture failure creates one issue and a second run updates it; branch runs never write", async () => {
  /** @type {import("./nightly-flake-report.mjs").Observation[][]} */
  const samples = Array.from({ length: 5 }, (_, index) => [
    {
      suite: "fixture",
      file: "fixture.test.mjs",
      project: "",
      name: "alternates",
      status: index % 2 === 0 ? "failed" : "passed",
    },
  ]);
  const rows = aggregate(samples);
  /** @type {{number: number, body: string}[]} */
  const issues = [];
  /** @type {(number | string)[]} */
  const writes = [];
  /** @type {import("./nightly-flake-report.mjs").IssueClient} */
  const client = {
    find: async (marker) =>
      issues.find((issue) => issue.body.includes(marker))?.number,
    create: async (title, body) => {
      writes.push(title);
      issues.push({ number: 42, body });
    },
    update: async (number, body) => {
      writes.push(number);
      const issue = issues.find((issue) => issue.number === number);
      if (issue !== undefined) issue.body = body;
    },
  };
  const context = {
    ref: "refs/heads/main",
    event: "workflow_dispatch",
    runUrl: "https://github.com/example/repo/actions/runs/1",
    sha: "abc",
    attempt: "1",
  };
  await publishFailures(rows, context, client);
  await publishFailures(rows, context, client);
  assert.equal(issues.length, 1);
  assert.equal(writes[1], 42);
  assert.match(issues[0]?.body ?? "", /3\/5/u);
  assert.match(issues[0]?.body ?? "", /artifacts/u);
  await publishFailures(rows, { ...context, ref: "refs/heads/branch" }, client);
  await publishFailures(rows, { ...context, event: "pull_request" }, client);
  assert.equal(writes.length, 2);
});
