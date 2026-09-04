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
    assert.match(planScript, /git\/ref\/heads\/main/u);
    assert.match(planScript, /immutable-releases/u);
    assert.match(ci, /^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/mu);
    assert.match(ci, /source_sha: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/u);
    assert.equal(
      ciWorkflow.match(/ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/gu)?.length,
      4,
    );
    assert.match(
      ciWorkflow,
      /Build and inspect release images\n {8}if: \$\{\{ github\.event_name == 'pull_request' \}\}/u,
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

    assert.equal(releaseWorkflow.match(/bash scripts\/plan-release\.sh/gu)?.length, 2);
    assert.match(finalize, /build-production-runtime-bundle\.sh/u);
    assert.match(finalize, /release-schema-identity\.sh/u);
    assert.match(finalize, /PREVIOUS_VERSION/u);
    assert.match(finalize, /gh release download "\$PREVIOUS_VERSION"/u);
    assert.match(finalize, /GITHUB_RUN_ID/u);
    assert.match(finalize, /release-contract\.mjs manifest/u);
    assert.match(finalize, /gh release create/u);
    assert.match(finalize, /--target "\$SOURCE_SHA"/u);
    assert.match(finalize, /release-assets\/production-runtime\.tar\.gz/u);
    assert.doesNotMatch(releaseWorkflow, /:latest|--clobber|secrets\./u);
    assert.doesNotMatch(
      releaseWorkflow,
      /anchore|attestation|vulnerabil|waiver|ssh|deploy/iu,
    );
  });

  it("keeps permissions at the owning job", () => {
    assertReleasePermissions(releaseWorkflow);
    assert.throws(
      () => assertReleasePermissions(overprivilegedFinalize),
      /finalize permissions differ from the release policy/u,
    );
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
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf("jobs:\n"));
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
  return Object.fromEntries(
    [...block.slice(start + marker.length).matchAll(/^ {6}([a-z-]+): (read|write)$/gmu)]
      .map((match) => [match[1], match[2]]),
  );
}

function assertReleasePermissions(workflow) {
  const expected = {
    plan: { contents: "read" },
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
