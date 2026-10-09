// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  createStandBuildBudget,
  dockerDesktopStoragePath,
} from "./local-stand-budget.mjs";

const gib = 1024 ** 3;

test("Docker storage budget measures the active data disk, irrespective of repository location", () => {
  assert.equal(
    dockerDesktopStoragePath(
      "p100\nn/Volumes/docker/Docker.raw\nn/Volumes/docker/Docker.raw\nn/Users/dev/repository\n",
    ),
    "/Volumes/docker/Docker.raw",
  );
  assert.throws(
    () => dockerDesktopStoragePath("n/Users/dev/repository\n"),
    /refusing an unmeasured/u,
  );
});

test("stand refuses a build without room for its allowance and preserved host reserve", () => {
  assert.throws(
    () => createStandBuildBudget(() => 19 * gib),
    /20 GiB.*10 GiB/u,
  );
});

test("stand stops when measured growth exhausts its allowance", () => {
  let available = 40 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 33 * gib;
  budget.assertAvailable();
  available = 32 * gib;
  assert.throws(() => budget.assertAvailable(), /8 GiB build ceiling/u);
});

test("stand preserves its host reserve even when other work consumed free space", () => {
  let available = 20 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 10 * gib;
  assert.throws(() => budget.assertAvailable(), /10 GiB host floor/u);
});
