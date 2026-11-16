// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finishStand, runStep, standFinishSteps } from "./stand-finish.mjs";

test("finish stops the light instance, then releases only an owned reservation", () => {
  assert.deepEqual(
    standFinishSteps.map((step) => step.args),
    [
      ["stand:light", "down"],
      ["stand", "release", "--if-owned"],
    ],
  );
});

test("a failing or hanging step is reported and the next step still runs", async () => {
  /** @type {string[][]} */
  const ran = [];
  /** @type {string[]} */
  const reports = [];
  const code = await finishStand({
    steps: [
      { name: "first", args: ["first"] },
      { name: "second", args: ["second"] },
      { name: "third", args: ["third"] },
    ],
    run: async (args) => {
      ran.push(args);
      if (args[0] === "first") return 1;
      if (args[0] === "second") throw new Error("time limit reached");
      return 0;
    },
    report: (message) => reports.push(message),
  });
  assert.equal(code, 1);
  assert.deepEqual(ran, [["first"], ["second"], ["third"]]);
  assert.equal(reports.length, 2);
  assert.match(reports[0] ?? "", /^first: exited with 1/u);
  assert.match(reports[1] ?? "", /^second: time limit reached/u);
});

test("a step past its time limit is stopped with its process tree", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-finish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A stand-in for the pnpm CLI: `hang` records its PID and never exits, `ok` exits 0.
  const fakePnpm = join(directory, "pnpm.mjs");
  await writeFile(
    fakePnpm,
    `import { writeFileSync } from "node:fs";
if (process.argv[2] === "hang") {
  writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid));
  setInterval(() => {}, 1_000);
}`,
  );
  assert.equal(
    await runStep({
      pnpmPath: fakePnpm,
      cwd: directory,
      args: ["ok"],
      limitMilliseconds: 60_000,
    }),
    0,
  );
  await assert.rejects(
    runStep({
      pnpmPath: fakePnpm,
      cwd: directory,
      args: ["hang"],
      // Covers the start of the Python supervisor and Node before the child writes its PID.
      limitMilliseconds: 5_000,
    }),
    /time limit reached/u,
  );
  const pid = Number(await readFile(join(directory, "pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("task finish adapter only invokes task-scoped stand release", async () => {
  /** @type {unknown} */
  const config = JSON.parse(
    await readFile(
      new URL("../.worktree-resources.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(
    typeof config === "object" && config !== null && "finish" in config,
  );
  assert.deepEqual(config.finish, [["pnpm", "stand:finish"]]);
});

test("successful stand release returns success", async () => {
  assert.equal(
    await finishStand({
      steps: standFinishSteps,
      run: async () => 0,
      report: assert.fail,
    }),
    0,
  );
});
