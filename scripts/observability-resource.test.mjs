// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";
import { fileURLToPath } from "node:url";

// deterministic-test-allow unit-io: external owner bounds the complete Node helper contract group, including failed startup and lingering socket/timer regressions.
test("resource HTTP and identity contracts retain bounded process lifetime", async () => {
  const result = await runOwnedProcess("/usr/bin/env", [
    "-u",
    "NODE_TEST_CONTEXT",
    process.execPath,
    "--test",
    "--test-reporter=tap",
    fileURLToPath(
      new URL("./observability-resource/test-client.mjs", import.meta.url),
    ),
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# tests [1-9][0-9]*\b/u);
});

// deterministic-test-allow unit-io: external Node owner bounds the stdlib Python resource contracts and their owned process/Unix-socket fixtures.
test("resource manifest, counters and lifecycle retain bounded ownership and UNKNOWN semantics", async () => {
  const result = await runOwnedProcess("python3", [
    "-m",
    "unittest",
    "discover",
    "-s",
    "scripts/observability-resource",
    "-p",
    "test_*.py",
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stderr);
});
