// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readPackageManifest } from "./package-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {number} buildStatus */
function invokeTooling(buildStatus) {
  const directory = mkdtempSync(join(tmpdir(), "inside-tooling-prerequisite-"));
  const log = join(directory, "calls");
  try {
    for (const tool of ["pnpm", "node"]) {
      writeFileSync(
        join(directory, tool),
        '#!/bin/sh\nprintf "%s\\n" "' +
          tool +
          ' $*" >> "$INSIDE_TOOLING_TEST_LOG"\n' +
          (tool === "pnpm"
            ? 'exit "$INSIDE_TOOLING_TEST_BUILD_STATUS"\n'
            : "exit 0\n"),
        { mode: 0o700 },
      );
    }
    const command = readPackageManifest(join(root, "package.json")).scripts[
      "test:tooling"
    ];
    assert.ok(command);
    const result = spawnSync("bash", ["-c", command], {
      cwd: root,
      env: {
        ...process.env,
        PATH: directory + ":" + (process.env["PATH"] ?? ""),
        INSIDE_TOOLING_TEST_LOG: log,
        INSIDE_TOOLING_TEST_BUILD_STATUS: String(buildStatus),
      },
      encoding: "utf8",
      timeout: 8000,
    });
    assert.ifError(result.error);
    return {
      status: result.status,
      calls: readFileSync(log, "utf8").trim().split("\n"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// deterministic-test-allow unit-io: bounded task-owned command doubles verify the actual guarded package entrypoint; no install, build or provider.
test("tooling builds the real backend before launching every serializer contract", () => {
  const result = invokeTooling(0);
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0], "pnpm --filter @inside/backend build");
  assert.ok(result.calls[1]?.startsWith("node --test --test-concurrency=2 "));
  for (const scope of ["tracking", "waitlist"]) {
    assert.ok(
      result.calls[1]?.includes(
        `scripts/observability-${scope}-storage.test.mjs`,
      ),
    );
    const wrapper = readFileSync(
      join(root, `scripts/observability-${scope}-storage.test.mjs`),
      "utf8",
    );
    assert.ok(
      wrapper.includes("trace_flags_contract.py"),
      `${scope} must execute actual production serializers`,
    );
  }
});

// deterministic-test-allow unit-io: the same bounded command doubles prove build failure prevents any ordinary tooling/serializer execution.
test("a failed backend prerequisite stops tooling before any serializer executes", () => {
  const result = invokeTooling(42);
  assert.equal(result.status, 42);
  assert.deepEqual(result.calls, ["pnpm --filter @inside/backend build"]);
});
