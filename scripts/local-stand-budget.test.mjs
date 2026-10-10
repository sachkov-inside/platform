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

test("stand stops with a 256 MiB margin before its 8 GiB growth ceiling", () => {
  let available = 40 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 32 * gib + 256 * 1024 ** 2 + 1;
  budget.assertAvailable();
  available -= 1;
  assert.throws(
    () => budget.assertAvailable(),
    /256 MiB.*8 GiB build ceiling/u,
  );
});

test("stand retains a 256 MiB stop margin above the mandatory host floor", () => {
  let available = 20 * gib;
  const budget = createStandBuildBudget(() => available);
  available = 10 * gib + 256 * 1024 ** 2;
  assert.throws(() => budget.assertAvailable(), /256 MiB.*10 GiB host floor/u);
});
