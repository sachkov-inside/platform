import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleContentCovers, assembleGuideArtifacts, assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { readHomeContent } from "../../src/modules/content-library/features/read-home-content/read-home-content.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = randomUUID();
const guideSource = "inside-content:guide-import";
const page = {
  card: { eyebrow: "Практикум", subtitle: "Инженерная работа", action: "Открыть практикум" },
  blocks: [
    { id: "hero", kind: "hero" as const, lead: "Лид страницы.", highlights: ["Твой стек", "Поддержка {support_term}"] },
    { id: "audience", kind: "cards" as const, eyebrow: "", title: "Кому это нужно", lead: "", items: [{ title: "Новичкам", text: "Текст.", detailLabel: "", detail: "" }], note: "" },
  ],
};
const materialSource = { id: "inside-content:guide-import-lesson", path: "lesson.md", revision: "c".repeat(64), showInFeed: false };

describe("authoring source Guide completion", () => {
  let database: TestDatabase;
  const stored = new Map<string, Uint8Array>();
  const objectStorage: ObjectStorage = {
    delete: (_namespace, key) => { stored.delete(key); return Promise.resolve(); },
    putImmutable: (input) => { stored.set(input.key, input.body); return Promise.resolve({ ok: true as const }); },
    read: (_namespace, key) => {
      const body = stored.get(key);
      return Promise.resolve(body === undefined ? null : { body, checksumSha256: createHash("sha256").update(body).digest("hex"), contentLength: body.byteLength, contentType: "application/octet-stream" });
    },
    signGet: () => Promise.resolve("https://storage.example.test/object"),
  };
  const authorPolicy = { canManage: (id: string) => id === actor };
  let authoring: ReturnType<typeof assembleMaterials>["authoring"];

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    authoring = assembleMaterials({ prisma: database.prisma, authorPolicy }).authoring;
  });
  afterAll(async () => { await database.dispose(); });

  async function reserveGuide(sourceId: string, slug: string) {
    const guide = await authoring.reserveSourceGuide({ actor, sourceId, name: "Импортированный продукт", slug, summary: "Подзаголовок" });
    if (!guide.ok) throw new Error(guide.error.code);
    return guide.value;
  }

  test("keeps an imported Guide out of ordinary archive and renames it through its source", async () => {
    const guide = await reserveGuide(guideSource, "guide-import");
    const updated = await authoring.updateSourceGuide({ actor, sourceId: guideSource, collectionId: guide.id, expectedVersion: guide.version, name: "Переименованный продукт", summary: guide.summary, source: { slug: guide.slug, presentation: "default", page: null } });
    expect(updated).toMatchObject({ ok: true, value: { name: "Переименованный продукт" } });
    if (!updated.ok) throw new Error(updated.error.code);
    expect(await authoring.updateSourceGuide({ actor, sourceId: "inside-content:other", collectionId: guide.id, expectedVersion: updated.value.version, name: "Чужой", summary: "", source: { slug: guide.slug, presentation: "default", page: null } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await authoring.setContentCollectionArchive({ actor, kind: "guide", collectionId: guide.id, expectedVersion: updated.value.version, archived: true })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("stores the product page only through its source and keeps the product when its address changes", async () => {
    const sourceId = "inside-content:page-guide";
    const guideId = randomUUID();
    await database.prisma.guide.create({ data: { id: guideId, name: "Импортированный продукт", slug: "page-guide", summary: "Подзаголовок" } });
    const topicId = randomUUID();
    await database.prisma.topic.create({ data: { id: topicId, name: "Page topic", slug: "page-topic" } });
    const lesson = await authoring.createDraft({ actor, idempotencyKey: randomUUID(), body: representativeDocument("Lesson"), metadata: { title: "Lesson", summary: "Lesson summary", access: "free", topicId, formatId: "guide", tagIds: [], difficulty: null, outcomes: [], seriesIds: [guideId] } });
    if (!lesson.ok) throw new Error(lesson.error.code);
    const published = await authoring.transitionPublication({ actor, idempotencyKey: randomUUID(), materialId: lesson.value.materialId, expectedContentVersion: lesson.value.contentVersion, publicationState: "published" });
    if (!published.ok) throw new Error(published.error.code);
    // Imported Guides accept only imported lessons, so the source is attached after composition.
    await database.prisma.guide.update({ where: { id: guideId }, data: { sourceId } });
    const guide = await reserveGuide(sourceId, "page-guide");
    expect(guide).toMatchObject({ id: guideId, sourceId, presentation: "default" });
    const pin = await authoring.loadHomePin({ actor });
    if (!pin.ok) throw new Error(pin.error.code);
    expect(await authoring.setHomePin({ actor, seriesId: guide.id, expectedVersion: pin.value.version })).toMatchObject({ ok: true });

    const request = { actor, sourceId, collectionId: guide.id, expectedVersion: guide.version, name: guide.name, summary: guide.summary };
    // An ordinary editor write never carries source-owned fields, even for an imported Guide.
    const { sourceId: _ignored, ...editorRequest } = request;
    expect(await authoring.updateContentCollection({ ...editorRequest, kind: "guide", source: { slug: "page-guide", presentation: "ai-first-process", page } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    for (const invalid of [
      { slug: "page-guide", presentation: "unknown-look", page },
      { slug: "page-guide", presentation: "ai-first-process", page: { ...page, blocks: [{ ...page.blocks[0], lead: "Цена {price}" }] } },
      { slug: "page-guide", presentation: "ai-first-process", page: { ...page, blocks: [page.blocks[0], page.blocks[0]] } },
      { slug: "page-guide", presentation: "ai-first-process", page: { ...page, blocks: [{ ...page.blocks[0], kind: "video" }] } },
    ]) {
      // @ts-expect-error -- the import boundary receives unchecked values
      expect(await authoring.updateSourceGuide({ ...request, source: invalid })).toMatchObject({ ok: false, error: { code: "invalid_content" } });
    }

    const imported = await authoring.updateSourceGuide({ ...request, source: { slug: "page-guide", presentation: "ai-first-process", page } });
    if (!imported.ok) throw new Error(imported.error.code);
    expect(imported.value).toMatchObject({ presentation: "ai-first-process", version: guide.version + 1 });
    // Repeating the same description writes nothing.
    const repeated = await authoring.updateSourceGuide({ ...request, source: { slug: "page-guide", presentation: "ai-first-process", page: structuredClone(page) } });
    expect(repeated).toMatchObject({ ok: true, value: { version: imported.value.version } });

    const moved = await authoring.updateSourceGuide({ ...request, expectedVersion: imported.value.version, source: { slug: "page-guide-renamed", presentation: "ai-first-process", page } });
    expect(moved).toMatchObject({ ok: true, value: { id: guide.id, slug: "page-guide-renamed", presentation: "ai-first-process" } });
    const materials = assembleMaterials({ prisma: database.prisma, authorPolicy });
    expect(await materials.publishedMaterialReader.discoverProjections({ kind: "series", slug: "page-guide", first: 10 })).toMatchObject({ ok: false });
    const discovered = await materials.publishedMaterialReader.discoverProjections({ kind: "series", slug: "page-guide-renamed", first: 10 });
    expect(discovered).toMatchObject({ ok: true, value: { reference: { id: guide.id, productPage: { presentation: "ai-first-process", page } }, items: [{ materialId: lesson.value.materialId }] } });
    const home = await readHomeContent(materials.publishedMaterialReader, materials.contentAccess, emptyCatalogVideos, { resolveForAccess: () => Promise.resolve({ kind: "required" }) }, true, { kind: "anonymous" });
    expect(home).toMatchObject({ ok: true, value: { pinnedSeries: { id: guide.id, slug: "page-guide-renamed", presentation: "ai-first-process", card: page.card } } });

    const other = await reserveGuide("inside-content:other-page-guide", "other-page-guide");
    expect(await authoring.updateSourceGuide({ actor, sourceId: "inside-content:other-page-guide", collectionId: other.id, expectedVersion: other.version, name: other.name, summary: other.summary, source: { slug: "page-guide-renamed", presentation: "default", page: null } })).toMatchObject({ ok: false, error: { code: "content_collection_slug_conflict" } });
  });

  test("changes covers only for records owned by the same source", async () => {
    const covers = assembleContentCovers({ prisma: database.prisma, objectStorage, authorPolicy });
    const reserved = await authoring.reserveSourceMaterial({ actor, source: materialSource });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const lesson = { id: reserved.value.materialId, kind: "material" as const };
    expect(await covers.change({ actor, expectedCoverId: null, kind: "upload", owner: lesson, ...(await coverUpload("#123456")) })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await covers.changeImported({ actor, expectedCoverId: null, kind: "upload", owner: lesson, ...(await coverUpload("#123456")) }, "inside-content:other")).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const imported = await covers.changeImported({ actor, expectedCoverId: null, kind: "upload", owner: lesson, ...(await coverUpload("#123456")) }, materialSource.id);
    expect(imported.ok && imported.value.cover !== null).toBe(true);

    const plain = await authoring.createDraft({ actor, idempotencyKey: "plain-cover-owner", body: representativeDocument("Plain"), metadata: { title: "Plain", summary: null, access: "free", topicId: null, formatId: null, tagIds: [], difficulty: null, outcomes: [], seriesIds: [] } });
    if (!plain.ok) throw new Error(plain.error.code);
    expect(await covers.changeImported({ actor, expectedCoverId: null, kind: "upload", owner: { id: plain.value.materialId, kind: "material" }, ...(await coverUpload("#654321")) }, materialSource.id)).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const guide = await reserveGuide("inside-content:cover-guide", "cover-guide");
    expect(await covers.changeImported({ actor, expectedCoverId: null, kind: "remove", owner: { id: guide.id, kind: "series" } }, "inside-content:other")).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await covers.changeImported({ actor, expectedCoverId: null, kind: "upload", owner: { id: guide.id, kind: "series" }, ...(await coverUpload("#abcdef")) }, "inside-content:cover-guide")).toMatchObject({ ok: true });
  });

  test("imports artifacts only into the Guide owned by the declared source", async () => {
    const artifacts = assembleGuideArtifacts({ authorPolicy, objectStorage, prisma: database.prisma });
    const guide = await reserveGuide("inside-content:artifact-guide", "artifact-guide");
    const body = Buffer.from("# Чек-лист\n");
    const file = { body, declaredContentType: "text/markdown", declaredSize: body.byteLength, expectedChecksumSha256: createHash("sha256").update(body).digest("hex"), filename: "checklist.md" };
    const artifact = { access: "membership" as const, file, purpose: "", sourceId: "inside-content:checklist", title: "Чек-лист" };
    expect(await artifacts.applyAuthoringImport({ actor, artifacts: [artifact], guideId: guide.id, guideSourceId: "inside-content:other" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await artifacts.applyAuthoringImport({ actor, artifacts: [artifact], guideId: guide.id, guideSourceId: "inside-content:artifact-guide" })).toMatchObject({ ok: true, value: { outcomes: [{ outcome: "created", sourceId: "inside-content:checklist" }] } });
    expect(await artifacts.applyAuthoringImport({ actor, artifacts: [artifact], guideId: guide.id, guideSourceId: "inside-content:artifact-guide" })).toMatchObject({ ok: true, value: { outcomes: [{ outcome: "unchanged" }] } });
  });
});

async function coverUpload(color: string) {
  const body = await sharp({ create: { background: color, channels: 4, height: 900, width: 1600 } }).png().toBuffer();
  return { body, declaredContentType: "image/png", declaredSize: body.byteLength, expectedChecksumSha256: createHash("sha256").update(body).digest("hex"), filename: "cover.png" } as const;
}
