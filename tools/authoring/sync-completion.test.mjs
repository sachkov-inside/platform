// @ts-check
import { currentEnvironment } from "./test-support.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum, materialRevision } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { loopbackOrigin, resolveLocalTarget } from "./target.mjs";
import { applyRelease, previewRelease } from "./release.mjs";
import {
  materialApplyRequest,
  taskReceiptSchema,
  isJournalOperation,
} from "./local-boundaries.mjs";
import {
  entryAt,
  itemAt,
  readJournalFile,
  reservationBodySchema,
  resourcesOf,
  valueAt,
} from "./test-support.mjs";
import { z } from "zod";
import { sourceUuid } from "./markdown.mjs";

/** @param {number} n */
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const productId = uuid(900);
const productIntroductionSchema = z
  .object({
    audience: z.string(),
    outcome: z.string(),
    prerequisites: z.string(),
    scope: z.string(),
  })
  .strict();
const productPage = {
  card: null,
  blocks: [{ id: "hero", kind: "hero", lead: "Лид продукта.", highlights: [] }],
};

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-completion-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  const files = {
    cover: Buffer.from("cover-bytes"),
    checklist: Buffer.from("# checklist\n"),
  };
  await writeFile(join(directory, "assets", "cover.png"), files.cover);
  await writeFile(join(directory, "assets", "checklist.md"), files.checklist);
  /**
   * @param {string} id
   * @param {Partial<ManifestMaterial>} [extra]
   * @returns {ManifestMaterial}
   */
  const row = (id, extra = {}) => ({
    sourceId: id,
    sourcePath: `${id}.md`,
    sourceIds: [],
    relatedMaterialIds: [],
    readingTimeMinutes: null,
    kind: "note",
    title: id,
    summary: "Summary",
    stage: "draft",
    topicId: null,
    access: "closed",
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
    ...extra,
  });
  /** @type {Manifest} */
  const manifest = {
    schemaVersion: 1,
    sourceNamespace: "inside-content",
    selection: {
      productId: "product",
      chapterIds: [],
      materialIds: ["lesson", "video", "old"],
      complete: true,
    },
    materials: [
      row("lesson", {
        coverAssetId: "cover",
        coverAlt: "Обложка",
        artifacts: [
          {
            sourceId: "checklist",
            title: "Чек-лист",
            assetId: "checklist",
            filename: "customer-brief.md",
          },
        ],
      }),
      row("video", {
        kind: "video",
        video: { kinescopeId: uuid(777) },
        videoChapters: [
          { start: 0, title: "Введение" },
          { start: 90, title: "Итог" },
        ],
      }),
      row("old"),
    ],
    products: [
      {
        sourceId: "product",
        presentation: "ai-first-process",
        page: productPage,
        title: "Продукт",
        summary: "Подзаголовок",
        complete: true,
        chapters: [],
        materialIds: ["lesson", "video", "old"],
        supplementaryMaterialIds: [],
      },
    ],
    assets: [
      {
        sourceId: "checklist",
        path: "assets/checklist.md",
        sha256: checksum(files.checklist),
        mimeType: "text/markdown",
      },
      {
        sourceId: "cover",
        path: "assets/cover.png",
        sha256: checksum(files.cover),
        mimeType: "image/png",
      },
    ],
    diagnostics: [],
  };
  const packagePath = join(directory, "package.json");
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return { manifest, write, state: join(directory, "state"), packagePath };
}

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./package.mjs").ManifestMaterial} ManifestMaterial
 * @typedef {import("./target.mjs").LocalTransport} LocalTransport
 * @typedef {{ path: string; key: string | undefined; method: string; body: unknown }} Call
 * @typedef {object} FakeMaterial
 * @property {string} materialId
 * @property {number} contentVersion
 * @property {string | null} primaryVideoId
 * @property {{ coverId: string } | null} cover
 * @property {{ slug: string; access?: string }} metadata
 * @property {{ id: string }} source
 * @property {string} publicationState
 * @property {unknown} [videoChapters]
 * @property {string[]} [productIds]
 * @property {boolean} [inFeed]
 * @typedef {{
 *   videoId: string;
 *   materialId: string;
 *   providerVideoId: string;
 *   state: string;
 *   reconciles: number;
 *   protected?: boolean;
 * }} FakeVideo
 * @typedef {{
 *   artifactId: string;
 *   origin: string;
 *   sourceId: string;
 *   title: string;
 *   materialIds: string[];
 *   filename?: string;
 * }} FakeArtifact
 * @typedef {object} FakeProduct
 * @property {string} id
 * @property {string} slug
 * @property {{ audience: string; outcome: string; prerequisites: string; scope: string } | null} [introduction]
 * @property {string} sourceId
 * @property {string} name
 * @property {string} summary
 * @property {number} version
 * @property {boolean} archived
 * @property {string} presentation
 * @property {unknown} page
 * @property {boolean} pageRejected
 * @property {string[]} [members]
 * @property {FakeTopic[]} [topics] Course topics; a receiver before #2022 reports none
 * @typedef {{ id: string; name: string; summary: string; materialIds: string[] }} FakeTopic
 */

// Bodies the double reads; the sync under test builds them, so a missing field fails the test.
const productValidationBodySchema = z
  .object({ source: z.object({ presentation: z.string() }).passthrough() })
  .passthrough();
const productUpdateBodySchema = z
  .object({
    expectedVersion: z.number(),
    introduction: z.unknown().optional(),
    name: z.string(),
    summary: z.string(),
    source: z
      .object({ slug: z.string(), presentation: z.string(), page: z.unknown() })
      .passthrough(),
  })
  .passthrough();
const homePinBodySchema = z
  .object({ expectedVersion: z.number(), productId: z.string() })
  .passthrough();
const compositionBodySchema = z
  .object({ orderedMaterialIds: z.array(z.string()) })
  .passthrough();
const topicsBodySchema = z
  .object({
    expectedOrderVersion: z.string(),
    topics: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          summary: z.string(),
          materialIds: z.array(z.uuid()),
        })
        .strict(),
    ),
  })
  .strict();
/** A receiver with topics hashes the catalogue and the topics; an older one keeps fixed versions.
 * @param {FakeProduct} product */
const fakeOrderVersion = (product) =>
  product.topics === undefined
    ? "a".repeat(64)
    : checksum(
        canonical({ members: product.members ?? [], topics: product.topics }),
      );
const attachBodySchema = z
  .object({ providerVideoId: z.string() })
  .passthrough();

/**
 * @param {FormData} form
 * @param {string} name
 */
function formText(form, name) {
  const value = form.get(name);
  assert.equal(typeof value, "string", `form field ${name}`);
  return String(value);
}

