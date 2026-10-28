// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "platform-worktree-adapter-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  copyFileSync(
    "scripts/worktree-resources.mjs",
    join(root, "scripts/worktree-resources.mjs"),
  );
  copyFileSync(
    ".worktree-resources.json",
    join(root, ".worktree-resources.json"),
  );
  return {
    root,
    /** @param {string} name */
    executable(name) {
      writeFileSync(
        join(root, "bin", name),
        `#!${process.execPath}\nconsole.log(JSON.stringify({command: ${JSON.stringify(name)}, args: process.argv.slice(2), cwd: process.cwd()}));\n`,
        { mode: 0o755 },
      );
    },
    /** @param {string[]} args */
    run(args) {
      return spawnSync(
        process.execPath,
        [join(root, "scripts/worktree-resources.mjs"), ...args],
        {
          cwd: tmpdir(),
          env: { ...process.env, PATH: join(root, "bin") },
          encoding: "utf8",
          timeout: 15000,
        },
      );
    },
  };
}

test("portable prepare repeats frozen install in its own worktree without a host CLI", (t) => {
  const context = fixture(t);
  context.executable("pnpm");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = context.run(["prepare", "--task", "1769"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      command: "pnpm",
      args: ["install", "--frozen-lockfile"],
      cwd: context.root,
    });
    assert.match(result.stderr, /resource tracking is unavailable/u);
  }
});

test("installed host CLI receives the project action, task and root without shell expansion", (t) => {
  const context = fixture(t);
  context.executable("agent-worktree");
  const result = context.run(["prepare", "--task", "issue;literal"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    command: "agent-worktree",
    args: ["prepare", "--task", "issue;literal"],
    cwd: context.root,
  });
});

test("status and cleanup delegate to the host CLI and refuse safely when it is absent", (t) => {
  const context = fixture(t);
  for (const action of ["status", "cleanup"]) {
    const missing = context.run([action]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no resources were changed/u);
  }
  context.executable("agent-worktree");
  for (const action of ["status", "cleanup"]) {
    const result = context.run([action, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      command: "agent-worktree",
      args: [action, "--json"],
      cwd: context.root,
    });
  }
});

test("prepare rejects a missing task before running dependencies or the host CLI", (t) => {
  const context = fixture(t);
  context.executable("pnpm");
  context.executable("agent-worktree");
  const result = context.run(["prepare"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /--task ISSUE/u);
});

test("a failed host preparation preserves its exit status and never retries a fallback install", (t) => {
  const context = fixture(t);
  writeFileSync(
    join(context.root, "bin", "agent-worktree"),
    `#!${process.execPath}\nprocess.exitCode = 23;\n`,
    { mode: 0o755 },
  );
  context.executable("pnpm");
  const result = context.run(["prepare", "--task", "1769"]);
  assert.equal(result.status, 23);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /Running project preparation/u);
});

test("portable preparation validates every argv command before starting any command", (t) => {
  const context = fixture(t);
  context.executable("pnpm");
  writeFileSync(
    join(context.root, ".worktree-resources.json"),
    JSON.stringify({ prepare: [["pnpm", "install"], "pnpm dev"] }),
  );
  const result = context.run(["prepare", "--task", "1769"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /argv arrays/u);
});

test("an installed host CLI with a missing interpreter fails without fallback preparation", (t) => {
  const context = fixture(t);
  writeFileSync(
    join(context.root, "bin", "agent-worktree"),
    "#!/missing-platform-review-interpreter\n",
    { mode: 0o755 },
  );
  context.executable("pnpm");
  const result = context.run(["prepare", "--task", "1769"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ENOENT/u);
  assert.doesNotMatch(result.stderr, /Running project preparation/u);
});
