// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { classifyMutationResult } from "./pilots/mutation-result.mjs";

test("seven passing tests survive; a smaller corpus is invalid", () => {
  assert.equal(
    classifyMutationResult({ exitCode: 0, passed: 7, failed: 0, log: "" }),
    "survived",
  );
  assert.equal(
    classifyMutationResult({ exitCode: 0, passed: 5, failed: 0, log: "" }),
    "invalid",
  );
});

test("an assertion counterexample kills a mutant", () => {
  assert.equal(
    classifyMutationResult({
      exitCode: 1,
      passed: 5,
      failed: 2,
      log: "Caused by: AssertionError: access was granted",
    }),
    "killed",
  );
});

test("setup errors, killed processes and timeouts never count as a kill", () => {
  for (const input of [
    { exitCode: 1, passed: 0, failed: 0, log: "Database setup failed" },
    { exitCode: null, passed: 5, failed: 2, log: "Caused by: AssertionError" },
    {
      exitCode: 1,
      passed: 5,
      failed: 2,
      log: "Caused by: AssertionError\nTest timed out",
    },
  ])
    assert.equal(classifyMutationResult(input), "invalid");
});
