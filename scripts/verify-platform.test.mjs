// @ts-check
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const helper = fileURLToPath(new URL("verify-platform.mjs", import.meta.url));

/** A repository of its own, so the helper never reads this checkout's instances. */
async function repository() {
  const directory = await mkdtemp(join(tmpdir(), "verify-platform-"));
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  git(["init", "--quiet", "--initial-branch", "feat/1-change"]);
  git(["config", "user.email", "verifier@inside.localhost"]);
  git(["config", "user.name", "Verifier"]);
  await writeFile(join(directory, "a.txt"), "first\n");
  git(["add", "a.txt"]);
  git(["commit", "--quiet", "--message", "first"]);
  return { directory, git };
}

/** @param {string} directory @param {string[]} args */
function run(directory, args) {
  return spawnSync(process.execPath, [helper, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, INIT_CWD: directory },
  });
}

test("the doctor refuses a worktree without an instance", async (context) => {
  const { directory } = await repository();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const text = run(directory, ["doctor"]);
  assert.equal(text.status, 1);
  assert.match(text.stdout, /^FAIL {2}process: no light instance/mu);
  assert.match(text.stdout, /Do not drive this instance/u);
  const json = run(directory, ["doctor", "--json"]);
  assert.equal(json.status, 1);
  assert.equal(
    z.object({ ok: z.boolean() }).parse(JSON.parse(json.stdout)).ok,
    false,
  );
  for (const args of [
    ["address", "owner", "/"],
    ["sql", "select 1"],
  ]) {
    const result = run(directory, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No light instance for this worktree/u);
  }
});

test("an evidence run records the commit and lists its artifacts", async (context) => {
  const { directory, git } = await repository();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const missing = run(directory, ["evidence", "path"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No evidence run/u);

  await writeFile(join(directory, "a.txt"), "second\n");
  const started = run(directory, ["evidence", "start", "--label", "probe"]);
  assert.equal(started.status, 0, started.stderr);
  const evidence = started.stdout.trim();
  const commit = git(["rev-parse", "HEAD"]).trim();
  assert.match(
    evidence,
    new RegExp(
      `/\\.git/inside-platform-stand/verify/\\d{8}T\\d{6}Z-feat-1-change-${commit.slice(0, 7)}$`,
      "u",
    ),
  );
  assert.equal(run(directory, ["evidence", "path"]).stdout.trim(), evidence);
  const record = z
    .object({
      commit: z.string(),
      uncommittedFiles: z.array(z.string()),
      uncommittedDiffSha256: z.string(),
    })
    .parse(JSON.parse(await readFile(join(evidence, "run.json"), "utf8")));
  assert.equal(record.commit, commit);
  assert.deepEqual(record.uncommittedFiles, ["a.txt"]);
  assert.match(record.uncommittedDiffSha256, /^[0-9a-f]{64}$/u);

  await writeFile(join(evidence, "01-before.png"), "image");
  const report = run(directory, ["report"]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^Verdict: <PASS \| PASS\+NOTES \| FAIL>$/mu);
  assert.match(report.stdout, new RegExp(`Commit: \`${commit}\``, "u"));
  assert.match(report.stdout, /Uncommitted: 1 file\(s\)/u);
  assert.match(
    report.stdout,
    /\| `01-before\.png` \| 5 B \| `[0-9a-f]{12}` \|/u,
  );
  assert.doesNotMatch(report.stdout, /run\.json/u);
});

test("the browser command refuses to act outside its session", async (context) => {
  const { directory } = await repository();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = run(directory, ["browser", "--", "close", "--all"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /own session/u);
  const role = run(directory, ["browser", "--role", "admin", "--", "snapshot"]);
  assert.equal(role.status, 1);
  const option = run(directory, ["doctor", "--unknown"]);
  assert.equal(option.status, 1);
  assert.doesNotMatch(option.stderr, /\n\s+at /u);
});
