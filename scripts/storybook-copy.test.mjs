// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

const fixture = fileURLToPath(
  new URL(
    "../apps/web/test/fixtures/storybook-copy/barrier.mjs",
    import.meta.url,
  ),
);

for (const mode of ["reproduce", "configured"]) {
  test(`Storybook public-copy filesystem contract: ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "storybook-copy-"));
    let child;
    try {
      child = spawnOwned(process.execPath, [fixture, mode, root], {
        timeout: 20000,
      });
      let output = "";
      let diagnostic = "";
      child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
        diagnostic += chunk.toString();
      });
      assert.equal(await commandExit(child), 0, diagnostic);
      assert.match(output, /filesystem contract passed/u);
    } finally {
      if (child !== undefined) await stopOwned(child);
      await rm(root, { recursive: true, force: true });
    }
  });
}
