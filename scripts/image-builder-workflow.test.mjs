// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { test } from "node:test";

test("image builders use one stable pinned toolchain in publication and compatibility proofs", () => {
  const action = readFileSync(
    ".github/actions/setup-image-builder/action.yml",
    "utf8",
  );
  assert.match(action, /buildx=v0\.39\.0/u);
  assert.match(action, /buildkit=v0\.35\.0/u);
  assert.match(
    action,
    /moby\/buildkit:v0\.35\.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb/u,
  );
  assert.match(action, /use: true/u);
  assert.match(action, /BUILDX_BUILDER=%s/u);
  assert.match(
    action,
    /SELECTED_BUILDER: \$\{\{ steps\.builder\.outputs\.name \}\}/u,
  );
  assert.match(action, /default-load=true/u);
  for (const [file, job] of [
    ["release.yml", "build-images"],
    ["telegram-release.yml", "image"],
    ["ci.yml", "compose-development"],
    ["ci.yml", "compose-production-checks"],
    ["foundation-recovery.yml", "recover"],
    ["nightly-fullstack.yml", "full-stack"],
  ]) {
    const source = readFileSync(`.github/workflows/${file}`, "utf8");
    const start = source.indexOf(`\n  ${job}:\n`);
    assert.ok(start >= 0, `${file} declares ${job}`);
    const [section] = source
      .slice(start + 1)
      .split(/\n(?= {2}[a-z][a-z0-9-]*:)/u);
    assert.match(
      section ?? "",
      /uses: \.\/\.github\/actions\/setup-image-builder/u,
      `${file}/${job}`,
    );
  }
});

/** @param {import("node:test").TestContext} t @param {string} buildx @param {string} buildkit */
async function verifyBuilder(t, buildx, buildkit) {
  const directory = mkdtempSync(join(tmpdir(), "inside-builder-contract-"));
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  t.after(async () => {
    if (child !== undefined) await stopOwned(child, 100);
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(
    join(directory, "docker"),
    '#!/bin/sh\nif [ "$2" = version ]; then printf "github.com/docker/buildx %s fixture\\n" "$INSIDE_TEST_BUILDX"; else printf "BuildKit version: %s\\n" "$INSIDE_TEST_BUILDKIT"; fi\n',
    { mode: 0o755 },
  );
  // unit-io: real Bash/awk boundary with an offline Docker double, supervised tree and bounded cleanup.
  child = spawnOwned("bash", [resolve("scripts/check-image-builder.sh")], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env["PATH"]}`,
      EXPECTED_BUILDX_VERSION: "v0.39.0",
      EXPECTED_BUILDKIT_VERSION: "v0.35.0",
      INSIDE_TEST_BUILDX: buildx,
      INSIDE_TEST_BUILDKIT: buildkit,
    },
  });
  child.stdout?.resume();
  child.stderr?.resume();
  // deterministic-test-allow duration-wait: failure budget; supervisor exit proves complete tree cleanup.
  const deadline = setTimeout(() => {
    if (child !== undefined) void stopOwned(child, 100);
  }, 10_000);
  try {
    return await commandExit(child);
  } finally {
    clearTimeout(deadline);
    await stopOwned(child, 100);
  }
}

test("builder verification rejects an older active Buildx (Bash/Docker boundary)", async (t) => {
  assert.notEqual(await verifyBuilder(t, "v0.38.2", "v0.35.0"), 0);
});

test("builder verification rejects an older active BuildKit (Bash/Docker boundary)", async (t) => {
  assert.notEqual(await verifyBuilder(t, "v0.39.0", "v0.34.2"), 0);
});

test("builder verification accepts the selected pair (Bash/Docker boundary)", async (t) => {
  assert.equal(await verifyBuilder(t, "v0.39.0", "v0.35.0"), 0);
});
