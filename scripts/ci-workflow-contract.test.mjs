// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ciJobNames,
  coverageIds,
  ciMatrixJobs,
  coverageSupersets,
} from "./ci-coverage-plan.mjs";
import { readPackageManifest } from "./package-manifest.mjs";
import { fullStackProjects } from "./full-stack-options.mjs";

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
const resourceWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/observability-resource.yml"),
  "utf8",
);
const signozWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/observability-signoz.yml"),
  "utf8",
);

/** @param {string} source */
function assertNodeCacheSegmentTimeout(source) {
  const nodeStep =
    source.match(
      /^ {4}- name: Install Node\.js\n([\s\S]*?)(?=\n {4}- name:|(?![\s\S]))/mu,
    )?.[1] ?? "";
  assert.match(nodeStep, /^ {6}uses: actions\/setup-node@/mu);
  assert.match(
    nodeStep,
    /^ {6}env:\n {8}SEGMENT_DOWNLOAD_TIMEOUT_MINS: "2"$/mu,
  );
  assert.equal(
    [...source.matchAll(/SEGMENT_DOWNLOAD_TIMEOUT_MINS/gu)].length,
    1,
    "only setup-node may override the cache segment timeout",
  );
}

/** @param {string} source */
function assertResourceHostNode(source) {
  const reference = signozWorkflow.match(
    /uses: (actions\/setup-node@[^\n]+)/u,
  )?.[1];
  assert.ok(reference);
  const jobs = [
    ...source.matchAll(
      /^ {2}(resource|fullstack|stability|cpu-control|fullstack-protocol-shard):\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:\n|(?![\s\S]))/gmu,
    ),
  ];
  assert.deepEqual(
    jobs.map(([, name]) => name),
    [
      "resource",
      "fullstack",
      "stability",
      "cpu-control",
      "fullstack-protocol-shard",
    ],
  );
  for (const [, name, body = ""] of jobs) {
    const setup = body.indexOf(`uses: ${reference}`);
    const facts = body.indexOf("- name: Verify pinned host Node facts");
    const contracts = body.search(
      /run: (?:bash scripts\/heavy-check\.sh )?python3/u,
    );
    assert.ok(
      setup >= 0 && setup < facts && facts < contracts,
      `${name}: pinned host Node must precede process contracts`,
    );
    assert.match(
      body.slice(setup, facts),
      /node-version-file: \.node-version\n\s+architecture: x64/u,
    );
    const verification = body.slice(facts, contracts);
    assert.match(verification, /readFileSync\("\.node-version", "utf8"\)/u);
    assert.match(verification, /process\.version !== expected/u);
    assert.match(verification, /process\.arch !== "x64"/u);
    assert.match(verification, /process\.platform !== "linux"/u);
    assert.match(
      verification,
      /JSON\.stringify\(\{ node: process\.version, architecture: process\.arch, platform: process\.platform \}\)/u,
    );
  }
  assert.doesNotMatch(
    source,
    /uses: \.\/\.github\/actions\/setup-platform|(?:pnpm|npm) install/u,
  );
}

/** @param {string} source */
function resourceJobs(source) {
  assert.equal(source.split("jobs:\n").length, 2);
  const body = source.split("jobs:\n")[1];
  assert.ok(body);
  const matches = [
    ...body.matchAll(
      /^ {2}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:\n|(?![\s\S]))/gmu,
    ),
  ];
  assert.deepEqual(
    matches.map(([, name]) => name),
    [
      "resource",
      "fullstack",
      "stability",
      "cpu-control",
      "fullstack-protocol-shard",
      "fullstack-protocol",
    ],
  );
  return new Map(matches.map(([, name = "", body = ""]) => [name, body]));
}

const resourceDiskStep = `      - name: Prepare preinstalled hosted Android SDK disk
        timeout-minutes: 3
        run: python3 scripts/observability-production/hosted_disk.py
`;
const resourceScopeStep = `      - name: Select exact assigned technical profile, otherwise full
        id: scope
        timeout-minutes: 1
        run: python3 scripts/observability-production/production.py select-scope >> "$GITHUB_OUTPUT"
`;
const resourceScopePrefix =
  "${{ steps.scope.outputs.scope == 'technical' && 'fullstack-technical' || 'fullstack' }}";
const resourceScopeArgument =
  '          --scope "${{ steps.scope.outputs.scope }}"\n';

it("refuses CPU technical scope, disk and budget bypasses while retaining full defaults", () => {
  const body = resourceJobs(resourceWorkflow).get("cpu-control");
  assert.ok(body);
  assertResourceProtocol(resourceWorkflow);
  for (const [before = "", after = ""] of [
    ["&& 40 || 24", "&& 41 || 24"],
    ["&& 40 || 24", "&& 40 || 25"],
    ["hosted_disk.py", "hosted_disk.py --force"],
    ["if: ${{ steps.scope.outputs.scope == 'technical' }}", "if: ${{ true }}"],
    ["cpu-control-admission --scope", "cpu-control-admission --unknown-scope"],
    ['--scope "${{ steps.scope.outputs.scope }}"', "--scope full"],
    ["select-scope >>", "select-other >>"],
  ]) {
    assert.ok(body.includes(before));
    assert.throws(() =>
      assertResourceProtocol(
        resourceWorkflow.replace(body, body.replace(before, after)),
      ),
    );
  }
});

it("binds existing stability technical scope, private paths and original containment before image preparation", () => {
  const body = resourceJobs(resourceWorkflow).get("stability");
  assert.ok(body);
  assertResourceProtocol(resourceWorkflow);
  for (const [before = "", after = ""] of [
    ["&& 30 || 12", "&& 31 || 12"],
    ["&& 30 || 12", "&& 30 || 13"],
    ["hosted_disk.py", "hosted_disk.py --force"],
    ["if: ${{ steps.scope.outputs.scope == 'technical' }}", "if: ${{ true }}"],
    ["diagnostic-admission --scope", "diagnostic-admission --unknown-scope"],
    ['--scope "${{ steps.scope.outputs.scope }}"', "--scope full"],
    ["select-scope >>", "select-other >>"],
    ["'stability-technical'", "'stability'"],
    ["fixed-actor-primed400-v1", "fixed-actor-cold400-v1"],
  ]) {
    assert.ok(body.includes(before));
    assert.throws(() =>
      assertResourceProtocol(
        resourceWorkflow.replace(body, body.replace(before, after)),
      ),
    );
  }
});

