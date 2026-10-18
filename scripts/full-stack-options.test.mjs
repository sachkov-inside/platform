// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  fullStackProjects,
  fullStackTestArguments,
} from "./full-stack-options.mjs";

test("the default full-stack command keeps both browser profiles", () => {
  assert.deepEqual(fullStackProjects, ["desktop-chromium", "mobile-chromium"]);
  assert.deepEqual(fullStackTestArguments({}), [
    "--filter",
    "@inside/web",
    "test:fullstack",
  ]);
});

test("an isolated profile can retain a focused scenario filter", () => {
  assert.deepEqual(
    fullStackTestArguments({
      FULLSTACK_TEST_PROJECT: "mobile-chromium",
      FULLSTACK_TEST_GREP: "  protected Material  ",
    }),
    [
      "--filter",
      "@inside/web",
      "test:fullstack",
      "--project",
      "mobile-chromium",
      "--grep",
      "protected Material",
    ],
  );
});

test("an invalid or empty requested profile cannot silently run different coverage", () => {
  for (const project of ["", "webkit", "desktop-chromium,mobile-chromium"]) {
    assert.throws(() =>
      fullStackTestArguments({ FULLSTACK_TEST_PROJECT: project }),
    );
  }
});
