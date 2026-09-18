import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { loopbackOrigin, resolveLocalTarget } from "./target.mjs";
import { applyRelease, previewRelease } from "./release.mjs";

const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const guideId = uuid(900);
const productPage = { card: null, blocks: [{ id: "hero", kind: "hero", lead: "Лид продукта.", highlights: [] }] };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "authoring-completion-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  const files = { cover: Buffer.from("cover-bytes"), checklist: Buffer.from("# checklist\n") };
  await writeFile(join(directory, "assets", "cover.png"), files.cover);
  await writeFile(join(directory, "assets", "checklist.md"), files.checklist);
  const row = (id, extra = {}) => ({ sourceId: id, sourcePath: `${id}.md`, sourceIds: [], relatedMaterialIds: [], readingTimeMinutes: null, kind: "note", title: id, summary: "Summary", stage: "draft", topicId: null, access: "membership", showInFeed: false, difficulty: null, outcomes: [], markdown: "Text", links: {}, images: {}, coverAssetId: null, coverAlt: null, video: null, videoChapters: [], artifacts: [], ...extra });
  const manifest = {
    schemaVersion: 1, sourceNamespace: "inside-content",
    selection: { guideId: "product", chapterIds: [], materialIds: ["lesson", "video", "old"], complete: true },
    materials: [
      row("lesson", { coverAssetId: "cover", coverAlt: "Обложка", artifacts: [{ sourceId: "checklist", title: "Чек-лист", assetId: "checklist" }] }),
      row("video", { kind: "video", video: { kinescopeId: uuid(777) }, videoChapters: [{ start: 0, title: "Введение" }, { start: 90, title: "Итог" }] }),
      row("old"),
    ],
    guides: [{ sourceId: "product", presentation: "ai-first-process", page: productPage, title: "Продукт", summary: "Подзаголовок", complete: true, chapters: [], materialIds: ["lesson", "video", "old"], supplementaryMaterialIds: [] }],
    assets: [
      { sourceId: "checklist", path: "assets/checklist.md", sha256: checksum(files.checklist), mimeType: "text/markdown" },
      { sourceId: "cover", path: "assets/cover.png", sha256: checksum(files.cover), mimeType: "image/png" },
    ],
    diagnostics: [],
  };
  const packagePath = join(directory, "package.json");
  const write = () => writeFile(packagePath, canonical(manifest));
  await write();
  return { manifest, write, state: join(directory, "state"), packagePath };
}

