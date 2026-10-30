// @ts-check
import assert from "node:assert/strict";
import { runReviewProcess } from "./review-evidence.test-support.mjs";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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

const migrationBase = "cfa6b52fed6792f67affcb1ab245c2ec591dd016";
const migrationSource = "0d7693f6774abdf5d13fc278d6026e05ed9a0efe";
const advancedBase = "1111111111111111111111111111111111111111";

test("authoritative PR and queue bases alone select the immutable squash migration", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = resolve(cwd, "output");
  for (const event of ["pull_request", "merge_group"]) {
    for (const base of [
      migrationBase,
      advancedBase,
      "",
      "main",
      "a".repeat(39),
      `${migrationBase}\n`,
    ]) {
      writeFileSync(output, "");
      const result = await runReviewProcess(
        "bash",
        ["-euc", command("Select trusted review source")],
        {
          cwd,
          env: {
            ...process.env,
            GITHUB_OUTPUT: output,
            REVIEW_EVENT_NAME: event,
            REVIEW_PR_BASE_SHA: event === "pull_request" ? base : migrationBase,
            REVIEW_QUEUE_BASE_SHA:
              event === "merge_group" ? base : migrationBase,
          },
        },
      );
      const valid = base === migrationBase || base === advancedBase;
      assert.equal(
        result.status,
        valid ? 0 : 1,
        `${event}: ${JSON.stringify(base)}: ${result.stderr}`,
      );
      assert.equal(
        readFileSync(output, "utf8"),
        valid
          ? `source_sha=${base === migrationBase ? migrationSource : base}\n`
          : "",
      );
    }
  }
  const unsupported = await runReviewProcess(
    "bash",
    ["-euc", command("Select trusted review source")],
    {
      cwd,
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        REVIEW_EVENT_NAME: "push",
        REVIEW_PR_BASE_SHA: migrationBase,
        REVIEW_QUEUE_BASE_SHA: migrationBase,
      },
    },
  );
  assert.equal(unsupported.status, 1);
});

test("migration checkout requires exact source and verifier digest before execution", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-pin-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const trusted = resolve(cwd, "review-trusted");
  mkdirSync(resolve(trusted, "scripts"), { recursive: true });
  const initialized = await runReviewProcess("git", ["init", trusted]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const objects = await runReviewProcess("git", [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "objects",
  ]);
  assert.equal(objects.status, 0, objects.stderr);
  writeFileSync(
    resolve(trusted, ".git/objects/info/alternates"),
    objects.stdout,
  );
  async function checkoutSource(/** @type {string} */ source) {
    const result = await runReviewProcess("git", [
      "-C",
      trusted,
      "update-ref",
      "HEAD",
      source,
    ]);
    assert.equal(result.status, 0, result.stderr);
  }
  const verifier = resolve(trusted, "scripts/review-evidence.mjs");
  const pinnedFile = await runReviewProcess("git", [
    "show",
    `${migrationSource}:scripts/review-evidence.mjs`,
  ]);
  assert.equal(pinnedFile.status, 0, pinnedFile.stderr);
  const original = pinnedFile.stdout;
  async function check(/** @type {string} */ source = migrationSource) {
    return runReviewProcess(
      "bash",
      ["-euc", command("Validate trusted review checkout")],
      {
        cwd: trusted,
        env: { ...process.env, REVIEW_TRUSTED_SOURCE: source },
      },
    );
  }
  await checkoutSource(migrationSource);
  writeFileSync(verifier, original);
  assert.equal((await check()).status, 0);
  const wrongDigest = command("Validate trusted review checkout").replace(
    "a925df89ac1d67fc36f89875be5193ff33c61d75a2332583b30d83a80924ba36",
    "0".repeat(64),
  );
  const rejectedDigest = await runReviewProcess("bash", ["-euc", wrongDigest], {
    cwd: trusted,
    env: { ...process.env, REVIEW_TRUSTED_SOURCE: migrationSource },
  });
  assert.equal(rejectedDigest.status, 1);
  writeFileSync(verifier, "throw new Error('TAMPERED VERIFIER EXECUTED');");
  const tampered = await check();
  assert.equal(tampered.status, 1);
  assert.doesNotMatch(tampered.stderr, /TAMPERED VERIFIER EXECUTED/u);
  rmSync(verifier);
  assert.equal((await check()).status, 1);
  writeFileSync(verifier, original);
  await checkoutSource(migrationBase);
  assert.equal((await check()).status, 1);
  // Ordinary target sources use their own verifier, without the historical A digest.
  writeFileSync(verifier, "throw new Error('ordinary trusted verifier');");
  assert.equal((await check(migrationBase)).status, 0);
  rmSync(resolve(trusted, ".git"), { recursive: true });
  assert.notEqual((await check()).status, 0);
});

