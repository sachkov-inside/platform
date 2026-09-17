import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, checksum } from "./package.mjs";
import { syncLocal } from "./local-sync.mjs";
import { loopbackOrigin, resolveLocalTarget } from "./target.mjs";

const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const guideId = uuid(900);

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
    guides: [{ sourceId: "product", title: "Продукт", summary: "Подзаголовок", complete: true, chapters: [], materialIds: ["lesson", "video", "old"], supplementaryMaterialIds: [] }],
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
  const guide = { id: guideId, slug: "product", name: "", summary: "", version: 1, archived: false };
  let next = 1;
  const api = {
    calls, materials, videos, artifacts, guide,
    count: (pattern) => calls.filter((call) => pattern.test(call.path)).length,
    async request(path, body, key, options = {}) {
      calls.push({ path, key, method: options.method ?? (body === undefined ? "GET" : "POST"), body: body instanceof FormData ? Object.fromEntries([...body.entries()].filter(([name]) => name !== "file")) : structuredClone(body) });
      if (path === "/authoring/import/materials/environment") return { mode: "development" };
      if (path === "/authoring/collections?kind=topic") return [];
      if (path === "/authoring/import/materials/validate") return { valid: true };
      if (path === "/authoring/import/guides/reserve") return structuredClone(guide);
      if (path === "/authoring/import/guides/update") {
        assert.equal(body.expectedVersion, guide.version);
        assert.equal(body.introduction, undefined, "Guide page copy is owned by Platform");
        Object.assign(guide, { name: body.name, summary: body.summary, version: guide.version + 1 });
        return structuredClone(guide);
      }
      if (path === `/authoring/guides/${guideId}/order`) return { orderVersion: "a".repeat(64) };
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
        Object.assign(current, { contentVersion: current.contentVersion + 1, primaryVideoId: body.primaryVideoId, videoChapters: body.videoChapters, publicationState: body.publicationState, seriesIds: body.metadata.seriesIds });
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
  await assert.rejects(run(setup, api, { videoAttempts: 1 }), /not ready yet/u);
  assert.equal(api.materials.get("inside-content:video")?.primaryVideoId ?? null, null);
  await run(setup, api);
  assert.equal(api.count(/videos\/attach$/u), 1);
  assert.equal(api.videos.size, 1);
});

test("only loopback HTTP origins are accepted as targets", () => {
  assert.equal(resolveLocalTarget("editor"), "http://127.0.0.1:4396");
  assert.equal(resolveLocalTarget("stand"), "http://127.0.0.1:4398");
  assert.throws(() => resolveLocalTarget("production"));
  for (const origin of ["https://inside.example", "http://10.0.0.5:4396", "http://127.0.0.1.example.com", "http://user@127.0.0.1:4396", "https://127.0.0.1:4396"]) {
    assert.throws(() => loopbackOrigin(origin), /loopback/u, origin);
  }
});
