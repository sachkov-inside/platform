// @ts-check
import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { commandExit } from "./diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const backend = fileURLToPath(new URL("../apps/backend/", import.meta.url));
const requireBackend = createRequire(join(backend, "package.json"));
const vitest = dirname(requireBackend.resolve("vitest/package.json"));
const fixture = join(backend, "test/fixtures/vitest-external-mock-paths");

for (const label of ["ascii", "кириллица space %20"]) {
  test(`Vitest external mock registration filesystem contract: ${label}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "vitest-path-proof-"));
    let child;
    try {
      const root = join(directory, label);
      const copiedVitest = join(root, "node_modules/vitest");
      await mkdir(root, { recursive: true });
      await cp(fixture, root, { recursive: true });
      await cp(vitest, copiedVitest, { recursive: true });
      // Recreate pnpm's immutable dependency links while the copied package owns its module identity.
      for (const dependency of await readdir(dirname(vitest))) {
        if (dependency === "vitest" || dependency === ".bin") continue;
        await symlink(
          await realpath(join(dirname(vitest), dependency)),
          join(root, "node_modules", dependency),
          "junction",
        );
      }
      // Real CLI/worker contract, bounded at 20 seconds; owned-process supervises every descendant.
      child = spawnOwned(
        process.execPath,
        [join(copiedVitest, "vitest.mjs"), "run"],
        {
          cwd: root,
          timeout: 20000,
        },
      );
      let output = "";
      child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
        output += chunk.toString();
      });
      assert.equal(await commandExit(child), 0, output);
      assert.match(output, /1 passed/u);
    } finally {
      if (child !== undefined) await stopOwned(child);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
