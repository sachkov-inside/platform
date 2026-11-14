// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const core = createRequire("/etc/logto/packages/core/package.json");
/* oxlint-disable typescript/no-unsafe-type-assertion -- installed Logto deepmerge module boundary */
const deepmerge = /** @type {typeof import("deepmerge")} */ (core("deepmerge"));
/* oxlint-enable typescript/no-unsafe-type-assertion */

test("merging untrusted keys keeps the result prototype unchanged", () => {
  /** @type {Record<string, unknown>} */
  const poisoned = { ["__proto__"]: { inherited: true }, safe: { value: 1 } };
  /** @type {Record<string, unknown>} */
  const nullPrototype = {};
  Object.setPrototypeOf(nullPrototype, null);
  for (const target of [{}, nullPrototype, { ["__proto__"]: {} }]) {
    for (const result of [
      deepmerge(target, poisoned),
      deepmerge(poisoned, target),
    ]) {
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(Object.hasOwn(result, "__proto__"), false);
      assert.equal(result["inherited"], undefined);
      assert.deepEqual(result["safe"], { value: 1 });
    }
  }
  assert.equal(Reflect.get({}, "inherited"), undefined);
});

test("ordinary nested values, arrays and symbol keys still merge", () => {
  const symbol = Symbol("metadata");
  const result = deepmerge(
    { nested: { a: 1 }, items: [1], [symbol]: { a: 1 } },
    {
      nested: { b: 2 },
      items: [2],
      [symbol]: { b: 2 },
      constructor: "ordinary own value",
    },
  );
  assert.deepEqual(result, {
    nested: { a: 1, b: 2 },
    items: [1, 2],
    [symbol]: { a: 1, b: 2 },
  });
});
