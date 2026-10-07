// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, loadPackage, materialRevision } from "./package.mjs";
import {
  coursePreviewManifest,
  prepareCoursePreview,
} from "./course-preview.mjs";

/** @returns {import('./package.mjs').Manifest} */
function fixture() {
  const ids = ["intro", "one", "two", "three", "brief"];
  const materials = ids.map((sourceId) => ({
    sourceId,
    sourcePath: `${sourceId}.md`,
    sourceIds: [],
    relatedMaterialIds: [],
    readingTimeMinutes: null,
    kind: /** @type {const} */ ("product"),
    title: sourceId,
    summary: sourceId,
    stage: /** @type {const} */ ("draft"),
    topicId: null,
    access: null,
    showInFeed: false,
    difficulty: null,
    outcomes: [],
    markdown: "Text",
    links: {},
    images: {},
    coverAssetId: null,
    coverAlt: null,
    video: null,
    videoChapters: [],
    artifacts: [],
  }));
  return {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      productId: "inside-ai-engineering",
      chapterIds: [],
      materialIds: ids,
      complete: true,
    },
    materials,
    assets: [],
    diagnostics: [],
    products: [
      {
        sourceId: "inside-ai-engineering",
        title: "Course",
        summary: "Draft",
        complete: true,
        materialIds: ids.slice(0, 4),
        supplementaryMaterialIds: ["brief"],
        chapters: [
          {
            sourceId: "course-preparation",
            title: "Before",
            summary: "",
            materialIds: ["intro"],
          },
          {
            sourceId: "first-agent-project",
            title: "First",
            summary: "",
            materialIds: ["one", "two", "three"],
          },
        ],
      },
    ],
  };
}

test("local access and practice preview preserve drafts and the original immutable package", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "course-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = fixture();
  const first = original.materials[1];
  assert.ok(first);
  original.practiceDefinitions = [
    {
      practiceId: "inside-content:one",
      definition: { schemaVersion: 1, title: "Practice" },
      sourceReference: {
        materialSourceId: "inside-content:one",
        materialSourceRevision: materialRevision(original, first),
      },
      provenance: {
        repository: "synthetic/content",
        commit: "a".repeat(40),
        path: "practice/one.yaml",
      },
      publicationState: "unpublished",
    },
  ];
  await mkdir(join(root, "original"));
  const path = join(root, "original", "package.json");
  const bytes = canonical(original);
  await writeFile(path, bytes);
  const previewPath = await prepareCoursePreview(path, root);
  const preview = await loadPackage(previewPath);
  assert.equal(await prepareCoursePreview(path, root), previewPath);
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.deepEqual(
    preview.manifest.materials.map((m) => m.access),
    ["free", "free", "free", "closed", "free"],
  );
  assert.ok(preview.manifest.materials.every((m) => m.stage === "draft"));
  assert.equal(
    preview.manifest.practiceDefinitions?.[0]?.publicationState,
    "published",
  );
  assert.equal(
    original.practiceDefinitions[0]?.publicationState,
    "unpublished",
  );
  const wrong = fixture();
  wrong.products = [];
  assert.throws(() => coursePreviewManifest(wrong), /requires only/u);
});