// Stateful application double for the loopback API; it records every call and enforces versions.
function applicationApi() {
  /** @type {Map<string, FakeMaterial>} */
  const materials = new Map();
  /** @type {Call[]} */
  const calls = [];
  /** @type {Map<string, FakeVideo>} */
  const videos = new Map();
  /** @type {Map<string, FakeArtifact>} */
  const artifacts = new Map();
  /** @type {FakeProduct} */
  const product = {
    id: productId,
    slug: "product",
    sourceId: "inside-content:product",
    name: "",
    summary: "",
    version: 1,
    archived: false,
    presentation: "default",
    page: null,
    pageRejected: false,
  };
  let next = 1;
  const api = {
    calls,
    materials,
    videos,
    artifacts,
    product,
    pin: { productId: uuid(901), version: 3 },
    /** @type {string | undefined} */
    rejectValidation: undefined,
    /** @param {RegExp} pattern */
    count: (pattern) => calls.filter((call) => pattern.test(call.path)).length,
    /** @type {LocalTransport} */
    async request(path, body, key, options = {}) {
      calls.push({
        path,
        key,
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        body:
          body instanceof FormData
            ? Object.fromEntries(
                [...body.entries()].filter(([name]) => name !== "file"),
              )
            : structuredClone(body),
      });
      if (path === "/authoring/import/materials/environment")
        return currentEnvironment("development");
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate")
        return { valid: true };
      if (path === "/authoring/import/products/validate") {
        const { source } = productValidationBodySchema.parse(body);
        assert.ok(source, "validation carries the page");
        if (api.rejectValidation !== undefined)
          throw Object.assign(new Error(api.rejectValidation), { status: 422 });
        if (!["default", "ai-first-process"].includes(source.presentation))
          throw Object.assign(
            new Error(`invalid_content /source/presentation`),
            { status: 422 },
          );
        return { valid: true };
      }
      if (path === "/authoring/import/products/reserve")
        return structuredClone(product);
      if (path === "/authoring/collections?kind=product")
        return [structuredClone(product)];
      if (path === "/authoring/home-pin" && body === undefined)
        return structuredClone(api.pin);
      if (path === "/authoring/home-pin") {
        const pin = homePinBodySchema.parse(body);
        assert.equal(pin.expectedVersion, api.pin.version);
        api.pin = { productId: pin.productId, version: api.pin.version + 1 };
        return structuredClone(api.pin);
      }
      if (path === "/authoring/import/products/update") {
        const update = productUpdateBodySchema.parse(body);
        assert.equal(update.expectedVersion, product.version);
        Object.assign(product, {
          ...(update.introduction === undefined
            ? {}
            : {
                introduction: productIntroductionSchema.parse(
                  update.introduction,
                ),
              }),
          name: update.name,
          summary: update.summary,
          slug: update.source.slug,
          presentation: update.source.presentation,
          page: update.source.page,
          pageRejected: false,
          version: product.version + 1,
        });
        return structuredClone(product);
      }
      if (path === `/authoring/products/${productId}/order`)
        return {
          orderVersion: fakeOrderVersion(product),
          items: (product.members ?? []).map((materialId) => ({
            materialId,
            chapterId: null,
          })),
          chapters: [],
          ...(product.topics === undefined
            ? {}
            : { topics: structuredClone(product.topics) }),
        };
      if (path === `/authoring/products/${productId}/topics`) {
        assert.equal(options.method, "PUT");
        const command = topicsBodySchema.parse(body);
        if (command.expectedOrderVersion !== fakeOrderVersion(product))
          throw Object.assign(new Error("stale_product_order"), {
            status: 409,
          });
        const members = product.members ?? [];
        // The receiver stores trimmed text and lists Materials in catalogue order.
        product.topics = command.topics.map((topic) => ({
          id: topic.id,
          name: topic.name.trim(),
          summary: topic.summary.trim(),
          materialIds: members.filter((id) => topic.materialIds.includes(id)),
        }));
        return { productId, orderVersion: fakeOrderVersion(product) };
      }
      if (path === "/authoring/import/products/composition") {
        product.members = compositionBodySchema.parse(body).orderedMaterialIds;
        return {
          orderVersion:
            product.topics === undefined
              ? "b".repeat(64)
              : fakeOrderVersion(product),
        };
      }
      if (path === "/authoring/import/materials/reserve") {
        const { source } = reservationBodySchema.parse(body);
        if (!materials.has(source.id))
          materials.set(source.id, {
            materialId: uuid(next++),
            contentVersion: 1,
            primaryVideoId: null,
            cover: null,
            metadata: { slug: itemAt(source.id.split(":"), 1) },
            source,
            publicationState: "draft",
            inFeed: false,
          });
        return structuredClone(materials.get(source.id));
      }
      /** @param {string | undefined} id */
      const byId = (id) => {
        const found = [...materials.values()].find(
          (item) => item.materialId === id,
        );
        assert.ok(found, `Unknown Material ${String(id)}`);
        return found;
      };
      let match;
      if ((match = /^\/authoring\/materials\/([^/]+)$/u.exec(path))) {
        const material = structuredClone(byId(match[1]));
        const video =
          material.primaryVideoId === null
            ? undefined
            : videos.get(material.primaryVideoId);
        // A target before ADR 0041 reports no protection; this double omits it on request.
        return video === undefined || video.protected === undefined
          ? material
          : { ...material, primaryVideo: { protected: video.protected } };
      }
      if (path === "/authoring/import/materials/apply") {
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        const current = valueAt(materials, command.source.id);
        if (command.expectedContentVersion !== current.contentVersion)
          throw new Error("stale_content_version");
        // Platform never moves a published or unpublished Material back to draft.
        if (
          command.publicationState === "draft" &&
          current.publicationState !== "draft"
        )
          throw new Error("invalid_publication_transition");
        if (command.primaryVideoId !== null)
          assert.equal(valueAt(videos, command.primaryVideoId).state, "ready");
        Object.assign(current, {
          contentVersion: current.contentVersion + 1,
          primaryVideoId: command.primaryVideoId,
          videoChapters: command.videoChapters,
          publicationState: command.publicationState,
          productIds: command.metadata.productIds,
          metadata: { ...current.metadata, access: command.metadata.access },
          ...(typeof command["inFeed"] === "boolean"
            ? { inFeed: command["inFeed"] }
            : {}),
        });
        return {
          materialId: current.materialId,
          contentVersion: current.contentVersion,
        };
      }
      if (
        (match = /^\/authoring\/materials\/([^/]+)\/videos\/attach$/u.exec(
          path,
        ))
      ) {
        const { providerVideoId } = attachBodySchema.parse(body);
        const existing = [...videos.values()].find(
          (video) => video.providerVideoId === providerVideoId,
        );
        if (existing) return structuredClone(existing);
        const video = {
          videoId: uuid(next++),
          materialId: itemAt(match, 1),
          providerVideoId,
          state: "processing",
          reconciles: 0,
          protected: true,
        };
        videos.set(video.videoId, video);
        return structuredClone(video);
      }
      if ((match = /^\/authoring\/videos\/([^/]+)\/reconcile$/u.exec(path))) {
        const video = valueAt(videos, itemAt(match, 1));
        if (++video.reconciles >= 2) video.state = "ready";
        return structuredClone(video);
      }
      if (
        (match =
          /^\/authoring\/import\/content-covers\/material\/([^/]+)$/u.exec(
            path,
          ))
      ) {
        const current = byId(match[1]);
        assert.equal(options.method, "PUT");
        assert.ok(body instanceof FormData);
        assert.equal(
          body.get("expectedCoverId"),
          current.cover?.coverId ?? "null",
        );
        assert.equal(body.get("sourceId"), current.source.id);
        current.cover = { coverId: uuid(next++) };
        return { cover: current.cover };
      }
      if (path === `/authoring/import/products/${productId}/artifacts`) {
        assert.ok(body instanceof FormData);
        assert.equal(body.get("productSourceId"), "inside-content:product");
        const sourceId = formText(body, "sourceId");
        const file = body.get("file");
        assert.ok(file instanceof File);
        const existing = artifacts.get(sourceId);
        const artifact = existing ?? {
          artifactId: uuid(next++),
          origin: "authoring",
          sourceId,
          title: formText(body, "title"),
          materialIds: [],
        };
        artifact.filename = file.name;
        artifacts.set(artifact.sourceId, artifact);
        return {
          artifactId: artifact.artifactId,
          outcome: existing ? "unchanged" : "created",
          sourceId: artifact.sourceId,
          title: artifact.title,
        };
      }
      if (
        (match = /^\/authoring\/product-artifacts\/([^/]+)\/materials$/u.exec(
          path,
        ))
      ) {
        throw new Error(
          "403 forbidden: manual artifact writes reject source ownership",
        );
      }
      if (
        (match =
          /^\/authoring\/import\/products\/([^/]+)\/artifacts\/([^/]+)\/materials$/u.exec(
            path,
          ))
      ) {
        assert.equal(match[1], productId);
        const binding = z
          .object({
            productSourceId: z.literal("inside-content:product"),
            sourceId: z.string(),
            materialIds: z.array(z.uuid()),
          })
          .strict()
          .parse(body);
        const artifactId = match[2];
        const artifact = [...artifacts.values()].find(
          (item) => item.artifactId === artifactId,
        );
        assert.ok(artifact);
        assert.equal(binding.sourceId, artifact.sourceId);
        artifact.materialIds = [
          ...new Set([...artifact.materialIds, ...binding.materialIds]),
        ];
        return structuredClone(artifact);
      }
      if (path === `/authoring/products/${productId}/artifacts`)
        return {
          artifacts: [...artifacts.values()].map((item) =>
            structuredClone(item),
          ),
        };
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
const run = (setup, api, options = {}) =>
  syncLocal(setup.packagePath, setup.state, {
    request: api.request,
    publish: "all",
    sleep: async () => {},
    ...options,
  });

test("covers, video and artifacts transfer once and replay as no-ops", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const first = await run(setup, api);
  assert.equal(first.applied, 3);
  const video = valueAt(api.materials, "inside-content:video");
  assert.equal(valueAt(api.videos, video.primaryVideoId).state, "ready");
  assert.deepEqual(video.videoChapters, [
    { start: 0, title: "Введение" },
    { start: 90, title: "Итог" },
  ]);
  const lesson = valueAt(api.materials, "inside-content:lesson");
  assert.ok(lesson.cover?.coverId);
  assert.deepEqual(
    valueAt(api.artifacts, "inside-content:checklist").materialIds,
    [lesson.materialId],
  );
  assert.equal(
    valueAt(api.artifacts, "inside-content:checklist").filename,
    "customer-brief.md",
  );
  assert.equal(api.product.name, "Продукт");
  assert.equal(
    first.notices.some((notice) => /pending|missing/u.test(notice.code)),
    false,
  );

  const before = api.calls.length;
  const second = await run(setup, api);
  assert.equal(second.applied, 0);
  assert.equal(second.unchanged, 3);
  const repeated = api.calls.slice(before).map((call) => call.path);
  assert.equal(
    repeated.some(
      (path) =>
        /apply|attach|reconcile|content-covers|artifacts$|materials$|update/u.test(
          path,
        ) && !path.startsWith(`/authoring/products/${productId}/artifacts`),
    ),
    false,
    repeated.join("\n"),
  );
});

test("a fresh reviewed release finishes uploaded artifact binding without reupload or journal edits", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  /** @type {LocalTransport} */
  const interrupted = (path, body, key, options) => {
    if (
      /^\/authoring\/import\/products\/[^/]+\/artifacts\/[^/]+\/materials$/u.test(
        path,
      )
    )
      throw new Error("binding refused");
    return api.request(path, body, key, options);
  };
  await assert.rejects(
    run(setup, { request: interrupted }),
    /binding refused/u,
  );
  const uploaded = valueAt(api.artifacts, "inside-content:checklist");
  assert.deepEqual(uploaded.materialIds, []);
  const receiptKey = `artifact:${productId}:inside-content:checklist`;
  const receipt = z
    .object({ artifactId: z.uuid(), materialIds: z.null() })
    .passthrough()
    .parse(resourcesOf(await readJournalFile(setup.state))[receiptKey]);
  assert.equal(receipt.artifactId, uploaded.artifactId);
  const uploads = () =>
    api.calls.filter(
      ({ path }) =>
        path === `/authoring/import/products/${productId}/artifacts`,
    ).length;
  assert.equal(uploads(), 1);
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin: "http://127.0.0.1:4396",
    publish: "all",
    request: api.request,
  });
  await applyRelease(reviewed.path, setup.state, { request: api.request });
  assert.equal(uploads(), 1);
  assert.equal(
    valueAt(api.artifacts, "inside-content:checklist").artifactId,
    receipt.artifactId,
  );
  assert.deepEqual(
    valueAt(api.artifacts, "inside-content:checklist").materialIds,
    [valueAt(api.materials, "inside-content:lesson").materialId],
  );
});

test("the product page travels with the Product: unknown looks stop early, edits write once and a new address keeps the product", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.products, 0).presentation = "neon";
  await setup.write();
  const api = applicationApi();
  await assert.rejects(run(setup, api), /presentation 'neon'/u);
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      publish: "all",
      origin: "http://127.0.0.1:4396",
      request: api.request,
    }),
    /presentation 'neon'/u,
  );
  assert.deepEqual(
    api.calls.map((call) => call.path),
    [
      "/authoring/import/materials/environment",
      "/authoring/import/products/validate",
      "/authoring/import/materials/environment",
      "/authoring/import/products/validate",
    ],
  );

  itemAt(setup.manifest.products, 0).presentation = "ai-first-process";
  await setup.write();
  await run(setup, api);
  assert.deepEqual(
    {
      presentation: api.product.presentation,
      page: api.product.page,
      slug: api.product.slug,
    },
    { presentation: "ai-first-process", page: productPage, slug: "product" },
  );
  const updates = () =>
    api.calls.filter(
      (call) => call.path === "/authoring/import/products/update",
    ).length;
  const once = updates();
  await run(setup, api);
  assert.equal(updates(), once, "an unchanged product page writes nothing");
  // Журнал прежних переносов не помнит описания: повтор сверяется с тем, что держит цель.
  const journalPath = join(setup.state, "journal.json");
  const forgotten = await readJournalFile(setup.state);
  for (const entry of Object.values(forgotten.products)) {
    delete entry["version"];
  }
  await writeFile(journalPath, canonical(forgotten));
  await run(setup, api);
  assert.equal(
    updates(),
    once,
    "a journal written before the page still writes nothing",
  );

  // Нечитаемое описание в цели перезаписывается даже при совпадающем пакете.
  api.product.pageRejected = true;
  await run(setup, api);
  assert.equal(updates(), once + 1);
  assert.equal(api.product.pageRejected, false);

  const edited = {
    ...productPage,
    blocks: [{ ...itemAt(productPage.blocks, 0), lead: "Правка текста." }],
  };
  itemAt(setup.manifest.products, 0).page = edited;
  itemAt(setup.manifest.products, 0).slug = "product-moved";
  await setup.write();
  const report = await run(setup, api);
  assert.equal(updates(), once + 2);
  assert.deepEqual(
    { id: api.product.id, slug: api.product.slug, page: api.product.page },
    { id: productId, slug: "product-moved", page: edited },
  );
  assert.match(itemAt(report.products, 0).url, /\/products\/product-moved$/u);
});

