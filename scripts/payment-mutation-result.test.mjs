// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { classifyMutationResult } from "./pilots/mutation-result.mjs";
const passed = { state: "passed", errors: [] };
const assertion = { name: "AssertionError", message: "expected no access" };
const failed = { state: "failed", errors: [assertion] };
const baseline = {
  exitCode: 0,
  tests: Array.from({ length: 7 }, () => passed),
  suiteErrors: [],
};

test("seven completed passes survive; an incomplete corpus is invalid", () => {
  assert.equal(classifyMutationResult(baseline), "survived");
  assert.equal(
    classifyMutationResult({ ...baseline, tests: baseline.tests.slice(1) }),
    "invalid",
  );
});

test("direct and wrapped assertions kill the mutant", () => {
  for (const error of [
    assertion,
    { name: "Error", message: "PROPERTY_SEED=42; trace=[]", cause: assertion },
  ])
    assert.equal(
      classifyMutationResult({
        ...baseline,
        exitCode: 1,
        tests: [
          ...baseline.tests.slice(1),
          { state: "failed", errors: [error] },
        ],
      }),
      "killed",
    );
});

test("process termination, suite failures and timeouts never kill a mutant", () => {
  for (const result of [
    { ...baseline, exitCode: 143, tests: [...baseline.tests.slice(1), failed] },
    {
      ...baseline,
      exitCode: null,
      tests: [...baseline.tests.slice(1), failed],
    },
    {
      ...baseline,
      exitCode: 1,
      suiteErrors: [{ name: "Error", message: "Database connection refused" }],
    },
    {
      ...baseline,
      exitCode: 1,
      tests: [
        ...baseline.tests.slice(1),
        {
          state: "failed",
          errors: [{ name: "Error", message: "Test timed out" }],
        },
      ],
    },
  ])
    assert.equal(classifyMutationResult(result), "invalid");
});

test("an assertion cannot hide a second database failure or a broken cause", () => {
  for (const errors of [
    [{ name: "Error", message: "Database connection refused" }],
    [
      {
        name: "Error",
        message: "PROPERTY_SEED=42",
        cause: { name: "Error", message: "connection refused" },
      },
    ],
    [],
  ])
    assert.equal(
      classifyMutationResult({
        ...baseline,
        exitCode: 1,
        tests: [
          ...baseline.tests.slice(2),
          failed,
          { state: "failed", errors },
        ],
      }),
      "invalid",
    );
});
