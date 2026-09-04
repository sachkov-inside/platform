import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/deploy.yml"),
  "utf8",
);
const unsafeWorkflows = [
  "unsafe-checkout.yml",
  "unsafe-permissions.yml",
  "unsafe-ssh.yml",
].map((name) => [
  name,
  readFileSync(
    resolve(repositoryRoot, "scripts/fixtures/deployment", name),
    "utf8",
  ),
]);

describe("production deployment workflow", () => {
  it("queues manual deploy and rollback commands without rebuilding a release", () => {
    assert.match(workflow, /^ {2}workflow_dispatch:$/mu);
    assert.match(workflow, /^ {6}operation:$/mu);
    assert.match(workflow, /^ {10}- deploy$/mu);
    assert.match(workflow, /^ {10}- rollback$/mu);
    assert.match(workflow, /^ {6}version:$/mu);
    assert.match(workflow, /^ {2}group: platform-production-deployment$/mu);
    assert.match(workflow, /^ {2}queue: max$/mu);
    assert.doesNotMatch(workflow, /cancel-in-progress/u);
    assert.match(workflow, /^ {4}environment: Production$/mu);
    assert.match(workflow, /^ {6}actions: read$/mu);
    assert.match(workflow, /^ {6}contents: read$/mu);
    assert.doesNotMatch(workflow, /actions\/checkout|docker build|pnpm|npm |yarn /u);
  });

  it("rechecks the immutable release before using the restricted SSH command", () => {
    assert.equal(workflow.match(/gh release view/gu)?.length, 2);
    assert.match(workflow, /isImmutable/u);
    assert.match(workflow, /actions\/runs/u);
    assert.match(workflow, /release-manifest\.json/u);
    assert.match(workflow, /production-runtime\.tar\.gz/u);
    assert.match(workflow, /StrictHostKeyChecking=yes/u);
    assert.match(workflow, /BatchMode=yes/u);
    assert.match(
      workflow,
      /inside-deploy@\$\{\{ secrets\.PRODUCTION_SSH_HOST \}\}/u,
    );
    assert.match(workflow, /"\$OPERATION \$VERSION \$GITHUB_RUN_ID"/u);
    assert.doesNotMatch(workflow, /ssh root@|StrictHostKeyChecking=accept-new/u);
  });

  it("keeps the deployment execution boundary closed", () => {
    assertDeploymentSafety(workflow);
  });

  for (const [name, unsafeWorkflow] of unsafeWorkflows) {
    it(`rejects the unsafe deployment fixture ${name}`, () => {
      assert.throws(() => assertDeploymentSafety(unsafeWorkflow));
    });
  }
});

function assertDeploymentSafety(candidate) {
  assert.match(candidate, /^permissions: \{\}$/mu);
  assert.match(candidate, /^ {6}actions: read$/mu);
  assert.match(candidate, /^ {6}contents: read$/mu);
  assert.doesNotMatch(candidate, /^ {6}(?:actions|contents|packages): write$/mu);
  assert.doesNotMatch(candidate, /actions\/checkout|docker build|pnpm|npm |yarn /u);
  assert.match(candidate, /StrictHostKeyChecking=yes/u);
  assert.match(candidate, /BatchMode=yes/u);
  assert.match(
    candidate,
    /inside-deploy@\$\{\{ secrets\.PRODUCTION_SSH_HOST \}\}/u,
  );
  assert.doesNotMatch(
    candidate,
    /ssh root@|StrictHostKeyChecking=accept-new|StrictHostKeyChecking=no/u,
  );
}
