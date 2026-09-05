import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  it("downloads and rechecks its release outside a Git checkout", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-workflow-"));
    try {
      const bundle = "immutable runtime fixture";
      const sourceSha = "1".repeat(40);
      const manifest = {
        schemaVersion: "inside.platform.release-manifest.v2",
        version: "v1",
        source: { repository: "sachkov-inside/platform", sha: sourceSha },
        runtimeBundle: {
          asset: "production-runtime.tar.gz",
          sha256: `sha256:${createHash("sha256").update(bundle).digest("hex")}`,
        },
        publication: { workflowRunId: 91 },
      };
      writeFileSync(resolve(directory, "release-manifest.json"), JSON.stringify(manifest));
      writeFileSync(resolve(directory, "production-runtime.tar.gz"), bundle);
      writeFileSync(resolve(directory, "release.json"), JSON.stringify({
        assets: [{ name: "release-manifest.json" }, { name: "production-runtime.tar.gz" }],
        isImmutable: true,
        tagName: "v1",
        targetCommitish: sourceSha,
      }));
      writeFileSync(resolve(directory, "run.json"), JSON.stringify({
        conclusion: "success", event: "workflow_dispatch", head_sha: sourceSha,
        path: ".github/workflows/release.yml",
      }));
      const gh = resolve(directory, "gh");
      writeFileSync(gh, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == release ]]; then
  [[ " $* " == *" --repo sachkov-inside/platform "* ]] || {
    echo 'No repository selected outside a Git checkout' >&2
    exit 1
  }
fi
case "$1 $2" in
  'release view') cat "$FIXTURE_DIR/release.json" ;;
  'release download')
    while [[ "$1" != --dir ]]; do shift; done
    cp "$FIXTURE_DIR/release-manifest.json" "$FIXTURE_DIR/production-runtime.tar.gz" "$2/"
    ;;
  'api repos/sachkov-inside/platform/actions/runs/91') cat "$FIXTURE_DIR/run.json" ;;
  *) exit 1 ;;
esac
`);
      chmodSync(gh, 0o755);
      for (const name of [
        "Verify and download the selected release",
        "Recheck the selected release after waiting in the queue",
      ]) {
        const step = workflow.split("      - name: ").find((part) => part.startsWith(`${name}\n`));
        assert.ok(step, `missing workflow step: ${name}`);
        const run = step.split("        run: |\n")[1];
        assert.ok(run, `missing shell body: ${name}`);
        const script = run.replace(/^ {10}/gmu, "");
        const result = spawnSync("bash", ["-c", script], {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            FIXTURE_DIR: directory,
            RUNNER_TEMP: directory,
            GITHUB_ENV: resolve(directory, "github.env"),
            GITHUB_REPOSITORY: "sachkov-inside/platform",
            RELEASE_DIR: resolve(directory, "production-release"),
            OPERATION: "deploy",
            VERSION: "v1",
          },
        });
        assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      }
      assert.equal(
        readFileSync(resolve(directory, "production-release/release-manifest.json"), "utf8"),
        JSON.stringify(manifest),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