test("Platform checks the whole description before the first write, and an older package keeps the address", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  api.rejectValidation = "page is too large";
  await assert.rejects(run(setup, api), /page is too large/u);
  assert.deepEqual(
    api.calls.map((call) => call.path),
    [
      "/authoring/import/materials/environment",
      "/authoring/import/products/validate",
    ],
  );
  api.rejectValidation = undefined;

  // Пакет, собранный до появления адреса и подписи карточки, ничего не переносит на новый адрес.
  api.product.slug = "product-published";
  delete itemAt(setup.manifest.products, 0).slug;
  itemAt(setup.manifest.products, 0).page = { blocks: productPage.blocks };
  await setup.write();
  await run(setup, api);
  assert.equal(api.product.slug, "product-published");
  const updates = () =>
    api.calls.filter(
      (call) => call.path === "/authoring/import/products/update",
    ).length;
  const once = updates();
  await run(setup, api);
  assert.equal(
    updates(),
    once,
    "a package without a Home card caption stays unchanged",
  );
});

test("an archived product with the same source key does not lend its address", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  api.product.archived = true;
  api.product.slug = "product-archived";
  const report = await run(setup, api);
  assert.equal(
    api.product.slug,
    "product-archived",
    "the address of an archived record is not reused as a decision",
  );
  assert.deepEqual(
    report.notices.filter((notice) => notice.code === "product_archived")
      .length,
    1,
  );
});

test("a package that names no description leaves the stored page alone", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  assert.deepEqual(api.product.page, productPage);
  const updates = () =>
    api.calls.filter(
      (call) => call.path === "/authoring/import/products/update",
    ).length;
  const before = updates();

  delete itemAt(setup.manifest.products, 0).page;
  delete itemAt(setup.manifest.products, 0).presentation;
  await setup.write();
  await run(setup, api);
  assert.deepEqual(
    {
      page: api.product.page,
      presentation: api.product.presentation,
      updates: updates(),
    },
    { page: productPage, presentation: "ai-first-process", updates: before },
  );

  // Снять описание можно только явным null.
  itemAt(setup.manifest.products, 0).page = null;
  await setup.write();
  await run(setup, api);
  assert.equal(api.product.page, null);
});

test("a replaced cover uses the current cover as its expected version", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const firstCover = valueAt(api.materials, "inside-content:lesson").cover
    ?.coverId;
  const bytes = Buffer.from("new-cover");
  await writeFile(join(setup.packagePath, "..", "assets", "cover.png"), bytes);
  itemAt(setup.manifest.assets, 1).sha256 = checksum(bytes);
  await setup.write();
  await run(setup, api);
  const upload = api.calls
    .filter((call) => call.path.includes("content-covers"))
    .at(-1);
  assert.equal(
    z.object({ expectedCoverId: z.string() }).parse(upload?.body)
      .expectedCoverId,
    firstCover,
  );
  assert.notEqual(
    valueAt(api.materials, "inside-content:lesson").cover?.coverId,
    firstCover,
  );
});

test("a missing original is proposed first and unpublished only on explicit request", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  setup.manifest.materials = setup.manifest.materials.filter(
    (row) => row.sourceId !== "old",
  );
  setup.manifest.selection.materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  await setup.write();
  const proposed = await run(setup, api);
  assert.deepEqual(
    proposed.archiveProposals.map((item) => item.sourceId),
    ["inside-content:old"],
  );
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "published",
  );
  await assert.rejects(
    run(setup, api, { archive: ["lesson"] }),
    /still in the package/u,
  );
  const archived = await run(setup, api, { archive: ["old"] });
  assert.deepEqual(archived.archived, [{ sourceId: "inside-content:old" }]);
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "unpublished",
  );
  assert.deepEqual(valueAt(api.materials, "inside-content:old").productIds, []);
  const after = await run(setup, api);
  assert.deepEqual(after.archiveProposals, []);
});

test("a reviewed archive builds a current command from an applied historical original", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const journal = await readJournalFile(setup.state);
  const old = valueAt(api.materials, "inside-content:old");
  const entry = Object.entries(journal.operations).find(
    ([, operation]) =>
      isJournalOperation(operation) &&
      materialApplyRequest(operation.request)?.body.source.id ===
        "inside-content:old",
  );
  assert.ok(entry && isJournalOperation(entry[1]));
  const command = materialApplyRequest(entry[1].request)?.body;
  assert.ok(command);
  const { version: _version, ...source } = command.source;
  const { productIds: _products, ...metadata } = command.metadata;
  const historical = {
    path: "/authoring/import/materials/apply",
    body: {
      ...command,
      source: { ...source, showInFeed: false },
      metadata: { ...metadata, seriesIds: [productId] },
    },
  };
  delete journal.operations[entry[0]];
  const historicalKey = `authoring:${checksum(canonical(historical))}`;
  journal.operations[historicalKey] = { ...entry[1], request: historical };
  await writeFile(join(setup.state, "journal.json"), canonical(journal));
  setup.manifest.materials = setup.manifest.materials.filter(
    (row) => row.sourceId !== "old",
  );
  setup.manifest.selection.materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  await setup.write();
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === "/authoring/import/materials/apply")
      assert.deepEqual(body, {
        ...command,
        expectedContentVersion: old.contentVersion,
        publicationState: "unpublished",
        metadata: { ...metadata, productIds: [] },
      });
    return api.request(path, body, key, options);
  };
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin: resolveLocalTarget("editor"),
    publish: "all",
    request,
  });
  const archived = await applyRelease(reviewed.path, setup.state, {
    archive: ["old"],
    request,
  });
  assert.deepEqual(archived.archived, [{ sourceId: "inside-content:old" }]);
  assert.equal(old.publicationState, "unpublished");
  assert.deepEqual(old.productIds, []);
  const after = await readJournalFile(setup.state);
  assert.deepEqual(
    after.operations[historicalKey],
    journal.operations[historicalKey],
  );
  const repeated = await run(setup, api);
  assert.deepEqual(repeated.archiveProposals, []);
});

test("a video that never becomes ready stops before Save and resumes with the same record", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await assert.rejects(
    run(setup, api, { videoAttempts: 1 }),
    /still processing/u,
  );
  assert.equal(
    valueAt(api.materials, "inside-content:video")?.primaryVideoId ?? null,
    null,
  );
  await run(setup, api);
  assert.equal(api.count(/videos\/attach$/u), 1);
  assert.equal(api.videos.size, 1);
});

test("supplementary originals join the Product after the programme without a chapter", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).supplementaryMaterialIds = ["old"];
  await setup.write();
  const api = applicationApi();
  const report = await run(setup, api);
  const ids = ["lesson", "video", "old"].map(
    (id) => valueAt(api.materials, `inside-content:${id}`).materialId,
  );
  assert.deepEqual(api.product.members, ids);
  assert.deepEqual(valueAt(api.materials, "inside-content:old").productIds, [
    productId,
  ]);
  const composition = api.calls.find(
    (call) => call.path === "/authoring/import/products/composition",
  );
  assert.deepEqual(
    z.object({ chapterAssignments: z.unknown() }).parse(composition?.body)
      .chapterAssignments,
    {},
  );
  assert.equal(itemAt(report.products, 0).mainMaterials, 2);
});

test("only loopback HTTP origins are accepted as targets", () => {
  assert.equal(resolveLocalTarget("editor"), "http://127.0.0.1:4396");
  assert.equal(resolveLocalTarget("stand"), "http://127.0.0.1:4398");
  assert.throws(() => resolveLocalTarget("production"));
  for (const origin of [
    "https://inside.example",
    "http://10.0.0.5:4396",
    "http://127.0.0.1.example.com",
    "http://user@127.0.0.1:4396",
    "https://127.0.0.1:4396",
  ]) {
    assert.throws(() => loopbackOrigin(origin), /loopback/u, origin);
  }
});

test("an uploaded recording is saved with the original's chapters until the original names it", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const journalPath = join(setup.state, "journal.json");
  const journal = await readJournalFile(setup.state);
  const uploadedId = uuid(555);
  api.videos.set(uploadedId, {
    videoId: uploadedId,
    materialId: valueAt(api.materials, "inside-content:lesson").materialId,
    state: "ready",
    providerVideoId: "uploaded",
    reconciles: 0,
  });
  resourcesOf(journal)["source-video:inside-content:lesson"] = {
    videoId: uploadedId,
    providerVideoId: "uploaded",
    sha256: "c".repeat(64),
  };
  await writeFile(journalPath, canonical(journal));
  itemAt(setup.manifest.materials, 0).videoChapters = [
    { start: 0, title: "Старт" },
  ];
  await setup.write();
  await run(setup, api);
  const lesson = valueAt(api.materials, "inside-content:lesson");
  assert.equal(lesson.primaryVideoId, uploadedId);
  assert.deepEqual(lesson.videoChapters, [{ start: 0, title: "Старт" }]);
});