/** @param {string} source */
function assertResourceProtocol(source) {
  const jobs = resourceJobs(source);
  assertResourceHostNode(source);
  const digest = (/** @type {string} */ text) =>
    createHash("sha256").update(text.trimEnd()).digest("hex");
  // Immutable pre-partition native bodies. Reverse only approved preparation
  // and scheduling edits; retain every original command, budget and opt-in.
  const nativeHashes = {
    resource:
      "aadf92ad3fced36f2a41b9f2b958a494b86b98b8c80000997ebc5c4ec21b9740",
    fullstack:
      "0031dc8fa00b5886e7539fed9647edd22cc46219290a270b4a50e42710b2593f",
    stability:
      "22c06bdaa977f62153d2c1298386b9d68987139e7e6df77dcc7de4cc75418a4f",
    "cpu-control":
      "05b46345052647862d979b2c52bf5cb2601c2a71a94a7cf86ba27295a6917f69",
  };
  const originalStep =
    "      - name: Verify whole-stack admission, ownership and acceptance contracts\n        timeout-minutes: 2\n        run: bash scripts/heavy-check.sh python3 -B -m unittest discover -s scripts/observability-fullstack -p 'test_*.py'\n";
  for (const [name, expected] of Object.entries(nativeHashes)) {
    const body = jobs.get(name);
    assert.ok(body);
    assert.ok(body.startsWith("    needs: fullstack-protocol\n"));
    assert.equal([...body.matchAll(/^ {4}needs:/gmu)].length, 1);
    let original = body.replace("    needs: fullstack-protocol\n", "");
    if (name === "stability") {
      const disk = resourceDiskStep.replace(
        "        timeout-minutes: 3",
        "        if: ${{ steps.scope.outputs.scope == 'technical' }}\n        timeout-minutes: 3",
      );
      const prefix =
        "${{ steps.scope.outputs.scope == 'technical' && 'stability-technical' || 'stability' }}";
      const measure =
        "      - name: Measure diagnostic control through scope-bound supervisor\n        timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 12 }}\n";
      const admission =
        '        run: python3 scripts/observability-fullstack/fullstack.py diagnostic-admission --scope "${{ steps.scope.outputs.scope }}"\n';
      for (const [delta, count] of /** @type {[string, number][]} */ ([
        [resourceScopeStep, 1],
        [disk, 1],
        [prefix, 13],
        [measure, 1],
        [admission, 1],
        [resourceScopeArgument, 4],
      ]))
        assert.equal(original.split(delta).length, count + 1);
      assert.ok(
        original.includes(
          resourceScopeStep +
            "      - name: Require exact diagnostic marker in the strict PR context\n",
        ),
      );
      assert.ok(
        original.includes(
          admission +
            disk +
            "      - name: Bind complete source and existing disk admission\n",
        ),
      );
      original = original
        .replace(resourceScopeStep, "")
        .replace(disk, "")
        .replace(
          measure,
          "      - name: Measure diagnostic control through unchanged 600-second supervisor\n        timeout-minutes: 12\n",
        )
        .replace(
          admission,
          "        run: python3 scripts/observability-fullstack/fullstack.py diagnostic-admission\n",
        )
        .replaceAll(resourceScopeArgument, "")
        .replaceAll(prefix, "stability");
    }
    if (name === "cpu-control") {
      const disk = `      - name: Prepare preinstalled hosted Android SDK disk
        if: \${{ steps.scope.outputs.scope == 'technical' }}
        timeout-minutes: 3
        run: python3 scripts/observability-production/hosted_disk.py
`;
      const strict =
        '        run: python3 scripts/observability-fullstack/fullstack.py cpu-control-admission --scope "${{ steps.scope.outputs.scope }}"\n';
      const current =
        "      - name: Run capped then uncapped through scope-bound supervisors\n        timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 40 || 24 }}\n";
      const previous =
        "      - name: Run capped then uncapped through separate unchanged 600-second supervisors\n        timeout-minutes: 24\n";
      const prefix =
        "${{ steps.scope.outputs.scope == 'technical' && 'cpu-control-technical' || 'cpu-control' }}";
      for (const [delta, count] of /** @type {[string, number][]} */ ([
        [resourceScopeStep, 1],
        [disk, 1],
        [strict, 1],
        [current, 1],
        [prefix, 14],
        [resourceScopeArgument, 4],
      ]))
        assert.equal(original.split(delta).length, count + 1);
      assert.ok(
        original.includes(
          resourceScopeStep +
            "      - name: Require exact CPU marker in the strict PR context\n",
        ),
      );
      assert.ok(
        original.includes(
          strict +
            disk +
            "      - name: Bind complete source and existing disk admission\n",
        ),
      );
      original = original
        .replace(resourceScopeStep, "")
        .replace(disk, "")
        .replace(
          strict,
          "        run: python3 scripts/observability-fullstack/fullstack.py cpu-control-admission\n",
        )
        .replace(current, previous)
        .replaceAll(resourceScopeArgument, "")
        .replaceAll(prefix, "cpu-control");
    }
    if (name === "resource" || name === "fullstack") {
      const admission =
        name === "resource"
          ? "      - name: Bind complete source and measure disk admission\n"
          : "      - name: Bind complete source and existing disk admission\n";
      assert.equal(original.split(resourceDiskStep).length, 2);
      assert.equal(original.split(resourceDiskStep + admission).length, 2);
      // Reverse only this fixed preparation step, retaining independent admission.
      original = original.replace(resourceDiskStep, "");
    }
    if (name === "fullstack") {
      // Reverse only the approved technical step name and conditional budget.
      // The legacy full profile and every other native budget stay fingerprinted.
      const scopedMeasureStep =
        "      - name: Measure paired full-process corpus through scope-bound supervisor\n        timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 12 }}\n";
      const legacyMeasureStep =
        "      - name: Measure paired full-process corpus through unchanged 600-second supervisor\n        timeout-minutes: 12\n";
      assert.equal(original.split(scopedMeasureStep).length, 2);
      assert.equal(original.split(resourceScopeStep).length, 2);
      assert.equal(original.split(resourceScopeArgument).length, 5);
      assert.equal(original.split(resourceScopePrefix).length, 14);
      original = original
        .replace(scopedMeasureStep, legacyMeasureStep)
        .replace(resourceScopeStep, "")
        .replaceAll(resourceScopeArgument, "")
        .replaceAll(resourceScopePrefix, "fullstack");
    }
    if (name !== "resource") {
      const anchor =
        name === "stability"
          ? "      - name: Require exact diagnostic marker in the strict PR context\n"
          : "      - name: Bind complete source and existing disk admission\n";
      assert.equal(original.split(anchor).length, 2);
      original = original.replace(anchor, originalStep + anchor);
    }
    assert.equal(digest(original), expected, `${name}: native policy drift`);
  }
  const shard = jobs.get("fullstack-protocol-shard");
  const aggregate = jobs.get("fullstack-protocol");
  assert.ok(shard && aggregate);
  assert.match(shard, /timeout-minutes: 5\n/u);
  assert.match(
    shard,
    /fail-fast: false\n {6}matrix:\n {8}group: \[1, 2, 3, 4, 5, 6, 7\]/u,
  );
  assert.match(
    shard,
    /persist-credentials: false\n {10}ref: \$\{\{ github.sha \}\}/u,
  );
  const identity = shard.indexOf(
    'run: test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
  );
  const protocol = shard.indexOf(
    'run: bash scripts/heavy-check.sh python3 -B scripts/observability-fullstack/protocol_runner.py --group "${{ matrix.group }}"',
  );
  assert.ok(
    identity > shard.indexOf("Verify pinned host Node facts") &&
      protocol > identity,
  );
  assert.match(
    shard.slice(shard.lastIndexOf("      - name:")),
    /timeout-minutes: 2\n/u,
  );
  assert.match(
    aggregate,
    /needs: \[fullstack-protocol-shard\]\n {4}if: \$\{\{ always\(\) \}\}/u,
  );
  assert.match(
    aggregate,
    /RESULT: \$\{\{ needs.fullstack-protocol-shard.result \}\}/u,
  );
  assert.match(aggregate, /run: test "\$RESULT" = success\n/u);
  // Exact new blocks reject duplicate/shadowing fields, conditional cells and
  // hidden alternatives as well as the explicit graph checks above.
  // Reverse exactly the two new mandatory cells and their factual label first.
  // Keep the five-cell fingerprints and the earlier four-cell inverse below;
  // these are cumulative scheduling inverses, never candidate rebaselines.
  const previousJobs = new Map(jobs);
  for (const [name = "", current = "", previous = ""] of [
    [
      "fullstack-protocol-shard",
      "group: [1, 2, 3, 4, 5, 6, 7]",
      "group: [1, 2, 3, 4, 5]",
    ],
    [
      "fullstack-protocol",
      "Require all seven provider results to succeed",
      "Require all five provider results to succeed",
    ],
  ]) {
    const body = jobs.get(name) ?? "";
    assert.equal(body.split(current).length, 2);
    previousJobs.set(name, body.replace(current, previous));
  }
  const previousProtocol = [
    [
      "fullstack-protocol-shard",
      "group: [1, 2, 3, 4, 5]",
      "group: [1, 2, 3, 4]",
      "648489f2d16e5fee834d4dda302ac948f81f6a616db671329ad2fb001f642638",
    ],
    [
      "fullstack-protocol",
      "Require all five provider results to succeed",
      "Require all four provider results to succeed",
      "f9522fb2702e8101d67017af3f071e78904a4e3ab24ad28512a914305bd72254",
    ],
  ];
  for (const [
    name = "",
    current = "",
    previous = "",
    expected = "",
  ] of previousProtocol) {
    const body = previousJobs.get(name) ?? "";
    assert.equal(body.split(current).length, 2);
    assert.equal(digest(body.replace(current, previous)), expected);
  }
  const protocolHashes = {
    "fullstack-protocol-shard":
      "ea6f6ac5dadb089fccb7c576be57437e4fdb7544fc89360c6625a8945a22b2be",
    "fullstack-protocol":
      "dea48cd68ba50b3ca180e09f6b6792d858344a1bef168700c88d10684eb2ecd0",
  };
  for (const [name, expected] of Object.entries(protocolHashes)) {
    assert.equal(
      digest(previousJobs.get(name) ?? ""),
      expected,
      `${name}: protocol policy drift`,
    );
  }
  assert.equal(
    digest(source.split("jobs:\n")[0] ?? ""),
    "96bee60d3ec3f842c7ec2bcc83502e9fa82dfa5a5d987d6996a449b4b7178914",
  );
  assert.doesNotMatch(
    source,
    /workflow_dispatch:|secrets:|continue-on-error:|(?:pnpm|npm) install/u,
  );
  assert.equal(
    [
      ...source.matchAll(
        /unittest discover -s scripts\/observability-fullstack/gmu,
      ),
    ].length,
    0,
  );
  assert.equal(
    [
      ...source.matchAll(
        /run: bash scripts\/heavy-check\.sh python3 -m unittest discover -s scripts\/observability-resource -p 'test_\*\.py'/gmu,
      ),
    ].length,
    1,
  );
}

