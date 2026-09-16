import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleContentCovers, assembleGuideArtifacts, assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = randomUUID();
const guideSource = "inside-content:guide-import";
const materialSource = { id: "inside-content:guide-import-lesson", path: "lesson.md", revision: "c".repeat(64), showInFeed: false };
const introduction = { audience: "Кому полезно", outcome: "Что получится", prerequisites: "Что нужно знать", scope: "Что входит" };

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

  test("imports the full introduction and archives only through the owning source", async () => {
    const guide = await reserveGuide(guideSource, "guide-import");
    const updated = await authoring.updateSourceGuide({ actor, sourceId: guideSource, collectionId: guide.id, expectedVersion: guide.version, name: guide.name, summary: guide.summary, introduction });
    expect(updated).toMatchObject({ ok: true, value: { introduction } });
    if (!updated.ok) throw new Error(updated.error.code);
    expect(await authoring.setContentCollectionArchive({ actor, kind: "guide", collectionId: guide.id, expectedVersion: updated.value.version, archived: true })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await authoring.archiveSourceGuide({ actor, sourceId: "inside-content:other", collectionId: guide.id, expectedVersion: updated.value.version, archived: true })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const archived = await authoring.archiveSourceGuide({ actor, sourceId: guideSource, collectionId: guide.id, expectedVersion: updated.value.version, archived: true });
    expect(archived).toMatchObject({ ok: true, value: { archived: true } });
    if (!archived.ok) throw new Error(archived.error.code);
    expect(await authoring.archiveSourceGuide({ actor, sourceId: guideSource, collectionId: guide.id, expectedVersion: archived.value.version, archived: false })).toMatchObject({ ok: true, value: { archived: false } });
    const plain = await authoring.createContentCollection({ actor, kind: "guide", name: "Обычный продукт", slug: "plain-guide-import", summary: "" });
    if (!plain.ok) throw new Error(plain.error.code);
    expect(await authoring.archiveSourceGuide({ actor, sourceId: guideSource, collectionId: plain.value.id, expectedVersion: plain.value.version, archived: true })).toMatchObject({ ok: false, error: { code: "forbidden" } });
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
