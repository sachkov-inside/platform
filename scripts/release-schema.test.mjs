import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";

import { releaseManifestSchema } from "../release/contract-schema.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("checked-in release manifest schema is generated from its Zod owner", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-release-manifest-schema.mjs", "--check"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release manifest schema is up to date\./u);
});

test("release manifest JSON Schema accepts its positive fixture and rejects negative fixtures", () => {
  const schema = readJson("release/manifest.schema.json");
  const fixtures = readJson(
    "scripts/fixtures/release/manifest-schema-cases.json",
  );
  const manifestResult = spawnSync(
    process.execPath,
    ["scripts/release-contract.mjs", "manifest", "--input", fixtures.positiveInput],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(manifestResult.status, 0, manifestResult.stderr);
  const manifest = JSON.parse(manifestResult.stdout);
  const validate = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(schema);

  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.equal(releaseManifestSchema.safeParse(manifest).success, true);
  for (const fixture of fixtures.negative) {
    const candidate = structuredClone(manifest);
    let owner = candidate;
    for (const segment of fixture.path.slice(0, -1)) {
      owner = owner[segment];
    }
    owner[fixture.path.at(-1)] = fixture.value;
    assert.equal(
      validate(candidate),
      false,
      `${fixture.name} unexpectedly matched the published schema`,
    );
    assert.equal(
      releaseManifestSchema.safeParse(candidate).success,
      false,
      `${fixture.name} unexpectedly matched the owning Zod schema`,
    );
  }
});

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}