it("pins host Node before every Resource job's process contracts without application installation", () => {
  assertResourceHostNode(resourceWorkflow);
});

it("rejects Resource host Node pin drift and setup after process contracts", () => {
  assertResourceHostNode(resourceWorkflow);
  const nodeSteps = resourceWorkflow.match(
    / {6}- name: Use repository-pinned Node without application dependencies\n[\s\S]*?(?= {6}- name: Verify hosted trust contracts)/u,
  )?.[0];
  assert.ok(nodeSteps);
  const lateSetup = resourceWorkflow
    .replace(nodeSteps, "")
    .replace(
      "      - name: Bind complete source and measure disk admission",
      `${nodeSteps}      - name: Bind complete source and measure disk admission`,
    );
  for (const broken of [
    resourceWorkflow.replace(
      "node-version-file: .node-version",
      "node-version: latest",
    ),
    resourceWorkflow.replace("architecture: x64", "architecture: arm64"),
    resourceWorkflow.replace("actions/setup-node@", "actions/setup-platform@"),
    resourceWorkflow.replace("process.version !== expected", "false"),
    resourceWorkflow.replace(
      "- name: Verify pinned host Node facts",
      "- name: Late host Node facts",
    ),
    lateSetup,
  ])
    assert.throws(() => assertResourceHostNode(broken));
});
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
  it("requires the independent security job even for documentation-only coverage", () => {
    const security = jobBlock("security");
    assert.doesNotMatch(security, /\n {4}if:|secrets\.|continue-on-error/u);
    assert.match(
      security,
      /run: pnpm quality:proof secrets && pnpm quality:security/u,
    );
    assert.match(jobBlock("ci-gate"), /- security\n/u);
    const gate = jobBlock("ci-gate");
    assert.match(gate, /SECURITY_RESULT: \$\{\{ needs.security.result \}\}/u);
    assert.match(gate, /run: test "\$SECURITY_RESULT" = success/u);
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const checked = spawnSync(
        "bash",
        ["-c", 'test "$SECURITY_RESULT" = success'],
        {
          env: { ...process.env, SECURITY_RESULT: result },
          timeout: 5_000,
          encoding: "utf8",
        },
      );
      assert.equal(checked.status, result === "success" ? 0 : 1);
    }
  });
  it("isolates both full-stack profiles and rejects failed or absent profile coverage", () => {
    const profiles = jobBlock("fullstack-browser");
    assert.match(profiles, /shard: \[1, 2\]/u);
    assert.match(
      profiles,
      /FULLSTACK_TEST_SHARD: \$\{\{ matrix.shard \}\}\/2/u,
    );
    const matrix = profiles.match(/project: \[([^\]]+)\]/u)?.[1];
    assert.ok(matrix);
    assert.deepEqual(
      matrix.split(",").map((value) => value.trim()),
      fullStackProjects,
    );
    assert.match(profiles, /fail-fast: false/u);
    assert.match(
      profiles,
      /FULLSTACK_TEST_PROJECT: \$\{\{ matrix\.project \}\}/u,
    );
    assert.match(
      profiles,
      /COMPOSE_PROJECT_NAME: .*\$\{\{ matrix\.project \}\}/u,
    );
    assert.match(
      profiles,
      /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/u,
    );
    const aggregate = jobBlock("fullstack");
    assert.match(aggregate, /needs: \[plan, fullstack-browser\]/u);
    assert.match(aggregate, /if: \$\{\{ always\(\) && contains/u);
    assert.match(
      aggregate,
      /PROFILE_RESULT: \$\{\{ needs\.fullstack-browser\.result \}\}/u,
    );
    const command = aggregate.match(/run: (test .+)$/mu)?.[1];
    assert.ok(command);
    for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
      /** @type {import("node:child_process").SpawnSyncReturns<string>} */
      const execution = spawnSync("bash", ["-euc", command], {
        env: { ...process.env, PROFILE_RESULT: result },
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(execution.status, result === "success" ? 0 : 1, result);
    }
  });
  it("preserves complete unit, integration and browser work behind fail-closed aggregates", () => {
    /** @type {Array<[string, string]>} */
    const groups = [
      ["unit", "unit-checks"],
      ["integration", "integration-checks"],
      ["web-e2e", "web-e2e-browser"],
      ["compose-production", "compose-production-checks"],
    ];
    for (const [aggregateId, childId] of groups) {
      const child = jobBlock(childId);
      assert.match(child, /fail-fast: false/u);
      assert.match(
        child,
        /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/u,
      );
      const aggregate = jobBlock(aggregateId);
      assert.match(
        aggregate,
        new RegExp(
          `needs: \\[plan, ${childId}(?:, foundation-recovery)?\\]`,
          "u",
        ),
      );
      assert.match(aggregate, /if: \$\{\{ always\(\) && contains/u);
      assert.match(
        aggregate,
        new RegExp(`RESULT: \\$\\{\\{ needs\\.${childId}\\.result \\}\\}`, "u"),
      );
      const command = aggregate.match(/run: (test .+)$/mu)?.[1];
      assert.ok(command);
      for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
        /** @type {import("node:child_process").SpawnSyncReturns<string>} */
        const execution = spawnSync("bash", ["-euc", command], {
          env: { ...process.env, RESULT: result, RECOVERY_RESULT: "success" },
          encoding: "utf8",
          timeout: 5_000,
        });
        assert.equal(execution.status, result === "success" ? 0 : 1, result);
      }
    }
    assert.match(
      jobBlock("unit-checks"),
      /part: \[tooling, modules, contracts\]/u,
    );
    assert.match(
      jobBlock("integration-checks"),
      /part: \[database, enrollments, buyer-journey\]/u,
    );
    assert.match(
      jobBlock("web-e2e-browser"),
      /project: \[desktop-chromium, mobile-chromium\]/u,
    );
    assert.match(
      jobBlock("web-e2e-browser"),
      /pnpm check:web-e2e --project=\$\{\{ matrix.project \}\}/u,
    );
  });
  it("binds each parallel unit part and both Web projects to the local complete commands", () => {
    assert.equal(
      rootScripts["check:unit"],
      "pnpm check:unit:tooling && pnpm check:unit:modules && pnpm check:contracts",
    );
    assert.equal(
      rootScripts["check:unit:tooling"],
      "pnpm test:tooling && pnpm test:authoring && pnpm test:practice-review",
    );
    assert.equal(
      rootScripts["check:unit:modules"],
      "pnpm --recursive --if-present --filter '!@inside/web' test && pnpm --filter @inside/web test:module",
    );
    for (const [part, command] of [
      ["tooling", "check:unit:tooling"],
      ["modules", "check:unit:modules"],
      ["contracts", "check:contracts"],
    ]) {
      const environment =
        part === "tooling"
          ? '        env:\n          INSIDE_CORE_SOURCE_PROGRESS: "1"\n'
          : "";
      assert.ok(
        jobBlock("unit-checks").includes(
          `if: \${{ matrix.part == '${part}' }}\n${environment}        run: pnpm ${command}`,
        ),
      );
    }
    assert.ok(
      rootScripts["check:web-e2e"]?.includes(
        'pnpm test:e2e "$@" && pnpm test:navigation "$@"',
      ),
    );
    const recovery = readFileSync(
      resolve(repositoryRoot, ".github/workflows/ci-gate-recovery.yml"),
      "utf8",
    );
    const matrixSource =
      recovery.split("const matrixGroups = [")[1]?.split("            ];")[0] ??
      "";
    const copiedGroups = [
      ...matrixSource.matchAll(
        /aggregate: '([^']+)', prefix: '([^']+)', names: \[([^\]]+)\]/gu,
      ),
    ].map(([, aggregate, prefix, names = ""]) => ({
      aggregate,
      prefix,
      names: [...names.matchAll(/'([^']+)'/gu)].map(([, name]) => name),
    }));
    assert.deepEqual(
      copiedGroups,
      Object.entries(ciMatrixJobs).map(([id, group]) => ({
        aggregate: ciJobNames[id],
        ...group,
      })),
    );
    assert.deepEqual(
      ciMatrixJobs.fullstack.names,
      fullStackProjects.flatMap((project) =>
        [1, 2].map((shard) => `Full-stack browser (${project}, ${shard})`),
      ),
    );
  });
  it("forwards the selected browser profile to both real pnpm command boundaries", () => {
    const body = rootScripts["check:web-e2e"]?.match(
      /bash -c '([^']+)' --$/u,
    )?.[1];
    assert.ok(body);
    for (const profile of fullStackProjects) {
      /** @type {import("node:child_process").SpawnSyncReturns<string>} */
      const result = spawnSync(
        "bash",
        [
          "-euc",
          `pnpm() { printf '%s\\n' "$*"; };\n${body}`,
          "--",
          `--project=${profile}`,
        ],
        { encoding: "utf8", timeout: 5_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split("\n"), [
        "build",
        "--filter @inside/web test:prerendered-handlers",
        "--filter @inside/web test:standalone-config",
        `test:e2e --project=${profile}`,
        `test:navigation --project=${profile}`,
      ]);
    }
  });
  it("requires both production proofs while isolating cold builds and admitted-cache preparation", () => {
    const production = jobBlock("compose-production-checks");
    assert.match(production, /part: \[cold, cache\]/u);
    assert.match(
      production,
      /- name: Run isolated production smoke\n {8}if: \$\{\{ matrix.part == 'cold' \}\}/u,
    );
    assert.match(
      production,
      /if: \$\{\{ matrix.part == 'cold' && github.event_name == 'pull_request' \}\}/u,
    );
    assert.match(
      production,
      /- name: Prove exact-source production runtime from admitted cache\n {8}if: \$\{\{ matrix.part == 'cache' \}\}/u,
    );
    assert.match(
      production,
      /name: compose-production-diagnostics-\$\{\{ matrix.part \}\}-\$\{\{ github.run_attempt \}\}/u,
    );
    assert.match(
      production,
      /run: bash scripts\/heavy-check.sh bash scripts\/production-cache-smoke-ci.sh/u,
    );
  });
  it("publishes only bounded preparation snapshots after healthy or failed cache proofs", () => {
    const production = jobBlock("compose-production-checks");
    const upload = production.match(
      / {6}- name: Upload cache preparation observations\n(?<step>[\s\S]*?)(?= {6}- name:|$)/u,
    )?.groups?.["step"];
    assert.ok(
      upload,
      "Preparation observations must be accessible on healthy CI runs",
    );
    assert.match(
      upload,
      /if: \$\{\{ always\(\) && matrix.part == 'cache' \}\}/u,
    );
    assert.match(
      upload,
      /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/u,
    );
    assert.match(
      upload,
      /name: cache-preparation-observations-\$\{\{ github.run_attempt \}\}/u,
    );
    assert.match(upload, /retention-days: 7/u);
    const paths = upload.match(/path: \|\n(?<paths>(?: {12}[^\n]+\n)+)/u)
      ?.groups?.["paths"];
    assert.deepEqual(paths?.trim().split(/\n\s*/u), [
      "ci-artifacts/compose-production-cache/preparation-before.json",
      "ci-artifacts/compose-production-cache/preparation-after.json",
    ]);
  });
  it("requires the path-selected native recovery proof before production coverage succeeds", () => {
    const recovery = jobBlock("foundation-recovery");
    assert.match(
      recovery,
      /uses: \.\/\.github\/workflows\/foundation-recovery\.yml/u,
    );
    assert.match(
      recovery,
      /contains\(fromJSON\(needs.plan.outputs.required\), 'compose-production'\)/u,
    );
    assert.match(
      recovery,
      /source_sha: \$\{\{ inputs.source_sha \|\| github.sha \}\}/u,
    );
    const aggregate = jobBlock("compose-production");
    assert.match(
      aggregate,
      /needs: \[plan, compose-production-checks, foundation-recovery\]/u,
    );
    assert.match(
      aggregate,
      /RECOVERY_RESULT: \$\{\{ needs.foundation-recovery.result \}\}/u,
    );
    const command = aggregate.match(/run: (test .*RECOVERY_RESULT.*)/u)?.[1];
    assert.ok(command);
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      /** @type {import("node:child_process").SpawnSyncReturns<string>} */
      const execution = spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        env: { ...process.env, RESULT: "success", RECOVERY_RESULT: result },
        timeout: 5_000,
      });
      assert.equal(execution.status, result === "success" ? 0 : 1, result);
    }
    const reusable = readFileSync(
      resolve(repositoryRoot, ".github/workflows/foundation-recovery.yml"),
      "utf8",
    );
    assert.match(reusable, /workflow_call:/u);
    assert.match(
      reusable,
      /ref: \$\{\{ inputs.source_sha \|\| github.sha \}\}/u,
    );
  });
  it("selects native recovery when its process-exit dependency changes", () => {
    const reusable = readFileSync(
      resolve(repositoryRoot, ".github/workflows/foundation-recovery.yml"),
      "utf8",
    );
    const command = reusable
      .match(/ {8}run: \|\n([\s\S]*?)\n {2}recover:/u)?.[1]
      ?.replace(/^ {10}/gmu, "");
    assert.ok(command);
    const fixture = mkdtempSync(resolve(tmpdir(), "inside-recovery-paths-"));
    /** @type {Array<[string, string]>} */
    const cases = [
      ["scripts/heavy-check/processes.py", "required=true\n"],
      ["apps/web/src/unrelated.ts", "required=false\n"],
    ];
    try {
      for (const [changedPath, expected] of cases) {
        const output = resolve(fixture, "output");
        rmSync(output, { force: true });
        /** @type {import("node:child_process").SpawnSyncReturns<string>} */
        const execution = spawnSync(
          "bash",
          [
            "-euc",
            `git() { for path in "$@"; do if [ "$path" = "$CHANGED_PATH" ]; then return 1; fi; done; return 0; }\n${command}`,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              BASE_SHA: "a".repeat(40),
              HEAD_SHA: "b".repeat(40),
              CHANGED_PATH: changedPath,
              GITHUB_OUTPUT: output,
            },
            timeout: 5_000,
          },
        );
        assert.equal(execution.status, 0, execution.stderr);
        assert.equal(readFileSync(output, "utf8"), expected, changedPath);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it("excludes focused jobs only while selected package commands execute their complete coverage", () => {
    assert.deepEqual(coverageSupersets, { docs: "static", contracts: "unit" });
    assertFocusedSupersets(rootScripts);
    /** @type {Array<[string, string]>} */
    const missingCommands = [
      ["check:static", "pnpm docs:check && "],
      ["check:unit:tooling", "pnpm test:tooling && "],
      ["check:unit", " && pnpm check:contracts"],
      ["check:contracts", "pnpm test:contracts && "],
    ];
    for (const [script, removed] of missingCommands) {
      const changed = {
        ...rootScripts,
        [script]: rootScripts[script]?.replace(removed, "") ?? "",
      };
      assert.throws(() => assertFocusedSupersets(changed));
    }
  });
  it("acquires development runtime images serially before startup and preserves pull failures", () => {
    const step = jobBlock("compose-development").split(
      "      - name: Run clean stack smoke and write persistence probes\n        run: |\n",
    )[1];
    assert.ok(step);
    const startup = "docker compose up --detach --wait";
    const startupIndex = step.indexOf(startup);
    assert.ok(startupIndex >= 0);
    const prefix = step
      .slice(0, startupIndex + startup.length)
      .replace(/^ {10}/gmu, "");
    const fixture = mkdtempSync(resolve(tmpdir(), "inside-development-pull-"));
    const calls = resolve(fixture, "calls");
    const resolvedImages =
      "ecr-fixture/postgres@sha256:fixed\nhub-fixture/rustfs@sha256:fixed\nhub-fixture/mailpit@sha256:fixed";
    const adapter = `docker() {
    printf '%s\\n' "$*" >>"$CALLS";
    case "$*" in
      'compose config --images postgres object-storage mailpit') printf '%s\\n' "$RESOLVED_IMAGES" ;;
      'compose --parallel 1 pull postgres object-storage mailpit')
        if [ "$PULL_EXIT" != 0 ]; then printf '%s\\n' 'primary registry failure' >&2; return "$PULL_EXIT"; fi ;;
      'compose up --detach --wait') ;;
      *) printf '%s\\n' 'unexpected Docker command' >&2; return 55 ;;
    esac
  }`;
    try {
      for (const pullExit of [0, 29]) {
        rmSync(calls, { force: true });
        const result = spawnSync("bash", ["-euc", `${adapter}\n${prefix}`], {
          env: {
            ...process.env,
            CALLS: calls,
            RESOLVED_IMAGES: resolvedImages,
            PULL_EXIT: String(pullExit),
          },
          encoding: "utf8",
          timeout: 10_000,
        });
        assert.equal(result.status, pullExit, result.stderr);
        assert.equal(result.stdout.trim(), resolvedImages);
        assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), [
          "compose config --images postgres object-storage mailpit",
          "compose --parallel 1 pull postgres object-storage mailpit",
          ...(pullExit === 0 ? ["compose up --detach --wait"] : []),
        ]);
        if (pullExit !== 0)
          assert.match(result.stderr, /primary registry failure/u);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("exports the identical publisher Ryuk image through the setup shell boundary", () => {
    const command = setupAction.match(
      /- name: Select Ryuk cleanup image\n\s+shell: bash\n\s+run: (.+)\n/u,
    )?.[1];
    assert.ok(command, "shared setup must select the publisher Ryuk image");
    const fixture = mkdtempSync(resolve(tmpdir(), "inside-ryuk-input-"));
    const environmentFile = resolve(fixture, "github-env");
    try {
      const result = spawnSync("bash", ["-euc", command], {
        env: { ...process.env, GITHUB_ENV: environmentFile },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(environmentFile, "utf8"),
        "RYUK_CONTAINER_IMAGE=ghcr.io/testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0\n",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

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
      /image: ghcr\.io\/sachkov-inside\/postgres:18\.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15$/mu,
    );
    assert.match(
      telegram,
      /image: ghcr\.io\/sachkov-inside\/rabbitmq:4\.3-management-alpine@sha256:[a-f0-9]{64}$/mu,
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
    const jobOverrides = [...workflow.matchAll(/^ {4}permissions:/gmu)];
    assert.equal(jobOverrides.length, 1);
    assert.match(jobBlock("review-evidence"), /^ {4}permissions:/mu);
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
      assert.ok(
        [
          "./.github/actions/setup-platform",
          "./.github/workflows/foundation-recovery.yml",
        ].includes(reference),
        reference,
      );
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
    for (const [job, script] of checkStages.filter(
      ([id]) => !["unit", "web-e2e"].includes(id),
    )) {
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
    assert.match(jobBlock("web-e2e-browser"), /browsers: chromium$/mu);
  });

  it("installs frozen dependencies and cached browser engines in one place", () => {
    assert.match(
      setupAction,
      /run: timeout --signal=TERM --kill-after=10s 4m pnpm install --frozen-lockfile$/mu,
    );
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

  it("bounds pnpm store cache segments only in the existing setup-node step", () => {
    assertNodeCacheSegmentTimeout(setupAction);
  });

  it("rejects missing, widened, moved and duplicated cache segment overrides", () => {
    const env = '      env:\n        SEGMENT_DOWNLOAD_TIMEOUT_MINS: "2"\n';
    for (const candidate of [
      setupAction.replace(env, ""),
      setupAction.replace(env, env.replace('"2"', '"10"')),
      setupAction.replace(env, env.replace("env:", "with:")),
      'env:\n  SEGMENT_DOWNLOAD_TIMEOUT_MINS: "2"\n' +
        setupAction.replace(env, ""),
      setupAction
        .replace(env, "")
        .replace(
          "    - name: Cache pnpm metadata and verification\n",
          "    - name: Cache pnpm metadata and verification\n" + env,
        ),
      setupAction.replace(
        "    - name: Restore Playwright browser engines\n",
        "    - name: Restore Playwright browser engines\n" + env,
      ),
    ]) {
      assert.throws(() => assertNodeCacheSegmentTimeout(candidate));
    }
  });

  it("bounds dependency installation and reuses pnpm's policy-aware cache (#1763)", () => {
    const install =
      setupAction.match(
        /- name: Install dependencies\n([\s\S]*?)(?=\n {4}- name:|$)/u,
      )?.[1] ?? "";
    assert.doesNotMatch(setupAction, /timeout-minutes:/u);
    assert.match(
      install,
      /run: timeout --signal=TERM --kill-after=10s 4m pnpm install --frozen-lockfile$/mu,
    );
    const cache =
      setupAction.match(
        /- name: Cache pnpm metadata and verification\n([\s\S]*?)(?=\n {4}- name:|$)/u,
      )?.[1] ?? "";
    assert.match(cache, /uses: actions\/cache@/u);
    assert.match(cache, /~\/\.cache\/pnpm\/v11\/metadata/u);
    assert.match(cache, /~\/\.cache\/pnpm\/lockfile-verified\.jsonl/u);
    for (const file of [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
      ".npmrc",
      ".node-version",
      ".github/actions/setup-platform/action.yml",
    ])
      assert.ok(cache.includes(`'${file}'`), `cache key binds ${file}`);
    assert.doesNotMatch(
      cache,
      /restore-keys:|lookup-only:|continue-on-error:/u,
    );
    assert.ok(
      setupAction.indexOf("name: Cache pnpm metadata and verification") <
        setupAction.indexOf("name: Install dependencies"),
    );
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
      jobBlock("integration-checks"),
      /run: pnpm test:integration:parallel$/mu,
    );
    assert.match(
      jobBlock("integration-checks"),
      /run: pnpm smoke:enrollments$/mu,
    );
    assert.match(
      jobBlock("integration-serial"),
      /run: pnpm test:integration:serial$/mu,
    );
    for (const job of ["integration-checks", "integration-serial"]) {
      assert.doesNotMatch(jobBlock(job), /services:/u);
    }

    assert.match(jobBlock("fullstack-browser"), /pnpm smoke:fullstack/u);

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
      jobBlock("compose-production-checks"),
      /run: pnpm compose:production:smoke/u,
    );
    // The runtime health-budget helper imports workspace dependencies on the host.
    const productionChecks = jobBlock("compose-production-checks");
    assert.match(
      productionChecks,
      /uses: \.\/\.github\/actions\/setup-platform/u,
    );
    assert.ok(
      productionChecks.indexOf("uses: ./.github/actions/setup-platform") <
        productionChecks.indexOf("run: pnpm compose:production:smoke"),
    );
  });

  it("retains bounded failure diagnostics and source evidence for seven days", () => {
    assert.equal(
      workflow.match(/uses: actions\/upload-artifact@/gu)?.length,
      10,
    );
    assert.equal(workflow.match(/^\s+retention-days: 7$/gmu)?.length, 10);
    assert.equal(
      workflow.match(/^\s+if: \$\{\{ failure\(\) \}\}$/gmu)?.length,
      10,
    );
    // A failed smoke keeps the Playwright results and the dev-server log (#863).
    assert.match(jobBlock("integration-checks"), /apps\/web\/test-results/u);
    assert.match(
      jobBlock("integration-checks"),
      /apps\/web\/\.next\/dev\/logs/u,
    );
    assert.match(workflow, /docker compose logs --no-color --tail 500/u);
    assert.doesNotMatch(workflow, /\.ci-artifacts/u);
    assert.match(
      jobBlock("compose-production-checks"),
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

  it("checks migrated release and deployment contracts with tooling mechanisms", () => {
    assert.match(
      jobBlock("contracts"),
      /run: pnpm test:tooling && pnpm test:contracts$/mu,
    );
    assert.match(
      jobBlock("fullstack-browser"),
      /if: \$\{\{ always\(\) \}\}\n {8}run: docker compose down --volumes --remove-orphans/u,
    );
  });

  it("isolates source evidence by attempt and keeps provider identities synchronized", () => {
    assert.match(
      jobBlock("ci-gate"),
      /name: ci-source-evidence-\$\{\{ github\.run_attempt \}\}/u,
    );
    for (const [id, name] of Object.entries(ciJobNames)) {
      assert.match(
        jobBlock(id),
        new RegExp(`^ {4}name: ${escapeRegExp(name)}$`, "mu"),
      );
    }
    const recovery = readFileSync(
      resolve(repositoryRoot, ".github/workflows/ci-gate-recovery.yml"),
      "utf8",
    );
    const names =
      recovery.split("const requiredNames = [")[1]?.split("];")[0] ?? "";
    const recoveryNames = [...names.matchAll(/'([^']+)'/gu)]
      .map(([, name]) => name)
      .sort();
    assert.deepEqual(
      recoveryNames,
      Object.entries(ciJobNames)
        .filter(([id]) => id !== "ci-gate")
        .map(([, name]) => name)
        .sort(),
    );
    assert.equal(
      [...workflow.matchAll(/^ {4}name: /gmu)].length,
      Object.keys(ciJobNames).length + Object.keys(ciMatrixJobs).length + 1,
    );
  });

  it("removes automated resource measurements without removing functional suites", () => {
    assert.doesNotMatch(
      workflow,
      /telemetry-resource|measure-telemetry|TELEMETRY_RESOURCE/u,
    );
    assert.match(
      jobBlock("integration-checks"),
      /pnpm test:integration:parallel/u,
    );
  });

  it("keeps Web E2E recordings and HTML call logs separate for each CI attempt", () => {
    const webE2E = jobBlock("web-e2e-browser");
    const upload = webE2E.slice(
      webE2E.indexOf("      - name: Upload Playwright diagnostics\n"),
    );
    assert.match(upload, /if: \$\{\{ failure\(\) \}\}/u);
    assert.match(upload, /uses: actions\/upload-artifact@/u);
    assert.match(
      upload,
      /name: web-e2e-playwright-\$\{\{ matrix\.project \}\}-\$\{\{ github\.run_attempt \}\}/u,
    );
    assert.match(upload, /^ {12}apps\/web\/playwright-report$/mu);
    assert.match(upload, /^ {12}apps\/web\/test-results$/mu);
    assert.doesNotMatch(upload, /overwrite: true/u);
  });

  it("uploads browser-engine and Storybook import diagnostics for each CI attempt", () => {
    const job = jobBlock("ui");
    assert.equal(job.match(/uses: actions\/upload-artifact@/gu)?.length, 1);
    assert.match(job, /if: \$\{\{ failure\(\) \}\}/u);
    assert.match(
      job,
      /name: browser-engines-playwright-\$\{\{ github.run_attempt \}\}/u,
    );
    assert.match(job, /^ {12}apps\/web\/test-results\/browser-engines$/mu);
    assert.match(job, /^ {12}apps\/web\/test-results\/storybook-imports$/mu);
    assert.match(job, /if-no-files-found: ignore/u);
    assert.match(job, /retention-days: 7/u);
  });

  it("exposes one stable gate that fails closed over every required job", () => {
    const gate = jobBlock("ci-gate");

    assert.match(gate, /^ {4}name: CI Gate$/mu);
    assert.match(gate, /^ {4}if: \$\{\{ always\(\) \}\}$/mu);
    for (const job of requiredJobs) {
      assert.match(gate, new RegExp(`^      - ${escapeRegExp(job)}$`, "mu"));
    }
    assert.match(
      gate,
      /SELECTED_PLAN_SHA256: \$\{\{ needs\.plan\.outputs\.plan_sha256 \}\}/u,
    );
    assert.match(
      jobBlock("plan"),
      /plan_sha256: \$\{\{ steps\.select\.outputs\.plan_sha256 \}\}/u,
    );
    assert.doesNotMatch(
      gate,
      /toJSON\(needs\)|SELECTED_PLAN:|needs\.plan\.outputs\.plan \}\}/u,
    );
    const results = gate.match(/JOB_RESULTS: >-\n((?: {12}.+\n)+)/u)?.[1];
    assert.ok(results);
    /** @type {unknown} */
    const projected = JSON.parse(
      results.replaceAll(/\$\{\{ needs\.([a-z0-9-]+)\.result \}\}/gu, "$1"),
    );
    assert.deepEqual(
      projected,
      Object.fromEntries(
        ["plan", ...coverageIds].map((id) => [id, { result: id }]),
      ),
    );
    assert.deepEqual(
      [...gate.matchAll(/^ {6}- ([a-z0-9-]+)$/gmu)]
        .map((match) => match[1])
        .sort(),
      ["security", "review-evidence", "plan", ...coverageIds].sort(),
    );
    assert.match(gate, /run: node scripts\/ci-coverage-run\.mjs gate/u);
  });
});

describe("nightly full-stack workflow contract", () => {
  it("runs only on demand, never for pull requests or pushes", () => {
    const triggers = topLevelBlock("on", nightlyWorkflow);

    assert.doesNotMatch(triggers, /schedule:|cron:/u);
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
    assert.match(jobBlock("ci-gate"), /fullstack/u);
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

/** @param {Record<string, string>} scripts */
function assertFocusedSupersets(scripts) {
  const invokes = (
    /** @type {string} */ owner,
    /** @type {string} */ command,
  ) => {
    assert.match(
      scripts[owner] ?? "",
      new RegExp(`(?:^|&&)\\s*pnpm ${command}(?:\\s*&&|$)`, "u"),
    );
  };
  invokes("check:static", "docs:check");
  invokes("check:unit", "check:unit:tooling");
  invokes("check:unit", "check:unit:modules");
  invokes("check:unit:tooling", "test:tooling");
  invokes("check:unit", "check:contracts");
  invokes("check:contracts", "test:contracts");
}

it("requires complete fixed protocol coverage before all native Resource jobs", () => {
  assertResourceProtocol(resourceWorkflow);
});

it("rejects hosted disk preparation bypasses in both Resource measurement jobs", () => {
  assertResourceProtocol(resourceWorkflow);
  for (const name of ["resource", "fullstack"]) {
    const body = resourceJobs(resourceWorkflow).get(name);
    assert.ok(body);
    assert.ok(body.includes(resourceDiskStep));
    const withoutStep = body.replace(resourceDiskStep, "");
    const build = "      - name: Build ";
    const mutations = [
      withoutStep,
      body.replace(resourceDiskStep, resourceDiskStep + resourceDiskStep),
      withoutStep.replace("    steps:\n", "    steps:\n" + resourceDiskStep),
      withoutStep.replace(build, resourceDiskStep + build),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace("timeout-minutes: 3", "timeout-minutes: 4"),
      ),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace("hosted_disk.py", "hosted_disk.py --force"),
      ),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace(
          "        run:",
          "        if: ${{ false }}\n        run:",
        ),
      ),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace(
          "        run:",
          "        continue-on-error: true\n        run:",
        ),
      ),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace(
          "        run:",
          "        env:\n          RUNNER_ENVIRONMENT: github-hosted\n        run:",
        ),
      ),
      body.replace(
        resourceDiskStep,
        resourceDiskStep.replace(
          "        run:",
          "        shell: bash\n        run:",
        ),
      ),
    ];
    for (const broken of mutations) {
      assert.notEqual(broken, body);
      assert.throws(
        () => assertResourceProtocol(resourceWorkflow.replace(body, broken)),
        name,
      );
    }
  }
});

it("rejects missing coverage, graph bypasses, source drift and native policy changes", () => {
  const mutations = [
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5, 5]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 3]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5, 7]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5, 6]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5, 6, 6]"],
    ["group: [1, 2, 3, 4, 5, 6, 7]", "group: [1, 2, 3, 4, 5, 6, 8]"],
    [
      "group: [1, 2, 3, 4, 5, 6, 7]",
      "group: [1, 2, 3, 4, 5, 6, 7]\n        exclude: [{group: 5}]",
    ],
    [
      "group: [1, 2, 3, 4, 5, 6, 7]",
      "group: [1, 2, 3, 4, 5, 6, 7]\n        exclude: [{group: 6}]",
    ],
    [
      "group: [1, 2, 3, 4, 5, 6, 7]",
      "group: [1, 2, 3, 4, 5, 6, 7]\n        exclude: [{group: 7}]",
    ],
    ["    needs: fullstack-protocol\n", ""],
    [
      "    needs: fullstack-protocol\n",
      "    needs: fullstack-protocol\n    if: ${{ always() }}\n",
    ],
    [
      "    needs: fullstack-protocol\n",
      "    needs: fullstack-protocol\n    if: ${{ false }}\n",
    ],
    [
      "    needs: fullstack-protocol\n",
      "    needs: fullstack-protocol\n    needs: []\n",
    ],
    [
      "    needs: fullstack-protocol\n",
      "    needs: [fullstack-protocol, foreign]\n",
    ],
    ["  resource:\n", "  resource:\n  resource:\n"],
    ["jobs:\n", "jobs:\n  foreign:\n    runs-on: ubuntu-24.04\n"],
    [
      "  fullstack-protocol-shard:\n",
      "  fullstack-protocol-shard:\n    if: ${{ false }}\n",
    ],
    [
      "  fullstack-protocol-shard:\n",
      "  fullstack-protocol-shard:\n    continue-on-error: true\n",
    ],
    [
      "Verify complete whole-stack protocol group\n        timeout-minutes: 2",
      "Verify complete whole-stack protocol group\n        timeout-minutes: 3",
    ],
    [
      'protocol_runner.py --group "${{ matrix.group }}"',
      'protocol_runner.py --group "1"',
    ],
    [
      "ref: ${{ github.sha }}",
      "ref: ${{ github.event.pull_request.head.sha }}",
    ],
    ['test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', "true"],
    [
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/checkout@main",
    ],
    ["node-version-file: .node-version", "node-version: latest"],
    ['process.platform !== "linux"', "false"],
    ["RESULT: ${{ needs.fullstack-protocol-shard.result }}", "RESULT: success"],
    ['test "$RESULT" = success', "true"],
    ["    needs: [fullstack-protocol-shard]", "    needs: []"],
    [
      "    needs: [fullstack-protocol-shard]\n    if: ${{ always() }}",
      "    needs: [fullstack-protocol-shard]",
    ],
    ["<!-- monitoring-stability: run -->", ""],
    ["<!-- monitoring-cpu-control: app-unlimited-v1 -->", ""],
    ["name: Matched CPU-policy diagnostic", "name: Capacity acceptance"],
    ["timeout-minutes: 60", "timeout-minutes: 61"],
    ["scope == 'technical' && 30 || 12", "scope == 'technical' && 17 || 12"],
    ["scope == 'technical' && 30 || 12", "scope == 'technical' && 30 || 30"],
    [
      "timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 12 }}",
      "timeout-minutes: 30",
    ],
    [
      "Measure paired full-process corpus through scope-bound supervisor",
      "Measure paired full-process corpus through unlimited supervisor",
    ],
    [
      "Representative whole-process monitoring OFF/ON resource proof\n    runs-on: ubuntu-24.04\n    timeout-minutes: 60",
      "Representative whole-process monitoring OFF/ON resource proof\n    runs-on: ubuntu-24.04\n    timeout-minutes: 61",
    ],
    [
      "Measure diagnostic control through scope-bound supervisor\n        timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 12 }}",
      "Measure diagnostic control through scope-bound supervisor\n        timeout-minutes: ${{ steps.scope.outputs.scope == 'technical' && 30 || 13 }}",
    ],
    [
      "    timeout-minutes: 1\n    env:\n      RESULT:",
      "    timeout-minutes: 2\n    env:\n      RESULT:",
    ],
    ["scope-bound supervisor", "unlimited supervisor"],
    ["fullstack.py run\n", "fullstack.py run --p95 1.10\n"],
    ["fullstack.py cpu-control-recover", "fullstack.py cpu-control-collect"],
    ["contents: read", "contents: write"],
    ["persist-credentials: false", "persist-credentials: true"],
  ];
  for (const [before = "", after = ""] of mutations) {
    assert.ok(resourceWorkflow.includes(before), `fixture anchor: ${before}`);
    assert.throws(
      () => assertResourceProtocol(resourceWorkflow.replace(before, after)),
      before,
    );
  }
});

it("accepts only the provider aggregate's exact success value", () => {
  const body = resourceJobs(resourceWorkflow).get("fullstack-protocol");
  assert.ok(body);
  const command = body.match(/^ {8}run: (.+)$/mu)?.[1];
  assert.equal(command, 'test "$RESULT" = success');
  assert.ok(command);
  for (const result of [
    "success",
    "failure",
    "cancelled",
    "timed_out",
    "skipped",
    "",
    "missing",
    "SUCCESS",
    "success ",
  ]) {
    /** @type {import("node:child_process").SpawnSyncReturns<string>} */
    const execution = spawnSync("bash", ["-euc", command], {
      cwd: repositoryRoot,
      env: { ...process.env, RESULT: result },
      encoding: "utf8",
      timeout: 1_000,
    });
    assert.equal(execution.error, undefined);
    assert.equal(execution.signal, null);
    assert.equal(execution.status, result === "success" ? 0 : 1);
  }
});

it("keeps fixed stdlib discovery and binds every tracked protocol source", () => {
  const runner = readFileSync(
    resolve(
      repositoryRoot,
      "scripts/observability-fullstack/protocol_runner.py",
    ),
    "utf8",
  );
  assert.match(runner, /START = Path\(__file__\)\.resolve\(\)\.parent/u);
  assert.match(runner, /loader = unittest\.TestLoader\(\)/u);
  assert.match(
    runner,
    /loader\.discover\(str\(START\), pattern='test_\*\.py'\)/u,
  );
  assert.match(runner, /partition\(suite, loader\.errors\)/u);
  assert.match(runner, /GROUPS = \('1', '2', '3', '4', '5', '6', '7'\)/u);
  assert.match(
    runner,
    /LATE_CASE = 'test_trace_sanitizer\.Sanitizer\.test_late_parser_owner_loss_reaps_every_born_identity_before_original_deadline'/u,
  );
  assert.doesNotMatch(
    runner,
    /os\.environ|argparse|loadTestsFromNames|\.skipTest\(|\.skip\(/u,
  );
  const binding = readFileSync(
    resolve(repositoryRoot, "scripts/observability-resource/binding.py"),
    "utf8",
  );
  assert.match(binding, /'ls-files', '-z', '--'/u);
  assert.match(binding, /'docs\/contracts', 'scripts', 'infra'/u);
  assert.match(binding, /'\.github\/workflows\/observability-resource\.yml'/u);
});

it("runs the cheap partition and inverse contracts inside required tooling within five seconds", () => {
  const execution = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/observability-fullstack",
      "-p",
      "test_protocol_runner.py",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1_048_576,
    },
  );
  assert.equal(execution.error, undefined);
  assert.equal(execution.signal, null);
  assert.equal(execution.status, 0, execution.stderr);
  const count = execution.stderr.match(/Ran (\d+) tests? in /u)?.[1];
  assert.ok(count && Number(count) > 0, execution.stderr);
});

const deferredScopeJob =
  '  scope:\n    name: Select assigned observability scope\n    runs-on: ubuntu-24.04\n    timeout-minutes: 1\n    outputs:\n      scope: ${{ steps.scope.outputs.scope }}\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n      - id: scope\n        run: python3 scripts/observability-production/production.py select-scope >> "$GITHUB_OUTPUT"\n\n';
const deferredWorkflowHashes = {
  signoz: "1efe0ae0ffaf0c1a687a5b9a6453bae514a922d74cf6e12af8fe22f0b2eecb35",
  "signoz-import-control":
    "15075f8ee4a80ac477d0fe350acc156d0c2d9bf39610bff6d11518a0288a84f6",
  "representative-d7":
    "e95699764ef66b30e6efe936a9b25dc2aea4cf4621d4b8b0c2e5bad6c137ca2d",
  umami: "f3f320bac4e0bd2684599b6a8f8b074fb1e027a5ad1d0177bcd119e96ac6a48c",
  "browser-analytics":
    "92af13ecde77052e2b8686f19ae49ee981292c9b0a8882bb9b7c457f6bf792ff",
};

/** @param {string} source @param {string} expected */
function assertDeferredScope(source, expected) {
  assert.equal(source.split(deferredScopeJob).length, 2);
  const gate =
    "needs.scope.result == 'success' && needs.scope.outputs.scope != 'technical'";
  let original = source.replace(deferredScopeJob, "");
  const jobs = [
    ...(original.split("jobs:\n")[1] ?? "").matchAll(
      /^ {2}([a-z][a-z0-9_-]*):\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9_-]*:\n|(?![\s\S]))/gmu,
    ),
  ];
  assert.ok(jobs.length > 0);
  for (const [, , body = ""] of jobs) {
    assert.equal(body.split(gate).length, 2);
    assert.match(body, /^ {4}needs: (scope|\[scope, [^\]]+\])$/mu);
  }
  original = original
    .replaceAll(`    if: \${{ ${gate} }}\n`, "")
    .replaceAll(`${gate} && `, "")
    .replaceAll("    needs: scope\n", "")
    .replaceAll("    needs: [scope, ", "    needs: [");
  assert.equal(createHash("sha256").update(original).digest("hex"), expected);
}

