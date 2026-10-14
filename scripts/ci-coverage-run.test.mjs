// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { z } from "zod";
import { coverageIds } from "./ci-coverage-plan.mjs";
const runner = fileURLToPath(new URL("./ci-coverage-run.mjs", import.meta.url));
it("git/Actions adapter plans the complete rename set and records actual checkout evidence", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "ci-coverage-"));
  /** @param {string[]} args */
  const git = (args) => {
    const run = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    git(["config", "user.name", "Fixture"]);
    mkdirSync(resolve(cwd, "apps/web"), { recursive: true });
    writeFileSync(resolve(cwd, "apps/web/runtime.md"), "runtime");
    git(["add", "."]);
    git(["commit", "-qm", "base"]);
    const base = git(["rev-parse", "HEAD"]);
    mkdirSync(resolve(cwd, "docs/research"), { recursive: true });
    renameSync(
      resolve(cwd, "apps/web/runtime.md"),
      resolve(cwd, "docs/research/runtime.md"),
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "rename"]);
    const head = git(["rev-parse", "HEAD"]);
    const output = resolve(cwd, "output");
    const env = {
      ...process.env,
      CI_EVENT: "merge_group",
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_EVENT_NAME: "merge_group",
    };
    const planRun = spawnSync(process.execPath, [runner, "plan"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(planRun.status, 0, planRun.stderr);
    const serialized =
      readFileSync(output, "utf8").split("\n")[0]?.slice("plan=".length) ?? "";
    const plan = z
      .object({ required: z.array(z.string()), paths: z.array(z.string()) })
      .parse(JSON.parse(serialized));
    assert.deepEqual(plan.paths, [
      "apps/web/runtime.md",
      "docs/research/runtime.md",
    ]);
    assert.ok(plan.required.includes("fullstack"));
    /** @type {Record<string, {result:string}>} */
    const results = { plan: { result: "success" } };
    for (const id of coverageIds)
      results[id] = {
        result: plan.required.includes(id) ? "success" : "skipped",
      };
    const gateEnv = {
      ...env,
      SELECTED_PLAN: serialized,
      JOB_RESULTS: JSON.stringify(results),
    };
    const gate = spawnSync(process.execPath, [runner, "gate"], {
      cwd,
      env: gateEnv,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(gate.status, 0, gate.stderr);
    const evidence = z
      .object({
        sourceSha: z.string(),
        treeSha: z.string(),
        successfulCoverage: z.array(z.string()),
      })
      .parse(
        JSON.parse(
          readFileSync(
            resolve(cwd, "ci-source-evidence/source-evidence.json"),
            "utf8",
          ),
        ),
      );
    assert.equal(evidence.sourceSha, head);
    assert.equal(evidence.treeSha, git(["rev-parse", "HEAD^{tree}"]));
    assert.deepEqual(evidence.successfulCoverage, plan.required);
    const forged = spawnSync(process.execPath, [runner, "gate"], {
      cwd,
      env: { ...gateEnv, SELECTED_PLAN: "{}" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.notEqual(forged.status, 0);
    assert.match(forged.stderr, /does not match complete source/u);
    const incomplete = spawnSync(process.execPath, [runner, "plan"], {
      cwd,
      env: { ...env, BASE_SHA: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /Missing complete source/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
it("release adapter validates immutable checkout and executes only allowlisted missing coverage", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "ci-release-plan-"));
  try {
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "fixture@example.invalid"],
      ["config", "user.name", "Fixture"],
      ["commit", "--allow-empty", "-qm", "source"],
    ]) {
      const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const sha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    }).stdout.trim();
    const output = resolve(cwd, "output");
    const env = {
      ...process.env,
      CI_EVENT: "release",
      SOURCE_SHA: sha,
      COVERAGE_JSON: '["fullstack"]',
      GITHUB_OUTPUT: output,
    };
    const run = spawnSync(process.execPath, [runner, "plan"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(readFileSync(output, "utf8"), /required=\["fullstack"\]/u);
    for (const changed of [
      { SOURCE_SHA: "main" },
      { SOURCE_SHA: "a".repeat(40) },
      { COVERAGE_JSON: '["invented"]' },
      { COVERAGE_JSON: '["unit","unit"]' },
    ]) {
      const rejected = spawnSync(process.execPath, [runner, "plan"], {
        cwd,
        env: { ...env, ...changed },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.notEqual(rejected.status, 0);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
