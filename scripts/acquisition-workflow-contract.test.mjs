// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/acquisition-diagnostic.yml", import.meta.url),
  "utf8",
);

test("acquisition entry cannot run on publication, another head, fork, PR or rerun", () => {
  assert.match(
    workflow,
    /on:\n {2}pull_request:\n {4}types: \[labeled\]\n {4}branches: \[main\]/u,
  );
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch:|pull_request_target:|^ {2}push:|^ {2}schedule:/mu,
  );
  const expression = workflow
    .match(/ {4}if: \|\n([\s\S]*?) {4}runs-on:/u)?.[1]
    ?.trim()
    .replace(/^\$\{\{|\}\}$/gu, "");
  assert.ok(expression);
  // The actual Actions expression is evaluated only against fixed supplied event doubles.

  const sha = "a".repeat(40);
  const event = () => ({
    event_name: "pull_request",
    run_attempt: 1,
    repository: "sachkov-inside/platform",
    event: {
      action: "labeled",
      number: 1340,
      label: { name: `1324-acq-${sha}` },
      pull_request: {
        head: { sha, repo: { full_name: "sachkov-inside/platform" } },
        base: { ref: "main" },
      },
    },
  });
  const format = (/** @type {string} */ pattern, /** @type {string} */ value) =>
    pattern.replace("{0}", value);
  const admitted = (/** @type {ReturnType<typeof event>} */ github) => {
    /** @type {unknown} */
    const result = runInNewContext(
      expression,
      { github, format },
      { timeout: 1000 },
    );
    return result;
  };
  assert.equal(admitted(event()), true);
  for (const field of [
    "action",
    "label",
    "head",
    "fork",
    "pr",
    "attempt",
    "event",
    "base",
  ]) {
    const value = event();
    if (field === "action") value.event.action = "synchronize";
    if (field === "label") value.event.label.name = "1324-acquisition";
    if (field === "head") value.event.pull_request.head.sha = "b".repeat(40);
    if (field === "fork")
      value.event.pull_request.head.repo.full_name = "fork/platform";
    if (field === "pr") value.event.number = 1333;
    if (field === "attempt") value.run_attempt = 2;
    if (field === "event") value.event_name = "push";
    if (field === "base") value.event.pull_request.base.ref = "other";
    assert.equal(admitted(value), false, field);
  }
});

test("hosted delivery preserves exact guardian, owned native closure and artifacts", () => {
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /permissions:\n {2}contents: read/u);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u,
  );
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(
    workflow,
    /SOURCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u,
  );
  assert.match(
    workflow,
    /node scripts\/owned-node\.mjs --command python3 scripts\/acquisition-diagnostic-guard\.py/u,
  );
  assert.match(workflow, /--source-sha "\$SOURCE_SHA"/u);
  assert.match(workflow, /ACQUISITION_DIAGNOSTIC_EPHEMERAL: "1"/u);
  assert.match(workflow, /timeout-minutes: 4/u);
  assert.match(
    workflow,
    /if: \$\{\{ always\(\) && steps\.diagnostic\.outcome != 'skipped' \}\}/u,
  );
  assert.match(
    workflow,
    /sudo -n python3 scripts\/acquisition-diagnostic-hosted\.py close/u,
  );
  assert.match(
    workflow,
    /if: \$\{\{ always\(\) \}\}[\s\S]*actions\/upload-artifact@[a-f0-9]{40}/u,
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.|browsers:|production:verify|docker (pull|run)|continue-on-error/u,
  );
});

test("exact full-SHA diagnostic label fits GitHub maximum 50 characters", () => {
  const pattern = workflow.match(
    /github\.event\.label\.name == format\('([^']+)', github\.event\.pull_request\.head\.sha\)/u,
  )?.[1];
  assert.ok(pattern);
  const sourceSha = "a".repeat(40);
  const label = pattern.replace("{0}", sourceSha);
  assert.ok(
    label.length <= 50,
    `actual diagnostic label length ${label.length}`,
  );
  assert.equal(label, `1324-acq-${sourceSha}`);
  assert.equal(label.slice("1324-acq-".length), sourceSha);
  assert.equal(label.length, 49);
  assert.equal(sourceSha.length, 40);
});

test("mixed-UID native preflight must succeed before guardian starts", () => {
  const native = workflow.indexOf(
    "name: Prove diagnostic mixed-UID meter closure",
  );
  const guardian = workflow.indexOf("id: diagnostic");
  assert.ok(native >= 0 && guardian > native);
  assert.match(workflow, /ACQUISITION_DIAGNOSTIC_NATIVE_EPHEMERAL: "1"/u);
  assert.match(
    workflow,
    /owned-node\.mjs --command python3 scripts\/acquisition-diagnostic-meter-native\.py/u,
  );
  assert.doesNotMatch(
    workflow.slice(native, guardian),
    /continue-on-error|if:.*always/u,
  );
});
