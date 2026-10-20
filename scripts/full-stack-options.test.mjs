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

test("each isolated full-stack profile accepts exactly the complete pair of CI shards", () => {
  for (const shard of ["1/2", "2/2"]) {
    assert.deepEqual(
      fullStackTestArguments({
        FULLSTACK_TEST_PROJECT: "desktop-chromium",
        FULLSTACK_TEST_SHARD: shard,
      }),
      [
        "--filter",
        "@inside/web",
        "test:fullstack",
        "--project",
        "desktop-chromium",
        "--shard",
        shard,
      ],
    );
  }
  for (const shard of ["", "0/2", "3/2", "1/3", "1/2 --grep login"]) {
    assert.throws(() =>
      fullStackTestArguments({ FULLSTACK_TEST_SHARD: shard }),
    );
  }
});
