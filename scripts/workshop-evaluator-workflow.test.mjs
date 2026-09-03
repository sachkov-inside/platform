import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/workshop-evaluator.yml", import.meta.url)),
  "utf8",
);
const caseSpecSchema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../contracts/workshop/inside.workshop.case-spec.v1.schema.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

test("Workshop evaluator CI executes every native beta target", () => {
  for (const expected of [
    "runner: macos-15\n            goos: darwin\n            goarch: arm64",
    "runner: ubuntu-24.04\n            goos: linux\n            goarch: amd64",
    "runner: windows-2025\n            goos: windows\n            goarch: amd64",
  ]) {
    assert.ok(workflow.includes(expected), `missing native matrix entry:\n${expected}`);
  }
  assert.match(workflow, /actual_target=.*go env GOOS.*go env GOARCH/su);
  assert.match(workflow, /go test -race \.\/\.\.\./u);
  assert.match(workflow, /workshop-evaluator-smoke/u);
  assert.equal((workflow.match(/real_compose: true/gu) ?? []).length, 2);
  assert.match(workflow, /target: darwin-arm64[\s\S]*?real_compose: false/u);
  assert.doesNotMatch(workflow, /colima start/u);
  assert.match(workflow, /Start-Service docker/u);
  assert.match(workflow, /smoke_arguments\+=\(--real-compose\)/u);
});

test("Workflow native targets exactly match the CaseSpec host contract", () => {
  const contractTargets = caseSpecSchema.$defs.supportedHost.oneOf.map(
    (host) => `${host.properties.os.const}-${host.properties.arch.const}`,
  );
  const workflowTargets = [...workflow.matchAll(/- target: ([^\n]+)/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(workflowTargets.sort(), contractTargets.sort());
});

test("Workshop evaluator artifacts are pinned and checksum-addressed", () => {
  assert.doesNotMatch(workflow, /EVALUATOR_VERSION/u);
  assert.match(workflow, /evaluator_version=.*--version/u);
  assert.match(workflow, /workshop-evaluator.*\.sha256/u);
  assert.match(workflow, /dist\/run-workshop-evaluator\.sh/u);
  assert.match(workflow, /dist\/run-workshop-evaluator\.ps1/u);
  assert.match(workflow, /workshop-evaluator-checksum --file .* --verify/u);
  assert.match(workflow, /package-native-artifact\.sh/u);
  assert.match(workflow, /workshop-evaluator-\$\{\{ matrix\.target \}\}\.tar\.gz/u);
  assert.match(workflow, /actions\/upload-artifact@v7\.0\.1/u);
  assert.doesNotMatch(workflow, /@[vV](?:latest|\d+)\s*$/mu);
  assert.doesNotMatch(workflow, /auto.?update/iu);
});
