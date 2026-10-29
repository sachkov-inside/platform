// @ts-check
import assert from "node:assert/strict";
// deterministic-test-allow unit-io: owned CLI subprocess contract, fake Docker only, bounded synchronous lifetime and no descendant processes.
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { z } from "zod";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

const imageId = (/** @type {number} */ n) =>
  `sha256:${String(n).padStart(64, "0")}`;

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "stand-images-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "calls.jsonl");
  const manifest = join(directory, "protected.json");
  await writeFile(manifest, JSON.stringify([imageId(2)]));
  await writeFile(
    join(directory, "docker"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
const command = args[0] === '--context' ? args.slice(2) : args;
if (process.env.FAKE_DOCKER_DOWN) process.exit(1);
if (command[0] === 'info') console.log(process.env.FAKE_DOCKER_CHANGED && fs.readFileSync(process.env.FAKE_DOCKER_LOG, 'utf8').split('"info"').length > 2 ? 'changed-daemon' : 'fixture-daemon');
else if (command.includes('inspect')) {
  for (const n of [1, 2]) console.log(JSON.stringify({
    Id: 'sha256:' + String(n).padStart(64, '0'), RepoTags: [],
    Created: n === 1 ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z', Size: 1,
    Config: { Labels: { 'com.docker.compose.project': 'inside-platform', 'com.docker.compose.service': 'api' } }
  }));
} else if (command[1] === 'ls') {
  for (const n of [1, 2]) console.log('sha256:' + String(n).padStart(64, '0') + (command.includes('--format') ? '\\t0' : ''));
}
`,
    { mode: 0o700 },
  );
  return {
    manifest,
    directory,
    run: (/** @type {string[]} */ args, extra = {}) =>
      spawnSync(
        process.execPath,
        [resolve("scripts/stand-images.mjs"), ...args],
        {
          env: {
            ...process.env,
            PATH: directory,
            TMPDIR: directory,
            FAKE_DOCKER_LOG: log,
            ...extra,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      ),
    calls: async () => {
      try {
        return (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) =>
            z
              .array(z.string())
              .parse(/** @type {unknown} */ (JSON.parse(line))),
          );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return [];
        throw error;
      }
    },
  };
}

test("CLI pins every Docker call and retains the explicit recovery manifest", async (t) => {
  const f = await fixture(t);
  const result = f.run([
    "--context",
    "orbstack",
    "--protected-images",
    f.manifest,
    "--apply",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /explicit recovery image/u);
  assert.match(result.stdout, /Removed 0/u);
  const calls = await f.calls();
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((args) => args[0] === "--context" && args[1] === "orbstack"),
  );
  assert.ok(calls.every((args) => !args.includes("rm")));
});

test("CLI refuses unknown options and missing or invalid protection before Docker", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["--unknown"],
    ["--context"],
    ["--protected-images", join(f.directory, "missing")],
  ]) {
    assert.equal(f.run([...args, "--apply"]).status, 1);
  }
  for (const raw of ["not-json", "{}", '["not-an-image-id"]']) {
    await writeFile(f.manifest, raw);
    assert.equal(
      f.run(["--protected-images", f.manifest, "--apply"]).status,
      1,
    );
  }
  assert.deepEqual(await f.calls(), []);
});

test("CLI refuses an occupied stand lock and a stopped daemon, and permits retry", async (t) => {
  const f = await fixture(t);
  const release = await acquireLocalSetupLock(
    "fixture",
    join(f.directory, "inside-platform-local-setup"),
  );
  try {
    const busy = f.run(["--apply"]);
    assert.equal(busy.status, 1);
    assert.match(busy.stderr, /Another stand operation/u);
    assert.deepEqual(await f.calls(), []);
  } finally {
    await release();
  }
  assert.equal(f.run(["--apply"], { FAKE_DOCKER_DOWN: "1" }).status, 1);
  const retried = f.run(["--apply", "--protected-images", f.manifest]);
  assert.equal(retried.status, 0, retried.stderr);
});

test("CLI refuses a changed daemon before deleting an eligible image", async (t) => {
  const f = await fixture(t);
  const result = f.run(["--context", "orbstack", "--apply"], {
    FAKE_DOCKER_CHANGED: "1",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docker daemon changed/u);
  assert.ok((await f.calls()).every((args) => !args.includes("rm")));
});

test("scheduled CLI refuses an unexpected initial daemon", async (t) => {
  const f = await fixture(t);
  const result = f.run([
    "--context",
    "orbstack",
    "--daemon-id",
    "accepted-daemon",
    "--apply",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docker daemon does not match/u);
  assert.equal((await f.calls()).length, 1);
});
