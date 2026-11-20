// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { restoreLocalProduct } from "./local-product.mjs";

test("the stand owner gains access to the product the run imported, after the import", async () => {
  /** @type {string[]} */
  const ran = [];
  const receipt = await restoreLocalProduct({
    importProduct: async () => {
      ran.push("import");
      return { commit: "abc" };
    },
    grantStandAccess: async () => {
      ran.push("grant");
    },
  });
  assert.deepEqual(ran, ["import", "grant"]);
  assert.deepEqual(receipt, { commit: "abc" });
});

test("a failed import grants nothing, and a failed grant fails the run", async () => {
  let granted = false;
  await assert.rejects(
    restoreLocalProduct({
      importProduct: async () => {
        throw new Error("import refused");
      },
      grantStandAccess: async () => {
        granted = true;
      },
    }),
    /import refused/u,
  );
  assert.equal(granted, false);
  await assert.rejects(
    restoreLocalProduct({
      importProduct: async () => ({}),
      grantStandAccess: async () => {
        throw new Error("bootstrap refused");
      },
    }),
    /bootstrap refused/u,
  );
});
