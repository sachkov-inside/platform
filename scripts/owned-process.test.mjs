// @ts-check
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("owned command supervision cleans real descendants across owner exits and signals", () => {
  execFileSync("python3", ["scripts/owned-process/test_supervisor.py"], {
    stdio: "inherit",
    timeout: 90_000,
  });
});
