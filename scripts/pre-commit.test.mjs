// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import * as prettier from "prettier";

import { readPackageScripts } from "./package-scripts.mjs";
import {
  needsDocumentationCheck,
  stagedFiles,
  unformattedFiles,
} from "./pre-commit.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

describe("pre-commit hook", () => {
  it("is installed by pnpm install and runs the staged checks", () => {
    const { scripts } = readPackageScripts(
      join(repositoryRoot, "package.json"),
    );
    assert.equal(
      scripts["prepare"],
      "git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath .githooks || true",
    );
    const hook = readFileSync(
      join(repositoryRoot, ".githooks/pre-commit"),
      "utf8",
    );
    assert.match(hook, /^#!\/bin\/sh\n/u);
    assert.match(hook, /exec node scripts\/pre-commit\.mjs\n$/u);
  });

  it("checks the staged bytes of formattable files and skips ignored ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "pre-commit-"));
    try {
      git(root, ["init", "--quiet"]);
      writeFileSync(join(root, ".prettierignore"), "ignored.ts\n");
      writeFileSync(join(root, "good.ts"), "export const value = 1;\n");
      writeFileSync(join(root, "bad.ts"), "export const value   =1\n");
      writeFileSync(join(root, "ignored.ts"), "export const value   =1\n");
      writeFileSync(join(root, "data.bin"), "\0");
      git(root, ["add", "."]);
      // The working copy is fixed after staging; the commit would still contain the bad bytes.
      writeFileSync(join(root, "bad.ts"), "export const value = 1;\n");
      writeFileSync(join(root, "good.ts"), "export const value   =1\n");

      const files = stagedFiles(root);
      assert.deepEqual(files.sort(), [
        ".prettierignore",
        "bad.ts",
        "data.bin",
        "good.ts",
        "ignored.ts",
      ]);
      assert.deepEqual(await unformattedFiles(root, files, prettier), [
        "bad.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs documentation contracts only for Markdown and package scripts", () => {
    assert.equal(needsDocumentationCheck("docs/runbooks/release.md"), true);
    assert.equal(needsDocumentationCheck("package.json"), true);
    assert.equal(needsDocumentationCheck("apps/web/package.json"), true);
    assert.equal(needsDocumentationCheck("apps/web/src/page.tsx"), false);
  });
});
