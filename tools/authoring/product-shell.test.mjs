// @ts-check
// Product shell release (#803): the product page and programme move without any Material.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  canonical,
  checksum,
  loadPackage,
  manifestSchema,
} from "./package.mjs";
import { productChapters, syncLocal } from "./local-sync.mjs";
import { applyRelease, previewRelease } from "./release.mjs";
import { resolveLocalTarget } from "./target.mjs";
import { sourceUuid } from "./markdown.mjs";
import { entryAt, itemAt, readJournalFile } from "./test-support.mjs";

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./target.mjs").LocalTransport} LocalTransport
 * @typedef {{ path: string; method: string; body: unknown }} Call
 * @typedef {{ materialId: string; chapterId: string | null }} Item
 * @typedef {{ id: string; name: string; summary: string }} Chapter
 */

/** @param {string} chapter */
const sourceChapterId = (chapter) =>
  sourceUuid(`inside-content:inside-ai-engineering:chapter:${chapter}`);
/** @param {number} n */
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const productId = uuid(900);
const page = {
  card: { caption: "Курс" },
  blocks: [{ id: "hero", kind: "hero", lead: "Лид курса.", highlights: [] }],
};
// The documented contract example is the package these tests release.
const contractFixture = new URL(
  "../../docs/contracts/authoring-guide-shell-v1/package.json",
  import.meta.url,
);

/** The example is readable JSON; the tests write it back as a canonical package. */
async function contractManifest() {
  return manifestSchema.parse(
    JSON.parse(await readFile(contractFixture, "utf8")),
  );
}

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-shell-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = await contractManifest();
  const packagePath = join(directory, "package.json");
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return { manifest, write, packagePath, state: join(directory, "state") };
}

