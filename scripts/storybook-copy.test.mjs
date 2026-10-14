// @ts-check
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const run = promisify(execFile);
const fixture = fileURLToPath(
  new URL(
    "../apps/web/test/fixtures/storybook-copy/barrier.mjs",
    import.meta.url,
  ),
);

for (const mode of ["reproduce", "configured"]) {
  test(`Storybook public-copy filesystem contract: ${mode}`, async () => {
    const { stdout } = await run(process.execPath, [fixture, mode], {
      timeout: 20000,
    });
    assert.match(stdout, /filesystem contract passed/u);
  });
}
