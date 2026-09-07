import { createPrismaClient } from "../../src/infrastructure/prisma/index.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleMaterials, assembleMaterialResourceFacts, PublishedMaterialSelection, PublishedSeriesComposition } from "../../src/modules/materials/index.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { ReadingActivity, PersonalHome } from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
const videoFormatId = "video";
const actor = randomUUID(); const topicId = randomUUID(); const formatId = "note";
describe("Personal Home on PostgreSQL", () => {
  let database: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let videos: ReturnType<typeof assembleVideos>;
  let contentAccess: ReturnType<typeof assembleContentAccess>;
  let home: PersonalHome;
  let reading: ReadingActivity;
  let membershipActive = false;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({ data: { id: topicId, name: "Home", slug: "home" } });


    videos = assembleVideos({ prisma: database.prisma, canManage: () => Promise.resolve(true), projects: { free: "public", membership: "members" }, provider: {
      initUpload: () => Promise.reject(new Error("unused")), delete: () => Promise.reject(new Error("unused")),
      find: ({ id }) => Promise.resolve({ id, projectId: "public", title: "Video", status: "done", durationSeconds: 600, embedLocator: `https://kinescope.io/embed/${id}` }),
    } });
    materials = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true }, videos });
    contentAccess = assembleContentAccess({ materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent), videoResourceFacts: assembleVideoResourceFacts(videos), accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) }, membershipEntitlements: { resolveForAccess: () => Promise.resolve(membershipActive ? { kind: "active", validUntil: new Date(Date.now() + 60_000).toISOString() } : { kind: "expired" }) } });
    home = makeHome();
    reading = new ReadingActivity({ prisma: database.prisma, materialContent: materials.materialContent, contentAccess, composition: new PublishedSeriesComposition(database.prisma) });
  });
  afterAll(async () => { await database.dispose(); });
  function makeHome(videoPort = videos) { return new PersonalHome({ composition: new PublishedSeriesComposition(database.prisma), reader: materials.publishedMaterialReader, prisma: database.prisma, materialContent: materials.materialContent, selection: new PublishedMaterialSelection(database.prisma), contentAccess, videos: videoPort }); }
  async function material(access: "free" | "membership" = "free", withVideo = false, seriesIds: string[] = []) {
    const metadata = { title: `Home ${randomUUID()}`, summary: "Continue test", topicId, formatId: withVideo ? videoFormatId : formatId, access, tagIds: [], seriesIds };
    const body = representativeDocument("Personal Home text.");
    const draft = await materials.authoring.createDraft({ actor, idempotencyKey: randomUUID(), metadata, body });
    if (!draft.ok) throw new Error(draft.error.code);
    let videoId: string | null = null;
    if (withVideo) {
      const attached = await videos.attachExisting({ actor, materialId: draft.value.materialId, access: "free", providerVideoId: randomUUID() });
      if (!attached.ok) throw new Error(attached.error.code);
      videoId = attached.value.videoId;
    }
    const saved = await materials.authoring.saveMaterial({ actor, materialId: draft.value.materialId, expectedContentVersion: draft.value.contentVersion, idempotencyKey: randomUUID(), metadata, body, primaryVideoId: videoId, publicationState: "published" });
    if (!saved.ok) throw new Error(saved.error.code);
    return { materialId: saved.value.materialId, contentVersion: saved.value.contentVersion, videoId, metadata, body };
  }
  function open(accountId: string, item: { materialId: string; contentVersion: number }) { return home.recordOpen({ accountId, materialId: item.materialId, contentVersion: item.contentVersion, commandId: randomUUID() }); }
  test("records only authorized current bodies; replay does not move recency or mark completion", async () => {
    const accountId = randomUUID(); const item = await material();
    expect(await home.getContinue(accountId)).toEqual({ ok: true, value: [] });
    const command = { accountId, materialId: item.materialId, contentVersion: item.contentVersion, commandId: randomUUID() };
    const first = await home.recordOpen(command); expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    await open(accountId, item);
    const visit = await database.prisma.readingMaterialVisit.findUniqueOrThrow({ where: { accountId_materialId: { accountId, materialId: item.materialId } } });
    expect(await home.recordOpen(command)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await database.prisma.readingMaterialVisit.findUniqueOrThrow({ where: { accountId_materialId: { accountId, materialId: item.materialId } } })).toEqual(visit);
    expect(await home.recordOpen({ ...command, contentVersion: item.contentVersion + 1 })).toEqual({ ok: false, error: { code: "command_conflict" } });
    expect(await home.recordOpen({ ...command, commandId: randomUUID(), contentVersion: item.contentVersion + 1 })).toEqual({ ok: false, error: { code: "access_changed" } });
    expect(await database.prisma.readingEvent.count({ where: { accountId } })).toBe(0);
    expect(await database.prisma.readingMaterialState.count({ where: { accountId } })).toBe(0);
    expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ material: { materialId: item.materialId }, resume: { kind: "start" } }] });
    expect(await home.getContinue(randomUUID())).toEqual({ ok: true, value: [] });
  });
  test("concurrent visible-open retries commit one visit and one receipt across connections", async () => {
    const accountId = randomUUID(); const item = await material();
    const second = createPrismaClient(database.url);
    try {
      const other = new PersonalHome({ composition: new PublishedSeriesComposition(database.prisma), reader: materials.publishedMaterialReader, prisma: second, materialContent: materials.materialContent, selection: new PublishedMaterialSelection(second), contentAccess, videos });
      const command = { accountId, materialId: item.materialId, contentVersion: item.contentVersion, commandId: randomUUID() };
      const results = await Promise.all([home.recordOpen(command), other.recordOpen(command)]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.filter((result) => result.ok && result.value.replayed)).toHaveLength(1);
      expect(await database.prisma.readingMaterialVisit.count({ where: { accountId } })).toBe(1);
      expect(await database.prisma.readingCommand.count({ where: { accountId } })).toBe(1);
    } finally { await second.$disconnect(); }
  });
  test("marking excludes opened content; unmarking restores only existing opens", async () => {
    const accountId = randomUUID(); const opened = await material(); const unopened = await material();
    await open(accountId, opened);
    for (const item of [opened, unopened]) {
      expect(await reading.setReadingState({ accountId, materialId: item.materialId, commandId: randomUUID(), expectedVersion: 0, isRead: true })).toMatchObject({ ok: true });
    }
    expect(await home.getContinue(accountId)).toEqual({ ok: true, value: [] });
    for (const item of [opened, unopened]) await reading.setReadingState({ accountId, materialId: item.materialId, commandId: randomUUID(), expectedVersion: 1, isRead: false });
    expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ material: { materialId: opened.materialId } }] });
  });
  test("expiry hides protected cards without removing history and rejoin restores them", async () => {
    const accountId = randomUUID(); const item = await material("membership");
    expect(await open(accountId, item)).toMatchObject({ ok: false, error: { code: "access_denied" } });
    try {
      membershipActive = true;
      expect(await open(accountId, item)).toMatchObject({ ok: true });
      expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ material: { materialId: item.materialId } }] });
      membershipActive = false;
      expect(await home.getContinue(accountId)).toEqual({ ok: true, value: [] });
      expect(await database.prisma.readingMaterialVisit.count({ where: { accountId } })).toBe(1);
      membershipActive = true;
      expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ material: { materialId: item.materialId } }] });
    } finally { membershipActive = false; }
  });
  test("video resume belongs to Videos and an unavailable adapter leaves text cards usable", async () => {
    const accountId = randomUUID(); const item = await material("free", true);
    if (item.videoId === null) throw new Error("missing video");
    await open(accountId, item);
    await videos.saveProgress({ accountId, videoId: item.videoId, positionSeconds: 123, durationSeconds: 600 });
    expect(await videos.loadProgressMany({ accountId, videoIds: [item.videoId] })).toMatchObject({ ok: true, value: [{ videoId: item.videoId, positionSeconds: 123 }] });
    expect(await videos.loadProgressMany({ accountId: randomUUID(), videoIds: [item.videoId] })).toEqual({ ok: true, value: [] });
    expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ resume: { kind: "position", positionSeconds: 123 } }] });
    await videos.saveProgress({ accountId, videoId: item.videoId, positionSeconds: 600, durationSeconds: 600 });
    expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ resume: { kind: "reached-end" } }] });
    const unavailable = makeHome({ ...videos, loadProgressMany: () => Promise.resolve({ ok: false, error: { code: "dependency_unavailable", retryable: true } }), loadReadyDurations: () => Promise.resolve({ ok: false, error: { code: "dependency_unavailable", retryable: true } }) });
    expect(await unavailable.getContinue(accountId)).toMatchObject({ ok: true, value: [{ resume: { kind: "start" } }] });
    expect(await database.prisma.readingEvent.count({ where: { accountId } })).toBe(0);
  });
  test("content updates preserve visits and replacement Video starts with its own progress", async () => {
    const accountId = randomUUID(); const item = await material("free", true);
    if (item.videoId === null) throw new Error("missing video");
    await open(accountId, item);
    await videos.saveProgress({ accountId, videoId: item.videoId, positionSeconds: 123, durationSeconds: 600 });
    const visit = await database.prisma.readingMaterialVisit.findUniqueOrThrow({ where: { accountId_materialId: { accountId, materialId: item.materialId } } });
    const replacement = await videos.attachExisting({ actor, materialId: item.materialId, access: "free", providerVideoId: randomUUID() });
    if (!replacement.ok) throw new Error(replacement.error.code);
    const updated = await materials.authoring.saveMaterial({ actor, materialId: item.materialId, expectedContentVersion: item.contentVersion, idempotencyKey: randomUUID(), metadata: { ...item.metadata, title: "Updated video material" }, body: representativeDocument("Updated body"), primaryVideoId: replacement.value.videoId, publicationState: "published" });
    if (!updated.ok) throw new Error(updated.error.code);
    expect(await home.getContinue(accountId)).toMatchObject({ ok: true, value: [{ material: { materialId: item.materialId, title: "Updated video material", primaryVideoId: replacement.value.videoId }, resume: { kind: "start" } }] });
    expect(await database.prisma.readingMaterialVisit.findUniqueOrThrow({ where: { accountId_materialId: { accountId, materialId: item.materialId } } })).toEqual(visit);
    expect(await open(accountId, item)).toEqual({ ok: false, error: { code: "access_changed" } });
    expect(await open(accountId, updated.value)).toMatchObject({ ok: true });
    expect(await videos.loadProgress({ accountId, videoId: item.videoId })).toEqual({ ok: true, value: { positionSeconds: 123 } });
  });
  test("bounds the projection to six, excludes unpublished and rolls back a failed receipt", async () => {
    const accountId = randomUUID();
    for (let index = 0; index < 8; index++) await open(accountId, await material());
    const result = await home.getContinue(accountId); expect(result.ok && result.value).toHaveLength(6);
    if (!result.ok || result.value[0] === undefined) throw new Error("missing result");
    const item = result.value[0].material;
    await materials.authoring.transitionPublication({ actor, materialId: item.materialId, expectedContentVersion: item.contentVersion, idempotencyKey: randomUUID(), publicationState: "unpublished" });
    const filtered = await home.getContinue(accountId);
    expect(filtered.ok && filtered.value.some((entry) => entry.material.materialId === item.materialId)).toBe(false);
    const rejected = await material();
    const pool = new Pool({ connectionString: database.url });
    try {
      await pool.query("CREATE FUNCTION reading_activity.reject_open_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$; CREATE TRIGGER reject_open_receipt BEFORE INSERT ON reading_activity.commands FOR EACH ROW EXECUTE FUNCTION reading_activity.reject_open_receipt();");
      expect(await open(accountId, rejected)).toEqual({ ok: false, error: { code: "dependency_unavailable" } });
      expect(await database.prisma.readingMaterialVisit.count({ where: { accountId, materialId: rejected.materialId } })).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER reject_open_receipt ON reading_activity.commands; DROP FUNCTION reading_activity.reject_open_receipt();");
      await pool.end();
    }
  });
  async function series() {
    const id = randomUUID(); const slug = `series-${id}`;
    await database.prisma.series.create({ data: { id, slug, name: "Learning series" } });
    return { id, slug };
  }
  test("learning Home keeps completed visits as series history, highlights author order and excludes all-read series", async () => {
    const accountId = randomUUID(); const collection = await series();
    const first = await material("free", false, [collection.id]);
    const second = await material("free", false, [collection.id]);
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
    expect(await home.getSeries(accountId, collection.slug)).toMatchObject({ ok: true, value: { total: 2, read: 0, continuation: null } });
    await open(accountId, first);
    await reading.setReadingState({ accountId, materialId: first.materialId, commandId: randomUUID(), expectedVersion: 0, isRead: true });
    const current = await home.getLearning(accountId);
    expect(current).toMatchObject({ ok: true, value: { video: null, series: { collection: { id: collection.id }, total: 2, read: 1 } } });
    if (!current.ok || current.value.series === null) throw new Error("Missing series");
    expect(current.value.series.continuation?.materialSlug).toBe(current.value.series.collection.previewItems.find((item) => item.materialId === second.materialId)?.slug);
    expect(await home.getLearning(randomUUID())).toEqual({ ok: true, value: { video: null, series: null } });
    await reading.setReadingState({ accountId, materialId: second.materialId, commandId: randomUUID(), expectedVersion: 0, isRead: true });
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
    await reading.setReadingState({ accountId, materialId: first.materialId, commandId: randomUUID(), expectedVersion: 1, isRead: false });
    expect(await home.getLearning(accountId)).toMatchObject({ ok: true, value: { series: { total: 2, read: 1 } } });
    await database.prisma.series.update({ where: { id: collection.id }, data: { archivedAt: new Date() } });
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
  });
  test("learning video searches beyond six text visits and rejects ended, completed or replaced Video progress", async () => {
    const accountId = randomUUID(); const video = await material("free", true);
    if (video.videoId === null) throw new Error("missing video");
    await open(accountId, video);
    await videos.saveProgress({ accountId, videoId: video.videoId, positionSeconds: 123, durationSeconds: 600 });
    for (let index = 0; index < 8; index++) await open(accountId, await material());
    expect(await home.getLearning(accountId)).toMatchObject({ ok: true, value: { video: { material: { materialId: video.materialId }, resume: { kind: "position", positionSeconds: 123 } }, series: null } });
    await videos.saveProgress({ accountId, videoId: video.videoId, positionSeconds: 600, durationSeconds: 600 });
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
    expect(await database.prisma.readingMaterialState.count({ where: { accountId, isRead: true } })).toBe(0);
    await videos.saveProgress({ accountId, videoId: video.videoId, positionSeconds: 123, durationSeconds: 600 });
    await reading.setReadingState({ accountId, materialId: video.materialId, commandId: randomUUID(), expectedVersion: 0, isRead: true });
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
    await reading.setReadingState({ accountId, materialId: video.materialId, commandId: randomUUID(), expectedVersion: 1, isRead: false });
    const replacement = await videos.attachExisting({ actor, materialId: video.materialId, access: "free", providerVideoId: randomUUID() });
    if (!replacement.ok) throw new Error(replacement.error.code);
    await materials.authoring.saveMaterial({ actor, materialId: video.materialId, expectedContentVersion: video.contentVersion, idempotencyKey: randomUUID(), metadata: video.metadata, body: video.body, primaryVideoId: replacement.value.videoId, publicationState: "published" });
    expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
  });
  test("series continuation follows reorder and publication while counting all published manual marks", async () => {
    const accountId = randomUUID(); const collection = await series();
    const first = await material("free", false, [collection.id]); const second = await material("free", false, [collection.id]);
    await open(accountId, first);
    const order = await materials.authoring.loadSeriesOrder({ actor, seriesId: collection.id });
    if (!order.ok) throw new Error(order.error.code);
    await materials.authoring.reorderSeries({ actor, seriesId: collection.id, expectedOrderVersion: order.value.orderVersion, orderedMaterialIds: [second.materialId, first.materialId] });
    const result = await home.getSeries(accountId, collection.slug);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.collection.previewItems[0]?.materialId).toBe(second.materialId);
    expect(result.value.continuation?.materialSlug).toBe(result.value.collection.previewItems[0]?.slug);
    await materials.authoring.transitionPublication({ actor, materialId: second.materialId, expectedContentVersion: second.contentVersion, idempotencyKey: randomUUID(), publicationState: "unpublished" });
    expect(await home.getSeries(accountId, collection.slug)).toMatchObject({ ok: true, value: { total: 1, read: 0 } });
  });
  test("series history survives expiry and resumes after rejoining; Videos failure still allows series continuation", async () => {
    const accountId = randomUUID(); const collection = await series();
    const item = await material("membership", false, [collection.id]);
    try {
      membershipActive = true; await open(accountId, item);
      expect(await home.getLearning(accountId)).toMatchObject({ ok: true, value: { series: { collection: { id: collection.id } } } });
      membershipActive = false;
      expect(await home.getLearning(accountId)).toEqual({ ok: true, value: { video: null, series: null } });
      expect(await home.getSeries(accountId, collection.slug)).toMatchObject({ ok: true, value: { total: 1, continuation: null } });
      expect(await database.prisma.readingMaterialVisit.count({ where: { accountId } })).toBe(1);
      membershipActive = true;
      const unavailable = makeHome({ ...videos, loadProgressMany: () => Promise.reject(new Error("offline")), loadReadyDurations: () => Promise.reject(new Error("offline")) });
      expect(await unavailable.getLearning(accountId)).toMatchObject({ ok: true, value: { series: { continuation: { resume: { kind: "start" } } } } });
    } finally { membershipActive = false; }
  });

});
