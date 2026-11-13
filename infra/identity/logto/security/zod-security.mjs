// Backport of colinhacks/zod#6652. Exercise both published module entry points.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const core = createRequire("/etc/logto/packages/core/package.json");
const entry = core.resolve("zod");
const variants = [core(entry.replace(/index\.js$/, "index.umd.js")), core("zod"), await import(pathToFileURL(entry.replace(/index\.js$/, "index.mjs")))];
for (const { z } of variants) {
  for (const [kind, wrap, input] of [
    ["max", (item) => z.array(item).max(2, "bounded"), Array(32).fill("bad")],
    ["length", (item) => z.array(item).length(2, "bounded"), Array(32).fill("bad")],
    ["set", (item) => z.set(item).max(2, "bounded"), new Set(Array.from({ length: 32 }, (_, i) => String(i)))],
  ]) {
    let calls = 0;
    const item = z.preprocess((value) => { calls++; return value; }, z.number());
    const schema = wrap(item);
    for (const parse of [(s, v) => s.safeParse(v), (s, v) => s.safeParseAsync(v)]) {
      calls = 0;
      const result = await parse(schema, input);
      assert.equal(result.success, false);
      assert.equal(calls, 0, `${kind}: oversized collection must stop before item parsing`);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
      assert.equal(result.error.issues[0].message, "bounded");
      assert.equal(result.error.issues[0].exact, kind === "length");
      calls = 0;
      assert.equal((await parse(z.union([schema, z.unknown()]), input)).success, true);
      assert.equal(calls, 0);
      calls = 0;
      assert.deepEqual((await parse(schema.catch([]), input)).data, []);
      assert.equal(calls, 0);
    }
    const nested = z.object({ values: schema }).safeParse({ values: input });
    assert.deepEqual(nested.error.issues[0].path, ["values"]);
  }
  assert.deepEqual(z.array(z.number()).max(2).parse([1, 2]), [1, 2]);
  assert.deepEqual(z.array(z.number()).length(2).parse([1, 2]), [1, 2]);
  assert.deepEqual([...z.set(z.number()).max(2).parse(new Set([1, 2]))], [1, 2]);
  assert.equal(z.array(z.number()).min(2).safeParse([1]).error.issues[0].code, "too_small");
  let refined = false;
  z.array(z.number()).max(2).refine(() => { refined = true; return true; }).safeParse([1, 2, 3]);
  assert.equal(refined, false);
}
console.log("Bounded Zod collections reject oversized inputs before parsing elements (CommonJS and ESM).");
