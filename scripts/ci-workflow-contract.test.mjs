import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const productionSmoke = readFileSync(
  resolve(repositoryRoot, "scripts/production-compose-smoke.sh"),
  "utf8",
);
const requiredJobs = [
  "quality",
  "integration",
  "compose-development",
  "compose-production",
  "production-foundation",
];

describe("application CI workflow contract", () => {
  it("runs only for main pull requests and reusable workflow calls", () => {
    const triggers = topLevelBlock("on");

    assert.match(triggers, /^ {2}pull_request:\n {4}branches:\n {6}- main$/mu);
    assert.match(triggers, /^ {2}workflow_call:$/mu);
    assert.doesNotMatch(triggers, /^ {2}push:/mu);
    assert.doesNotMatch(triggers, /pull_request_target/u);
    assert.match(
      topLevelBlock("concurrency"),
      /github\.event\.pull_request\.number \|\| github\.run_id/u,
    );
    assert.match(topLevelBlock("concurrency"), /cancel-in-progress: true/u);
  });

  it("keeps the workflow read-only and independent of secrets", () => {
    assert.equal(topLevelBlock("permissions").trim(), "contents: read");
    assert.doesNotMatch(workflow, /^ {2,}permissions:/mu);
    assert.doesNotMatch(workflow, /secrets\./u);
    assert.doesNotMatch(workflow, /packages:\s*write/u);
  });

  it("pins every action to an exact release version", () => {
    const actionReferences = [
      ...workflow.matchAll(/^\s+-?\s*uses:\s*([^\s#]+)/gmu),
    ].map((match) => match[1]);

    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) {
      assert.match(reference, /^[^@\s]+@v\d+\.\d+\.\d+$/u);
    }
    for (const action of [
      "actions/checkout",
      "actions/setup-node",
      "pnpm/action-setup",
      "actions/upload-artifact",
    ]) {
      assert.ok(
        actionReferences.some((reference) => reference.startsWith(`${action}@`)),
        `${action} must be used by the workflow`,
      );
    }
  });

  it("runs all five required checks on pinned GitHub-hosted runners", () => {
    for (const job of requiredJobs) {
      const body = jobBlock(job);
      assert.match(body, /^ {4}runs-on: ubuntu-24\.04$/mu);
      assert.match(body, /^ {4}timeout-minutes: \d+$/mu);
    }

    assert.match(jobBlock("quality"), /pnpm install --frozen-lockfile/u);
    assert.match(jobBlock("quality"), /playwright install --with-deps chromium/u);
    assert.match(jobBlock("quality"), /run: pnpm check/u);

    assert.match(jobBlock("integration"), /pnpm install --frozen-lockfile/u);
    assert.match(jobBlock("integration"), /run: pnpm test:integration/u);
    assert.doesNotMatch(jobBlock("integration"), /services:/u);

    assert.doesNotMatch(workflow, /^ {2}full-stack:/mu);
    assert.doesNotMatch(workflow, /pnpm smoke:fullstack/u);

    assert.match(
      jobBlock("compose-development"),
      /docker compose --profile storybook config --quiet/u,
    );
    assert.match(
      jobBlock("compose-development"),
      /docker compose --profile storybook build/u,
    );
    assert.equal(
      jobBlock("compose-development").match(/bash scripts\/compose-stack-smoke\.sh/gu)
        ?.length,
      2,
    );
    const developmentCompose = jobBlock("compose-development");
    const writePostgresProbe = developmentCompose.indexOf(
      "insert into ci_smoke.persistence_probe",
    );
    const writeObjectStorageProbe = developmentCompose.indexOf(
      "mc pipe ci/inside-ci/persistence-probe.txt",
    );
    const restart = developmentCompose.indexOf("docker compose down");
    const readPostgresProbe = developmentCompose.indexOf(
      "select marker from ci_smoke.persistence_probe",
    );
    const readObjectStorageProbe = developmentCompose.indexOf(
      "mc cat ci/inside-ci/persistence-probe.txt",
    );
    assert.ok(writePostgresProbe > -1 && writePostgresProbe < restart);
    assert.ok(writeObjectStorageProbe > -1 && writeObjectStorageProbe < restart);
    assert.ok(readPostgresProbe > restart);
    assert.ok(readObjectStorageProbe > restart);
    assert.match(
      developmentCompose,
      /test "\$postgres_marker" = "survived-restart"/u,
    );
    assert.match(
      developmentCompose,
      /test "\$object_storage_marker" = "survived-restart"/u,
    );
    assert.match(
      jobBlock("compose-development"),
      /docker compose down --volumes --remove-orphans/u,
    );

    assert.match(
      jobBlock("compose-production"),
      /run: pnpm compose:production:smoke/u,
    );
    assert.match(
      jobBlock("production-foundation"),
      /host-foundation\.py install-secret-tools/u,
    );
    assert.match(
      jobBlock("production-foundation"),
      /run: pnpm foundation:smoke/u,
    );
  });

  it("uploads only bounded failure diagnostics for seven days", () => {
    assert.equal(workflow.match(/uses: actions\/upload-artifact@/gu)?.length, 4);
    assert.equal(workflow.match(/^\s+retention-days: 7$/gmu)?.length, 4);
    assert.equal(workflow.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length, 5);
    assert.match(workflow, /docker compose logs --no-color --tail 500/u);
    assert.doesNotMatch(workflow, /\.ci-artifacts/u);
    assert.match(
      jobBlock("compose-production"),
      /PRODUCTION_SMOKE_ARTIFACT_DIR: ci-artifacts\/compose-production/u,
    );
    assert.match(
      productionSmoke,
      /artifact_dir="\$\{PRODUCTION_SMOKE_ARTIFACT_DIR:-\}"/u,
    );
    assert.match(productionSmoke, /logs --no-color --tail 500/u);
    assert.ok(
      productionSmoke.indexOf("logs --no-color --tail 500") <
        productionSmoke.indexOf("down --rmi local --volumes --remove-orphans"),
      "production diagnostics must be captured before cleanup",
    );
  });

  it("exposes one stable gate that fails closed over every required job", () => {
    const gate = jobBlock("ci-gate");

    assert.match(gate, /^ {4}name: CI Gate$/mu);
    assert.match(gate, /^ {4}if: \$\{\{ always\(\) \}\}$/mu);
    for (const job of requiredJobs) {
      assert.match(gate, new RegExp(`^      - ${escapeRegExp(job)}$`, "mu"));
      assert.match(
        gate,
        new RegExp(`needs\\.${escapeRegExp(job)}\\.result`, "u"),
      );
    }
    assert.match(gate, /if \[\[ "\$result" != "success" \]\]/u);
  });
});

function topLevelBlock(key) {
  const marker = `${key}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow must declare ${key}`);
  const bodyStart = start + marker.length;
  const remainder = workflow.slice(bodyStart);
  const end = remainder.search(/^\S[^\n]*:\n/mu);
  return (end === -1 ? remainder : remainder.slice(0, end)).trimEnd();
}

function jobBlock(job) {
  const jobsStart = workflow.indexOf("jobs:\n");
  assert.notEqual(jobsStart, -1, "workflow must declare jobs");
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker, jobsStart);
  assert.notEqual(start, -1, `workflow must declare ${job}`);
  const bodyStart = start + marker.length;
  const remainder = workflow.slice(bodyStart);
  const end = remainder.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
  return marker + (end === -1 ? remainder : remainder.slice(0, end));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