// Stateful application double for the loopback API; it records every call and enforces versions.
function applicationApi() {
  const materials = new Map();
  const calls = [];
  const videos = new Map();
  const artifacts = new Map();
  const guide = { id: guideId, slug: "product", name: "", summary: "", version: 1, archived: false, presentation: "default", page: null, pageRejected: false };
  let next = 1;
  const api = {
    calls, materials, videos, artifacts, guide, pin: { seriesId: uuid(901), version: 3 },
    count: (pattern) => calls.filter((call) => pattern.test(call.path)).length,
    async request(path, body, key, options = {}) {
      calls.push({ path, key, method: options.method ?? (body === undefined ? "GET" : "POST"), body: body instanceof FormData ? Object.fromEntries([...body.entries()].filter(([name]) => name !== "file")) : structuredClone(body) });
      if (path === "/authoring/import/materials/environment") return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate") return { valid: true };
      if (path === "/authoring/import/guides/validate") {
        assert.ok(body.source, "validation carries the page");
        if (api.rejectValidation) throw Object.assign(new Error(api.rejectValidation), { status: 422 });
        if (!["default", "ai-first-process"].includes(body.source.presentation)) throw Object.assign(new Error(`invalid_content /source/presentation`), { status: 422 });
        return { valid: true };
      }
      if (path === "/authoring/import/guides/reserve") return structuredClone(guide);
      if (path === "/authoring/collections?kind=guide") return [structuredClone(guide)];
      if (path === "/authoring/home-pin" && body === undefined) return structuredClone(api.pin);
      if (path === "/authoring/home-pin") { assert.equal(body.expectedVersion, api.pin.version); api.pin = { seriesId: body.seriesId, version: api.pin.version + 1 }; return structuredClone(api.pin); }
      if (path === "/authoring/import/guides/update") {
        assert.equal(body.expectedVersion, guide.version);
        assert.equal(body.introduction, undefined, "The editor-owned introduction is never imported");
        Object.assign(guide, { name: body.name, summary: body.summary, slug: body.source.slug, presentation: body.source.presentation, page: body.source.page, pageRejected: false, version: guide.version + 1 });
        return structuredClone(guide);
      }
      if (path === `/authoring/guides/${guideId}/order`) return { orderVersion: "a".repeat(64), items: (guide.members ?? []).map((materialId) => ({ materialId, chapterId: null })), chapters: [] };
      if (path === "/authoring/import/guides/composition") { guide.members = body.orderedMaterialIds; return { orderVersion: "b".repeat(64) }; }
      if (path === "/authoring/import/materials/reserve") {
        if (!materials.has(body.source.id)) materials.set(body.source.id, { materialId: uuid(next++), contentVersion: 1, primaryVideoId: null, cover: null, metadata: { slug: body.source.id.split(":")[1] }, source: body.source, publicationState: "draft" });
        return structuredClone(materials.get(body.source.id));
      }
      const byId = (id) => [...materials.values()].find((item) => item.materialId === id);
      let match;
      if ((match = /^\/authoring\/materials\/([^/]+)$/u.exec(path))) return structuredClone(byId(match[1]));
      if (path === "/authoring/import/materials/apply") {
        const current = materials.get(body.source.id);
        if (body.expectedContentVersion !== current.contentVersion) throw new Error("stale_content_version");
        if (body.primaryVideoId !== null) assert.equal(videos.get(body.primaryVideoId).state, "ready");
        Object.assign(current, { contentVersion: current.contentVersion + 1, primaryVideoId: body.primaryVideoId, videoChapters: body.videoChapters, publicationState: body.publicationState, seriesIds: body.metadata.seriesIds, metadata: { ...current.metadata, access: body.metadata.access } });
        return { materialId: current.materialId, contentVersion: current.contentVersion };
      }
      if ((match = /^\/authoring\/materials\/([^/]+)\/videos\/attach$/u.exec(path))) {
        const existing = [...videos.values()].find((video) => video.providerVideoId === body.providerVideoId);
        if (existing) return structuredClone(existing);
        const video = { videoId: uuid(next++), materialId: match[1], providerVideoId: body.providerVideoId, state: "processing", reconciles: 0 };
        videos.set(video.videoId, video);
        return structuredClone(video);
      }
      if ((match = /^\/authoring\/videos\/([^/]+)\/reconcile$/u.exec(path))) {
        const video = videos.get(match[1]);
        if (++video.reconciles >= 2) video.state = "ready";
        return structuredClone(video);
      }
      if ((match = /^\/authoring\/import\/content-covers\/material\/([^/]+)$/u.exec(path))) {
        const current = byId(match[1]);
        assert.equal(options.method, "PUT");
        assert.equal(body.get("expectedCoverId"), current.cover?.coverId ?? "null");
        assert.equal(body.get("sourceId"), current.source.id);
        current.cover = { coverId: uuid(next++) };
        return { cover: current.cover };
      }
      if (path === `/authoring/import/guides/${guideId}/artifacts`) {
        assert.equal(body.get("guideSourceId"), "inside-content:product");
        const existing = artifacts.get(body.get("sourceId"));
        const artifact = existing ?? { artifactId: uuid(next++), origin: "authoring", sourceId: body.get("sourceId"), title: body.get("title"), materialIds: [] };
        artifacts.set(artifact.sourceId, artifact);
        return { artifactId: artifact.artifactId, outcome: existing ? "unchanged" : "created", sourceId: artifact.sourceId, title: artifact.title };
      }
      if ((match = /^\/authoring\/guide-artifacts\/([^/]+)\/materials$/u.exec(path))) {
        const artifact = [...artifacts.values()].find((item) => item.artifactId === match[1]);
        artifact.materialIds = body.materialIds;
        return structuredClone(artifact);
      }
      if (path === `/authoring/guides/${guideId}/artifacts`) return { artifacts: [...artifacts.values()].map((item) => structuredClone(item)) };
      throw new Error(`Unexpected API request: ${path}`);
    },
  };
  return api;
}

const run = (setup, api, options = {}) => syncLocal(setup.packagePath, setup.state, { request: api.request, sleep: async () => {}, ...options });

