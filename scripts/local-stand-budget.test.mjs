// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { createStandBuildBudget } from "./local-stand-budget.mjs";

const gib = 1024 ** 3;

test("stand refuses a build without room for its allowance and preserved host reserve", () => {
  assert.throws(
    () => createStandBuildBudget(() => 24 * gib),
    /25 GiB.*15 GiB/u,
  );
});

test("stand stops when measured growth exhausts its allowance", () => {
  let available = 40 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 31 * gib;
  budget.assertAvailable();
  available = 29 * gib;
  assert.throws(() => budget.assertAvailable(), /10 GiB build allowance/u);
});

test("stand preserves its host reserve even when other work consumed free space", () => {
  let available = 25 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 14 * gib;
  assert.throws(() => budget.assertAvailable(), /15 GiB host reserve/u);
});
