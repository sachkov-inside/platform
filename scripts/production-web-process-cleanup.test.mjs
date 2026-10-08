// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production launcher SIGTERM closes its pipes and stops the Next/load group", () => {
  const result = spawnSync(
    "python3",
    ["scripts/fixtures/production-web-cleanup/probe.py"],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
