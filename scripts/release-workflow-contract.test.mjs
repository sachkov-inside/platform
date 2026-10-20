// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const releaseWorkflow = read(".github/workflows/release.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
const planScript = read("scripts/plan-release.sh");
const overprivilegedFinalize = read(
  "scripts/fixtures/release/overprivileged-finalize.yml",
);

describe("ordinal release workflow contract", () => {
  it("starts manually, serializes releases and reuses CI for the captured SHA", () => {
    const triggers = topLevelBlock(releaseWorkflow, "on");
    const plan = jobBlock(releaseWorkflow, "plan");
    const ci = jobBlock(releaseWorkflow, "ci");

    assert.match(triggers, /^ {2}workflow_dispatch:$/mu);
    assert.match(triggers, /^ {6}version:$/mu);
    assert.doesNotMatch(triggers, /^ {2}(?:push|pull_request|release):/mu);
    assert.match(releaseWorkflow, /^ {2}group: platform-release$/mu);
    assert.match(releaseWorkflow, /^ {2}cancel-in-progress: false$/mu);
    assert.match(plan, /bash scripts\/plan-release\.sh/u);
    assert.match(planScript, /captured-release-main\.sh/u);
    assert.match(
      ci,
      /coverage_json: \$\{\{ needs\.plan\.outputs\.missing_coverage \}\}/u,
    );
    assert.match(planScript, /bash scripts\/check-release-immutability\.sh/u);
    assert.match(
      read("scripts/check-release-immutability.sh"),
      /immutable-releases/u,
    );
    assert.ok(
      plan.indexOf("unset RELEASE_SETTINGS_READ_TOKEN") >
        plan.indexOf("bash scripts/plan-release.sh") &&
        plan.indexOf("unset RELEASE_SETTINGS_READ_TOKEN") <
          plan.indexOf('echo "image_matrix='),
      "the calling shell must remove settings access before its output-processing commands",
    );
    assert.match(ci, /^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/mu);
    assert.match(
      ci,
      /source_sha: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/u,
    );
    // Every checkout of the reusable path verifies the captured SHA, however many jobs there are.
    const checkouts =
      ciWorkflow.match(/uses: actions\/checkout@/gu)?.length ?? 0;
    assert.ok(checkouts > 0);
    assert.equal(
      ciWorkflow.match(/ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/gu)
        ?.length,
      checkouts,
    );
    assert.match(
      ciWorkflow,
      /Build and inspect release images\n {8}if: \$\{\{ matrix\.part == 'cold' && github\.event_name == 'pull_request' \}\}/u,
    );
  });

  it("publishes two digest-addressable images after CI", () => {
    const build = jobBlock(releaseWorkflow, "build-images");

    assert.match(build, /^ {6}- plan$/mu);
    assert.match(build, /^ {6}- ci$/mu);
    assert.match(
      build,
      /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.image_matrix\) \}\}/u,
    );
    assert.match(build, /push: true/u);
    assert.match(
      build,
      /tags: \$\{\{ matrix\.imageName \}\}:\$\{\{ needs\.plan\.outputs\.version \}\}/u,
    );
    assert.match(build, /docker logout ghcr\.io/u);
    assert.match(build, /docker buildx imagetools inspect/u);
  });

  it("binds the runtime bundle and exact previous image proof before publication", () => {
    const finalize = jobBlock(releaseWorkflow, "finalize");

    assert.equal(
      releaseWorkflow.match(/bash scripts\/plan-release\.sh/gu)?.length,
      2,
    );
    assert.match(finalize, /build-production-runtime-bundle\.sh/u);
    assert.match(finalize, /release-contract\.mjs image-reference/u);
    assert.match(finalize, /release-schema-identity\.sh/u);
    assert.ok(
      finalize.indexOf("release-contract.mjs image-reference") <
        finalize.indexOf("release-schema-identity.sh"),
      "the image artifact must be fully validated before its image is executed",
    );
    assert.match(finalize, /PREVIOUS_VERSION/u);
    assert.match(finalize, /gh release download "\$PREVIOUS_VERSION"/u);
    assert.match(finalize, /GITHUB_RUN_ID/u);
    assert.match(finalize, /release-contract\.mjs manifest/u);
    assert.match(finalize, /gh release create/u);
    assert.match(finalize, /--target "\$SOURCE_SHA"/u);
    assert.match(finalize, /release-assets\/production-runtime\.tar\.gz/u);
    assert.doesNotMatch(releaseWorkflow, /:latest|--clobber/u);
    assert.deepEqual(
      [...releaseWorkflow.matchAll(/secrets\.([A-Z_]+)/gu)].map(
        (match) => match[1],
      ),
      ["RELEASE_SETTINGS_READ_TOKEN", "RELEASE_SETTINGS_READ_TOKEN"],
    );
    assert.doesNotMatch(
      releaseWorkflow,
      /anchore|attestation|vulnerabil|waiver|ssh|deploy/iu,
    );
  });

  /** @type {Array<[string, string]>} */
  const receiptWorkflows = [
    [".github/workflows/release.yml", "finalize"],
    [".github/workflows/telegram-release.yml", "publish"],
  ];
  for (const [workflowPath, finalJob] of receiptWorkflows) {
    it(`keeps full and partial rerun receipts bound to their producing plan (${finalJob})`, () => {
      const workflow = read(workflowPath);
      assertReceiptAttempts(workflow, finalJob);
      // A full rerun uploads a distinct plan artifact. A partial rerun keeps the
      // original successful plan output; it must not select by the final job's attempt.
      for (const scenario of [
        { producingAttempt: 1, currentAttempt: 1, artifactId: 101 },
        { producingAttempt: 2, currentAttempt: 2, artifactId: 202 },
        { producingAttempt: 1, currentAttempt: 2, artifactId: 101 },
      ]) {
        const producingName =
          "release-source-receipt-" + scenario.producingAttempt;
        const finalName = "release-source-complete-" + scenario.currentAttempt;
        assert.equal(
          jobBlock(workflow, "plan")
            .match(/name: (release-source-receipt-.*)/u)?.[1]
            ?.replace(
              "${{ github.run_attempt }}",
              String(scenario.producingAttempt),
            ),
          producingName,
        );
        assert.equal(
          jobBlock(workflow, finalJob)
            .match(/name: (release-source-complete-.*)/u)?.[1]
            ?.replace(
              "${{ github.run_attempt }}",
              String(scenario.currentAttempt),
            ),
          finalName,
        );
        assert.equal(
          jobBlock(workflow, finalJob)
            .match(/artifact-ids: (.*)/u)?.[1]
            ?.replace(
              "${{ needs.plan.outputs.source_receipt_artifact_id }}",
              String(scenario.artifactId),
            ),
          String(scenario.artifactId),
        );
      }
      assert.throws(() =>
        assertReceiptAttempts(
          workflow.replace(
            "name: release-source-receipt-${{ github.run_attempt }}",
            "name: release-source-receipt",
          ),
          finalJob,
        ),
      );
      assert.throws(() =>
        assertReceiptAttempts(
          workflow.replace(
            "name: release-source-complete-${{ github.run_attempt }}",
            "name: release-source-complete",
          ),
          finalJob,
        ),
      );
      assert.throws(() =>
        assertReceiptAttempts(
          workflow.replace(
            "artifact-ids: ${{ needs.plan.outputs.source_receipt_artifact_id }}",
            "name: release-source-receipt-${{ github.run_attempt }}",
          ),
          finalJob,
        ),
      );
    });
  }

  it("keeps permissions at the owning job", () => {
    assertReleasePermissions(releaseWorkflow);
    assert.throws(
      () => assertReleasePermissions(overprivilegedFinalize),
      /finalize permissions differ from the release policy/u,
    );
  });
});