test("a cover change whose response was lost is adopted on the retry", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const bytes = Buffer.from("replacement-cover");
  await writeFile(join(setup.packagePath, "..", "assets", "cover.png"), bytes);
  itemAt(setup.manifest.assets, 1).sha256 = checksum(bytes);
  await setup.write();
  const original = api.request;
  let lose = true;
  /** @type {LocalTransport} */
  const lossy = async (path, body, key, options) => {
    const result = await original(path, body, key, options);
    if (lose && path.includes("content-covers")) {
      lose = false;
      throw new Error("Connection lost after the cover changed");
    }
    return result;
  };
  /** @type {LocalTransport} */
  const conflicting = async (path, body, key, options) => {
    if (path.includes("content-covers")) {
      assert.ok(body instanceof FormData);
      const current = valueAt(api.materials, "inside-content:lesson").cover
        ?.coverId;
      if (body.get("expectedCoverId") !== current)
        throw Object.assign(new Error("409"), {
          status: 409,
          body: { code: "conflict", currentCoverId: current },
        });
    }
    return original(path, body, key, options);
  };
  await assert.rejects(run(setup, { request: lossy }), /Connection lost/u);
  const applied = valueAt(api.materials, "inside-content:lesson").cover
    ?.coverId;
  await run(setup, { request: conflicting });
  const journal = await readJournalFile(setup.state);
  assert.equal(
    entryAt(journal.materials, "inside-content:lesson")["coverId"],
    applied,
  );
  assert.equal(
    resourcesOf(journal)[
      `cover-pending:${valueAt(api.materials, "inside-content:lesson").materialId}`
    ],
    undefined,
  );
});

test("an archive whose receipt was stored before the crash stays archived", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  setup.manifest.materials = setup.manifest.materials.filter(
    (row) => row.sourceId !== "old",
  );
  setup.manifest.selection.materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  await setup.write();
  await run(setup, api, { archive: ["old"] });
  const journalPath = join(setup.state, "journal.json");
  const journal = await readJournalFile(setup.state);
  // Simulate the crash: the operation receipt exists, the cache still shows the published version.
  Object.assign(entryAt(journal.materials, "inside-content:old"), {
    archived: false,
    contentVersion:
      entryAt(journal.materials, "inside-content:old").contentVersion - 1,
  });
  await writeFile(journalPath, canonical(journal));
  const report = await run(setup, api);
  assert.deepEqual(report.archiveProposals, []);
});

test("release preview reports video, composition and artifact changes that the sync would apply", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  const clean = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.deepEqual(clean.summary, {
    new: 0,
    changed: 0,
    restore: 0,
    unchanged: 3,
    kept: 0,
    conflict: 0,
  });
  assert.deepEqual(itemAt(clean.preview.products, 0), {
    sourceId: "product",
    title: "Продукт",
    materials: 3,
    artifactChanges: [],
    change: "unchanged",
    detailsChange: false,
    chapterTextChanges: 0,
    pageChange: false,
    added: 0,
    removed: 0,
    reorderedOrRegrouped: false,
  });

  // A recording uploaded after the review changes what apply would save, so apply refuses.
  const reviewedJournal = await readJournalFile(setup.state);
  resourcesOf(reviewedJournal)["source-video:inside-content:old"] = {
    videoId: uuid(557),
    providerVideoId: "late",
    sha256: "e".repeat(64),
  };
  await writeFile(
    join(setup.state, "journal.json"),
    canonical(reviewedJournal),
  );
  api.videos.set(uuid(557), {
    videoId: uuid(557),
    materialId: valueAt(api.materials, "inside-content:old").materialId,
    state: "ready",
    providerVideoId: "late",
    reconciles: 0,
  });
  await assert.rejects(
    applyRelease(clean.path, setup.state, { request: api.request }),
    /changed after the preview/u,
  );
  delete resourcesOf(reviewedJournal)["source-video:inside-content:old"];
  await writeFile(
    join(setup.state, "journal.json"),
    canonical(reviewedJournal),
  );

  const journalPath = join(setup.state, "journal.json");
  const journal = await readJournalFile(setup.state);
  resourcesOf(journal)["source-video:inside-content:lesson"] = {
    videoId: uuid(556),
    providerVideoId: "uploaded",
    sha256: "d".repeat(64),
  };
  await writeFile(journalPath, canonical(journal));
  setup.manifest.materials.push({
    ...itemAt(setup.manifest.materials, 2),
    sourceId: "extra",
    sourcePath: "extra.md",
    title: "extra",
  });
  setup.manifest.selection.materialIds.push("extra");
  itemAt(setup.manifest.products, 0).materialIds = [
    "video",
    "lesson",
    "old",
    "extra",
  ];
  itemAt(itemAt(setup.manifest.materials, 0).artifacts, 0).title = "Чек-лист 2";
  await setup.write();
  const next = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const lesson = next.preview.materials.find(
    (item) => item.sourceId === "lesson",
  );
  assert.ok(lesson);
  assert.equal(lesson.change, "changed");
  assert.equal(lesson.videoChange, true);
  assert.equal(
    next.preview.materials.find((item) => item.sourceId === "extra")?.change,
    "new",
  );
  assert.deepEqual(itemAt(next.preview.products, 0), {
    sourceId: "product",
    title: "Продукт",
    materials: 4,
    artifactChanges: ["checklist"],
    change: "composition",
    detailsChange: false,
    chapterTextChanges: 0,
    pageChange: false,
    added: 1,
    removed: 0,
    reorderedOrRegrouped: true,
  });
  itemAt(setup.manifest.products, 0).title = "Новое имя";
  await setup.write();
  const renamed = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.equal(itemAt(renamed.preview.products, 0).detailsChange, true);
  itemAt(setup.manifest.products, 0).slug = "product-moved";
  itemAt(setup.manifest.products, 0).presentation = "default";
  itemAt(setup.manifest.products, 0).page = {
    ...productPage,
    blocks: [{ ...itemAt(productPage.blocks, 0), lead: "Новый лид." }],
  };
  await setup.write();
  const redesigned = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.deepEqual(
    (({ pageChange, slugChange, presentationChange }) => ({
      pageChange,
      slugChange,
      presentationChange,
    }))(itemAt(redesigned.preview.products, 0)),
    {
      pageChange: true,
      slugChange: { from: "product", to: "product-moved" },
      presentationChange: { from: "ai-first-process", to: "default" },
    },
  );

  // Once the original names its own upload, the preview expects no video change.
  resourcesOf(journal)["source-video:inside-content:video"] = {
    videoId: valueAt(api.materials, "inside-content:video").primaryVideoId,
    providerVideoId: itemAt(setup.manifest.materials, 1).video?.kinescopeId,
    sha256: "f".repeat(64),
  };
  delete resourcesOf(journal)[
    `video:${valueAt(api.materials, "inside-content:video").materialId}:${itemAt(setup.manifest.materials, 1).video?.kinescopeId}`
  ];
  await writeFile(journalPath, canonical(journal));
  const named = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.equal(
    named.preview.materials.find((item) => item.sourceId === "video")?.change,
    "unchanged",
  );
  itemAt(setup.manifest.materials, 1).access = "free";
  await setup.write();
  const accessChanged = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const video = accessChanged.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.ok(video);
  // A protected recording serves either access, so the lesson keeps its Video (ADR 0041).
  assert.equal(video.change, "changed");
  assert.equal(video.conflictReason, undefined);
  assert.deepEqual(video.accessChange, { from: "closed", to: "free" });
  assert.equal(video.videoChange, undefined);
  // A new provider record replaces the Video without any access decision.
  itemAt(setup.manifest.materials, 1).video = { kinescopeId: uuid(778) };
  await setup.write();
  const newRecording = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const replaced = newRecording.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.ok(replaced);
  assert.equal(replaced.change, "changed");
  assert.equal(replaced.videoChange, true);
});

test("release preview reports an access change of a lesson with a Video like any other", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  itemAt(setup.manifest.materials, 1).access = "free";
  itemAt(setup.manifest.materials, 0).access = "free";
  await setup.write();
  const preview = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const attached = preview.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.ok(attached);
  assert.equal(attached.change, "changed");
  assert.equal(attached.conflictReason, undefined);
  assert.deepEqual(attached.accessChange, { from: "closed", to: "free" });
  const plain = preview.preview.materials.find(
    (item) => item.sourceId === "lesson",
  );
  assert.ok(plain);
  assert.equal(plain.change, "changed");
  assert.equal(plain.conflictReason, undefined);
  assert.deepEqual(plain.accessChange, { from: "closed", to: "free" });

  // A legacy journal entry without access still sees the target's current access.
  const journalPath = join(setup.state, "journal.json");
  const journal = await readJournalFile(setup.state);
  delete entryAt(journal.materials, "inside-content:video")["access"];
  await writeFile(journalPath, canonical(journal));
  const legacy = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.deepEqual(
    legacy.preview.materials.find((item) => item.sourceId === "video")
      ?.accessChange,
    { from: "closed", to: "free" },
  );

  itemAt(setup.manifest.materials, 1).video = { kinescopeId: uuid(779) };
  await setup.write();
  const replaced = (
    await previewRelease(setup.packagePath, setup.state, {
      publish: "all",
      origin,
      request: api.request,
    })
  ).preview.materials.find((item) => item.sourceId === "video");
  assert.ok(replaced);
  assert.equal(replaced.conflictReason, undefined);
  assert.deepEqual(replaced.accessChange, { from: "closed", to: "free" });
});

test("release preview reports the feed choice and the sync applies it once (#1885)", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const lesson = itemAt(setup.manifest.materials, 0);
  lesson.access = "free";
  await setup.write();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  // Только выбор ленты меняет строку: он входит в ревизию материала.
  lesson.inFeed = true;
  await setup.write();
  const preview = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const row = preview.preview.materials.find(
    (item) => item.sourceId === lesson.sourceId,
  );
  assert.ok(row);
  assert.equal(row.change, "changed");
  assert.equal(row.inFeed, true);
  assert.deepEqual(row.feedChange, { from: false, to: true });

  await run(setup, api);
  const applied = api.calls.findLast(
    (call) => call.path === "/authoring/import/materials/apply",
  );
  assert.equal(materialApplyRequest(applied ?? {})?.body["inFeed"], true);
  const settled = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const after = settled.preview.materials.find(
    (item) => item.sourceId === lesson.sourceId,
  );
  assert.equal(after?.change, "unchanged");
  assert.equal(after?.feedChange, undefined);
});

