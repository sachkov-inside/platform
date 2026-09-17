import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

function layout(t) {
  const base = mkdtempSync(join(tmpdir(), "shared-identity-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const primary = join(base, "primary");
  const worktree = join(base, "worktree");
  mkdirSync(join(primary, ".git"), { recursive: true });
  mkdirSync(worktree);
  return { primary, worktree };
}

test("a linked worktree points at the primary checkout's stand identity", (t) => {
  const { primary, worktree } = layout(t);
  const git = () => join(primary, ".git");
  assert.equal(ensureSharedIdentityDirectory(worktree, { git }), join(primary, ".identity-proof"));
  assert.equal(readlinkSync(join(worktree, ".identity-proof")), join(primary, ".identity-proof"));
  assert.equal(ensureSharedIdentityDirectory(worktree, { git }), join(primary, ".identity-proof"));
  writeFileSync(join(worktree, ".identity-proof", "stand.env"), "KEY=value\n");
  assert.ok(existsSync(join(primary, ".identity-proof", "stand.env")));
});

test("the primary checkout keeps its own directory and a divergent worktree copy is refused", (t) => {
  const { primary, worktree } = layout(t);
  assert.equal(ensureSharedIdentityDirectory(primary, { git: () => ".git" }), join(primary, ".identity-proof"));
  mkdirSync(join(worktree, ".identity-proof"));
  assert.throws(() => ensureSharedIdentityDirectory(worktree, { git: () => join(primary, ".git") }), /shared stand identity directory/u);
});
