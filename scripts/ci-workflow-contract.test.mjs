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
const nightlyWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/nightly-fullstack.yml"),
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

  it("runs all four required checks on pinned GitHub-hosted runners", () => {
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
    // The clean-stack smoke reads the published demo; the shared stand keeps it hidden.
    assert.match(jobBlock("compose-development"), /LOCAL_SEED_VIEW: checks/u);
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
      "--data-binary survived-restart http://127.0.0.1:9000/inside-ci/persistence-probe.txt",
    );
    const restart = developmentCompose.indexOf("docker compose down");
    const readPostgresProbe = developmentCompose.indexOf(
      "select marker from ci_smoke.persistence_probe",
    );
    const readObjectStorageProbe = developmentCompose.indexOf(
      "s3 http://127.0.0.1:9000/inside-ci/persistence-probe.txt",
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
  });

  it("uploads only bounded failure diagnostics for seven days", () => {
    assert.equal(workflow.match(/uses: actions\/upload-artifact@/gu)?.length, 3);
    assert.equal(workflow.match(/^\s+retention-days: 7$/gmu)?.length, 3);
    assert.equal(workflow.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length, 4);
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

describe("nightly full-stack workflow contract", () => {
  it("runs on a nightly schedule and on demand, never for pull requests or pushes", () => {
    const triggers = topLevelBlock("on", nightlyWorkflow);

    assert.match(triggers, /^ {2}schedule:\n {4}- cron: "[^"]+"$/mu);
    assert.match(triggers, /^ {2}workflow_dispatch:$/mu);
    assert.doesNotMatch(triggers, /pull_request/u);
    assert.doesNotMatch(triggers, /^ {2}push:/mu);
    assert.doesNotMatch(triggers, /workflow_call/u);
  });

  it("never overlaps another run of the same ref", () => {
    const concurrency = topLevelBlock("concurrency", nightlyWorkflow);

    assert.match(concurrency, /group: platform-nightly-fullstack-/u);
    assert.match(concurrency, /cancel-in-progress: false/u);
  });

  it("stays read-only, secret-free and pinned", () => {
    assert.equal(topLevelBlock("permissions", nightlyWorkflow).trim(), "contents: read");
    assert.doesNotMatch(nightlyWorkflow, /^ {2,}permissions:/mu);
    assert.doesNotMatch(nightlyWorkflow, /secrets\./u);
    const actionReferences = [
      ...nightlyWorkflow.matchAll(/^\s+-?\s*uses:\s*([^\s#]+)/gmu),
    ].map((match) => match[1]);
    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) {
      assert.match(reference, /^[^@\s]+@v\d+\.\d+\.\d+$/u);
    }
  });

  it("starts Compose infrastructure before the smoke and always removes it", () => {
    const job = jobBlock("full-stack", nightlyWorkflow);

    assert.match(job, /^ {4}runs-on: ubuntu-24\.04$/mu);
    assert.match(job, /^ {4}timeout-minutes: \d+$/mu);
    const steps = [
      "pnpm install --frozen-lockfile",
      "playwright install --with-deps chromium",
      "cp .env.example .env",
      "run: pnpm infra:up",
      "run: pnpm smoke:fullstack",
    ].map((command) => {
      const index = job.indexOf(command);
      assert.notEqual(index, -1, `nightly job must run ${command}`);
      return index;
    });
    assert.deepEqual(steps, [...steps].sort((left, right) => left - right));
    // The smoke owns its check database; an exported URL would point it elsewhere.
    assert.doesNotMatch(job, /DATABASE_URL/u);
    assert.match(job, /if: \$\{\{ always\(\) \}\}\n {8}run: docker compose down --volumes --remove-orphans/u);
  });

  it("uploads Playwright diagnostics only after a failure", () => {
    const job = jobBlock("full-stack", nightlyWorkflow);

    assert.equal(job.match(/uses: actions\/upload-artifact@/gu)?.length, 1);
    assert.match(job, /^ {12}apps\/web\/playwright-report$/mu);
    assert.match(job, /^ {12}apps\/web\/test-results$/mu);
    assert.match(job, /^\s+retention-days: 7$/mu);
    assert.equal(job.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length, 2);
  });

  it("is not part of the pull-request gate", () => {
    assert.doesNotMatch(workflow, /nightly/u);
    assert.doesNotMatch(jobBlock("ci-gate"), /full-stack/u);
  });
});

function topLevelBlock(key, source = workflow) {
  const marker = `${key}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `workflow must declare ${key}`);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const end = remainder.search(/^\S[^\n]*:\n/mu);
  return (end === -1 ? remainder : remainder.slice(0, end)).trimEnd();
}

function jobBlock(job, source = workflow) {
  const jobsStart = source.indexOf("jobs:\n");
  assert.notEqual(jobsStart, -1, "workflow must declare jobs");
  const marker = `  ${job}:\n`;
  const start = source.indexOf(marker, jobsStart);
  assert.notEqual(start, -1, `workflow must declare ${job}`);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const end = remainder.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
  return marker + (end === -1 ? remainder : remainder.slice(0, end));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
