// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
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
    [
      join(repositoryRoot, "scripts/copy-process.sh"),
      "--skip-labels",
      "--allow-dirty",
      ...args,
    ],
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

      mkdirSync(join(target, ".agents/skills/local-skill"));
      appendFileSync(join(target, "WORKFLOW.md"), "local edit\n");
      const drift = copyProcess(["--check", target]);
      assert.equal(drift.status, 1);
      assert.match(drift.stderr, /Differs: WORKFLOW\.md/u);
      assert.match(
        drift.stderr,
        /remove it from the target: \.agents\/skills\/local-skill/u,
      );
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("refuses to copy uncommitted process files", () => {
    const source = mkdtempSync(join(tmpdir(), "process-source-"));
    const target = mkdtempSync(join(tmpdir(), "process-copy-"));
    try {
      mkdirSync(join(target, ".git"));
      mkdirSync(join(source, "scripts"));
      mkdirSync(join(source, "docs/agents"), { recursive: true });
      mkdirSync(join(source, ".agents/skills/implement"), { recursive: true });
      cpSync(
        join(repositoryRoot, "scripts/copy-process.sh"),
        join(source, "scripts/copy-process.sh"),
      );
      for (const file of [
        "WORKFLOW.md",
        "docs/agents/triage-labels.md",
        ".agents/skills/UPSTREAM.md",
        ".agents/skills/implement/SKILL.md",
      ]) {
        cpSync(join(repositoryRoot, file), join(source, file));
      }
      const git = (/** @type {string[]} */ args) =>
        spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
      git(["init", "--quiet"]);
      git(["add", "--all"]);
      git([
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "--message=process",
      ]);
      const script = join(source, "scripts/copy-process.sh");

      appendFileSync(join(source, "WORKFLOW.md"), "uncommitted\n");
      const refused = spawnSync("bash", [script, "--skip-labels", target], {
        encoding: "utf8",
      });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /Commit the process files/u);
      assert.ok(!existsSync(join(target, "WORKFLOW.md")));

      git(["checkout", "--quiet", "--", "WORKFLOW.md"]);
      const copied = spawnSync("bash", [script, "--skip-labels", target], {
        encoding: "utf8",
      });
      assert.equal(copied.status, 0, copied.stderr);
    } finally {
      rmSync(source, { recursive: true, force: true });
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
