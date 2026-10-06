// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { z } from "zod";

const callSchema = z.array(z.string());

test("a failed main smoke opens an assigned triage issue with the exact run and source", () => {
  const result = reportFailure();
  assert.equal(result.status, 0, result.stderr);
  const created = result.calls.find((call) => call[1] === "create");
  assert.ok(created);
  assert.ok(created.includes("needs-triage"));
  assert.ok(created.includes("KirillSachkov"));
  assert.match(result.body, /actions\/runs\/12345/u);
  assert.ok(result.body.includes("a".repeat(40)));
  assert.match(result.body, /TimeoutError/u);
});

test("another failure updates the open incident instead of creating a duplicate", () => {
  const result = reportFailure({ EXISTING_ISSUE: "987" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((call) => call.slice(0, 3)),
    [
      ["issue", "list", "--repo"],
      ["issue", "edit", "987"],
    ],
  );
  assert.match(result.body, /actions\/runs\/12345/u);
});

test("a branch experiment does not notify the owner", () => {
  const result = reportFailure({
    GITHUB_REF: "refs/heads/fix/589-e2e-outside-gate",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
});

test("denied GitHub access fails visibly without opening a duplicate incident", () => {
  const result = reportFailure({ GH_FAILURE: "true" });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 1);
});

/** @param {NodeJS.ProcessEnv} [overrides] */
function reportFailure(overrides = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-nightly-failure-"));
  const callsPath = resolve(directory, "calls");
  const bodyPath = resolve(directory, "body");
  writeFileSync(callsPath, "");
  writeFileSync(bodyPath, "");
  writeFileSync(
    resolve(directory, "gh"),
    `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS_PATH, JSON.stringify(args) + "\\n");
if (process.env.GH_FAILURE === "true") process.exit(1);
if (args[1] === "list") console.log(process.env.EXISTING_ISSUE ?? "");
const bodyIndex = args.indexOf("--body-file");
if (bodyIndex !== -1) writeFileSync(process.env.BODY_PATH, readFileSync(args[bodyIndex + 1]));
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(
      "/bin/bash",
      ["scripts/report-nightly-fullstack-failure.sh"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env["PATH"]}`,
          GITHUB_REPOSITORY: "sachkov-inside/platform",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_RUN_ID: "12345",
          GITHUB_SHA: "a".repeat(40),
          CALLS_PATH: callsPath,
          BODY_PATH: bodyPath,
          ...overrides,
        },
      },
    );
    return {
      ...result,
      body: readFileSync(bodyPath, "utf8"),
      calls: readFileSync(callsPath, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => callSchema.parse(JSON.parse(line))),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
