// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runStandImages } from "./stand-images.mjs";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

const now = new Date("2026-10-29T12:00:00Z");
const id = (/** @type {number} */ n) => `sha256:${String(n).padStart(64, "0")}`;

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "stand-images-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = join(directory, "protected.json");
  const lockTarget = join(directory, "stand-lock");
  await writeFile(manifest, JSON.stringify([id(2)]));
  /** @type {string[][]} */
  const calls = [];
  let output = "";
  let inspections = 0;
  let infos = 0;
  const state = {
    down: false,
    changed: false,
    acquired: false,
    newProtection: false,
    removalFails: false,
  };
  /** @param {string[]} args */
  const executeDocker = async (args) => {
    calls.push(args);
    const command = args[0] === "--context" ? args.slice(2) : args;
    if (state.down) throw new Error("daemon stopped");
    if (command[0] === "info")
      return state.changed && ++infos > 1 ? "changed-daemon" : "fixture-daemon";
    if (command[1] === "inspect") {
      inspections += 1;
      if (inspections > 1 && state.newProtection)
        await writeFile(manifest, JSON.stringify([id(2)]));
      return [1, 2]
        .map((n) =>
          JSON.stringify({
            Id: id(n),
            RepoTags: [],
            Created: n === 1 ? "2026-10-01T00:00:00Z" : "2026-09-01T00:00:00Z",
            Size: 1,
            Config: {
              Labels: {
                "com.docker.compose.project": "inside-platform",
                "com.docker.compose.service": "api",
              },
            },
          }),
        )
        .join("\n");
    }
    if (command[1] === "ls")
      return [1, 2]
        .map(
          (n) =>
            id(n) +
            (command.includes("--format")
              ? inspections > 1 && state.acquired && n === 2
                ? "\t1"
                : "\t0"
              : ""),
        )
        .join("\n");
    if (state.removalFails) throw new Error("image removal refused");
    return "";
  };
  return {
    state,
    manifest,
    lockTarget,
    calls,
    executeDocker,
    output: () => output,
    run: (/** @type {string[]} */ args, execute = executeDocker) =>
      runStandImages({
        args,
        executeDocker: execute,
        defaultProtectionFile: manifest,
        lockTarget,
        now: () => now,
        write: (line) => {
          output += line;
        },
      }),
  };
}

test("command pins every Docker call and retains the default recovery manifest", async (t) => {
  const f = await fixture(t);
  await f.run(["--context", "orbstack", "--apply"]);
  assert.match(f.output(), /explicit recovery image/u);
  assert.match(f.output(), /Removed 0/u);
  assert.ok(f.calls.length > 0);
  assert.ok(
    f.calls.every((args) => args[0] === "--context" && args[1] === "orbstack"),
  );
  assert.ok(f.calls.every((args) => !args.includes("rm")));
});

test("command refuses unknown options and missing or invalid protection before Docker", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["--unknown"],
    ["--context"],
    ["--protected-images", join(f.manifest, "missing")],
  ])
    await assert.rejects(f.run([...args, "--apply"]));
  for (const raw of ["not-json", "{}", '["not-an-image-id"]']) {
    await writeFile(f.manifest, raw);
    await assert.rejects(f.run(["--apply"]));
  }
  assert.deepEqual(f.calls, []);
});

test("command refuses an occupied stand lock and a stopped daemon, and releases on failure", async (t) => {
  const f = await fixture(t);
  const release = await acquireLocalSetupLock("fixture", f.lockTarget);
  try {
    await assert.rejects(f.run(["--apply"]), /Another stand operation/u);
    assert.deepEqual(f.calls, []);
  } finally {
    await release();
  }
  f.state.down = true;
  await assert.rejects(f.run(["--apply"]), /daemon stopped/u);
  f.state.down = false;
  await f.run(["--apply"]);
});

test("command refuses changed and unexpected daemons before deleting", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run(["--apply", "--daemon-id", "other-daemon"]),
    /does not match/u,
  );
  assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  await writeFile(f.manifest, "[]");
  f.state.changed = true;
  await assert.rejects(f.run(["--apply"]), /Docker daemon changed/u);
  assert.ok(f.calls.every((args) => !args.includes("rm")));
});

test("command rechecks newly acquired container and recovery references before deletion", async (t) => {
  for (const protection of ["container", "recovery"]) {
    const f = await fixture(t);
    await writeFile(f.manifest, "[]");
    f.state.acquired = protection === "container";
    f.state.newProtection = protection === "recovery";
    await f.run(["--apply"]);
    assert.match(f.output(), /Removed 0/u);
    assert.ok(f.calls.every((args) => !args.includes("rm")));
  }
});

test("command preserves its lock while asynchronous Docker is pending and after removal failure", async (t) => {
  const f = await fixture(t);
  await writeFile(f.manifest, "[]");
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const pending = f.run(["--apply"], async (args) => {
    started.resolve();
    await resume.promise;
    return f.executeDocker(args);
  });
  try {
    await started.promise;
    await assert.rejects(acquireLocalSetupLock("busy", f.lockTarget), /busy/u);
  } finally {
    resume.resolve();
  }
  await pending;
  f.state.removalFails = true;
  await assert.rejects(f.run(["--apply"]), /image removal refused/u);
  f.state.removalFails = false;
  await f.run(["--apply"]);
});
