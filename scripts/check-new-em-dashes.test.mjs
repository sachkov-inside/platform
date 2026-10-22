// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkNewEmDashes, findAddedEmDashes } from "./check-new-em-dashes.mjs";

const dash = "—";

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe("new em dash check", () => {
  it("reports only added copy lines with their new line numbers", () => {
    const diff = [
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -3,0 +4,2 @@",
      `+Plain line`,
      `+New ${dash} copy`,
      "@@ -10 +12 @@",
      `-Old ${dash} line`,
      "+Rewritten line",
      "diff --git a/apps/web/src/page.tsx b/apps/web/src/page.tsx",
      "--- a/apps/web/src/page.tsx",
      "+++ b/apps/web/src/page.tsx",
      "@@ -1,0 +1,3 @@",
      `+  // developer note ${dash} not copy`,
      `+   * block comment ${dash} not copy`,
      `+  <p>Heading ${dash} copy</p>`,
    ].join("\n");
    assert.deepEqual(findAddedEmDashes(diff), [
      { file: "docs/guide.md", line: 5, text: `New ${dash} copy` },
      {
        file: "apps/web/src/page.tsx",
        line: 3,
        text: `<p>Heading ${dash} copy</p>`,
      },
    ]);
  });

  it("compares the working tree or the index with the merge base and ignores other paths", () => {
    const root = mkdtempSync(join(tmpdir(), "em-dash-"));
    try {
      git(root, ["init", "--quiet", "--initial-branch=main"]);
      mkdirSync(join(root, "docs"));
      mkdirSync(join(root, "scripts"));
      writeFileSync(join(root, "docs/old.md"), `Existing ${dash} text\n`);
      git(root, ["add", "."]);
      git(root, ["commit", "--quiet", "-m", "base"]);
      const base = git(root, ["rev-parse", "HEAD"]);
      git(root, ["update-ref", "refs/remotes/origin/main", base]);

      assert.deepEqual(checkNewEmDashes({ repositoryRoot: root }), {
        base,
        findings: [],
      });

      writeFileSync(join(root, "scripts/tool.mjs"), `// ${dash}\n"${dash}"\n`);
      writeFileSync(join(root, "docs/new.md"), `Title\nNew ${dash} copy\n`);
      git(root, ["add", "docs/new.md", "scripts/tool.mjs"]);
      git(root, ["commit", "--quiet", "-m", "change"]);
      assert.deepEqual(checkNewEmDashes({ repositoryRoot: root }).findings, [
        { file: "docs/new.md", line: 2, text: `New ${dash} copy` },
      ]);

      writeFileSync(join(root, "docs/old.md"), `Existing ${dash} text\nMore\n`);
      git(root, ["add", "docs/old.md"]);
      assert.deepEqual(
        checkNewEmDashes({ repositoryRoot: root, staged: true }).findings,
        [],
      );
      writeFileSync(join(root, "docs/staged.md"), `Staged ${dash}\n`);
      git(root, ["add", "docs/staged.md"]);
      assert.deepEqual(
        checkNewEmDashes({ repositoryRoot: root, staged: true }).findings,
        [{ file: "docs/staged.md", line: 1, text: `Staged ${dash}` }],
      );

      git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
      assert.equal(checkNewEmDashes({ repositoryRoot: root }).base, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
