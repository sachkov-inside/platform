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
});
