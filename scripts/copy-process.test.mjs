// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} args */
function copyProcess(args) {
  return spawnSync(
    "bash",
    [join(repositoryRoot, "scripts/copy-process.sh"), "--skip-labels", ...args],
    { encoding: "utf8" },
  );
}

describe("developer process copy", () => {
  it("copies the process without the frontend skills and detects drift", () => {
    const target = mkdtempSync(join(tmpdir(), "process-copy-"));
    try {
      mkdirSync(join(target, ".git"));

      const copy = copyProcess([target]);
      assert.equal(copy.status, 0, copy.stderr);
      assert.ok(existsSync(join(target, ".agents/skills/implement/SKILL.md")));
      assert.ok(
        existsSync(join(target, ".agents/skills/session-cleanup/SKILL.md")),
      );
      assert.ok(!existsSync(join(target, ".agents/skills/impeccable")));
      assert.equal(
        readlinkSync(join(target, ".claude/skills")),
        "../.agents/skills",
      );
      assert.equal(copyProcess(["--check", target]).status, 0);

      appendFileSync(join(target, "WORKFLOW.md"), "local edit\n");
      const drift = copyProcess(["--check", target]);
      assert.equal(drift.status, 1);
      assert.match(drift.stderr, /Differs: WORKFLOW\.md/u);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("refuses a target that is not a repository", () => {
    const target = mkdtempSync(join(tmpdir(), "process-copy-"));
    try {
      assert.equal(copyProcess([target]).status, 2);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
