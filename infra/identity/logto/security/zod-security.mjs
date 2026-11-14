// @ts-check
// Backport of colinhacks/zod#6652. Exercise both published module entry points.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const core = createRequire("/etc/logto/packages/core/package.json");
const entry = core.resolve("zod");
/* oxlint-disable typescript/no-unsafe-type-assertion -- installed Logto Zod 3 CJS/ESM module boundaries */
const variants = /** @type {typeof import("zod/v3")[]} */ ([core(entry.replace(/index\.js$/, "index.umd.js")), core("zod"), await import(pathToFileURL(entry.replace(/index\.js$/, "index.mjs")).href)]);
/* oxlint-enable typescript/no-unsafe-type-assertion */
for (const { z } of variants) {
  /** @type {[string, (item: import("zod/v3").ZodTypeAny) => import("zod/v3").ZodTypeAny, unknown][]} */
  const cases = [
    ["max", (item) => z.array(item).max(2, "bounded"), Array(32).fill("bad")],
    ["length", (item) => z.array(item).length(2, "bounded"), Array(32).fill("bad")],
    ["set", (item) => z.set(item).max(2, "bounded"), new Set(Array.from({ length: 32 }, (_, i) => String(i)))],
  ];
  for (const [kind, wrap, input] of cases) {
    let calls = 0;
    const item = z.preprocess((/** @type {unknown} */ value) => { calls++; return value; }, z.number());
    const schema = wrap(item);
    /** @type {((s: import("zod/v3").ZodTypeAny, v: unknown) => import("zod/v3").SafeParseReturnType<unknown, unknown> | Promise<import("zod/v3").SafeParseReturnType<unknown, unknown>>)[]} */
    const parsers = [(s, v) => s.safeParse(v), (s, v) => s.safeParseAsync(v)];
    for (const parse of parsers) {
      calls = 0;
      const result = await parse(schema, input);
      assert.ok(!result.success);
      assert.equal(calls, 0, `${kind}: oversized collection must stop before item parsing`);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0]?.code, "too_big");
      assert.equal(result.error.issues[0]?.message, "bounded");
      assert.equal(Reflect.get(result.error.issues[0] ?? {}, "exact"), kind === "length");
      calls = 0;
      assert.equal((await parse(z.union([schema, z.unknown()]), input)).success, true);
      assert.equal(calls, 0);
      calls = 0;
      assert.deepEqual((await parse(schema.catch([]), input)).data, []);
      assert.equal(calls, 0);
    }
    const nested = z.object({ values: schema }).safeParse({ values: input });
    assert.ok(!nested.success);
    assert.deepEqual(nested.error.issues[0]?.path, ["values"]);
  }
  assert.deepEqual(z.array(z.number()).max(2).parse([1, 2]), [1, 2]);
  assert.deepEqual(z.array(z.number()).length(2).parse([1, 2]), [1, 2]);
  assert.deepEqual([...z.set(z.number()).max(2).parse(new Set([1, 2]))], [1, 2]);
  const tooSmall = z.array(z.number()).min(2).safeParse([1]);
  assert.ok(!tooSmall.success);
  assert.equal(tooSmall.error.issues[0]?.code, "too_small");
  let refined = false;
  z.array(z.number()).max(2).refine(() => { refined = true; return true; }).safeParse([1, 2, 3]);
  assert.equal(refined, false);
}
console.log("Bounded Zod collections reject oversized inputs before parsing elements (CommonJS and ESM).");
