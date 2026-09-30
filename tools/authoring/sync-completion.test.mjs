// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { loopbackOrigin, resolveLocalTarget } from "./target.mjs";
import { applyRelease, previewRelease } from "./release.mjs";
import { materialApplyRequest } from "./local-boundaries.mjs";
import {
  entryAt,
  itemAt,
  readJournalFile,
  reservationBodySchema,
  resourcesOf,
  valueAt,
} from "./test-support.mjs";
import { z } from "zod";

/** @param {number} n */
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const guideId = uuid(900);
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
    access: "membership",
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
      guideId: "product",
      chapterIds: [],
      materialIds: ["lesson", "video", "old"],
      complete: true,
    },
    materials: [
      row("lesson", {
        coverAssetId: "cover",
        coverAlt: "Обложка",
        artifacts: [
          { sourceId: "checklist", title: "Чек-лист", assetId: "checklist" },
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
    guides: [
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
 * @property {string[]} [seriesIds]
 * @typedef {{
 *   videoId: string;
 *   materialId: string;
 *   providerVideoId: string;
 *   state: string;
 *   reconciles: number;
 * }} FakeVideo
 * @typedef {{
 *   artifactId: string;
 *   origin: string;
 *   sourceId: string;
 *   title: string;
 *   materialIds: string[];
 * }} FakeArtifact
 * @typedef {object} FakeGuide
 * @property {string} id
 * @property {string} slug
 * @property {string} sourceId
 * @property {string} name
 * @property {string} summary
 * @property {number} version
 * @property {boolean} archived
 * @property {string} presentation
 * @property {unknown} page
 * @property {boolean} pageRejected
 * @property {string[]} [members]
 */

// Bodies the double reads; the sync under test builds them, so a missing field fails the test.
const guideValidationBodySchema = z
  .object({ source: z.object({ presentation: z.string() }).passthrough() })
  .passthrough();
const guideUpdateBodySchema = z
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
  .object({ expectedVersion: z.number(), seriesId: z.string() })
  .passthrough();
const compositionBodySchema = z
  .object({ orderedMaterialIds: z.array(z.string()) })
  .passthrough();
const attachBodySchema = z
  .object({ providerVideoId: z.string() })
  .passthrough();
const linkBodySchema = z
  .object({ materialIds: z.array(z.string()) })
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
  /** @type {FakeGuide} */
  const guide = {
    id: guideId,
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
    guide,
    pin: { seriesId: uuid(901), version: 3 },
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
        return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate")
        return { valid: true };
      if (path === "/authoring/import/guides/validate") {
        const { source } = guideValidationBodySchema.parse(body);
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
      if (path === "/authoring/import/guides/reserve")
        return structuredClone(guide);
      if (path === "/authoring/collections?kind=guide")
        return [structuredClone(guide)];
      if (path === "/authoring/home-pin" && body === undefined)
        return structuredClone(api.pin);
      if (path === "/authoring/home-pin") {
        const pin = homePinBodySchema.parse(body);
        assert.equal(pin.expectedVersion, api.pin.version);
        api.pin = { seriesId: pin.seriesId, version: api.pin.version + 1 };
        return structuredClone(api.pin);
      }
      if (path === "/authoring/import/guides/update") {
        const update = guideUpdateBodySchema.parse(body);
        assert.equal(update.expectedVersion, guide.version);
        assert.equal(
          update.introduction,
          undefined,
          "The editor-owned introduction is never imported",
        );
        Object.assign(guide, {
          name: update.name,
          summary: update.summary,
          slug: update.source.slug,
          presentation: update.source.presentation,
          page: update.source.page,
          pageRejected: false,
          version: guide.version + 1,
        });
        return structuredClone(guide);
      }
      if (path === `/authoring/guides/${guideId}/order`)
        return {
          orderVersion: "a".repeat(64),
          items: (guide.members ?? []).map((materialId) => ({
            materialId,
            chapterId: null,
          })),
          chapters: [],
        };
      if (path === "/authoring/import/guides/composition") {
        guide.members = compositionBodySchema.parse(body).orderedMaterialIds;
        return { orderVersion: "b".repeat(64) };
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
      if ((match = /^\/authoring\/materials\/([^/]+)$/u.exec(path)))
        return structuredClone(byId(match[1]));
      if (path === "/authoring/import/materials/apply") {
        const command = materialApplyRequest({ path, body })?.body;
        assert.ok(command);
        const current = valueAt(materials, command.source.id);
        if (command.expectedContentVersion !== current.contentVersion)
          throw new Error("stale_content_version");
        if (command.primaryVideoId !== null)
          assert.equal(valueAt(videos, command.primaryVideoId).state, "ready");
        Object.assign(current, {
          contentVersion: current.contentVersion + 1,
          primaryVideoId: command.primaryVideoId,
          videoChapters: command.videoChapters,
          publicationState: command.publicationState,
          seriesIds: command.metadata.seriesIds,
          metadata: { ...current.metadata, access: command.metadata.access },
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
      if (path === `/authoring/import/guides/${guideId}/artifacts`) {
        assert.ok(body instanceof FormData);
        assert.equal(body.get("guideSourceId"), "inside-content:product");
        const sourceId = formText(body, "sourceId");
        const existing = artifacts.get(sourceId);
        const artifact = existing ?? {
          artifactId: uuid(next++),
          origin: "authoring",
          sourceId,
          title: formText(body, "title"),
          materialIds: [],
        };
        artifacts.set(artifact.sourceId, artifact);
        return {
          artifactId: artifact.artifactId,
          outcome: existing ? "unchanged" : "created",
          sourceId: artifact.sourceId,
          title: artifact.title,
        };
      }
      if (
        (match = /^\/authoring\/guide-artifacts\/([^/]+)\/materials$/u.exec(
          path,
        ))
      ) {
        const artifactId = match[1];
        const artifact = [...artifacts.values()].find(
          (item) => item.artifactId === artifactId,
        );
        assert.ok(artifact);
        artifact.materialIds = linkBodySchema.parse(body).materialIds;
        return structuredClone(artifact);
      }
      if (path === `/authoring/guides/${guideId}/artifacts`)
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
  assert.equal(api.guide.name, "Продукт");
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
        ) && !path.startsWith(`/authoring/guides/${guideId}/artifacts`),
    ),
    false,
    repeated.join("\n"),
  );
});

test("the product page travels with the Guide: unknown looks stop early, edits write once and a new address keeps the product", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.guides, 0).presentation = "neon";
  await setup.write();
  const api = applicationApi();
  await assert.rejects(run(setup, api), /presentation 'neon'/u);
  await assert.rejects(
    previewRelease(setup.packagePath, setup.state, {
      origin: "http://127.0.0.1:4396",
      request: api.request,
    }),
    /presentation 'neon'/u,
  );
  assert.deepEqual(
    api.calls.map((call) => call.path),
    [
      "/authoring/import/materials/environment",
      "/authoring/import/guides/validate",
      "/authoring/import/materials/environment",
      "/authoring/import/guides/validate",
    ],
  );

  itemAt(setup.manifest.guides, 0).presentation = "ai-first-process";
  await setup.write();
  await run(setup, api);
  assert.deepEqual(
    {
      presentation: api.guide.presentation,
      page: api.guide.page,
      slug: api.guide.slug,
    },
    { presentation: "ai-first-process", page: productPage, slug: "product" },
  );
  const updates = () =>
    api.calls.filter((call) => call.path === "/authoring/import/guides/update")
      .length;
  const once = updates();
  await run(setup, api);
  assert.equal(updates(), once, "an unchanged product page writes nothing");
  // Журнал прежних переносов не помнит описания: повтор сверяется с тем, что держит цель.
  const journalPath = join(setup.state, "journal.json");
  const forgotten = await readJournalFile(setup.state);
  for (const entry of Object.values(forgotten.guides)) {
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
  api.guide.pageRejected = true;
  await run(setup, api);
  assert.equal(updates(), once + 1);
  assert.equal(api.guide.pageRejected, false);

  const edited = {
    ...productPage,
    blocks: [{ ...itemAt(productPage.blocks, 0), lead: "Правка текста." }],
  };
  itemAt(setup.manifest.guides, 0).page = edited;
  itemAt(setup.manifest.guides, 0).slug = "product-moved";
  await setup.write();
  const report = await run(setup, api);
  assert.equal(updates(), once + 2);
  assert.deepEqual(
    { id: api.guide.id, slug: api.guide.slug, page: api.guide.page },
    { id: guideId, slug: "product-moved", page: edited },
  );
  assert.match(itemAt(report.guides, 0).url, /\/products\/product-moved$/u);
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
      "/authoring/import/guides/validate",
    ],
  );
  api.rejectValidation = undefined;

  // Пакет, собранный до появления адреса и подписи карточки, ничего не переносит на новый адрес.
  api.guide.slug = "product-published";
  delete itemAt(setup.manifest.guides, 0).slug;
  itemAt(setup.manifest.guides, 0).page = { blocks: productPage.blocks };
  await setup.write();
  await run(setup, api);
  assert.equal(api.guide.slug, "product-published");
  const updates = () =>
    api.calls.filter((call) => call.path === "/authoring/import/guides/update")
      .length;
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
  api.guide.archived = true;
  api.guide.slug = "product-archived";
  const report = await run(setup, api);
  assert.equal(
    api.guide.slug,
    "product-archived",
    "the address of an archived record is not reused as a decision",
  );
  assert.deepEqual(
    report.notices.filter((notice) => notice.code === "guide_archived").length,
    1,
  );
});

test("a package that names no description leaves the stored page alone", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  assert.deepEqual(api.guide.page, productPage);
  const updates = () =>
    api.calls.filter((call) => call.path === "/authoring/import/guides/update")
      .length;
  const before = updates();

  delete itemAt(setup.manifest.guides, 0).page;
  delete itemAt(setup.manifest.guides, 0).presentation;
  await setup.write();
  await run(setup, api);
  assert.deepEqual(
    {
      page: api.guide.page,
      presentation: api.guide.presentation,
      updates: updates(),
    },
    { page: productPage, presentation: "ai-first-process", updates: before },
  );

  // Снять описание можно только явным null.
  itemAt(setup.manifest.guides, 0).page = null;
  await setup.write();
  await run(setup, api);
  assert.equal(api.guide.page, null);
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
  itemAt(setup.manifest.guides, 0).materialIds = ["lesson", "video"];
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
  assert.deepEqual(valueAt(api.materials, "inside-content:old").seriesIds, []);
  const after = await run(setup, api);
  assert.deepEqual(after.archiveProposals, []);
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

test("supplementary originals join the Guide after the programme without a chapter", async (t) => {
  const setup = await fixture(t);
  itemAt(setup.manifest.guides, 0).materialIds = ["lesson", "video"];
  itemAt(setup.manifest.guides, 0).supplementaryMaterialIds = ["old"];
  await setup.write();
  const api = applicationApi();
  const report = await run(setup, api);
  const ids = ["lesson", "video", "old"].map(
    (id) => valueAt(api.materials, `inside-content:${id}`).materialId,
  );
  assert.deepEqual(api.guide.members, ids);
  assert.deepEqual(valueAt(api.materials, "inside-content:old").seriesIds, [
    guideId,
  ]);
  const composition = api.calls.find(
    (call) => call.path === "/authoring/import/guides/composition",
  );
  assert.deepEqual(
    z.object({ chapterAssignments: z.unknown() }).parse(composition?.body)
      .chapterAssignments,
    {},
  );
  assert.equal(itemAt(report.guides, 0).mainMaterials, 2);
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
  itemAt(setup.manifest.guides, 0).materialIds = ["lesson", "video"];
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
    origin,
    request: api.request,
  });
  assert.deepEqual(clean.summary, {
    new: 0,
    changed: 0,
    restore: 0,
    unchanged: 3,
    conflict: 0,
  });
  assert.deepEqual(itemAt(clean.preview.guides, 0), {
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
  itemAt(setup.manifest.guides, 0).materialIds = [
    "video",
    "lesson",
    "old",
    "extra",
  ];
  itemAt(itemAt(setup.manifest.materials, 0).artifacts, 0).title = "Чек-лист 2";
  await setup.write();
  const next = await previewRelease(setup.packagePath, setup.state, {
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
  assert.deepEqual(itemAt(next.preview.guides, 0), {
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
  itemAt(setup.manifest.guides, 0).title = "Новое имя";
  await setup.write();
  const renamed = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  assert.equal(itemAt(renamed.preview.guides, 0).detailsChange, true);
  itemAt(setup.manifest.guides, 0).slug = "product-moved";
  itemAt(setup.manifest.guides, 0).presentation = "default";
  itemAt(setup.manifest.guides, 0).page = {
    ...productPage,
    blocks: [{ ...itemAt(productPage.blocks, 0), lead: "Новый лид." }],
  };
  await setup.write();
  const redesigned = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  assert.deepEqual(
    (({ pageChange, slugChange, presentationChange }) => ({
      pageChange,
      slugChange,
      presentationChange,
    }))(itemAt(redesigned.preview.guides, 0)),
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
    origin,
    request: api.request,
  });
  const video = accessChanged.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.ok(video);
  assert.equal(video.change, "conflict");
  assert.equal(video.conflictReason, "video_access_change");
  await assert.rejects(
    applyRelease(accessChanged.path, setup.state, { request: api.request }),
    /conflicts/u,
  );
  // A new provider record is attached with the new access, so that change is not a conflict.
  itemAt(setup.manifest.materials, 1).video = { kinescopeId: uuid(778) };
  await setup.write();
  const newRecording = await previewRelease(setup.packagePath, setup.state, {
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

test("release preview separates Video access conflicts from plain access changes", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  itemAt(setup.manifest.materials, 1).access = "free";
  itemAt(setup.manifest.materials, 0).access = "free";
  await setup.write();
  const preview = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  const attached = preview.preview.materials.find(
    (item) => item.sourceId === "video",
  );
  assert.ok(attached);
  assert.equal(attached.change, "conflict");
  assert.equal(attached.conflictReason, "video_access_change");
  const plain = preview.preview.materials.find(
    (item) => item.sourceId === "lesson",
  );
  assert.ok(plain);
  assert.equal(plain.change, "changed");
  assert.equal(plain.conflictReason, undefined);
  assert.deepEqual(plain.accessChange, { from: "membership", to: "free" });

  // A legacy journal entry without access still sees the target's current access.
  const journalPath = join(setup.state, "journal.json");
  const journal = await readJournalFile(setup.state);
  delete entryAt(journal.materials, "inside-content:video")["access"];
  await writeFile(journalPath, canonical(journal));
  const legacy = await previewRelease(setup.packagePath, setup.state, {
    origin,
    request: api.request,
  });
  assert.equal(
    legacy.preview.materials.find((item) => item.sourceId === "video")
      ?.conflictReason,
    "video_access_change",
  );

  itemAt(setup.manifest.materials, 1).video = { kinescopeId: uuid(779) };
  await setup.write();
  const replaced = (
    await previewRelease(setup.packagePath, setup.state, {
      origin,
      request: api.request,
    })
  ).preview.materials.find((item) => item.sourceId === "video");
  assert.ok(replaced);
  assert.equal(replaced.conflictReason, undefined);
  assert.deepEqual(replaced.accessChange, { from: "membership", to: "free" });
});

test("the local product view pins the transferred product on Home once", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const report = await run(setup, api, { pinHome: true });
  assert.equal(report.homePinned, guideId);
  assert.deepEqual(api.pin, { seriesId: guideId, version: 4 });
  await run(setup, api, { pinHome: true });
  assert.equal(api.pin.version, 4);
});