test("covers, video and artifacts transfer once and replay as no-ops", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  const first = await run(setup, api);
  assert.equal(first.applied, 3);
  const video = api.materials.get("inside-content:video");
  assert.equal(api.videos.get(video.primaryVideoId).state, "ready");
  assert.deepEqual(video.videoChapters, [{ start: 0, title: "Введение" }, { start: 90, title: "Итог" }]);
  const lesson = api.materials.get("inside-content:lesson");
  assert.ok(lesson.cover?.coverId);
  assert.deepEqual(api.artifacts.get("inside-content:checklist").materialIds, [lesson.materialId]);
  assert.equal(api.guide.name, "Продукт");
  assert.equal(first.notices.some((notice) => /pending|missing/u.test(notice.code)), false);

  const before = api.calls.length;
  const second = await run(setup, api);
  assert.equal(second.applied, 0);
  assert.equal(second.unchanged, 3);
  const repeated = api.calls.slice(before).map((call) => call.path);
  assert.equal(repeated.some((path) => /apply|attach|reconcile|content-covers|artifacts$|materials$|update/u.test(path) && !path.startsWith(`/authoring/guides/${guideId}/artifacts`)), false, repeated.join("\n"));
});

test("the product page travels with the Guide: unknown looks stop early, edits write once and a new address keeps the product", async (t) => {
  const setup = await fixture(t);
  setup.manifest.guides[0].presentation = "neon";
  await setup.write();
  const api = applicationApi();
  await assert.rejects(run(setup, api), /presentation 'neon'/u);
  await assert.rejects(previewRelease(setup.packagePath, setup.state, { origin: "http://127.0.0.1:4396", request: api.request }), /presentation 'neon'/u);
  assert.deepEqual(
    api.calls.map((call) => call.path),
    ["/authoring/import/materials/environment", "/authoring/import/guides/validate", "/authoring/import/materials/environment", "/authoring/import/guides/validate"],
  );

  setup.manifest.guides[0].presentation = "ai-first-process";
  await setup.write();
  await run(setup, api);
  assert.deepEqual({ presentation: api.guide.presentation, page: api.guide.page, slug: api.guide.slug }, { presentation: "ai-first-process", page: productPage, slug: "product" });
  const updates = () => api.calls.filter((call) => call.path === "/authoring/import/guides/update").length;
  const once = updates();
  await run(setup, api);
  assert.equal(updates(), once, "an unchanged product page writes nothing");
  // Журнал прежних переносов не помнит описания: повтор сверяется с тем, что держит цель.
  const journalPath = join(setup.state, "journal.json");
  const forgotten = JSON.parse(await readFile(journalPath, "utf8"));
  for (const entry of Object.values(forgotten.guides)) { delete entry.version; }
  await writeFile(journalPath, canonical(forgotten));
  await run(setup, api);
  assert.equal(updates(), once, "a journal written before the page still writes nothing");

  // Нечитаемое описание в цели перезаписывается даже при совпадающем пакете.
  api.guide.pageRejected = true;
  await run(setup, api);
  assert.equal(updates(), once + 1);
  assert.equal(api.guide.pageRejected, false);

  const edited = { ...productPage, blocks: [{ ...productPage.blocks[0], lead: "Правка текста." }] };
  setup.manifest.guides[0].page = edited;
  setup.manifest.guides[0].slug = "product-moved";
  await setup.write();
  const report = await run(setup, api);
  assert.equal(updates(), once + 2);
  assert.deepEqual({ id: api.guide.id, slug: api.guide.slug, page: api.guide.page }, { id: guideId, slug: "product-moved", page: edited });
  assert.match(report.guides[0].url, /\/guides\/product-moved$/u);
});

test("Platform checks the whole description before the first write, and an older package keeps the address", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  api.rejectValidation = "page is too large";
  await assert.rejects(run(setup, api), /page is too large/u);
  assert.deepEqual(api.calls.map((call) => call.path), ["/authoring/import/materials/environment", "/authoring/import/guides/validate"]);
  api.rejectValidation = undefined;

  // Пакет, собранный до появления адреса и подписи карточки, ничего не переносит на новый адрес.
  api.guide.slug = "product-published";
  delete setup.manifest.guides[0].slug;
  setup.manifest.guides[0].page = { blocks: productPage.blocks };
  await setup.write();
  await run(setup, api);
  assert.equal(api.guide.slug, "product-published");
  const updates = () => api.calls.filter((call) => call.path === "/authoring/import/guides/update").length;
  const once = updates();
  await run(setup, api);
  assert.equal(updates(), once, "a package without a Home card caption stays unchanged");
});

