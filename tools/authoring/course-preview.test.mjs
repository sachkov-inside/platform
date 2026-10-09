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
  const ids = [
    "aie-ch1-course",
    "aie-ch1-agent-choice",
    "aie-ch2-modules",
    "aie-ch2-mvp-design",
    "aie-product-brief",
  ];
  const materials = ids.map((sourceId) => ({
    sourceId,
    sourcePath: `${sourceId}.md`,
    sourceIds: [],
    relatedMaterialIds: [],
    readingTimeMinutes: null,
    kind: /** @type {const} */ ("guide"),
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
        supplementaryMaterialIds: ["aie-product-brief"],
        chapters: [
          {
            sourceId: "project-setup",
            title: "Before",
            summary: "",
            materialIds: ids.slice(0, 2),
          },
          {
            sourceId: "mvp-platform",
            title: "First",
            summary: "",
            materialIds: ids.slice(2, 4),
          },
          ...[
            "team-agent-infrastructure",
            "business-agent",
            "quality-and-production",
          ].map((sourceId) => ({
            sourceId,
            title: sourceId,
            summary: "",
            materialIds: [],
          })),
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
      practiceId: "inside-content:aie-ch1-agent-choice",
      definition: { schemaVersion: 1, title: "Practice" },
      sourceReference: {
        materialSourceId: "inside-content:aie-ch1-agent-choice",
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
    ["free", "free", "closed", "closed", "closed"],
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

test("unknown course programmes cannot inherit the local access profile", () => {
  const original = fixture();
  const chapter = original.products[0]?.chapters[0];
  assert.ok(chapter);
  chapter.sourceId = "unknown-chapter";
  assert.throws(
    () => coursePreviewManifest(original),
    /unknown course programme/u,
  );
  assert.equal(original.materials[0]?.access, null);
});

test("v2 guide envelope produces a separate preview without changing source IDs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "course-preview-v2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const {
    products,
    selection: { productId, ...selection },
    ...rest
  } = fixture();
  const original = {
    ...rest,
    schemaVersion: 2,
    requiredFeatures: ["github-anchors-v1"],
    guides: products,
    selection: { ...selection, guideId: productId, taskIds: [] },
  };
  const path = join(root, "package.json");
  const bytes = canonical(original);
  await writeFile(path, bytes);
  const previewPath = await prepareCoursePreview(path, root);
  const preview = await loadPackage(previewPath);
  assert.notEqual(previewPath, path);
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.equal(preview.manifest.schemaVersion, 2);
  assert.deepEqual(preview.manifest.products, products);
  assert.deepEqual(preview.manifest.selection, {
    ...selection,
    productId,
    taskIds: [],
  });
  assert.deepEqual(preview.manifest.requiredFeatures, ["github-anchors-v1"]);
  assert.deepEqual(
    preview.manifest.materials.map((row) => row.access),
    ["free", "free", "closed", "closed", "closed"],
  );
});

test("course profile preserves opaque v2 readerBlocks, Task pages and authored access", () => {
  const base = fixture();
  const material = base.materials[0];
  assert.ok(material);
  const readerBlocks = [
    { kind: "markdown", markdown: "## Section\nText" },
    {
      kind: "quiz",
      id: "question-one",
      promptMarkdown: "Question?",
      options: [{ id: "a", markdown: "A", explanationMarkdown: "Reason" }],
      correctOptionId: "a",
      dontKnow: {
        explanationMarkdown: "Review section",
        reviewLinks: [{ label: "Section", href: "#section" }],
      },
    },
  ];
  const original = {
    ...base,
    schemaVersion: /** @type {const} */ (2),
    requiredFeatures: ["quiz-v1", "github-anchors-v1"],
    materials: base.materials.map((row) => ({ ...row, readerBlocks })),
    tasks: [
      {
        sourceId: "task-one",
        productId: "inside-ai-engineering",
        chapterId: "project-setup",
        title: "Task",
        access: /** @type {const} */ ("closed"),
        publicationState: /** @type {const} */ ("unpublished"),
        relatedMaterialIds: [],
        provenance: {
          repository: "synthetic/content",
          commit: "a".repeat(40),
          path: "practice/task.yaml",
        },
        definition: { schemaVersion: 2 },
        page: { ...material, readerBlocks },
      },
    ],
  };
  const bytes = canonical(original);
  const preview = coursePreviewManifest(original);
  assert.equal(canonical(original), bytes);
  assert.deepEqual(preview.tasks, original.tasks);
  assert.deepEqual(preview.requiredFeatures, original.requiredFeatures);
  for (const row of preview.materials) {
    assert.deepEqual(Reflect.get(row, "readerBlocks"), readerBlocks);
  }
  assert.deepEqual(preview.products, original.products);
  assert.deepEqual(preview.selection, original.selection);
});