test("release preview refuses to close a public recording and any access change on an older target", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  const attachedVideo = valueAt(
    api.videos,
    valueAt(api.materials, "inside-content:video").primaryVideoId,
  );
  const preview = async () =>
    (
      await previewRelease(setup.packagePath, setup.state, {
        publish: "all",
        origin,
        request: api.request,
      })
    ).preview.materials.find((item) => item.sourceId === "video");

  // A recording in the public project plays without a token: the lesson opens but never closes.
  attachedVideo.protected = false;
  itemAt(setup.manifest.materials, 1).access = "free";
  await setup.write();
  const opened = await preview();
  assert.equal(opened?.change, "changed");
  assert.equal(opened?.conflictReason, undefined);
  const free = await applyRelease(
    (
      await previewRelease(setup.packagePath, setup.state, {
        publish: "all",
        origin,
        request: api.request,
      })
    ).path,
    setup.state,
    { request: api.request },
  );
  assert.ok(free);
  itemAt(setup.manifest.materials, 1).access = "closed";
  await setup.write();
  const closing = await preview();
  assert.equal(closing?.change, "conflict");
  assert.equal(closing?.conflictReason, "video_not_protected");

  // A target before ADR 0041 cannot change the access of a lesson with a Video at all.
  delete attachedVideo.protected;
  const older = await preview();
  assert.equal(older?.change, "conflict");
  assert.equal(older?.conflictReason, "video_access_change");
});

test("the local product view pins the transferred product on Home once", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const report = await run(setup, api, { pinHome: true });
  assert.equal(report.homePinned, productId);
  assert.deepEqual(api.pin, { productId: productId, version: 4 });
  await run(setup, api, { pinHome: true });
  assert.equal(api.pin.version, 4);
});

/** @param {ReturnType<typeof applicationApi>} api */
const applies = (api) =>
  api.calls.filter((call) => call.path === "/authoring/import/materials/apply");

test("an import keeps every original a private draft unless its publication is approved", async (t) => {
  const setup = await fixture(t);
  const lesson = itemAt(setup.manifest.materials, 0);
  lesson.markdown = "Смотрите [старый урок](old.md).";
  lesson.links = { "old.md": "old" };
  await setup.write();
  const api = applicationApi();

  const report = await run(setup, api, { publish: [] });
  for (const material of api.materials.values())
    assert.equal(material.publicationState, "draft");
  assert.ok(
    report.materials.every((item) => item.publicationState === "draft"),
  );
  // The checklist would be public by its Product placement, so it waits for a published owner.
  assert.equal(api.artifacts.size, 0);
  assert.ok(
    report.notices.some(
      (notice) => notice.code === "artifact_waits_publication",
    ),
  );

  // A repeated private import publishes nothing and writes nothing.
  const before = applies(api).length;
  const repeated = await run(setup, api, { publish: [] });
  assert.equal(applies(api).length, before);
  assert.equal(repeated.unchanged, 3);

  // An explicit approval publishes exactly the named original and brings its artifact along.
  const published = await run(setup, api, { publish: ["lesson"] });
  assert.equal(
    valueAt(api.materials, "inside-content:lesson").publicationState,
    "published",
  );
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "draft",
  );
  assert.equal(
    valueAt(api.materials, "inside-content:video").publicationState,
    "draft",
  );
  assert.equal(api.artifacts.size, 1);
  assert.ok(
    published.notices.some(
      (notice) =>
        notice.code === "link_to_draft" && notice.path === "lesson.md",
    ),
  );
  // A private draft that leaves the package was never public, so nothing is proposed to archive.
  setup.manifest.materials = setup.manifest.materials.filter(
    (row) => row.sourceId !== "old",
  );
  setup.manifest.selection.materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  lesson.markdown = "Текст";
  lesson.links = {};
  await setup.write();
  const after = await run(setup, api, { publish: ["lesson"] });
  assert.deepEqual(after.archiveProposals, []);
});

test("a private import stops before any Material write when the target is already public", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  itemAt(setup.manifest.materials, 0).markdown = "Новая редакция";
  await setup.write();
  // The product page changes too, so a late check would already have rewritten it.
  itemAt(setup.manifest.products, 0).title = "Новое имя продукта";
  await setup.write();
  const calls = api.calls.length;
  await assert.rejects(
    run(setup, api, { publish: ["video"] }),
    /lesson\.md: the Material is already published in Platform/u,
  );
  assert.deepEqual(
    api.calls
      .slice(calls)
      .filter((call) => call.method !== "GET")
      .map((call) => call.path)
      .filter((path) => !path.endsWith("/validate")),
    [],
  );
  assert.equal(
    valueAt(api.materials, "inside-content:lesson").publicationState,
    "published",
  );
  await assert.rejects(
    run(setup, api, { publish: ["missing"] }),
    /outside this package: inside-content:missing/u,
  );
});

test("a private lesson imports legacy requirements through Tasks without publishing or rewriting its original package", async (t) => {
  const setup = await fixture(t);
  const lesson = itemAt(setup.manifest.materials, 0);
  setup.manifest.practiceDefinitions = [
    {
      practiceId: "inside-content:lesson-brief",
      definition: {
        schemaVersion: 1,
        title: "Brief",
        businessInputs: "Original situation",
        expectedOutcome: "Я".repeat(16000),
        allowedFreedom: "Original freedom",
        criteria: [
          {
            id: "evidence",
            requirement: "Original requirement",
            acceptableEvidence: ["Original evidence"],
          },
        ],
      },
      sourceReference: {
        materialSourceId: "inside-content:lesson",
        materialSourceRevision: materialRevision(setup.manifest, lesson),
      },
      provenance: {
        repository: "sachkov-inside/inside-content",
        commit: "b".repeat(40),
        path: "lesson-brief.json",
      },
      publicationState: "published",
    },
  ];
  const product = itemAt(setup.manifest.products, 0);
  product.chapters = [
    {
      sourceId: "chapter",
      title: "Chapter",
      summary: "",
      materialIds: [...product.materialIds],
    },
  ];
  await setup.write();
  const originalBytes = await readFile(setup.packagePath, "utf8");
  const api = applicationApi();
  /** @type {unknown[]} */
  const taskBodies = [];
  /** @type {unknown[]} */
  const writes = [];
  /** @type {LocalTransport} */
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === "/authoring/import/materials/state?namespace=inside-content")
      return { namespace: "inside-content", materials: [] };
    if (path === "/authoring/import/tasks/state?namespace=inside-content")
      return { namespace: "inside-content", tasks: [] };
    if (path === "/authoring/import/tasks/validate") {
      taskBodies.push(body);
      return { valid: true, current: null };
    }
    if (path === "/authoring/import/tasks/apply") {
      taskBodies.push(body);
      writes.push(body);
      const command = z
        .object({
          code: z.string(),
          definition: z.record(z.string(), z.json()),
          publicationState: z.enum(["published", "unpublished"]),
        })
        .passthrough()
        .parse(body);
      return {
        taskId: uuid(990),
        code: command.code,
        revision: 1,
        currentVersion: 1,
        definitionDigest: "c".repeat(64),
        publicationState: command.publicationState,
      };
    }
    return api.request(path, body, key, options);
  };
  await run(setup, { request }, { publish: [] });
  assert.ok(taskBodies.length >= 2);
  assert.equal(await readFile(setup.packagePath, "utf8"), originalBytes);
  assert.equal(
    api.calls.some((call) =>
      call.path.startsWith("/authoring/import/practices/"),
    ),
    false,
  );
  // Task validation reads authored intent; only the actual apply may publish.
  assert.equal(writes.length, 1);
  for (const body of writes)
    assert.equal(
      z.object({ publicationState: z.string() }).passthrough().parse(body)
        .publicationState,
      "unpublished",
    );
  assert.deepEqual(
    z
      .object({ definition: z.object({ result: z.array(z.string()) }) })
      .parse(writes[0]).definition.result,
    ["Я".repeat(16000)],
  );
});

test("preview shows each publication and apply follows only the reviewed approval", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const origin = resolveLocalTarget("editor");
  await run(setup, api, { publish: [] });

  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
    publish: ["video"],
  });
  assert.deepEqual(reviewed.preview.publish, ["inside-content:video"]);
  const video = reviewed.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.deepEqual(video?.["publicationChange"], {
    from: "draft",
    to: "published",
  });
  assert.equal(video?.change, "changed");
  const lessonRow = reviewed.preview.materials.find(
    (item) => item.sourceId === "lesson",
  );
  assert.equal(lessonRow?.change, "unchanged");

  await applyRelease(reviewed.path, setup.state, { request: api.request });
  assert.equal(
    valueAt(api.materials, "inside-content:video").publicationState,
    "published",
  );
  assert.equal(
    valueAt(api.materials, "inside-content:lesson").publicationState,
    "draft",
  );

  // Once public, a private preview names the conflict and apply refuses it.
  const privatePreview = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  const conflict = privatePreview.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.equal(conflict?.change, "conflict");
  assert.equal(conflict?.["conflictReason"], "target_not_draft");
  await assert.rejects(
    applyRelease(privatePreview.path, setup.state, { request: api.request }),
    /contains conflicts/u,
  );
});

/**
 * A private import of three drafts, then another session unpublishes `old` on the target.
 *
 * @param {import("node:test").TestContext} t
 */
async function unpublishedByAnotherSession(t) {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api, { publish: [] });
  const old = valueAt(api.materials, "inside-content:old");
  // The publication write bumps the version; this journal never saw it.
  old.publicationState = "unpublished";
  old.contentVersion++;
  // The package edits both texts; only the lesson may change.
  itemAt(setup.manifest.materials, 0).markdown = "Новая редакция урока";
  itemAt(setup.manifest.materials, 2).markdown = "Новая редакция старого";
  await setup.write();
  return { setup, api, old };
}

