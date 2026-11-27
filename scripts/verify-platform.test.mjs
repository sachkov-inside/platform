// @ts-check
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  // As in this repository: evidence is never part of the change under verification.
  await writeFile(join(directory, ".gitignore"), ".evidence/\n");
  git(["add", "a.txt", ".gitignore"]);
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

test("an evidence run builds a manifest the report is made from", async (context) => {
  const { directory, git } = await repository();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const missing = run(directory, ["evidence", "path"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No evidence run/u);

  const started = run(directory, ["evidence", "start"]);
  assert.equal(started.status, 0, started.stderr);
  const evidence = started.stdout.trim();
  assert.equal(evidence, join(await realpath(directory), ".evidence"));
  assert.equal(run(directory, ["evidence", "path"]).stdout.trim(), evidence);
  // The same commit continues its run.
  assert.equal(run(directory, ["evidence", "start"]).status, 0);

  await writeFile(join(evidence, "01-before.png"), "image");
  const added = run(directory, [
    "evidence",
    "add",
    "--title",
    "Владелец выдаёт продукт",
    "--kind",
    "screenshot",
    "--file",
    "01-before.png::карточка до выдачи",
    "--shows",
    "Карточка показывает «Доступ открыт»",
    "--covers",
    "#2211: владелец выдаёт продукт",
    "--result",
    "PASS",
  ]);
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /Added scenario s01/u);
  // PASS needs no notes; the manifest is complete with one scenario.
  const noFile = run(directory, [
    "evidence",
    "add",
    "--title",
    "Без файла",
    "--kind",
    "video",
    "--shows",
    "x",
    "--covers",
    "y",
    "--result",
    "PASS",
  ]);
  assert.equal(noFile.status, 1);
  assert.match(noFile.stderr, /needs at least one file/u);

  const unfinished = run(directory, ["evidence", "check"]);
  assert.equal(unfinished.status, 1);
  assert.match(unfinished.stdout, /the run has no verdict/u);
  assert.equal(run(directory, ["evidence", "verdict", "PASS"]).status, 0);
  const complete = run(directory, ["evidence", "check"]);
  assert.equal(complete.status, 0, complete.stdout);
  assert.match(complete.stdout, /1 scenario\(s\), verdict PASS/u);

  const commit = git(["rev-parse", "HEAD"]).trim();
  const manifest = z
    .object({
      version: z.literal(1),
      commit: z.string(),
      verdict: z.string(),
      scenarios: z.array(
        z.object({ id: z.string(), source: z.string(), kind: z.string() }),
      ),
    })
    .parse(JSON.parse(await readFile(join(evidence, "manifest.json"), "utf8")));
  assert.equal(manifest.commit, commit);
  assert.deepEqual(manifest.scenarios, [
    { id: "s01", source: "light-instance", kind: "screenshot" },
  ]);
  const report = run(directory, ["report"]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^Verdict: PASS$/mu);
  assert.match(
    report.stdout,
    /\| s01 \| Владелец выдаёт продукт \| screenshot \|/u,
  );

  await writeFile(join(directory, "a.txt"), "second\n");
  const edited = run(directory, ["evidence", "start"]);
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /other uncommitted changes/u);
  git(["commit", "--quiet", "--all", "--message", "second"]);
  const moved = run(directory, ["evidence", "check"]);
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, /the manifest is of [0-9a-f]{12}, HEAD is/u);
  const stale = run(directory, ["evidence", "start"]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /start over with: evidence start --reset/u);
  // A broken manifest and stray files do not stop a reset.
  await writeFile(join(evidence, "manifest.json"), "{");
  assert.equal(run(directory, ["evidence", "start", "--reset"]).status, 0);
  assert.equal(existsSync(join(evidence, "01-before.png")), false);
  assert.equal(run(directory, ["evidence", "check"]).status, 1);

  // A link is not evidence: the check does not follow it out of .evidence.
  await writeFile(join(directory, "outside.png"), "image");
  await symlink(join(directory, "outside.png"), join(evidence, "link.png"));
  const linked = run(directory, [
    "evidence",
    "add",
    "--title",
    "Ссылка наружу",
    "--kind",
    "screenshot",
    "--file",
    "link.png::снимок :: с двоеточиями",
    "--shows",
    "x",
    "--covers",
    "y",
    "--result",
    "PASS",
  ]);
  assert.equal(linked.status, 0, linked.stderr);
  assert.match(
    await readFile(join(evidence, "manifest.json"), "utf8"),
    /снимок :: с двоеточиями/u,
  );
  assert.match(
    run(directory, ["evidence", "check"]).stdout,
    /link\.png is not a file in \.evidence/u,
  );
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

test("the guarded light session closes browsers before stopping its instance", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "light-verification-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "operations");
  await writeFile(
    join(directory, "pnpm"),
    `#!/bin/sh
printf '%s\\n' "$*" >>"$VERIFY_TEST_LOG"
if [ "$2" = up ]; then
  touch "$INSIDE_LIGHT_VERIFICATION/started" "$INSIDE_LIGHT_VERIFICATION/ready"
fi
`,
    { mode: 0o700 },
  );
  await writeFile(
    join(directory, "node"),
    `#!/bin/sh
printf '%s\\n' "$*" >>"$VERIFY_TEST_LOG"
`,
    { mode: 0o700 },
  );
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    ...process.env,
    PATH: `${directory}:${process.env["PATH"] ?? ""}`,
    INSIDE_HEAVY_CHECK_DIRECTORY: join(directory, "queue"),
    VERIFY_TEST_LOG: log,
  };
  delete environment["CI"];
  delete environment["INSIDE_HEAVY_CHECK_OWNER"];
  delete environment["INSIDE_HEAVY_CHECK_EXCLUSIVE"];
  const expected = [
    "stand:light up",
    "scripts/verify-platform.mjs browser --role holder -- close",
    "stand:light down",
  ];
  const verification = ["bash", "scripts/verify-light.sh", "--", "sh", "-c"];
  const recordRoles =
    'printf "holder\\nholder\\n" > "$INSIDE_LIGHT_VERIFICATION/roles"';
  for (const { command, status, expectedOperations } of [
    {
      command: [...verification.slice(1), `${recordRoles}; exit 17`],
      status: 17,
      expectedOperations: expected,
    },
    {
      command: [
        "scripts/heavy-check.sh",
        "--exclusive",
        "--timeout",
        "2",
        "--cleanup-grace",
        "8",
        ...verification,
        `${recordRoles}; sleep 60`,
      ],
      status: 124,
      expectedOperations: expected,
    },
    {
      command: [
        ...verification.slice(1, 2),
        "--browser-only",
        ...verification.slice(2),
        `${recordRoles}; exit 0`,
      ],
      status: 0,
      expectedOperations: [expected[1]],
    },
  ]) {
    await writeFile(log, "");
    const result = spawnSync("bash", command, {
      env: environment,
      encoding: "utf8",
      timeout: 12_000,
    });
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(
      (await readFile(log, "utf8")).trim().split("\n"),
      expectedOperations,
    );
  }
});
