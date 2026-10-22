// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { sourceCommitRelation } from "./source-commit.mjs";

test("a package moves a row forward along Content history, never back or sideways", async () => {
  // History: a ← b ← c, and x on another branch from a.
  /** @type {Record<string, string[]>} */
  const parents = { a: [], b: ["a"], c: ["b", "a"], x: ["a"] };
  const isAncestor = async (
    /** @type {string} */ ancestor,
    /** @type {string} */ descendant,
  ) =>
    ancestor === descendant || (parents[descendant] ?? []).includes(ancestor);
  assert.equal(await sourceCommitRelation(null, "c", isAncestor), "unrecorded");
  assert.equal(
    await sourceCommitRelation(undefined, "c", isAncestor),
    "unrecorded",
  );
  assert.equal(await sourceCommitRelation("c", "c", isAncestor), "same");
  assert.equal(await sourceCommitRelation("b", "c", isAncestor), "forward");
  assert.equal(await sourceCommitRelation("c", "b", isAncestor), "older");
  assert.equal(await sourceCommitRelation("x", "c", isAncestor), "diverged");
});
