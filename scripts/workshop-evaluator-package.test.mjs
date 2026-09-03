import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const evaluatorRoot = path.join(repositoryRoot, "tools/workshop-evaluator");

test("native Unix package preserves modes and rejects a changed binary", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "inside-workshop-package-test-"));
  const dist = path.join(temporaryRoot, "dist");
  mkdirSync(dist);

  const binary = path.join(dist, "workshop-evaluator");
  writeFileSync(binary, "#!/usr/bin/env bash\nprintf '%s\\n' 'fixture-version'\n");
  chmodSync(binary, 0o755);
  const wrapper = path.join(dist, "run-workshop-evaluator.sh");
  copyFileSync(
    path.join(evaluatorRoot, "wrappers/run-workshop-evaluator.sh"),
    wrapper,
  );
  chmodSync(wrapper, 0o755);
  const digest = createHash("sha256").update(readFileSync(binary)).digest("hex");
  writeFileSync(path.join(dist, "workshop-evaluator.sha256"), `${digest}  workshop-evaluator\n`);

  const packaged = spawnSync(
    path.join(evaluatorRoot, "package-native-artifact.sh"),
    ["darwin-arm64", dist],
    { cwd: evaluatorRoot, encoding: "utf8" },
  );
  assert.equal(packaged.status, 0, packaged.stderr);

  const extracted = path.join(temporaryRoot, "extracted");
  mkdirSync(extracted);
  const archive = path.join(dist, "workshop-evaluator-darwin-arm64.tar.gz");
  const extraction = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
    encoding: "utf8",
  });
  assert.equal(extraction.status, 0, extraction.stderr);

  const executed = spawnSync(path.join(extracted, "run-workshop-evaluator.sh"), ["--version"], {
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /fixture-version/u);

  appendFileSync(path.join(extracted, "workshop-evaluator"), "tampered\n");
  const rejected = spawnSync(
    path.join(extracted, "run-workshop-evaluator.sh"),
    ["--version"],
    { encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.doesNotMatch(rejected.stdout, /fixture-version/u);
});
