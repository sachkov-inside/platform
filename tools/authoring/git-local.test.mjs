import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withGitSnapshot } from "./git-local.mjs";

const execute = promisify(execFile);
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "git-content-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await execute("git", ["-C", root, ...args])).stdout.trim();
  await git("init");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Fixture");
  await writeFile(join(root, "lesson.md"), "Committed lesson");
  await git("add", ".");
  await git("-c", "commit.gpgsign=false", "commit", "-m", "Initial content");
  return { root, git };
}

test("snapshot contains exactly the chosen commit and leaves all working changes intact", async (t) => {
  const { root, git } = await repository(t);
  const initial = await git("rev-parse", "HEAD");
  await writeFile(join(root, "lesson.md"), "Later commit");
  await git("add", ".");
  await git("-c", "commit.gpgsign=false", "commit", "-m", "Later content");
  await writeFile(join(root, "lesson.md"), "Staged draft");
  await git("add", ".");
  await writeFile(join(root, "lesson.md"), "Unstaged draft");
  await writeFile(join(root, "private.md"), "Untracked draft");
  const status = await git("status", "--porcelain");
  let temporary;
  await withGitSnapshot(root, initial, async ({ snapshot, commit }) => {
    temporary = snapshot;
    assert.equal(commit, initial);
    assert.equal(await readFile(join(snapshot, "lesson.md"), "utf8"), "Committed lesson");
    await assert.rejects(access(join(snapshot, "private.md")));
  });
  await assert.rejects(access(temporary));
  assert.equal(await git("status", "--porcelain"), status);
  assert.equal(await readFile(join(root, "lesson.md"), "utf8"), "Unstaged draft");
  assert.equal(await git("show", ":lesson.md"), "Staged draft");
});

test("invalid refs never run the exporter; failed export cleans up the snapshot", async (t) => {
  const { root } = await repository(t);
  let called = false;
  await assert.rejects(withGitSnapshot(root, "missing-ref", () => { called = true; }));
  assert.equal(called, false);
  let temporary;
  await assert.rejects(withGitSnapshot(root, "HEAD", ({ snapshot }) => {
    temporary = snapshot;
    throw new Error("Rejected content");
  }), /Rejected content/);
  await assert.rejects(access(temporary));
});