test("a replaced cover uses the current cover as its expected version", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const firstCover = api.materials.get("inside-content:lesson").cover.coverId;
  const bytes = Buffer.from("new-cover");
  await writeFile(join(setup.packagePath, "..", "assets", "cover.png"), bytes);
  setup.manifest.assets[1].sha256 = checksum(bytes);
  await setup.write();
  await run(setup, api);
  const upload = api.calls.filter((call) => call.path.includes("content-covers")).at(-1);
  assert.equal(upload.body.expectedCoverId, firstCover);
  assert.notEqual(api.materials.get("inside-content:lesson").cover.coverId, firstCover);
});

test("a missing original is proposed first and unpublished only on explicit request", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  setup.manifest.materials = setup.manifest.materials.filter((row) => row.sourceId !== "old");
  setup.manifest.selection.materialIds = ["lesson", "video"];
  setup.manifest.guides[0].materialIds = ["lesson", "video"];
  await setup.write();
  const proposed = await run(setup, api);
  assert.deepEqual(proposed.archiveProposals.map((item) => item.sourceId), ["inside-content:old"]);
  assert.equal(api.materials.get("inside-content:old").publicationState, "published");
  await assert.rejects(run(setup, api, { archive: ["lesson"] }), /still in the package/u);
  const archived = await run(setup, api, { archive: ["old"] });
  assert.deepEqual(archived.archived, [{ sourceId: "inside-content:old" }]);
  assert.equal(api.materials.get("inside-content:old").publicationState, "unpublished");
  assert.deepEqual(api.materials.get("inside-content:old").seriesIds, []);
  const after = await run(setup, api);
  assert.deepEqual(after.archiveProposals, []);
});

test("a video that never becomes ready stops before Save and resumes with the same record", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await assert.rejects(run(setup, api, { videoAttempts: 1 }), /still processing/u);
  assert.equal(api.materials.get("inside-content:video")?.primaryVideoId ?? null, null);
  await run(setup, api);
  assert.equal(api.count(/videos\/attach$/u), 1);
  assert.equal(api.videos.size, 1);
});

test("supplementary originals join the Guide after the programme without a chapter", async (t) => {
  const setup = await fixture(t);
  setup.manifest.guides[0].materialIds = ["lesson", "video"];
  setup.manifest.guides[0].supplementaryMaterialIds = ["old"];
  await setup.write();
  const api = applicationApi();
  const report = await run(setup, api);
  const ids = ["lesson", "video", "old"].map((id) => api.materials.get(`inside-content:${id}`).materialId);
  assert.deepEqual(api.guide.members, ids);
  assert.deepEqual(api.materials.get("inside-content:old").seriesIds, [guideId]);
  const composition = api.calls.find((call) => call.path === "/authoring/import/guides/composition");
  assert.deepEqual(composition.body.chapterAssignments, {});
  assert.equal(report.guides[0].mainMaterials, 2);
});

test("only loopback HTTP origins are accepted as targets", () => {
  assert.equal(resolveLocalTarget("editor"), "http://127.0.0.1:4396");
  assert.equal(resolveLocalTarget("stand"), "http://127.0.0.1:4398");
  assert.throws(() => resolveLocalTarget("production"));
  for (const origin of ["https://inside.example", "http://10.0.0.5:4396", "http://127.0.0.1.example.com", "http://user@127.0.0.1:4396", "https://127.0.0.1:4396"]) {
    assert.throws(() => loopbackOrigin(origin), /loopback/u, origin);
  }
});

test("an uploaded recording is saved with the original's chapters until the original names it", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const journalPath = join(setup.state, "journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const uploadedId = uuid(555);
  api.videos.set(uploadedId, { videoId: uploadedId, state: "ready", providerVideoId: "uploaded" });
  journal.resources["source-video:inside-content:lesson"] = { videoId: uploadedId, providerVideoId: "uploaded", sha256: "c".repeat(64) };
  await writeFile(journalPath, canonical(journal));
  setup.manifest.materials[0].videoChapters = [{ start: 0, title: "Старт" }];
  await setup.write();
  await run(setup, api);
  const lesson = api.materials.get("inside-content:lesson");
  assert.equal(lesson.primaryVideoId, uploadedId);
  assert.deepEqual(lesson.videoChapters, [{ start: 0, title: "Старт" }]);
});