/**
 * @param {string} workflow
 * @param {string} key
 */
function topLevelBlock(workflow, key) {
  const marker = `${key}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow must declare ${key}`);
  const remainder = workflow.slice(start + marker.length);
  const end = remainder.search(/^\S[^\n]*:\n/mu);
  return (end === -1 ? remainder : remainder.slice(0, end)).trimEnd();
}

/**
 * @param {string} workflow
 * @param {string} job
 */
function jobBlock(workflow, job) {
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf("jobs:\n"));
  assert.notEqual(start, -1, `workflow must declare ${job}`);
  const remainder = workflow.slice(start + marker.length);
  const end = remainder.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
  return marker + (end === -1 ? remainder : remainder.slice(0, end));
}

/**
 * @param {string} workflow
 * @param {string} job
 */
function jobPermissions(workflow, job) {
  const block = jobBlock(workflow, job);
  const marker = "    permissions:\n";
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `${job} must declare permissions`);
  return Object.fromEntries(
    [
      ...block
        .slice(start + marker.length)
        .matchAll(/^ {6}([a-z-]+): (read|write)$/gmu),
    ].map(
      ([, name = "", access = ""]) => /** @type {const} */ ([name, access]),
    ),
  );
}

/** @param {string} workflow */
function assertReleasePermissions(workflow) {
  const expected = {
    plan: { contents: "read", actions: "read" },
    ci: { contents: "read" },
    "build-images": { contents: "read", packages: "write" },
    finalize: { actions: "read", contents: "write" },
  };
  for (const [job, permissions] of Object.entries(expected)) {
    if (!isDeepStrictEqual(jobPermissions(workflow, job), permissions)) {
      throw new Error(`${job} permissions differ from the release policy`);
    }
  }
}

/** @param {string} workflow @param {string} finalJob */
function assertReceiptAttempts(workflow, finalJob) {
  const plan = jobBlock(workflow, "plan");
  const final = jobBlock(workflow, finalJob);
  assert.match(
    plan,
    /source_receipt_artifact_id: \$\{\{ steps\.source_receipt\.outputs\.artifact-id \}\}/u,
  );
  assert.match(
    plan,
    /Retain selected source and evidence receipt\n {8}id: source_receipt\n {8}uses: actions\/upload-artifact@/u,
  );
  assert.match(
    plan,
    /name: release-source-receipt-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(
    final,
    /artifact-ids: \$\{\{ needs\.plan\.outputs\.source_receipt_artifact_id \}\}\n {10}path: source-receipt\n {10}merge-multiple: true/u,
  );
  assert.match(
    final,
    /name: release-source-complete-\$\{\{ github\.run_attempt \}\}/u,
  );
}