test("a private release keeps an unpublished Material as the target holds it and keeps it in the Product", async (t) => {
  const { setup, api, old } = await unpublishedByAnotherSession(t);
  const origin = resolveLocalTarget("editor");
  const before = structuredClone(old);
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  const kept = reviewed.preview.materials.find(
    (item) => item.sourceId === "old",
  );
  assert.equal(kept?.change, "kept");
  assert.equal(kept?.["publicationKept"], "unpublished");
  assert.equal(kept?.["conflictReason"], undefined);
  assert.equal(kept?.["publicationChange"], undefined);
  assert.equal(kept?.["contentReplacement"], undefined);
  assert.equal(reviewed.summary["kept"], 1);
  assert.equal(reviewed.summary["conflict"], 0);
  assert.equal(
    reviewed.preview.expected["inside-content:old"],
    before.contentVersion,
  );

  const calls = api.calls.length;
  await applyRelease(reviewed.path, setup.state, { request: api.request });
  const writes = api.calls.slice(calls).filter((call) => call.method !== "GET");
  assert.deepEqual(
    writes.filter((call) => JSON.stringify(call).includes(old.materialId)),
    // Only the composition names the kept Material, by its existing target id.
    writes.filter(
      (call) => call.path === "/authoring/import/products/composition",
    ),
  );
  assert.deepEqual(
    applies(api)
      .slice(-1)
      .map(
        (call) =>
          z
            .object({ source: z.object({ id: z.string() }) })
            .passthrough()
            .parse(call.body).source.id,
      ),
    ["inside-content:lesson"],
  );
  assert.deepEqual(valueAt(api.materials, "inside-content:old"), before);
  assert.deepEqual(
    api.product.members,
    ["lesson", "video", "old"].map(
      (id) => valueAt(api.materials, `inside-content:${id}`).materialId,
    ),
  );

  // The sync shares the rule: no write, and the report names what it kept.
  itemAt(setup.manifest.materials, 0).markdown = "Третья редакция урока";
  await setup.write();
  const report = await run(setup, api, { publish: [] });
  assert.deepEqual(valueAt(api.materials, "inside-content:old"), before);
  assert.equal(report.kept, 1);
  assert.equal(report.applied, 1);
  assert.equal(report.unchanged, 1);
  assert.equal(
    report.materials.find((item) => item.sourceId === "old")?.publicationState,
    "unpublished",
  );
  assert.ok(
    report.notices.some(
      (notice) =>
        notice.code === "material_kept_unpublished" && notice.path === "old.md",
    ),
  );
});

test("a release converges with a kept Material placed in two chapters", async (t) => {
  const { setup, api, old } = await unpublishedByAnotherSession(t);
  const product = itemAt(setup.manifest.products, 0);
  product.materialIds = ["old", "lesson", "video"];
  product.chapters = [
    { sourceId: "first", title: "Первая", summary: "", materialIds: ["old"] },
    {
      sourceId: "second",
      title: "Вторая",
      summary: "",
      materialIds: ["lesson", "video", "old"],
    },
  ];
  await setup.write();
  const compositionSchema = z.object({
    chapters: z.array(
      z.object({ id: z.uuid(), name: z.string(), summary: z.string() }),
    ),
    programmePlacements: z.array(
      z.object({
        id: z.uuid(),
        materialId: z.uuid(),
        chapterId: z.uuid().nullable(),
        stepGroup: z.string().nullable(),
      }),
    ),
  });
  /** @type {z.infer<typeof compositionSchema>} */
  let composition = { chapters: [], programmePlacements: [] };
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === `/authoring/products/${productId}/order`) {
      // The receiver projects catalogue entries from each Material's first programme placement.
      /** @type {Map<string, (typeof composition.programmePlacements)[number]>} */
      const first = new Map();
      for (const placement of composition.programmePlacements)
        if (!first.has(placement.materialId))
          first.set(placement.materialId, placement);
      return {
        orderVersion: checksum(canonical(composition)),
        ...structuredClone(composition),
        items: (api.product.members ?? []).map((materialId) => ({
          materialId,
          chapterId: first.get(materialId)?.chapterId ?? null,
        })),
      };
    }
    const result = await api.request(path, body, key, options);
    if (path === "/authoring/import/products/composition") {
      composition = compositionSchema.parse(body);
      return { orderVersion: checksum(canonical(composition)) };
    }
    return result;
  };
  const options = { origin: resolveLocalTarget("editor"), request };
  const reviewed = await previewRelease(
    setup.packagePath,
    setup.state,
    options,
  );
  await applyRelease(reviewed.path, setup.state, { request });
  const clean = await previewRelease(setup.packagePath, setup.state, options);
  assert.equal(
    clean.preview.materials.find((row) => row.sourceId === "old")?.change,
    "kept",
  );
  assert.equal(itemAt(clean.preview.products, 0).change, "unchanged");
  assert.equal(itemAt(clean.preview.products, 0).reorderedOrRegrouped, false);
  const before = applies(api).length;
  const repeated = await applyRelease(clean.path, setup.state, { request });
  assert.equal(repeated.applied, 0);
  assert.equal(applies(api).length, before);
  const again = await previewRelease(setup.packagePath, setup.state, options);
  assert.equal(itemAt(again.preview.products, 0).change, "unchanged");
  assert.equal(old.publicationState, "unpublished");

  // A real move of the repeated position still changes the reviewed programme.
  itemAt(composition.programmePlacements, 3).chapterId = itemAt(
    composition.chapters,
    0,
  ).id;
  const moved = await previewRelease(setup.packagePath, setup.state, options);
  assert.equal(itemAt(moved.preview.products, 0).change, "composition");
  assert.equal(itemAt(moved.preview.products, 0).reorderedOrRegrouped, true);
});

test("a release ignores catalogue ordering outside the programme", async (t) => {
  const setup = await fixture(t);
  const product = itemAt(setup.manifest.products, 0);
  product.materialIds = ["lesson"];
  product.supplementaryMaterialIds = ["old", "video"];
  await setup.write();
  const api = applicationApi();
  /** @type {{ id: string; materialId: string; chapterId: null; stepGroup: null }[]} */
  let programmePlacements = [];
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === `/authoring/products/${productId}/order`) {
      const main = programmePlacements.map((entry) => entry.materialId);
      const extras = (api.product.members ?? [])
        .filter((id) => !main.includes(id))
        .sort();
      return {
        orderVersion: checksum(canonical({ programmePlacements, extras })),
        programmePlacements,
        chapters: [],
        items: [...main, ...extras].map((materialId) => ({
          materialId,
          chapterId: null,
        })),
      };
    }
    const result = await api.request(path, body, key, options);
    if (path === "/authoring/import/products/composition") {
      programmePlacements = z
        .object({
          programmePlacements: z.array(
            z.object({
              id: z.uuid(),
              materialId: z.uuid(),
              chapterId: z.null(),
              stepGroup: z.null(),
            }),
          ),
        })
        .parse(body).programmePlacements;
    }
    return result;
  };
  await run(setup, { request });
  const old = valueAt(api.materials, "inside-content:old");
  old.publicationState = "unpublished";
  old.contentVersion++;
  const options = {
    origin: resolveLocalTarget("editor"),
    publish: ["lesson", "video"],
    request,
  };
  const clean = await previewRelease(setup.packagePath, setup.state, options);
  assert.equal(itemAt(clean.preview.products, 0).change, "unchanged");
  assert.equal(itemAt(clean.preview.products, 0).reorderedOrRegrouped, false);
  await applyRelease(clean.path, setup.state, { request });
  const again = await previewRelease(setup.packagePath, setup.state, options);
  assert.equal(itemAt(again.preview.products, 0).change, "unchanged");
  assert.equal(itemAt(again.preview.products, 0).added, 0);
  assert.equal(itemAt(again.preview.products, 0).removed, 0);
});

test("drift on a kept Material after the preview stops apply before any write", async (t) => {
  /** @type {Record<string, (material: FakeMaterial) => void>} */
  const drifts = {
    republished: (material) => {
      material.publicationState = "published";
      material.contentVersion++;
    },
    "body edited": (material) => {
      material.contentVersion++;
    },
  };
  for (const [name, drift] of Object.entries(drifts)) {
    const { setup, api, old } = await unpublishedByAnotherSession(t);
    const reviewed = await previewRelease(setup.packagePath, setup.state, {
      origin: resolveLocalTarget("editor"),
      request: api.request,
    });
    drift(old);
    const calls = api.calls.length;
    await assert.rejects(
      applyRelease(reviewed.path, setup.state, { request: api.request }),
      /environment changed after the preview/u,
      name,
    );
    assert.deepEqual(
      api.calls
        .slice(calls)
        .filter(
          (call) => call.method !== "GET" && !call.path.endsWith("/validate"),
        ),
      [],
      name,
    );
  }
});

test("an explicit approval publishes an unpublished Material; a published one still needs it", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const origin = resolveLocalTarget("editor");
  await run(setup, api);
  // The original leaves, is unpublished on request, then returns to the package.
  const rows = setup.manifest.materials;
  setup.manifest.materials = rows.filter((row) => row.sourceId !== "old");
  setup.manifest.selection.materialIds = ["lesson", "video"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video"];
  await setup.write();
  await run(setup, api, { archive: ["old"] });
  setup.manifest.materials = rows;
  setup.manifest.selection.materialIds = ["lesson", "video", "old"];
  itemAt(setup.manifest.products, 0).materialIds = ["lesson", "video", "old"];
  await setup.write();

  const withoutVideo = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
    publish: ["lesson", "old"],
  });
  const video = withoutVideo.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.equal(video?.change, "conflict");
  assert.equal(video?.["conflictReason"], "target_not_draft");

  const keeping = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
    publish: ["lesson", "video"],
  });
  assert.equal(
    keeping.preview.materials.find((item) => item.sourceId === "old")?.change,
    "kept",
  );

  const publishing = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
    publish: ["lesson", "video", "old"],
  });
  const old = publishing.preview.materials.find(
    (item) => item.sourceId === "old",
  );
  assert.deepEqual(old?.["publicationChange"], {
    from: "unpublished",
    to: "published",
  });
  assert.equal(publishing.summary["conflict"], 0);
  await applyRelease(publishing.path, setup.state, { request: api.request });
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "published",
  );
});

test("a journal that missed a publication still stops a private import", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api, { publish: [] });
  // Another state directory published the lesson; this journal still records a draft.
  valueAt(api.materials, "inside-content:lesson").publicationState =
    "published";
  await assert.rejects(
    run(setup, api, { publish: [] }),
    /lesson\.md: the Material is already published/u,
  );
});

test("an interrupted publication resumes only with the same approval", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api, { publish: [] });
  itemAt(setup.manifest.materials, 2).markdown = "Новая редакция";
  await setup.write();
  const request = api.request;
  let failed = false;
  /** @type {LocalTransport} */
  const lossy = async (path, body, key, options) => {
    if (path === "/authoring/import/materials/apply" && !failed) {
      failed = true;
      throw Object.assign(new Error("connection lost"), { status: 503 });
    }
    return request(path, body, key, options);
  };
  await assert.rejects(run(setup, { request: lossy }, { publish: ["old"] }));
  await assert.rejects(
    run(setup, api, { publish: [] }),
    /old\.md: an interrupted transfer was publishing this Material/u,
  );
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "draft",
  );
  await run(setup, api, { publish: ["old"] });
  assert.equal(
    valueAt(api.materials, "inside-content:old").publicationState,
    "published",
  );
});