test("a cover change whose response was lost is adopted on the retry", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const bytes = Buffer.from("replacement-cover");
  await writeFile(join(setup.packagePath, "..", "assets", "cover.png"), bytes);
  setup.manifest.assets[1].sha256 = checksum(bytes);
  await setup.write();
  const original = api.request;
  let lose = true;
  const lossy = async (path, body, key, options) => {
    const result = await original(path, body, key, options);
    if (lose && path.includes("content-covers")) { lose = false; throw new Error("Connection lost after the cover changed"); }
    return result;
  };
  const conflicting = async (path, body, key, options) => {
    if (path.includes("content-covers")) {
      const current = api.materials.get("inside-content:lesson").cover.coverId;
      if (body.get("expectedCoverId") !== current) throw Object.assign(new Error("409"), { status: 409, body: { code: "conflict", currentCoverId: current } });
    }
    return original(path, body, key, options);
  };
  await assert.rejects(run(setup, { request: lossy }), /Connection lost/u);
  const applied = api.materials.get("inside-content:lesson").cover.coverId;
  await run(setup, { request: conflicting });
  const journal = JSON.parse(await readFile(join(setup.state, "journal.json"), "utf8"));
  assert.equal(journal.materials["inside-content:lesson"].coverId, applied);
  assert.equal(journal.resources[`cover-pending:${api.materials.get("inside-content:lesson").materialId}`], undefined);
});

test("an archive whose receipt was stored before the crash stays archived", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  setup.manifest.materials = setup.manifest.materials.filter((row) => row.sourceId !== "old");
  setup.manifest.selection.materialIds = ["lesson", "video"];
  setup.manifest.guides[0].materialIds = ["lesson", "video"];
  await setup.write();
  await run(setup, api, { archive: ["old"] });
  const journalPath = join(setup.state, "journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  // Simulate the crash: the operation receipt exists, the cache still shows the published version.
  Object.assign(journal.materials["inside-content:old"], { archived: false, contentVersion: journal.materials["inside-content:old"].contentVersion - 1 });
  await writeFile(journalPath, canonical(journal));
  const report = await run(setup, api);
  assert.deepEqual(report.archiveProposals, []);
});

