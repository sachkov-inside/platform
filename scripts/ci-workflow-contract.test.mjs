// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { readPackageManifest } from "./package-manifest.mjs";

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
const setupAction = readFileSync(
  resolve(repositoryRoot, ".github/actions/setup-platform/action.yml"),
  "utf8",
);
/**
 * Сторонний action закреплён коммитом: тег можно перезаписать, и чужой код выполнится с токеном
 * задачи. Комментарий хранит версию для человека и для Dependabot.
 */
const commitPinnedAction = /^[^@\s]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u;
/** @param {string} source */
const actionReferenceLines = (source) =>
  [...source.matchAll(/^\s+-?\s*uses:\s*(.+)$/gmu)].map(
    // The capture group is mandatory, so every match carries it.
    ([, reference = ""]) => reference.trim(),
  );
const rootScripts = readPackageManifest(
  resolve(repositoryRoot, "package.json"),
).scripts;
/** Каждая часть `pnpm check` идёт своей задачей; порядок совпадает с агрегатом. */
/** @type {[job: string, script: string][]} */
const checkStages = [
  ["static", "check:static"],
  ["unit", "check:unit"],
  ["ui", "check:ui"],
  ["web-e2e", "check:web-e2e"],
];
const requiredJobs = [
  ...checkStages.map(([job]) => job),
  "integration",
  "integration-serial",
  "compose-development",
  "compose-production",
  "telegram",
];

