// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { resolveContentCheckout } from "./local-product.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = fileURLToPath(new URL("local-product.mjs", import.meta.url));

/** Runs the grant with a recording pnpm double from an unrelated directory. */
async function grantWith(/** @type {number} */ exitCode) {
  const directory = await mkdtemp(join(tmpdir(), "local-product-grant-"));
  const record = join(directory, "record.json");
  const pnpm = join(directory, "pnpm.mjs");
  await writeFile(
    pnpm,
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));`,
      'process.stdout.write("bootstrap report\\n");',
      `process.exit(${String(exitCode)});`,
    ].join("\n"),
  );
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { grantStandProductAccess } from ${JSON.stringify(script)}; grantStandProductAccess(${JSON.stringify(pnpm)});`,
    ],
    { cwd: directory, encoding: "utf8" },
  );
  const recorded = z
    .object({ args: z.array(z.string()), cwd: z.string() })
    .parse(JSON.parse(await readFile(record, "utf8")));
  await rm(directory, { recursive: true, force: true });
  return { child, recorded };
}

test("the access grant runs the account bootstrap from the repository root, its report on stderr", async () => {
  const { child, recorded } = await grantWith(0);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(recorded.args, ["local:accounts:bootstrap"]);
  assert.equal(await realpath(recorded.cwd), await realpath(root));
  // stdout carries only the transfer's JSON receipt.
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /bootstrap report/u);
});

test("a failed account bootstrap fails the access grant", async () => {
  const { child } = await grantWith(1);
  assert.notEqual(child.status, 0);
});

test("checkout selection supports both studio names and honours an explicit path", async (t) => {
  const materials = await mkdtemp(join(tmpdir(), "studio-materials-"));
  t.after(() => rm(materials, { recursive: true, force: true }));
  const current = join(materials, "course-studio");
  const legacy = join(materials, "content-studio");
  assert.throws(() => resolveContentCheckout(materials), /course-studio/u);
  await mkdir(join(legacy, "tools"), { recursive: true });
  await writeFile(join(legacy, "tools/content.py"), "");
  assert.equal(resolveContentCheckout(materials), legacy);
  await mkdir(join(current, "tools"), { recursive: true });
  await writeFile(join(current, "tools/content.py"), "");
  assert.equal(resolveContentCheckout(materials), current);
  assert.equal(resolveContentCheckout(materials, legacy), legacy);
  assert.throws(
    () => resolveContentCheckout(materials, join(materials, "missing")),
    /missing/u,
  );
});