test("release preview reports video, composition and artifact changes that the sync would apply", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  const clean = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  assert.deepEqual(clean.summary, { new: 0, changed: 0, restore: 0, unchanged: 3, conflict: 0 });
  assert.deepEqual(clean.preview.guides[0], { sourceId: "product", title: "Продукт", materials: 3, artifactChanges: [], change: "unchanged", detailsChange: false, chapterTextChanges: 0, pageChange: false, added: 0, removed: 0, reorderedOrRegrouped: false });

  // A recording uploaded after the review changes what apply would save, so apply refuses.
  const reviewedJournal = JSON.parse(await readFile(join(setup.state, "journal.json"), "utf8"));
  reviewedJournal.resources["source-video:inside-content:old"] = { videoId: uuid(557), providerVideoId: "late", sha256: "e".repeat(64) };
  await writeFile(join(setup.state, "journal.json"), canonical(reviewedJournal));
  api.videos.set(uuid(557), { videoId: uuid(557), state: "ready" });
  await assert.rejects(applyRelease(clean.path, setup.state, { request: api.request }), /changed after the preview/u);
  delete reviewedJournal.resources["source-video:inside-content:old"];
  await writeFile(join(setup.state, "journal.json"), canonical(reviewedJournal));

  const journalPath = join(setup.state, "journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.resources["source-video:inside-content:lesson"] = { videoId: uuid(556), providerVideoId: "uploaded", sha256: "d".repeat(64) };
  await writeFile(journalPath, canonical(journal));
  setup.manifest.materials.push({ ...setup.manifest.materials[2], sourceId: "extra", sourcePath: "extra.md", title: "extra" });
  setup.manifest.selection.materialIds.push("extra");
  setup.manifest.guides[0].materialIds = ["video", "lesson", "old", "extra"];
  setup.manifest.materials[0].artifacts[0].title = "Чек-лист 2";
  await setup.write();
  const next = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  const lesson = next.preview.materials.find((item) => item.sourceId === "lesson");
  assert.equal(lesson.change, "changed");
  assert.equal(lesson.videoChange, true);
  assert.equal(next.preview.materials.find((item) => item.sourceId === "extra").change, "new");
  assert.deepEqual(next.preview.guides[0], { sourceId: "product", title: "Продукт", materials: 4, artifactChanges: ["checklist"], change: "composition", detailsChange: false, chapterTextChanges: 0, pageChange: false, added: 1, removed: 0, reorderedOrRegrouped: true });
  setup.manifest.guides[0].title = "Новое имя";
  await setup.write();
  const renamed = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  assert.equal(renamed.preview.guides[0].detailsChange, true);
  setup.manifest.guides[0].slug = "product-moved";
  setup.manifest.guides[0].presentation = "default";
  setup.manifest.guides[0].page = { ...productPage, blocks: [{ ...productPage.blocks[0], lead: "Новый лид." }] };
  await setup.write();
  const redesigned = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  assert.deepEqual(
    (({ pageChange, slugChange, presentationChange }) => ({ pageChange, slugChange, presentationChange }))(redesigned.preview.guides[0]),
    { pageChange: true, slugChange: { from: "product", to: "product-moved" }, presentationChange: { from: "ai-first-process", to: "default" } },
  );

  // Once the original names its own upload, the preview expects no video change.
  journal.resources["source-video:inside-content:video"] = { videoId: api.materials.get("inside-content:video").primaryVideoId, providerVideoId: setup.manifest.materials[1].video.kinescopeId, sha256: "f".repeat(64) };
  delete journal.resources[`video:${api.materials.get("inside-content:video").materialId}:${setup.manifest.materials[1].video.kinescopeId}`];
  await writeFile(journalPath, canonical(journal));
  const named = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  assert.equal(named.preview.materials.find((item) => item.sourceId === "video").change, "unchanged");
  setup.manifest.materials[1].access = "free";
  await setup.write();
  const accessChanged = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  const video = accessChanged.preview.materials.find((item) => item.sourceId === "video");
  assert.equal(video.change, "conflict");
  assert.equal(video.conflictReason, "video_access_change");
  await assert.rejects(applyRelease(accessChanged.path, setup.state, { request: api.request }), /conflicts/u);
  // A new provider record is attached with the new access, so that change is not a conflict.
  setup.manifest.materials[1].video = { kinescopeId: uuid(778) };
  await setup.write();
  const newRecording = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  const replaced = newRecording.preview.materials.find((item) => item.sourceId === "video");
  assert.equal(replaced.change, "changed");
  assert.equal(replaced.videoChange, true);
});

test("release preview separates Video access conflicts from plain access changes", async (t) => {
  const setup = await fixture(t);
  const api = applicationApi();
  await run(setup, api);
  const origin = "http://127.0.0.1:4396";
  setup.manifest.materials[1].access = "free";
  setup.manifest.materials[0].access = "free";
  await setup.write();
  const preview = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  const attached = preview.preview.materials.find((item) => item.sourceId === "video");
  assert.equal(attached.change, "conflict");
  assert.equal(attached.conflictReason, "video_access_change");
  const plain = preview.preview.materials.find((item) => item.sourceId === "lesson");
  assert.equal(plain.change, "changed");
  assert.equal(plain.conflictReason, undefined);
  assert.deepEqual(plain.accessChange, { from: "membership", to: "free" });

  // A legacy journal entry without access still sees the target's current access.
  const journalPath = join(setup.state, "journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  delete journal.materials["inside-content:video"].access;
  await writeFile(journalPath, canonical(journal));
  const legacy = await previewRelease(setup.packagePath, setup.state, { origin, request: api.request });
  assert.equal(legacy.preview.materials.find((item) => item.sourceId === "video").conflictReason, "video_access_change");

  setup.manifest.materials[1].video = { kinescopeId: uuid(779) };
  await setup.write();
  const replaced = (await previewRelease(setup.packagePath, setup.state, { origin, request: api.request })).preview.materials.find((item) => item.sourceId === "video");
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
