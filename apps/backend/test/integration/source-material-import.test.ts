import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = { id: "authoring-test-one", path: "materials/one.md", revision: "a".repeat(64), showInFeed: false };
const metadata = { title: "Imported", summary: null, access: "free" as const, difficulty: null, outcomes: [], topicId: null, formatId: "note" as const, tagIds: [], seriesIds: [] };

describe("authoring source Material", () => {
  let database: TestDatabase;
  beforeAll(async () => { database = await createMigratedTestDatabase(); });
  afterAll(async () => { await database.dispose(); });

  test("reserves once, preserves identity across rename, rejects ordinary writes and stale imports", async () => {
    const { authoring } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    const reservations = await Promise.all([
      authoring.reserveSourceMaterial({ actor, source }),
      authoring.reserveSourceMaterial({ actor, source }),
    ]);
    const first = reservations[0];
    expect(first?.ok).toBe(true);
    if (!first?.ok) throw new Error("Source reservation failed");
    expect(reservations[1]).toEqual(first);
    const command = {
      actor, materialId: first.value.materialId, expectedContentVersion: 1,
      idempotencyKey: "apply-one", source, publicationState: "draft" as const,
      primaryVideoId: null, metadata, body: representativeDocument("Imported original"),
    };
    const applied = await authoring.applySourceMaterial(command);
    expect(applied).toMatchObject({ ok: true, value: { contentVersion: 2 } });
    expect(await authoring.applySourceMaterial(command)).toEqual(applied);
    const { source: ignored, ...ordinary } = command;
    void ignored;
    expect(await authoring.saveMaterial({ ...ordinary, expectedContentVersion: 2, idempotencyKey: "ordinary" })).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
    expect(await authoring.deleteDraft({ actor, materialId: command.materialId, expectedContentVersion: 2, idempotencyKey: "delete-source" })).toMatchObject({ ok: false, error: { code: "draft_deletion_forbidden" } });
    expect(await authoring.applySourceMaterial({ ...command, idempotencyKey: "stale-import" })).toMatchObject({ ok: false, error: { code: "stale_content_version" } });
    const renamed = { ...source, path: "materials/renamed.md", revision: "b".repeat(64) };
    expect(await authoring.applySourceMaterial({ ...command, source: renamed, expectedContentVersion: 2, idempotencyKey: "rename-import" })).toMatchObject({ ok: true, value: { materialId: command.materialId, contentVersion: 3 } });
    expect(await authoring.reserveSourceMaterial({ actor, source: renamed })).toMatchObject({ ok: true, value: { materialId: command.materialId, contentVersion: 3 } });
    expect(await authoring.reserveSourceMaterial({ actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
  test("feed scope includes only selected publications and restricts facet counts without changing direct reads", async () => {
    const { authoring, publishedMaterialReader } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    const topic = await authoring.createContentCollection({ actor, kind: "topic", name: "Import topic", slug: "import-topic", summary: "" });
    if (!topic.ok) throw new Error(topic.error.code);
    const ids: string[] = [];
    for (const showInFeed of [false, true]) {
      const feedSource = { ...source, id: `feed-${String(showInFeed)}`, showInFeed };
      const reserved = await authoring.reserveSourceMaterial({ actor, source: feedSource });
      if (!reserved.ok) throw new Error(reserved.error.code);
      ids.push(reserved.value.materialId);
      const saved = await authoring.applySourceMaterial({ actor, source: feedSource, materialId: reserved.value.materialId, expectedContentVersion: 1, idempotencyKey: `feed-${String(showInFeed)}`, publicationState: "published", primaryVideoId: null, metadata: { ...metadata, title: `Feed ${String(showInFeed)}`, summary: "Published import", topicId: topic.value.id }, body: representativeDocument("Searchable needle") });
      expect(saved).toMatchObject({ ok: true });
    }
    const catalog = await publishedMaterialReader.listProjections({ first: 12 });
    expect(catalog).toMatchObject({ ok: true, value: { totalCount: 2 } });
    const feed = await publishedMaterialReader.listProjections({ first: 12, feedOnly: true });
    expect(feed).toMatchObject({ ok: true, value: { totalCount: 1, items: [{ materialId: ids[1] }], facets: { topics: [{ count: 1 }], formats: [{ count: 1 }] } } });
    const hiddenSearch = await publishedMaterialReader.listProjections({ first: 12, feedOnly: true, q: "false" });
    expect(hiddenSearch).toMatchObject({ ok: true, value: { totalCount: 0 } });
  });

  test("ordinary writes cannot change a source programme and removing the final paid feed placement fails", async () => {
    const { authoring } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    const guide = await authoring.reserveSourceGuide({ actor, sourceId: "paid-guide", name: "Paid guide", slug: "paid-guide", summary: "Programme" });
    if (!guide.ok) throw new Error(guide.error.code);
    const ordinary = await authoring.createDraft({ actor, idempotencyKey: "ordinary-in-source-guide", metadata: { ...metadata, seriesIds: [guide.value.id] }, body: representativeDocument("Ordinary") });
    expect(ordinary).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const plain = await authoring.createDraft({ actor, idempotencyKey: "ordinary-outside-guide", metadata, body: representativeDocument("Ordinary") });
    if (!plain.ok) throw new Error(plain.error.code);
    expect(await authoring.saveMaterial({ actor, idempotencyKey: "attach-to-source-guide", materialId: plain.value.materialId, expectedContentVersion: 1, publicationState: "draft", primaryVideoId: null, metadata: { ...metadata, seriesIds: [guide.value.id] }, body: representativeDocument("Ordinary") })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const paidSource = { ...source, id: "paid-feed-lesson", showInFeed: true };
    const reserved = await authoring.reserveSourceMaterial({ actor, source: paidSource });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const topic = await authoring.createContentCollection({ actor, kind: "topic", name: "Paid topic", slug: "paid-topic", summary: "" });
    if (!topic.ok) throw new Error(topic.error.code);
    expect(await authoring.applySourceMaterial({ actor, source: paidSource, materialId: reserved.value.materialId, expectedContentVersion: 1, idempotencyKey: "paid-feed-publish", publicationState: "published", primaryVideoId: null, metadata: { ...metadata, access: "membership", summary: "Paid lesson", topicId: topic.value.id, seriesIds: [guide.value.id] }, body: representativeDocument("Protected body") })).toMatchObject({ ok: true });
    const order = await authoring.loadSeriesOrder({ actor, seriesId: guide.value.id });
    if (!order.ok) throw new Error(order.error.code);
    expect(await authoring.reorderSourceGuide({ actor, sourceId: "paid-guide", seriesId: guide.value.id, expectedOrderVersion: order.value.orderVersion, orderedMaterialIds: [] })).toMatchObject({ ok: false, error: { code: "invalid_reference", issues: [{ code: "standalone_feed_material_must_be_free" }] } });
    expect(await database.prisma.material.findUnique({ where: { id: reserved.value.materialId }, select: { access: true, showInFeed: true } })).toEqual({ access: "membership", showInFeed: true });
    expect(await database.prisma.guideMembership.count({ where: { materialId: reserved.value.materialId } })).toBe(1);
  });

});