it("defers only the five native analytics/comparison workflows through the exact PR selector", () => {
  for (const [name, expected] of Object.entries(deferredWorkflowHashes)) {
    const source = readFileSync(
      resolve(repositoryRoot, `.github/workflows/observability-${name}.yml`),
      "utf8",
    );
    assertDeferredScope(source, expected);
    for (const [before = "", after = ""] of [
      ["select-scope >>", "select-other >>"],
      ["needs: scope\n", "needs: []\n"],
      ["needs.scope.outputs.scope != 'technical'", "true"],
      ["contents: read", "contents: write"],
      ["persist-credentials: false", "persist-credentials: true"],
      ["scope.outputs.scope", "scope.outputs.other"],
    ]) {
      assert.ok(source.includes(before));
      assert.throws(() =>
        assertDeferredScope(source.replace(before, after), expected),
      );
    }
  }
});

/** @param {string} source */
function requireGatewayDiagnostics(source) {
  for (const id of ["unit-checks", "telegram"]) {
    const block =
      source.split(`\n  ${id}:\n`)[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0] ?? "";
    const upload =
      block.split("- name: Upload Telegram gateway failure diagnostics")[1] ??
      "";
    assert.match(upload, /if: \$\{\{ failure\(\) \}\}/u);
    assert.match(upload, /uses: actions\/upload-artifact@[0-9a-f]{40}/u);
    assert.match(upload, /path: ci-artifacts\/telegram-deploy-gateway/u);
    assert.match(
      upload,
      /name: telegram-gateway-.+github.run_id.+github.run_attempt/u,
    );
    assert.match(upload, /retention-days: 7/u);
    assert.doesNotMatch(upload, /continue-on-error/u);
  }
}
it("retains gateway diagnostics in both contract execution jobs and rejects lost uploads", () => {
  requireGatewayDiagnostics(workflow);
  for (const mutation of [
    workflow.replaceAll(
      "path: ci-artifacts/telegram-deploy-gateway",
      "path: missing",
    ),
    workflow.replaceAll(
      "name: Upload Telegram gateway failure diagnostics",
      "name: Lost upload",
    ),
    workflow.replaceAll("retention-days: 7", "retention-days: 90"),
  ])
    assert.throws(() => requireGatewayDiagnostics(mutation));
});