const compositionSchema = z
  .object({
    expectedOrderVersion: z.string(),
    orderedMaterialIds: z.array(z.string()),
    chapters: z
      .array(
        z.object({ id: z.string(), name: z.string(), summary: z.string() }),
      )
      .optional(),
    chapterAssignments: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .passthrough();
const updateSchema = z
  .object({
    expectedVersion: z.number(),
    name: z.string(),
    summary: z.string(),
    source: z.object({
      slug: z.string(),
      presentation: z.string(),
      page: z.unknown(),
    }),
  })
  .passthrough();

/**
 * A loopback double that keeps a Product's order and chapters like Platform: omitted assignments keep
 * retained Materials in their chapters, and an unchanged composition writes nothing. Any request
 * outside the Product shell routes fails the test, so a Material write cannot pass unnoticed.
 *
 * @param {{ stored?: boolean }} [options]
 */
function platform({ stored = true } = {}) {
  const preparation = sourceChapterId("chapter-0");
  /** @type {Call[]} */
  const calls = [];
  const product = {
    id: productId,
    slug: "ai-engineering",
    sourceId: "inside-content:inside-ai-engineering",
    name: "Старое имя",
    summary: "Старый анонс",
    version: 1,
    archived: false,
    presentation: "default",
    page: null,
    pageRejected: false,
  };
  const state = {
    exists: stored,
    /** @type {Chapter[]} */
    chapters: [{ id: preparation, name: "Подготовка", summary: "" }],
    /** @type {Item[]} */
    items: [
      { materialId: uuid(1), chapterId: preparation },
      { materialId: uuid(2), chapterId: null },
    ],
    compositions: 0,
  };
  const version = () =>
    checksum(canonical({ items: state.items, chapters: state.chapters }));
  const api = {
    calls,
    product,
    state,
    /** @param {RegExp} pattern */
    count: (pattern) => calls.filter((call) => pattern.test(call.path)).length,
    /** @type {LocalTransport} */
    async request(path, body, _key, options = {}) {
      calls.push({
        path,
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        body: structuredClone(body),
      });
      if (path === "/authoring/import/materials/environment")
        return { mode: "development" };
      if (path === "/authoring/import/products/validate")
        return { valid: true };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/collections?kind=product")
        return state.exists ? [structuredClone(product)] : [];
      if (path === "/authoring/import/products/reserve") {
        state.exists = true;
        return structuredClone(product);
      }
      if (path === "/authoring/import/products/update") {
        const update = updateSchema.parse(body);
        assert.equal(update.expectedVersion, product.version);
        Object.assign(product, {
          name: update.name,
          summary: update.summary,
          slug: update.source.slug,
          presentation: update.source.presentation,
          page: update.source.page,
          version: product.version + 1,
        });
        return structuredClone(product);
      }
      if (path === `/authoring/products/${productId}/order`)
        return {
          orderVersion: version(),
          items: structuredClone(state.items),
          chapters: structuredClone(state.chapters),
        };
      if (path === "/authoring/import/products/composition") {
        const command = compositionSchema.parse(body);
        const chapters = command.chapters ?? state.chapters;
        const ids = new Set(chapters.map((chapter) => chapter.id));
        const kept = Object.fromEntries(
          state.items.flatMap((item) =>
            item.chapterId === null ? [] : [[item.materialId, item.chapterId]],
          ),
        );
        const assignments = command.chapterAssignments ?? kept;
        const items = command.orderedMaterialIds.map((materialId) => {
          const chapterId = assignments[materialId];
          return {
            materialId,
            chapterId:
              chapterId !== undefined && ids.has(chapterId) ? chapterId : null,
          };
        });
        const next = checksum(canonical({ items, chapters }));
        if (next === version()) return { orderVersion: next };
        if (command.expectedOrderVersion !== version())
          throw Object.assign(new Error("stale_series_order"), { status: 409 });
        Object.assign(state, { items, chapters });
        state.compositions++;
        return { orderVersion: next };
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
  return api;
}

/**
 * @param {{ packagePath: string; state: string }} setup
 * @param {{ request: LocalTransport }} api
 * @param {import("./local-sync.mjs").SyncOptions} [options]
 */
const sync = (setup, api, options = {}) =>
  syncLocal(setup.packagePath, setup.state, {
    request: api.request,
    ...options,
  });

/**
 * A journal that already holds a lesson transferred with this product.
 *
 * @param {string} state
 */
async function journalWithLesson(state) {
  await mkdir(state, { recursive: true });
  await writeFile(
    join(state, "journal.json"),
    canonical({
      schemaVersion: 1,
      target: resolveLocalTarget("editor"),
      materials: {
        "inside-content:harness-intro": {
          materialId: uuid(1),
          contentVersion: 3,
          digest: "a".repeat(64),
          archived: false,
          productSourceIds: ["inside-content:inside-ai-engineering"],
          url: "/materials/harness-intro",
        },
      },
      products: {},
      operations: {},
      resources: {},
    }),
  );
}

test("the documented Product shell package carries the page and every chapter without Materials", async () => {
  const manifest = await contractManifest();
  const [product] = manifest.products;
  assert.ok(product);
  assert.equal(manifest.selection.scope, "product-shell");
  assert.deepEqual(manifest.materials, []);
  assert.deepEqual(
    product.chapters.map((chapter) => chapter.sourceId),
    Array.from({ length: 8 }, (_, index) => `chapter-${String(index)}`),
  );
});

test("the contract example loads as a canonical package", async (t) => {
  const setup = await fixture(t);
  const loaded = await loadPackage(setup.packagePath);
  assert.equal(loaded.manifest.selection.scope, "product-shell");
});

/** @type {[string, (manifest: Manifest) => void, RegExp][]} */
const refusals = [
  [
    "an empty selection without the explicit scope",
    (manifest) => delete manifest.selection.scope,
    /must declare selection\.scope product-shell/u,
  ],
  [
    "a shell that carries a Material",
    (manifest) => {
      manifest.selection.materialIds = ["lesson"];
      manifest.materials = [
        {
          sourceId: "lesson",
          sourcePath: "lesson.md",
          sourceIds: [],
          relatedMaterialIds: [],
          readingTimeMinutes: null,
          kind: "note",
          title: "Урок",
          summary: "Кратко",
          stage: "draft",
          topicId: null,
          access: "closed",
          showInFeed: false,
          difficulty: null,
          outcomes: [],
          markdown: "Текст",
          links: {},
          images: {},
          coverAssetId: null,
          coverAlt: null,
          video: null,
          videoChapters: [],
          artifacts: [],
        },
      ];
    },
    /carries no chapter subset, Material, asset, practice or task/u,
  ],
  [
    "a shell that places a Material in a chapter",
    (manifest) => {
      const product = itemAt(manifest.products, 0);
      itemAt(product.chapters, 0).materialIds = ["lesson"];
      product.materialIds = ["lesson"];
    },
    /without Material placement/u,
  ],
  [
    "a shell that names a chapter subset",
    (manifest) => {
      manifest.selection.chapterIds = ["chapter-0"];
    },
    /carries no chapter subset/u,
  ],
  [
    "a shell for another Product",
    (manifest) => {
      manifest.selection.productId = "other";
    },
    /exactly its one Product/u,
  ],
];
for (const [name, change, message] of refusals)
  test(`package loading refuses ${name}`, async (t) => {
    const setup = await fixture(t);
    change(setup.manifest);
    await setup.write();
    await assert.rejects(loadPackage(setup.packagePath), message);
  });

test("a shell release moves page and chapters and leaves every Material alone", async (t) => {
  const setup = await fixture(t);
  await journalWithLesson(setup.state);
  const api = platform();
  const before = structuredClone(api.state.items);

  const report = await sync(setup, api);

  assert.equal(report.scope, "product-shell");
  assert.deepEqual(report.archiveProposals, []);
  assert.deepEqual(report.archived, []);
  assert.equal(report.applied, 0);
  assert.equal(api.product.name, "Inside AI Engineering");
  assert.deepEqual(api.product.page, page);
  assert.deepEqual(
    api.state.chapters.map((chapter) => chapter.name),
    itemAt(setup.manifest.products, 0).chapters.map((chapter) => chapter.title),
  );
  // Existing lessons keep their order and chapter: the chapter identity comes from the source key.
  assert.equal(
    itemAt(
      productChapters(setup.manifest, itemAt(setup.manifest.products, 0)),
      0,
    ).id,
    sourceChapterId("chapter-0"),
  );
  assert.deepEqual(api.state.items, before);
  // No Material, artifact, practice, archive, Home pin or offer route is touched.
  assert.deepEqual([...new Set(api.calls.map((call) => call.path))].sort(), [
    "/authoring/collections?kind=product",
    "/authoring/collections?kind=topic",
    "/authoring/import/materials/environment",
    "/authoring/import/products/composition",
    "/authoring/import/products/reserve",
    "/authoring/import/products/update",
    "/authoring/import/products/validate",
    `/authoring/products/${productId}/order`,
  ]);
  const journal = await readJournalFile(setup.state);
  assert.equal(
    entryAt(journal.materials, "inside-content:harness-intro")["archived"],
    false,
  );

  // A repeated release changes nothing and duplicates nothing.
  const calls = api.calls.length;
  const repeated = await sync(setup, api);
  assert.equal(api.state.compositions, 1);
  assert.equal(api.product.version, 2);
  assert.equal(api.state.chapters.length, 8);
  assert.deepEqual(repeated.products, report.products);
  assert.equal(
    api.calls.slice(calls).filter((call) => call.path.endsWith("/update"))
      .length,
    0,
  );
});

test("a shell release creates a new product with an empty programme", async (t) => {
  const setup = await fixture(t);
  const api = platform({ stored: false });
  api.state.items = [];
  api.state.chapters = [];
  const report = await sync(setup, api);
  assert.equal(itemAt(report.products, 0).mainMaterials, 0);
  assert.equal(api.state.chapters.length, 8);
  assert.deepEqual(api.state.items, []);
});

test("a shell that would drop a chapter holding Materials stops before any write", async (t) => {
  const setup = await fixture(t);
  const product = itemAt(setup.manifest.products, 0);
  product.chapters = product.chapters.filter(
    (chapter) => chapter.sourceId !== "chapter-0",
  );
  await setup.write();
  const api = platform();
  await assert.rejects(
    sync(setup, api),
    /drops chapters that hold 1 Materials/u,
  );
  assert.equal(api.count(/reserve|update|composition/u), 0);
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      origin: resolveLocalTarget("editor"),
      request: api.request,
    }),
    /drops chapters that hold 1 Materials/u,
  );
});

test("a shell release refuses an archive request", async (t) => {
  const setup = await fixture(t);
  await journalWithLesson(setup.state);
  const api = platform();
  await assert.rejects(
    sync(setup, api, { archive: ["harness-intro"] }),
    /never archives Materials/u,
  );
  assert.equal(api.calls.length, 0);
});

test("preview shows the shell and exact apply stops on drift", async (t) => {
  const setup = await fixture(t);
  await journalWithLesson(setup.state);
  const api = platform();
  const origin = resolveLocalTarget("editor");
  const { path, preview } = await previewRelease(
    setup.packagePath,
    setup.state,
    { origin, request: api.request },
  );
  assert.equal(preview.scope, "product-shell");
  assert.deepEqual(preview.materials, []);
  assert.deepEqual(preview.archiveProposals, []);
  assert.deepEqual(itemAt(preview.products, 0), {
    sourceId: "inside-ai-engineering",
    title: "Inside AI Engineering",
    materials: 0,
    artifactChanges: [],
    change: "composition",
    detailsChange: true,
    chapterTextChanges: 1,
    pageChange: true,
    chapterListChange: { added: 7, removed: 0 },
    added: 0,
    removed: 0,
    reorderedOrRegrouped: false,
  });
  assert.equal(api.count(/reserve|update|composition/u), 0);

  // Another writer moves a lesson after the review: the reviewed preview no longer applies.
  api.state.items.reverse();
  await assert.rejects(
    applyRelease(path, setup.state, { request: api.request }),
    /changed after the preview/u,
  );
  assert.equal(api.count(/reserve|update|composition/u), 0);
  await assert.rejects(
    applyRelease(path, setup.state, {
      request: api.request,
      archive: ["harness-intro"],
    }),
    /limited to the reviewed proposals/u,
  );

  const fresh = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  const report = await applyRelease(fresh.path, setup.state, {
    request: api.request,
  });
  assert.equal(report.scope, "product-shell");
  const again = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  assert.equal(itemAt(again.preview.products, 0).change, "unchanged");
});

test("a new product's shell preview lists its chapters", async (t) => {
  const setup = await fixture(t);
  const api = platform({ stored: false });
  const { preview } = await previewRelease(setup.packagePath, setup.state, {
    origin: resolveLocalTarget("editor"),
    request: api.request,
  });
  assert.equal(itemAt(preview.products, 0).change, "new");
  assert.deepEqual(itemAt(preview.products, 0).chapterListChange, {
    added: 8,
    removed: 0,
  });
});

test("a page edited on the target after the preview stops exact apply", async (t) => {
  const setup = await fixture(t);
  const api = platform();
  const { path } = await previewRelease(setup.packagePath, setup.state, {
    origin: resolveLocalTarget("editor"),
    request: api.request,
  });
  api.product.version++;
  await assert.rejects(
    applyRelease(path, setup.state, { request: api.request }),
    /changed after the preview/u,
  );
  assert.equal(api.count(/reserve|update|composition/u), 0);
});

test("a shell leaves an unfinished Material write alone and says so", async (t) => {
  const setup = await fixture(t);
  await journalWithLesson(setup.state);
  const journal = await readJournalFile(setup.state);
  const request = {
    path: "/authoring/import/materials/reserve",
    body: { source: { id: "inside-content:harness-intro" } },
  };
  journal.operations[`authoring:${checksum(canonical(request))}`] = {
    status: "pending",
    request,
  };
  await writeFile(join(setup.state, "journal.json"), canonical(journal));
  const api = platform();
  const { preview } = await previewRelease(setup.packagePath, setup.state, {
    origin: resolveLocalTarget("editor"),
    request: api.request,
  });
  assert.equal(preview.pendingMaterialWrites, 1);
  const report = await sync(setup, api);
  assert.ok(report.notices.some((notice) => notice.code === "journal_pending"));
  assert.equal(api.count(/materials\/(reserve|apply|validate)/u), 0);
});
