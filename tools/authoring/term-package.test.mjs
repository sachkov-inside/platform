// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, loadPackage } from "./package.mjs";

const term = {
  sourceId: "deploy",
  sourcePath: "terms/deploy.md",
  publicationState: "published",
  definition: {
    id: "44300000-0000-4000-8000-000000000001",
    title: "Деплой",
    aliases: ["deploy"],
    definition:
      "Развёртывание выбранной версии приложения в конкретном окружении — например, на тестовом сервере",
  },
};
const material = {
  sourceId: "one",
  sourcePath: "materials/one.md",
  sourceIds: [],
  relatedMaterialIds: [],
  readingTimeMinutes: null,
  kind: "note",
  title: "One",
  summary: "Summary",
  stage: "draft",
  topicId: null,
  access: "closed",
  showInFeed: false,
  difficulty: null,
  outcomes: [],
  markdown: "[[deploy|выкатить версию]]",
  links: {},
  images: {},
  coverAssetId: null,
  coverAlt: null,
  video: null,
  videoChapters: [],
  artifacts: [],
};
function fixture() {
  return {
    schemaVersion: 2,
    requiredFeatures: ["terms-v1"],
    sourceNamespace: "synthetic",
    selection: {
      productId: null,
      chapterIds: [],
      materialIds: ["one"],
      taskIds: [],
      complete: true,
    },
    materials: [material],
    products: [],
    assets: [],
    diagnostics: [],
    terms: [term],
  };
}

test("portable authored terms enter the real package loader; missing references fail before transfer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "443-term-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "package.json");
  await writeFile(path, canonical(fixture()));
  const pkg = await loadPackage(path);
  assert.equal(pkg.manifest.terms?.[0]?.definition.id, term.definition.id);
  await writeFile(path, canonical({ ...fixture(), terms: [] }));
  await assert.rejects(loadPackage(path), /Missing term/u);
});