test("unavailable pinned checkout stops the workflow without bootstrap or fallback", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-unavailable-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const initialized = await runReviewProcess("git", ["init", cwd]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const result = await runReviewProcess(
    "bash",
    [
      "-euc",
      `git checkout '${migrationSource}'\n${command("Validate trusted review checkout")}\necho UNCHECKED_EXECUTION`,
    ],
    {
      cwd,
      env: { ...process.env, REVIEW_TRUSTED_SOURCE: migrationSource },
    },
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(
    result.stdout,
    /UNCHECKED_EXECUTION|bootstrap-prior-policy/u,
  );
  assert.doesNotMatch(review, /continue-on-error|always\(\)|failure\(\)/u);
  assert.ok(
    review.indexOf("Validate trusted review checkout") <
      review.indexOf("Check out candidate as data"),
  );
});

test("trusted verifier executes instead of candidate and broken adopted verifier cannot bootstrap", async (t) => {
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
  async function run() {
    writeFileSync(output, "");
    writeFileSync(summary, "");
    return runReviewProcess(
      "bash",
      [
        "-euc",
        command("Verify current GitHub reviews under trusted target rules"),
      ],
      {
        cwd: candidate,
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
  }
  assert.equal((await run()).status, 0);
  assert.match(readFileSync(output, "utf8"), /status=bootstrap-prior-policy/u);
  assert.match(
    readFileSync(summary, "utf8"),
    /owner approval of prepared controls/u,
  );
  writeFileSync(
    resolve(trustedScripts, "review-evidence.mjs"),
    "throw new Error('trusted verifier failed');",
  );
  const broken = await run();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /trusted verifier failed/u);
  assert.equal(readFileSync(output, "utf8"), "");
  writeFileSync(
    resolve(trustedScripts, "review-evidence.mjs"),
    "console.log('TRUSTED VERIFIER');",
  );
  const trusted = await run();
  assert.equal(trusted.status, 0);
  assert.match(trusted.stdout, /TRUSTED VERIFIER/u);
  assert.doesNotMatch(trusted.stderr, /CANDIDATE EXECUTED/u);
});

test("release workflow_call needs no open PR, token or candidate execution", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "review-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const output = resolve(cwd, "output");
  const summary = resolve(cwd, "summary");
  const result = await runReviewProcess(
    "bash",
    ["-euc", command("Preserve release coverage applicability")],
    {
      cwd,
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
    6,
  );
  assert.match(review, /if: \$\{\{ inputs.source_sha != '' \}\}/u);
});

test("read-only review is unconditional for PR/queue and required by CI Gate", async () => {
  assert.doesNotMatch(
    review,
    /^ {4}if:|continue-on-error|pnpm|\.\/\.github\/actions|: write|secrets\./mu,
  );
  assert.match(
    review,
    /ref: \$\{\{ steps.review-source.outputs.source_sha \}\}/u,
  );
  assert.match(review, /REVIEW_EVENT_NAME: \$\{\{ github.event_name \}\}/u);
  assert.match(
    review,
    /REVIEW_PR_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/u,
  );
  assert.match(
    review,
    /REVIEW_QUEUE_BASE_SHA: \$\{\{ github.event.merge_group.base_sha \}\}/u,
  );
  assert.match(
    review,
    /REVIEW_TRUSTED_SOURCE: \$\{\{ steps.review-source.outputs.source_sha \}\}/u,
  );
  assert.ok(
    review.indexOf("Select trusted review source") <
      review.indexOf("Check out trusted target rules"),
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
    const checked = await runReviewProcess("bash", ["-euc", shell], {
      env: { ...process.env, REVIEW_RESULT: result },
    });
    assert.equal(checked.status, result === "success" ? 0 : 1);
  }
});

/** @param {string} source @param {number} indent */
function permissions(source, indent) {
  const block =
    source.match(
      new RegExp(
        `^ {${indent}}permissions:\\n((?: {${indent + 2}}[a-z-]+: (?:read|write|none)\\n)+)`,
        "mu",
      ),
    )?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/([a-z-]+): (read|write|none)/gu)].map(
      ([, key = "", level = ""]) => [key, level],
    ),
  );
}
/** @param {Record<string, string>} required @param {Record<string, string>} granted */
function assertPermissionCeiling(required, granted) {
  const levels = new Map([
    ["none", 0],
    ["read", 1],
    ["write", 2],
  ]);
  for (const [name, level] of Object.entries(required)) {
    assert.ok(
      (levels.get(granted[name] ?? "none") ?? -1) >= (levels.get(level) ?? 3),
      `Caller cannot grant ${name}:${level}`,
    );
  }
}

test("review API permissions are job-scoped and admitted by every actual reusable CI caller", () => {
  const required = {
    contents: "read",
    "pull-requests": "read",
    issues: "read",
  };
  assert.deepEqual(permissions(workflow, 0), { contents: "read" });
  assert.deepEqual(permissions(review, 4), required);
  const directory = new URL("../.github/workflows/", import.meta.url);
  const callers = [];
  for (const filename of readdirSync(directory).filter((name) =>
    name.endsWith(".yml"),
  )) {
    const source = readFileSync(new URL(filename, directory), "utf8");
    const blocks = source.split(/^ {2}([a-z][a-z0-9-]*):\n/gmu);
    for (let index = 1; index < blocks.length; index += 2) {
      const body = blocks[index + 1] ?? "";
      if (!/^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/mu.test(body))
        continue;
      callers.push(filename);
      assertPermissionCeiling(required, permissions(body, 4));
    }
  }
  assert.deepEqual(callers.sort(), ["release.yml", "telegram-release.yml"]);
  assert.throws(
    () => assertPermissionCeiling(required, { contents: "read" }),
    /Caller cannot grant/u,
  );
  assert.throws(
    () => assertPermissionCeiling(required, { ...required, issues: "none" }),
    /Caller cannot grant issues/u,
  );
});
