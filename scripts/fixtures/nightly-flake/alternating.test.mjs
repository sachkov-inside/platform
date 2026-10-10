// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

test("[fixture] alternates failure and success without retries", () => {
  assert.equal(Number(process.env["FLAKE_ITERATION"]) % 2, 0);
});
