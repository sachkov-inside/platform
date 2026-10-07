// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("production verifier unit tests pass without production credentials or Docker", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/production-verify",
      "-p",
      "test_verify.py",
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || "python3 unit tests failed",
  );
});

test("production verifier refuses path traversal before any server access", () => {
  const result = spawnSync(
    "python3",
    [
      "scripts/production-verify/verify.py",
      "--local",
      "--application",
      "platform",
      "--version",
      "../../etc/inside",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /version must be vN/u);
});