test("Product Tasks travel after their Product in sync and in an exact release, published only by approval", async (t) => {
  const setup = await fixture(t);
  const product = itemAt(setup.manifest.products, 0);
  product.chapters = [
    {
      sourceId: "chapter-one",
      title: "Глава 1",
      summary: "",
      materialIds: [...product.materialIds],
    },
  ];
  /** @param {string} sourceId */
  const task = (sourceId) => ({
    sourceId,
    productId: "product",
    chapterId: "chapter-one",
    title: `Задание ${sourceId}`,
    access: /** @type {const} */ ("free"),
    definition: { schemaVersion: 1, situation: sourceId },
    relatedMaterialIds: ["lesson"],
    publicationState: /** @type {const} */ ("published"),
    provenance: {
      repository: "sachkov-inside/inside-content",
      commit: "b".repeat(40),
      path: `tasks/${sourceId}.yaml`,
    },
  });
  setup.manifest.tasks = [task("task-one"), task("task-two")];
  await setup.write();
  const api = applicationApi();
  /** @type {Map<string, { taskId: string; code: string; revision: number; currentVersion: number; definitionDigest: string; publicationState: "published" | "unpublished" }>} */
  const tasks = new Map();
  /** @type {Record<string, unknown>[]} */
  const applied = [];
  /** @type {LocalTransport} */
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === "/authoring/import/tasks/validate") {
      const { code } = z.object({ code: z.string() }).passthrough().parse(body);
      return { valid: true, current: tasks.get(code) ?? null };
    }
    if (path === "/authoring/import/tasks/apply") {
      const command = z
        .object({
          code: z.string(),
          productId: z.string(),
          position: z.number(),
          publicationState: z.enum(["published", "unpublished"]),
          expectedRevision: z.number().nullable(),
        })
        .passthrough()
        .parse(body);
      applied.push(command);
      const previous = tasks.get(command.code);
      assert.equal(command.expectedRevision, previous?.revision ?? null);
      const receipt = {
        taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        code: command.code,
        revision: (previous?.revision ?? 0) + 1,
        currentVersion: 1,
        definitionDigest: "c".repeat(64),
        publicationState: command.publicationState,
      };
      tasks.set(command.code, receipt);
      return receipt;
    }
    return api.request(path, body, key, options);
  };
  const report = await run(setup, { request }, { publish: [] });
  assert.deepEqual(
    applied.map((body) => [
      body["code"],
      body["position"],
      body["publicationState"],
    ]),
    [
      ["task-one", 1, "unpublished"],
      ["task-two", 2, "unpublished"],
    ],
  );
  assert.equal(applied[0]?.["productId"], api.product.id);
  assert.deepEqual(
    report.tasks?.map((item) => item.change),
    ["new", "new"],
  );

  // A release publishes exactly the reviewed selection: one task by its code.
  const origin = resolveLocalTarget("editor");
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request,
    publish: ["task-one"],
  });
  const previewTasks = z
    .array(z.object({ sourceId: z.string(), change: z.string() }).passthrough())
    .parse(reviewed.preview["tasks"]);
  assert.deepEqual(
    previewTasks.map((item) => [
      item.sourceId,
      item.change,
      item["publication"],
    ]),
    [
      ["task-one", "changed", "published"],
      ["task-two", "unchanged", "unpublished"],
    ],
  );
  const writes = applied.length;
  assert.equal(writes, 2, "preview writes nothing");
  await applyRelease(reviewed.path, setup.state, { request });
  assert.equal(tasks.get("task-one")?.publicationState, "published");
  assert.equal(tasks.get("task-two")?.publicationState, "unpublished");
  assert.equal(applied.length, writes + 1);
});

test("imports source introduction and preserves it when an older package omits the field", async (t) => {
  const setup = await fixture(t);
  setup.manifest.schemaVersion = 2;
  setup.manifest.requiredFeatures = [];
  setup.manifest.selection.taskIds = [];
  const product = itemAt(setup.manifest.products, 0);
  product.introduction = {
    audience: "Инженерам",
    outcome: "Рабочий проект",
    prerequisites: "TypeScript",
    scope: "Практика",
  };
  await setup.write();
  const api = applicationApi();
  await run(setup, api);
  const update = api.calls.find(
    ({ path }) => path === "/authoring/import/products/update",
  );
  assert.deepEqual(
    productUpdateBodySchema.parse(update?.body).introduction,
    product.introduction,
  );
  const calls = api.calls.length;
  await run(setup, api);
  assert.equal(
    api.calls
      .slice(calls)
      .some(({ path }) => path === "/authoring/import/products/update"),
    false,
  );
  delete product.introduction;
  product.title = "Старый пакет меняет название";
  await setup.write();
  await run(setup, api);
  assert.deepEqual(api.product.introduction, {
    audience: "Инженерам",
    outcome: "Рабочий проект",
    prerequisites: "TypeScript",
    scope: "Практика",
  });
});

test("reviewed Product removal choice changes the fingerprint and survives partial release", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  // Keep this tracer focused on composition after Materials committed successfully.
  setup.manifest.materials = [itemAt(setup.manifest.materials, 2)];
  setup.manifest.selection.materialIds = ["old"];
  itemAt(setup.manifest.products, 0).materialIds = ["old"];
  itemAt(setup.manifest.products, 0).chapters = [
    {
      sourceId: "chapter",
      title: "Chapter",
      summary: "",
      materialIds: ["old"],
    },
  ];
  setup.manifest.tasks = [
    {
      sourceId: "task-one",
      productId: "product",
      chapterId: "chapter",
      title: "Task",
      access: "free",
      relatedMaterialIds: [],
      publicationState: "published",
      definition: { schemaVersion: 1, situation: "Synthetic task" },
      provenance: {
        repository: "synthetic/content",
        commit: "a".repeat(40),
        path: "task.yaml",
      },
    },
  ];
  await setup.write();
  api.product.members = [uuid(700)];
  /** @type {{ key: string | undefined; body: unknown }[]} */
  const compositionCalls = [];
  let taskWrites = 0;
  let loseCompositionResponse = false;
  /** @type {z.infer<typeof taskReceiptSchema> | null} */
  let taskReceipt = null;
  /** @type {{ id: string; name: string; summary: string }[]} */
  let chapters = [];
  const orderVersion = () =>
    checksum(canonical({ members: api.product.members, chapters }));
  /** @type {LocalTransport} */
  const request = async (path, body, key, options) => {
    if (path === `/authoring/products/${productId}/order`)
      return {
        orderVersion: orderVersion(),
        chapters,
        items: (api.product.members ?? []).map((materialId) => ({
          materialId,
          chapterId: chapters[0]?.id ?? null,
        })),
      };
    if (path === "/authoring/import/tasks/validate")
      return { valid: true, current: taskReceipt, migration: null };
    if (path === "/authoring/import/tasks/apply") {
      taskWrites++;
      taskReceipt = taskReceiptSchema.parse({
        taskId: uuid(800),
        code: "task-one",
        revision: 1,
        currentVersion: 1,
        definitionDigest: "a".repeat(64),
        publicationState: "published",
      });
      return taskReceipt;
    }
    if (path === "/authoring/import/products/composition") {
      const command = z
        .object({ confirmedProductRemovals: z.array(z.string()).optional() })
        .passthrough()
        .parse(body);
      compositionCalls.push({ key, body: structuredClone(body) });
      if (!command.confirmedProductRemovals?.includes(productId))
        throw Object.assign(
          new Error("product_removal_confirmation_required"),
          { status: 409 },
        );
      await api.request(path, body, key, options);
      chapters = z
        .object({
          chapters: z.array(
            z.object({ id: z.string(), name: z.string(), summary: z.string() }),
          ),
        })
        .passthrough()
        .parse(body).chapters;
      if (loseCompositionResponse) {
        loseCompositionResponse = false;
        throw new Error("composition response lost after commit");
      }
      return { orderVersion: orderVersion() };
    }
    return api.request(path, body, key, options);
  };
  const options = {
    origin: "http://127.0.0.1:4396",
    publish: /** @type {const} */ ("all"),
    request,
  };
  const original = await previewRelease(
    setup.packagePath,
    setup.state,
    options,
  );
  await assert.rejects(
    applyRelease(original.path, setup.state, { request }),
    /product_removal_confirmation_required/u,
  );
  const before = await readJournalFile(setup.state);
  assert.equal(taskWrites, 0);
  const materialWrites = api.count(/materials\/apply/u);
  const rejected = Object.entries(before.operations).filter(
    ([, operation]) =>
      isJournalOperation(operation) && operation.status === "rejected",
  );
  assert.equal(rejected.length, 1);
  assert.equal(itemAt(compositionCalls, 0).key, itemAt(rejected, 0)[0]);

  const unconfirmed = await previewRelease(
    setup.packagePath,
    setup.state,
    options,
  );
  const confirmed = await previewRelease(setup.packagePath, setup.state, {
    ...options,
    confirmedProductRemovals: [productId],
  });
  assert.deepEqual(confirmed.preview.confirmedProductRemovals, [productId]);
  assert.notEqual(
    confirmed.preview.fingerprint,
    unconfirmed.preview.fingerprint,
  );
  assert.equal(itemAt(confirmed.preview.materials, 0).change, "unchanged");
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      ...options,
      confirmedProductRemovals: [uuid(901)],
    }),
    /outside this package's target scope/u,
  );
  await assert.rejects(
    run(
      setup,
      { request },
      {
        reviewedProductRemovals: [productId],
      },
    ),
    /require a reviewed release/u,
  );
  const tamperedPath = join(setup.state, "tampered.json");
  await writeFile(
    tamperedPath,
    canonical({ ...confirmed.preview, confirmedProductRemovals: [uuid(901)] }),
  );
  await assert.rejects(
    applyRelease(tamperedPath, setup.state, { request }),
    /changed after review/u,
  );
  const version = api.product.version;
  api.product.version++;
  await assert.rejects(
    applyRelease(confirmed.path, setup.state, { request }),
    /environment changed/u,
  );
  api.product.version = version;
  await applyRelease(confirmed.path, setup.state, { request });
  assert.equal(api.count(/materials\/apply/u), materialWrites);
  assert.equal(api.materials.size, 1);
  assert.deepEqual(api.product.members, [uuid(1)]);
  assert.equal(taskWrites, 1);
  const after = await readJournalFile(setup.state);
  for (const [key, operation] of Object.entries(before.operations))
    assert.deepEqual(after.operations[key], operation);
  assert.notEqual(
    itemAt(compositionCalls, 0).key,
    itemAt(compositionCalls, 1).key,
  );
  const repeat = await previewRelease(setup.packagePath, setup.state, {
    ...options,
    confirmedProductRemovals: [productId],
  });
  await applyRelease(repeat.path, setup.state, { request });
  assert.equal(api.materials.size, 1);
  assert.equal(api.count(/materials\/apply/u), materialWrites);
  assert.equal(taskWrites, 1);
  // A target may return to its previous composition hash; an old success is not its actual state.
  const committed = await readJournalFile(setup.state);
  api.product.members = [uuid(700)];
  chapters = [];
  const restored = await previewRelease(setup.packagePath, setup.state, {
    ...options,
    confirmedProductRemovals: [productId],
  });
  loseCompositionResponse = true;
  await assert.rejects(
    applyRelease(restored.path, setup.state, { request }),
    /composition response lost/u,
  );
  const lost = itemAt(compositionCalls, compositionCalls.length - 1);
  assert.notEqual(lost.key, itemAt(compositionCalls, 1).key);
  await assert.rejects(
    applyRelease(unconfirmed.path, setup.state, { request }),
    /interrupted composition requires/u,
  );
  const callsBeforeReplay = compositionCalls.length;
  await assert.rejects(
    applyRelease(restored.path, setup.state, { request }),
    /environment changed/u,
  );
  assert.equal(compositionCalls.length, callsBeforeReplay + 1);
  assert.ok(lost.key);
  const replayedOperation = entryAt(
    (await readJournalFile(setup.state)).operations,
    lost.key,
  );
  assert.ok(isJournalOperation(replayedOperation));
  assert.equal(replayedOperation.status, "applied");
  const replay = itemAt(compositionCalls, compositionCalls.length - 1);
  assert.equal(replay.key, lost.key);
  assert.deepEqual(replay.body, lost.body);
  const recovered = await previewRelease(setup.packagePath, setup.state, {
    ...options,
    confirmedProductRemovals: [productId],
  });
  await applyRelease(recovered.path, setup.state, { request });
  assert.deepEqual(api.product.members, [uuid(1)]);
  const resumed = await readJournalFile(setup.state);
  for (const [key, operation] of Object.entries(committed.operations))
    assert.deepEqual(resumed.operations[key], operation);
  assert.equal(taskWrites, 1);
  assert.equal(api.count(/materials\/apply/u), materialWrites);
});

