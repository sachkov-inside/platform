// @ts-check
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareDevelopmentCorpus } from "./seed-runtime.mjs";

test("the fixture runs the seed owner through production configuration modules", () => {
  const directory = mkdtempSync(join(tmpdir(), "inside-resource-seed-"));
  const target = join(directory, "development");
  try {
    mkdirSync(target);
    prepareDevelopmentCorpus(
      new URL("../../apps/backend/src/development/", import.meta.url),
      target,
    );
    const entry = readFileSync(join(target, "resource-seed.js"), "utf8");
    assert.ok(entry.includes('"./seed-local-development.js"'));
    assert.ok(entry.includes('"../config/platform-config.js"'));
    assert.ok(!entry.includes("load-platform-config"));
    assert.ok(
      readFileSync(join(target, "seed-local-development.js"), "utf8").includes(
        "seedLocalDevelopment",
      ),
    );
    assert.ok(
      readFileSync(
        join(target, "seed-local-offer-catalog.js"),
        "utf8",
      ).includes("seedLocalOfferCatalog"),
    );
    assert.throws(
      () =>
        prepareDevelopmentCorpus(
          new URL("../../apps/backend/src/development/", import.meta.url),
          target,
        ),
      /fresh_seed_directory/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the fixture refuses a redirected source before writing any seed module", () => {
  const directory = mkdtempSync(join(tmpdir(), "inside-resource-seed-"));
  const source = join(directory, "source");
  const target = join(directory, "target");
  try {
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(
      join(source, "seed-local-offer-catalog.ts"),
      "export const value: number = 1;",
    );
    symlinkSync(
      join(source, "seed-local-offer-catalog.ts"),
      join(source, "seed-local-development.ts"),
    );
    assert.throws(
      () => prepareDevelopmentCorpus(source, target),
      /seed_source_file/u,
    );
    assert.throws(
      () => readFileSync(join(target, "seed-local-offer-catalog.js")),
      /ENOENT/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
