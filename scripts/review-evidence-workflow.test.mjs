// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const review =
  workflow
    .split("  review-evidence:\n")[1]
    ?.split(/\n {2}[a-z][a-z-]+:\n/u)[0] ?? "";
/** @param {string} step */
function command(step) {
  const block = review.split(`      - name: ${step}\n`)[1] ?? "";
  const script =
    block.split("        run: |\n")[1]?.split(/\n {6}- name:/u)[0] ?? "";
  assert.ok(script, `Missing step: ${step}`);
  return script.replace(/^ {10}/gmu, "").trim();
}

test("trusted verifier executes instead of candidate and broken adopted verifier cannot bootstrap", (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-workflow-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const candidate = resolve(cwd, "review-candidate");
  const trustedScripts = resolve(cwd, "review-trusted/scripts");
  mkdirSync(resolve(candidate, "scripts"), { recursive: true });
  mkdirSync(trustedScripts, { recursive: true });
  writeFileSync(
    resolve(candidate, "scripts/review-evidence.mjs"),
    "throw new Error('CANDIDATE EXECUTED');",
  );
  const output = resolve(cwd, "output");
  const summary = resolve(cwd, "summary");
  function run() {
    writeFileSync(output, "");
    writeFileSync(summary, "");
    return spawnSync(
      "bash",
      [
        "-euc",
        command("Verify current GitHub reviews under trusted target rules"),
      ],
      {
        cwd: candidate,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
  }
  assert.equal(run().status, 0);
  assert.match(readFileSync(output, "utf8"), /status=bootstrap-prior-policy/u);
  assert.match(
    readFileSync(summary, "utf8"),
    /owner approval of prepared controls/u,
  );
  writeFileSync(
    resolve(trustedScripts, "review-evidence.mjs"),
    "throw new Error('trusted verifier failed');",
  );
  const broken = run();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /trusted verifier failed/u);
  assert.equal(readFileSync(output, "utf8"), "");
  writeFileSync(
    resolve(trustedScripts, "review-evidence.mjs"),
    "console.log('TRUSTED VERIFIER');",
  );
  const trusted = run();
  assert.equal(trusted.status, 0);
  assert.match(trusted.stdout, /TRUSTED VERIFIER/u);
  assert.doesNotMatch(trusted.stderr, /CANDIDATE EXECUTED/u);
});

test("release workflow_call needs no open PR, token or candidate execution", (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = resolve(cwd, "output");
  const summary = resolve(cwd, "summary");
  const result = spawnSync(
    "bash",
    ["-euc", command("Preserve release coverage applicability")],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"],
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "status=release-not-applicable\n");
  assert.match(
    readFileSync(summary, "utf8"),
    /release source coverage remains mandatory/u,
  );
  assert.equal(
    (review.match(/if: \$\{\{ inputs.source_sha == '' \}\}/gu) ?? []).length,
    4,
  );
  assert.match(review, /if: \$\{\{ inputs.source_sha != '' \}\}/u);
});

test("read-only review is unconditional for PR/queue and required by CI Gate", () => {
  assert.doesNotMatch(
    review,
    /^ {4}if:|continue-on-error|permissions:|pnpm|\.\/\.github\/actions|: write|secrets\./mu,
  );
  assert.match(
    review,
    /ref: \$\{\{ github.event.pull_request.base.sha \|\| github.event.merge_group.base_sha \}\}/u,
  );
  assert.match(review, /working-directory: review-candidate/u);
  assert.match(
    review,
    /node \.\.\/review-trusted\/scripts\/review-evidence.mjs verify/u,
  );
  assert.equal((review.match(/persist-credentials: false/gu) ?? []).length, 2);
  const gate = workflow.split("  ci-gate:\n")[1] ?? "";
  assert.match(gate, /^ {6}- review-evidence$/mu);
  assert.match(
    gate,
    /REVIEW_RESULT: \$\{\{ needs.review-evidence.result \}\}/u,
  );
  assert.match(
    gate,
    /REVIEW_STATUS: \$\{\{ needs.review-evidence.outputs.status \}\}/u,
  );
  const shell = gate.match(/run: (test "\$REVIEW_RESULT" = success)/u)?.[1];
  assert.ok(shell);
  for (const result of ["success", "failure", "skipped", "cancelled", ""]) {
    /** @type {import("node:child_process").SpawnSyncReturns<string>} */
    const checked = spawnSync("bash", ["-euc", shell], {
      encoding: "utf8",
      env: { ...process.env, REVIEW_RESULT: result },
    });
    assert.equal(checked.status, result === "success" ? 0 : 1);
  }
});