test("binds an inline source reference to a current-file route and keeps ordinary reading links", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.materials, 0).markdown =
    "[Читать бриф](https://example.test/brief)\n\n[Скачать бриф (.md)](artifact:checklist)";
  await setup.write();
  const api = applicationApi();
  await run(setup, api);
  const command = api.calls
    .map((call) => materialApplyRequest(call)?.body)
    .find((item) => item?.source.id === "inside-content:lesson");
  assert.ok(command);
  const body = JSON.stringify(command.body);
  assert.ok(
    body.includes(
      `/api/products/${productId}/artifact-sources/inside-content%3Achecklist/file`,
    ),
  );
  assert.ok(body.includes("https://example.test/brief"));
  assert.equal(body.includes("artifact:checklist"), false);
  assert.equal(body.includes("?version="), false);
});
test("refuses an undeclared artifact reference", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.materials, 0).markdown = "[Скачать](artifact:missing)";
  await setup.write();
  await assert.rejects(
    run(setup, applicationApi()),
    /unresolved or ambiguous artifact reference/u,
  );
});
test("keeps old packages valid and reapplies a changed filename without changed bytes", async (t) => {
  const setup = await fixture(t);
  const artifact = itemAt(itemAt(setup.manifest.materials, 0).artifacts, 0);
  delete artifact.filename;
  await setup.write();
  const api = applicationApi();
  await run(setup, api);
  assert.equal(
    valueAt(api.artifacts, "inside-content:checklist").filename,
    "checklist.md",
  );
  artifact.filename = "customer-brief.md";
  await setup.write();
  await run(setup, api);
  assert.equal(
    valueAt(api.artifacts, "inside-content:checklist").filename,
    "customer-brief.md",
  );
});

/**
 * Moves the fixture to package v2 with the course topics feature (#2022).
 *
 * @param {Awaited<ReturnType<typeof fixture>>} setup
 * @param {NonNullable<import("./package.mjs").ManifestProduct["topics"]>} topics
 */
async function writeTopics(setup, topics) {
  setup.manifest.schemaVersion = 2;
  setup.manifest.requiredFeatures = ["product-topics-v1"];
  setup.manifest.selection.taskIds = [];
  itemAt(setup.manifest.products, 0).topics = topics;
  await setup.write();
}

test("course topics travel with the Product: absent topics stay untouched, present ones are reviewed and written once", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const manual = {
    id: uuid(950),
    name: "Ручная",
    summary: "",
    materialIds: [],
  };
  api.product.topics = [manual];
  const origin = "http://127.0.0.1:4396";
  const topicWrites = () =>
    api.calls.filter((call) => call.path.endsWith("/topics"));

  // A package from an older exporter names no topics: the target keeps its own.
  await run(setup, api);
  assert.deepEqual(topicWrites(), []);
  const untouched = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const before = itemAt(untouched.preview.products, 0);
  assert.equal(before.change, "unchanged");
  assert.equal(before.topicListChange, undefined);
  assert.equal(before.topicChanges, undefined);

  await writeTopics(setup, [
    {
      sourceId: "basics",
      title: " Основы ",
      summary: "Кратко ",
      materialIds: ["video", "lesson"],
    },
    { sourceId: "extra", title: "Ещё", summary: "", materialIds: [] },
  ]);
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const listed = itemAt(reviewed.preview.products, 0);
  assert.equal(listed.change, "composition");
  assert.deepEqual(listed.topicListChange, { added: 2, removed: 1 });
  assert.equal(listed.topicChanges, undefined);

  await applyRelease(reviewed.path, setup.state, { request: api.request });
  // The topics write expects the version the composition returned.
  const expectedOrderVersion = checksum(
    canonical({ members: api.product.members, topics: [manual] }),
  );
  const material = (/** @type {string} */ id) =>
    valueAt(api.materials, `inside-content:${id}`).materialId;
  const topicId = (/** @type {string} */ id) =>
    sourceUuid(`inside-content:product:topic:${id}`);
  assert.deepEqual(
    topicWrites().map(({ method, body }) => ({ method, body })),
    [
      {
        method: "PUT",
        body: {
          expectedOrderVersion,
          topics: [
            {
              id: topicId("basics"),
              name: "Основы",
              summary: "Кратко",
              materialIds: [material("video"), material("lesson")],
            },
            {
              id: topicId("extra"),
              name: "Ещё",
              summary: "",
              materialIds: [],
            },
          ],
        },
      },
    ],
  );
  // A topic ID never repeats the chapter ID of the same source key.
  assert.notEqual(
    topicId("basics"),
    sourceUuid("inside-content:product:chapter:basics"),
  );

  const settled = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const after = itemAt(settled.preview.products, 0);
  assert.equal(after.change, "unchanged");
  assert.equal(after.topicListChange, undefined);
  assert.equal(after.topicChanges, undefined);
  await run(setup, api);
  assert.equal(topicWrites().length, 1);

  // A renamed topic or a moved Material is a change of a kept topic.
  const [basics] = itemAt(setup.manifest.products, 0).topics ?? [];
  assert.ok(basics);
  basics.materialIds = ["lesson"];
  await setup.write();
  const moved = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  const changed = itemAt(moved.preview.products, 0);
  assert.equal(changed.change, "composition");
  assert.equal(changed.topicListChange, undefined);
  assert.equal(changed.topicChanges, 1);
});

test("an empty topic list clears the target's topics, and a stale order stops the write", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await writeTopics(setup, []);
  await run(setup, api);
  // A receiver that reports no topics yet holds none, so an empty list writes nothing.
  assert.equal(api.count(/\/topics$/u), 0);

  api.product.topics = [
    { id: uuid(951), name: "Ручная", summary: "", materialIds: [] },
  ];
  const origin = "http://127.0.0.1:4396";
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin,
    request: api.request,
  });
  assert.deepEqual(itemAt(reviewed.preview.products, 0).topicListChange, {
    added: 0,
    removed: 1,
  });
  await applyRelease(reviewed.path, setup.state, { request: api.request });
  assert.deepEqual(api.product.topics, []);

  // Another writer changes the topics between the order read and the write.
  await writeTopics(setup, [
    { sourceId: "basics", title: "Основы", summary: "", materialIds: [] },
  ]);
  const request = api.request;
  /** @type {LocalTransport} */
  const racing = async (path, body, key, options) => {
    if (path.endsWith("/topics"))
      api.product.topics = [
        { id: uuid(952), name: "Чужая", summary: "", materialIds: [] },
      ];
    return request(path, body, key, options);
  };
  await assert.rejects(
    run(setup, { request: racing }),
    /Product product: stale_product_order/u,
  );
});

test("a topics edit after the reviewed preview stops apply before the composition write", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  api.product.topics = [];
  await run(setup, api);
  await writeTopics(setup, [
    { sourceId: "basics", title: "Основы", summary: "", materialIds: [] },
  ]);
  const reviewed = await previewRelease(setup.packagePath, setup.state, {
    publish: "all",
    origin: "http://127.0.0.1:4396",
    request: api.request,
  });
  const request = api.request;
  let edited = false;
  let editedAt = 0;
  /** @type {LocalTransport} */
  const editing = async (path, body, key, options) => {
    // The first Product reservation comes after apply has checked the preview again.
    if (path === "/authoring/import/products/reserve" && !edited) {
      edited = true;
      editedAt = api.calls.length;
      api.product.topics = [
        { id: uuid(953), name: "Админ", summary: "", materialIds: [] },
      ];
    }
    return request(path, body, key, options);
  };
  await assert.rejects(
    applyRelease(reviewed.path, setup.state, { request: editing }),
    /Product product: The Product topics changed after the preview/u,
  );
  assert.ok(edited);
  assert.deepEqual(
    api.calls
      .slice(editedAt)
      .filter(
        (call) =>
          call.path.endsWith("/topics") ||
          call.path === "/authoring/import/products/composition",
      ),
    [],
  );
  assert.deepEqual(
    api.product.topics.map((topic) => topic.name),
    ["Админ"],
  );
});
