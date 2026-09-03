import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const releaseWorkflow = read(".github/workflows/release.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
const planScript = read("scripts/plan-release.sh");
const permissionFixture = JSON.parse(
  read("scripts/fixtures/release/workflow-permissions.json"),
);

describe("ordinal release workflow contract", () => {
  it("starts only by an owner command and serializes every release", () => {
    const triggers = topLevelBlock(releaseWorkflow, "on");
    const concurrency = topLevelBlock(releaseWorkflow, "concurrency");

    assert.match(triggers, /^ {2}workflow_dispatch:$/mu);
    assert.match(triggers, /^ {6}version:$/mu);
    assert.match(triggers, /^ {8}required: true$/mu);
    assert.doesNotMatch(triggers, /vulnerability|waiver/iu);
    assert.doesNotMatch(triggers, /^ {2}(?:push|pull_request|release):/mu);
    assert.match(concurrency, /^ {2}group: platform-release$/mu);
    assert.match(concurrency, /^ {2}cancel-in-progress: false$/mu);
  });

  it("captures current main once and runs reusable CI for that exact SHA", () => {
    const ciTriggers = topLevelBlock(ciWorkflow, "on");
    const plan = jobBlock(releaseWorkflow, "plan");
    const ci = jobBlock(releaseWorkflow, "ci");

    assert.match(ciTriggers, /^ {2}workflow_call:$/mu);
    assert.match(ciTriggers, /^ {6}source_sha:$/mu);
    assert.match(ciTriggers, /^ {8}required: true$/mu);
    assert.equal(
      ciWorkflow.match(/ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/gu)?.length,
      4,
    );
    assert.match(plan, /bash scripts\/plan-release\.sh/u);
    assert.match(planScript, /git\/ref\/heads\/main/u);
    assert.match(planScript, /immutable-releases/u);
    assert.match(planScript, /repos\/\$\{GITHUB_REPOSITORY\}\/releases/u);
    assert.match(planScript, /release-contract\.mjs plan/u);
    assert.match(plan, /^ {4}outputs:$/mu);
    assert.match(plan, /\.imageMatrix release-plan\.json/u);
    assert.match(plan, /\.manifestAssetName release-plan\.json/u);
    assert.match(ci, /^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/mu);
    assert.match(ci, /source_sha: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/u);
  });

  it("builds and publishes both images once and proves public digest access", () => {
    const build = jobBlock(releaseWorkflow, "build-images");

    for (const dependency of ["plan", "ci"]) {
      assert.match(build, new RegExp(`^      - ${dependency}$`, "mu"));
    }
    assert.match(
      build,
      /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.image_matrix\) \}\}/u,
    );
    assert.match(build, /file: \$\{\{ matrix\.dockerfile \}\}/u);
    assert.match(build, /target: \$\{\{ matrix\.target \}\}/u);
    assert.match(
      build,
      /ref: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/u,
    );
    assert.match(build, /push: true/u);
    assert.match(
      build,
      /tags: \$\{\{ matrix\.imageName \}\}:\$\{\{ needs\.plan\.outputs\.version \}\}/u,
    );
    assert.doesNotMatch(build, /:latest/u);
    assert.match(build, /provenance: false/u);
    assert.match(build, /sbom: false/u);
    assert.doesNotMatch(build, /anchore|actions\/attest|gh attestation|waiver|vulnerabil/iu);
    assert.match(build, /SOURCE_SHA: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/u);
    assert.match(build, /sourceSha: \$sourceSha/u);
    assert.match(build, /docker logout ghcr\.io/u);
    assert.match(build, /docker buildx imagetools inspect/u);
    assert.match(build, /^ {6}packages: write$/mu);
    assert.doesNotMatch(build, /artifact-metadata|attestations|id-token/u);
  });

  it("rechecks main and ordinal state before publishing one immutable release record", () => {
    const finalize = jobBlock(releaseWorkflow, "finalize");

    for (const dependency of ["plan", "ci", "build-images"]) {
      assert.match(finalize, new RegExp(`^      - ${dependency}$`, "mu"));
    }
    assert.match(finalize, /^ {6}actions: read$/mu);
    assert.match(finalize, /^ {6}contents: write$/mu);
    assert.match(finalize, /uses: actions\/download-artifact@v\d+\.\d+\.\d+/u);
    assert.match(finalize, /merge-multiple: true/u);
    assert.match(finalize, /bash scripts\/plan-release\.sh/u);
    assert.equal(releaseWorkflow.match(/bash scripts\/plan-release\.sh/gu)?.length, 2);
    assert.equal(finalize.match(/release-contract\.mjs manifest/gu)?.length, 1);
    assert.match(finalize, /gh release create/u);
    assert.match(finalize, /--target "\$SOURCE_SHA"/u);
    assert.match(finalize, /MANIFEST_ASSET_NAME/u);
    assert.doesNotMatch(releaseWorkflow, /ghcr\.io\/sachkov-inside\/platform-/u);
    assert.doesNotMatch(releaseWorkflow, /release-assets\/release-manifest\.json/u);
    assert.doesNotMatch(finalize, /sbom|provenance|attest|vulnerabil|waiver/iu);
    assert.doesNotMatch(releaseWorkflow, /--clobber/u);
    assert.doesNotMatch(releaseWorkflow, /secrets\./u);
  });

  it("matches the positive permission fixture and rejects over-privileged fixtures", () => {
    assert.match(releaseWorkflow, /^permissions: \{\}$/mu);
    const actual = {
      release: Object.fromEntries(
        Object.keys(permissionFixture.release).map((job) => [
          job,
          jobPermissions(releaseWorkflow, job),
        ]),
      ),
    };

    assertPermissionPolicy(actual, permissionFixture);
    for (const invalid of permissionFixture.invalid) {
      const candidate = structuredClone(actual);
      candidate[invalid.workflow][invalid.job] = invalid.permissions;
      assert.throws(
        () => assertPermissionPolicy(candidate, permissionFixture),
        new RegExp(invalid.job, "u"),
        invalid.name,
      );
    }
  });
});

function topLevelBlock(workflow, key) {
  const marker = `${key}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow must declare ${key}`);
  const remainder = workflow.slice(start + marker.length);
  const end = remainder.search(/^\S[^\n]*:\n/mu);
  return (end === -1 ? remainder : remainder.slice(0, end)).trimEnd();
}

function jobBlock(workflow, job) {
  const jobsStart = workflow.indexOf("jobs:\n");
  assert.notEqual(jobsStart, -1, "workflow must declare jobs");
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker, jobsStart);
  assert.notEqual(start, -1, `workflow must declare ${job}`);
  const remainder = workflow.slice(start + marker.length);
  const end = remainder.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
  return marker + (end === -1 ? remainder : remainder.slice(0, end));
}

function jobPermissions(workflow, job) {
  const block = jobBlock(workflow, job);
  const marker = "    permissions:\n";
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `${job} must declare permissions`);
  const permissions = {};
  const remainder = block.slice(start + marker.length);
  for (const match of remainder.matchAll(/^ {6}([a-z-]+): (read|write)$/gmu)) {
    permissions[match[1]] = match[2];
  }
  assert.ok(Object.keys(permissions).length > 0, `${job} permissions must not be empty`);
  return permissions;
}

function assertPermissionPolicy(actual, fixture) {
  for (const workflow of ["release"]) {
    for (const [job, expected] of Object.entries(fixture[workflow])) {
      if (!isDeepStrictEqual(actual[workflow][job], expected)) {
        throw new Error(`${workflow} ${job} permissions differ from the release policy`);
      }
    }
  }
}
