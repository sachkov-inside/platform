// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStandSource } from "./stand-source.mjs";

test("source identity detects dirty edits and new files while live Web edits keep the build reusable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stand-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps/web/src"), { recursive: true });
  await writeFile(join(root, "apps/web/src/view.tsx"), "first");
  const files = ["apps/web/src/view.tsx"];
  const options = {
    git: (/** @type {string[]} */ args) =>
      args.includes("ls-files") ? files.join("\0") : "1".repeat(40),
    environment: {},
  };
  const first = await readStandSource(root, options);
  await writeFile(join(root, "apps/web/src/view.tsx"), "second");
  const edited = await readStandSource(root, options);
  assert.notEqual(edited.fingerprint, first.fingerprint);
  assert.equal(edited.build, first.build);
  await writeFile(join(root, "new-source.ts"), "new untracked source");
  files.push("new-source.ts");
  const added = await readStandSource(root, options);
  assert.notEqual(added.build, edited.build);
});

test("Compose environment overrides invalidate infrastructure without storing secret values", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stand-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "compose.yaml"),
    "services:\n  web:\n    ports: ['${WEB_HOST_PORT:-3000}:3000']\n",
  );
  const git = (/** @type {string[]} */ args) =>
    args.includes("ls-files") ? "compose.yaml\0" : "1".repeat(40);
  const first = await readStandSource(root, { git, environment: {} });
  const override = await readStandSource(root, {
    git,
    environment: { WEB_HOST_PORT: "4300" },
  });
  assert.notEqual(first.infrastructure, override.infrastructure);
  assert.equal(first.schema, override.schema);
  await writeFile(
    join(root, ".env"),
    "LOGTO_APP_SECRET=fixture-private-value\n",
  );
  const privateConfig = await readStandSource(root, { git, environment: {} });
  assert.notEqual(first.infrastructure, privateConfig.infrastructure);
  assert.ok(!JSON.stringify(privateConfig).includes("fixture-private-value"));
});

test("module-owned SQL migrations invalidate the schema compatibility guard", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stand-migrations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migration =
    "apps/backend/src/modules/materials/infrastructure/postgres/migrations/0001_materials.ts";
  await mkdir(join(root, migration, ".."), { recursive: true });
  await writeFile(join(root, migration), "CREATE TABLE first");
  const git = (/** @type {string[]} */ args) =>
    args.includes("ls-files") ? migration + "\0" : "1".repeat(40);
  const first = await readStandSource(root, { git, environment: {} });
  await writeFile(join(root, migration), "CREATE TABLE changed");
  const changed = await readStandSource(root, { git, environment: {} });
  assert.notEqual(changed.schema, first.schema);
});

test("database dependency and migration engine changes require schema handoff", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stand-schema-inputs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    "apps/backend/package.json",
    "pnpm-lock.yaml",
    "apps/backend/src/infrastructure/postgres/migrate-to-latest.ts",
  ];
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "first");
  }
  const git = (/** @type {string[]} */ args) =>
    args.includes("ls-files") ? files.join("\0") : "1".repeat(40);
  let previous = await readStandSource(root, { git, environment: {} });
  for (const file of files) {
    await writeFile(join(root, file), "changed");
    const current = await readStandSource(root, { git, environment: {} });
    assert.notEqual(current.schema, previous.schema, file);
    previous = current;
  }
});

test("the private Kinescope stand file invalidates application builds without an infrastructure handoff", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stand-kinescope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "compose.yaml"), "services: {}\n");
  const git = (/** @type {string[]} */ args) =>
    args.includes("ls-files") ? "compose.yaml\0" : "1".repeat(40);
  const first = await readStandSource(root, { git, environment: {} });
  await mkdir(join(root, ".identity-proof"));
  await writeFile(
    join(root, ".identity-proof/stand-kinescope.env"),
    "KINESCOPE_API_TOKEN=fixture-private-token\n",
  );
  const real = await readStandSource(root, { git, environment: {} });
  assert.notEqual(real.fingerprint, first.fingerprint);
  assert.notEqual(real.build, first.build);
  assert.equal(real.infrastructure, first.infrastructure);
  assert.equal(real.schema, first.schema);
  assert.equal(real.identity, first.identity);
  assert.ok(!JSON.stringify(real).includes("fixture-private-token"));
});