describe("application CI workflow contract", () => {
  it("checks Telegram on isolated PostgreSQL and non-guest RabbitMQ at the captured source SHA", () => {
    const telegram = jobBlock("telegram");
    assert.match(
      telegram,
      /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/u,
    );
    assert.match(telegram, /uses: \.\/\.github\/actions\/setup-platform$/mu);
    assert.match(
      telegram,
      /run: pnpm --filter @inside\/telegram check:full$/mu,
    );
    assert.match(
      telegram,
      /image: public\.ecr\.aws\/docker\/library\/postgres:18\.4-alpine@sha256:[a-f0-9]{64}$/mu,
    );
    assert.match(
      telegram,
      /image: public\.ecr\.aws\/docker\/library\/rabbitmq:4\.3-management-alpine@sha256:[a-f0-9]{64}$/mu,
    );
    assert.match(telegram, /RABBITMQ_DEFAULT_USER: telegram_checks/u);
    assert.match(
      telegram,
      /DATABASE_URL: postgresql:\/\/inside:inside@127\.0\.0\.1:5432\/inside_telegram/u,
    );
    assert.match(
      telegram,
      /NOTIFICATION_TEST_AMQP_URL: amqp:\/\/telegram_checks:telegram_checks@127\.0\.0\.1:5672/u,
    );
    assert.match(
      telegram,
      /NOTIFICATION_TEST_MANAGEMENT_URL: http:\/\/127\.0\.0\.1:15672/u,
    );
    assert.doesNotMatch(telegram, /environment:|secrets\.|docker compose/u);
  });

  it("rejects unsuccessful or missing Telegram results through the executable CI Gate", () => {
    const gate = jobBlock("ci-gate");
    const command = gate.split("        run: |\n")[1];
    assert.ok(command);
    const shell = command.replace(/^ {10}/gmu, "");
    const resultNames = [...gate.matchAll(/^ {10}([A-Z0-9_]+_RESULT):/gmu)].map(
      ([, name = ""]) => name,
    );
    for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
      const env = Object.fromEntries(
        resultNames.map((name) => [name, "success"]),
      );
      env["TELEGRAM_RESULT"] = result;
      const run = spawnSync(
        "/bin/bash",
        ["--noprofile", "--norc", "-eu", "-c", shell],
        { env, encoding: "utf8" },
      );
      assert.equal(
        run.status,
        result === "success" ? 0 : 1,
        `Telegram result ${JSON.stringify(result)}: ${run.stderr}`,
      );
    }
  });

  it("runs for main pull requests, the merge queue and reusable workflow calls", () => {
    const triggers = topLevelBlock("on");

    assert.match(triggers, /^ {2}pull_request:\n {4}branches:\n {6}- main$/mu);
    // The merge queue proves the combined result before main moves; without this trigger the
    // queue would wait forever for CI Gate.
    assert.match(triggers, /^ {2}merge_group:$/mu);
    assert.match(triggers, /^ {2}workflow_call:$/mu);
    assert.doesNotMatch(triggers, /^ {2}push:/mu);
    assert.doesNotMatch(triggers, /pull_request_target/u);
    assert.match(
      topLevelBlock("concurrency"),
      /github\.event\.pull_request\.number \|\| github\.event\.merge_group\.head_ref \|\| github\.run_id/u,
    );
    assert.match(topLevelBlock("concurrency"), /cancel-in-progress: true/u);
  });

  it("isolates reruns from first attempts so stale recovery cannot cancel a newer commit", () => {
    assert.match(
      topLevelBlock("concurrency"),
      /\$\{\{ github\.run_attempt > 1 && format\('-rerun-\{0\}', github\.run_id\) \|\| '' \}\}/u,
    );
  });

  it("keeps the workflow read-only and independent of secrets", () => {
    assert.equal(topLevelBlock("permissions").trim(), "contents: read");
    assert.doesNotMatch(workflow, /^ {2,}permissions:/mu);
    assert.doesNotMatch(workflow, /secrets\./u);
    assert.doesNotMatch(workflow, /packages:\s*write/u);
  });

  it("pins every action to a release commit", () => {
    const actionReferences = [workflow, setupAction].flatMap(
      actionReferenceLines,
    );
    const remoteReferences = actionReferences.filter(
      (reference) => !reference.startsWith("./"),
    );

    assert.ok(remoteReferences.length > 0);
    for (const reference of remoteReferences) {
      assert.match(reference, commitPinnedAction);
    }
    for (const reference of actionReferences.filter((value) =>
      value.startsWith("./"),
    )) {
      assert.equal(reference, "./.github/actions/setup-platform");
    }
    for (const action of [
      "actions/checkout",
      "actions/setup-node",
      "pnpm/action-setup",
      "actions/upload-artifact",
    ]) {
      assert.ok(
        actionReferences.some((reference) =>
          reference.startsWith(`${action}@`),
        ),
        `${action} must be used by the workflow`,
      );
    }
  });

  it("runs every stage of pnpm check as its own job", () => {
    assert.equal(
      rootScripts["check"],
      `bash scripts/heavy-check.sh bash -c '${checkStages.map(([, script]) => `pnpm ${script}`).join(" && ")} "$@"' --`,
    );
    for (const [job, script] of checkStages) {
      assert.match(
        jobBlock(job),
        new RegExp(`run: pnpm ${escapeRegExp(script)}$`, "mu"),
      );
      assert.match(
        jobBlock(job),
        /uses: \.\/\.github\/actions\/setup-platform$/mu,
      );
    }
    assert.doesNotMatch(workflow, /run: pnpm check$/mu);
    assert.match(jobBlock("ui"), /browsers: chromium webkit$/mu);
    assert.match(jobBlock("web-e2e"), /browsers: chromium$/mu);
  });

  it("installs frozen dependencies and cached browser engines in one place", () => {
    assert.match(setupAction, /run: pnpm install --frozen-lockfile$/mu);
    assert.match(setupAction, /uses: actions\/cache@/u);
    assert.match(setupAction, /path: ~\/\.cache\/ms-playwright$/mu);
    assert.match(
      setupAction,
      /key: playwright-.*steps\.playwright\.outputs\.version/u,
    );
    assert.match(
      setupAction,
      /bash scripts\/install-playwright-ci\.sh \$BROWSERS$/mu,
    );
    assert.doesNotMatch(workflow, /pnpm install/u);
  });

  // Зеркало Ubuntu отдавало пакеты WebKit с паузами по 30 с, и установка не успевала за таймаут
  // задачи (#827).
  it("installs Playwright system packages from a cache that only main saves", () => {
    const step = (/** @type {string} */ name) => {
      const start = setupAction.indexOf(`- name: ${name}\n`);
      assert.notEqual(start, -1, `setup action must have step ${name}`);
      const next = setupAction.indexOf("\n    - name: ", start + 1);
      return setupAction.slice(start, next === -1 ? undefined : next);
    };
    const restore = step("Restore Playwright system packages");
    const install = step("Install browser engines and system dependencies");
    const save = step("Save Playwright system packages");

    assert.ok(
      setupAction.indexOf(restore) < setupAction.indexOf(install) &&
        setupAction.indexOf(install) < setupAction.indexOf(save),
      "system packages must be restored before the install and saved after it",
    );
    for (const block of [restore, save]) {
      assert.match(block, /path: ~\/\.cache\/playwright-apt\/\*\.deb$/mu);
    }
    assert.match(restore, /uses: actions\/cache\/restore@/u);
    assert.match(
      restore,
      /key: playwright-apt-.*inputs\.browsers.*steps\.playwright\.outputs\.version.*steps\.playwright\.outputs\.image/u,
    );
    assert.match(
      restore,
      /restore-keys: playwright-apt-\$\{\{ runner\.os \}\}-\$\{\{ inputs\.browsers \}\}-$/mu,
    );
    const archivesConfig = install.search(
      /^ {8}echo "Dir::Cache::Archives \\"\$apt_archives\/\\";" \| sudo tee \/etc\/apt\/apt\.conf\.d\/99playwright-archives >\/dev\/null$/mu,
    );
    assert.notEqual(archivesConfig, -1, "apt must read the cached archives");
    assert.ok(
      archivesConfig < install.indexOf("bash scripts/install-playwright-ci.sh"),
      "apt must read the cached archives before Playwright installs system packages",
    );
    assert.match(install, /apt-get autoclean$/mu);
    assert.match(save, /uses: actions\/cache\/save@/u);
    assert.match(
      save,
      /^ {6}if: \$\{\{ inputs\.browsers != '' && github\.ref == 'refs\/heads\/main' && steps\.system-packages\.outputs\.cache-hit != 'true' \}\}$/mu,
    );
    assert.match(
      save,
      /key: \$\{\{ steps\.system-packages\.outputs\.cache-primary-key \}\}$/mu,
    );
  });

  it("runs every required job on pinned GitHub-hosted runners", () => {
    for (const job of requiredJobs) {
      const body = jobBlock(job);
      assert.match(body, /^ {4}runs-on: ubuntu-24\.04$/mu);
      assert.match(body, /^ {4}timeout-minutes: \d+$/mu);
    }

    assert.match(
      jobBlock("integration"),
      /run: pnpm test:integration:parallel$/mu,
    );
    assert.match(jobBlock("integration"), /run: pnpm smoke:enrollments$/mu);
    assert.match(
      jobBlock("integration-serial"),
      /run: pnpm test:integration:serial$/mu,
    );
    for (const job of ["integration", "integration-serial"]) {
      assert.doesNotMatch(jobBlock(job), /services:/u);
    }

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
      jobBlock("compose-development").match(
        /bash scripts\/compose-stack-smoke\.sh/gu,
      )?.length,
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
    assert.ok(
      writeObjectStorageProbe > -1 && writeObjectStorageProbe < restart,
    );
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
    assert.equal(
      workflow.match(/uses: actions\/upload-artifact@/gu)?.length,
      5,
    );
    assert.equal(workflow.match(/^\s+retention-days: 7$/gmu)?.length, 5);
    assert.equal(
      workflow.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length,
      6,
    );
    // A failed smoke keeps the Playwright results and the dev-server log (#863).
    assert.match(jobBlock("integration"), /apps\/web\/test-results/u);
    assert.match(jobBlock("integration"), /apps\/web\/\.next\/dev\/logs/u);
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

  it("keeps Web E2E recordings and HTML call logs separate for each CI attempt", () => {
    const webE2E = jobBlock("web-e2e");
    const upload = webE2E.slice(
      webE2E.indexOf("      - name: Upload Playwright diagnostics\n"),
    );
    assert.match(upload, /if: \$\{\{ failure\(\) \}\}/u);
    assert.match(upload, /uses: actions\/upload-artifact@/u);
    assert.match(
      upload,
      /name: web-e2e-playwright-\$\{\{ github\.run_attempt \}\}/u,
    );
    assert.match(upload, /^ {12}apps\/web\/playwright-report$/mu);
    assert.match(upload, /^ {12}apps\/web\/test-results$/mu);
    assert.doesNotMatch(upload, /overwrite: true/u);
  });

  it("uploads WebKit browser-engine diagnostics separately for each CI attempt", () => {
    const job = jobBlock("ui");
    assert.equal(job.match(/uses: actions\/upload-artifact@/gu)?.length, 1);
    assert.match(job, /if: \$\{\{ failure\(\) \}\}/u);
    assert.match(
      job,
      /name: browser-engines-playwright-\$\{\{ github.run_attempt \}\}/u,
    );
    assert.match(job, /path: apps\/web\/test-results\/browser-engines/u);
    assert.match(job, /if-no-files-found: ignore/u);
    assert.match(job, /retention-days: 7/u);
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
    assert.equal(
      topLevelBlock("permissions", nightlyWorkflow).trim(),
      "contents: read",
    );
    assert.doesNotMatch(
      jobBlock("full-stack", nightlyWorkflow),
      /permissions:/u,
    );
    assert.doesNotMatch(nightlyWorkflow, /secrets\./u);
    const actionReferences = actionReferenceLines(nightlyWorkflow);
    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) {
      assert.match(reference, commitPinnedAction);
    }
  });

  it("reports main failures in an assigned issue through a separate write-permission job", () => {
    const reporter = jobBlock("report-failure", nightlyWorkflow);
    assert.match(reporter, /^ {4}needs: full-stack$/mu);
    assert.match(
      reporter,
      /always\(\) && needs\.full-stack\.result == 'failure' && github\.ref == 'refs\/heads\/main'/u,
    );
    assert.match(reporter, /^ {6}issues: write$/mu);
    assert.match(reporter, /^ {6}contents: read$/mu);
    assert.match(reporter, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
    assert.match(
      reporter,
      /run: bash scripts\/report-nightly-fullstack-failure\.sh$/mu,
    );
    assert.match(jobBlock("full-stack", nightlyWorkflow), /runner-load\.txt/u);
  });

  it("starts Compose infrastructure before the smoke and always removes it", () => {
    const job = jobBlock("full-stack", nightlyWorkflow);

    assert.match(job, /^ {4}runs-on: ubuntu-24\.04$/mu);
    assert.match(job, /^ {4}timeout-minutes: \d+$/mu);
    const steps = [
      "pnpm install --frozen-lockfile",
      "bash scripts/install-playwright-ci.sh chromium",
      "cp .env.example .env",
      "run: pnpm infra:up",
      "pnpm smoke:fullstack",
    ].map((command) => {
      const index = job.indexOf(command);
      assert.notEqual(index, -1, `nightly job must run ${command}`);
      return index;
    });
    assert.deepEqual(
      steps,
      [...steps].sort((left, right) => left - right),
    );
    // The smoke owns its check database; an exported URL would point it elsewhere.
    assert.doesNotMatch(job, /DATABASE_URL/u);
    assert.match(
      job,
      /if: \$\{\{ always\(\) \}\}\n {8}run: docker compose down --volumes --remove-orphans/u,
    );
  });

  it("uploads Playwright diagnostics only after a failure", () => {
    const job = jobBlock("full-stack", nightlyWorkflow);

    assert.equal(job.match(/uses: actions\/upload-artifact@/gu)?.length, 1);
    assert.match(job, /^ {12}apps\/web\/playwright-report$/mu);
    assert.match(job, /^ {12}apps\/web\/test-results$/mu);
    assert.match(
      job,
      /name: nightly-fullstack-diagnostics-\$\{\{ github\.run_attempt \}\}/u,
    );
    assert.doesNotMatch(job, /overwrite: true/u);
    assert.match(job, /^\s+retention-days: 7$/mu);
    assert.equal(job.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length, 2);
  });

  it("is not part of the pull-request gate", () => {
    assert.doesNotMatch(workflow, /nightly/u);
    assert.doesNotMatch(jobBlock("ci-gate"), /full-stack/u);
  });
});

/**
 * @param {string} key
 * @param {string} [source]
 */
function topLevelBlock(key, source = workflow) {
  const marker = `${key}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `workflow must declare ${key}`);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const end = remainder.search(/^\S[^\n]*:\n/mu);
  return (end === -1 ? remainder : remainder.slice(0, end)).trimEnd();
}

/**
 * @param {string} job
 * @param {string} [source]
 */
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

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("repository-owned workflow supply chain", () => {
  const ownedSources = [
    ...readdirSync(resolve(repositoryRoot, ".github/workflows")).map(
      (name) => `.github/workflows/${name}`,
    ),
    ...readdirSync(resolve(repositoryRoot, ".github/actions")).map(
      (name) => `.github/actions/${name}/action.yml`,
    ),
  ];

  it("pins every third-party action in every owned workflow to a release commit", () => {
    assert.ok(ownedSources.includes(".github/workflows/release.yml"));
    for (const path of ownedSources) {
      const references = actionReferenceLines(
        readFileSync(resolve(repositoryRoot, path), "utf8"),
      ).filter((reference) => !reference.startsWith("./"));
      for (const reference of references) {
        assert.match(reference, commitPinnedAction, `${path}: ${reference}`);
      }
    }
  });

  it("rejects a tag-only reference", () => {
    assert.doesNotMatch("actions/checkout@v7.0.1", commitPinnedAction);
    assert.doesNotMatch(
      `actions/checkout@${"a".repeat(40)}`,
      commitPinnedAction,
    );
  });
});

describe("production access pass workflow", () => {
  const productionAccess = readFileSync(
    resolve(repositoryRoot, ".github/workflows/production-access.yml"),
    "utf8",
  );

  it("binds the pass job to Production for environment secrets", () => {
    const job = productionAccess.split("\n  pass:\n")[1];
    assert.ok(job, "missing job pass");
    assert.match(job, /^ {4}environment: Production$/mu);
    assert.match(
      job,
      /PRODUCTION_ACCESS_LOGTO_APP_SECRET:\s*\$\{\{\s*secrets\.PRODUCTION_ACCESS_LOGTO_APP_SECRET\s*\}\}/u,
    );
  });

  /**
   * Репозиторий публичный, а GitHub печатает env шага в логе и маскирует только secrets (#929).
   * Из variables проход берёт лишь id приложения Logto: он не секрет и не персональные данные.
   */
  it("takes only the Logto application id from variables", () => {
    const variables = [
      ...productionAccess.matchAll(/\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/gu),
    ].map(([, name]) => name);
    assert.deepEqual(variables, ["PRODUCTION_ACCESS_LOGTO_APP_ID"]);
    assert.match(
      productionAccess,
      /PRODUCTION_ACCESS_MAILBOX:\s*\$\{\{\s*secrets\.PRODUCTION_ACCESS_MAILBOX\s*\}\}/u,
    );
  });
});
