import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants, type AccessCapability } from "../../src/modules/membership-entitlements/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

/**
 * Состав купленного продукта живой, но снять из него опубликованный материал можно только явным
 * подтверждением с записью в журнал. Держателей права считают настоящие гранты на PostgreSQL.
 */
describe("снятие материала из купленного руководства (реальный PostgreSQL)", () => {
  let db: TestDatabase;
  const owner = randomUUID();
  const buyer = randomUUID();
  const topicId = randomUUID();
  let now = new Date("2030-01-01T00:00:00Z");
  let grants: ReturnType<typeof assembleAccessGrants>;
  let materials: ReturnType<typeof assembleMaterials>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, buyer]) {
      await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
    }
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-removal-fingerprint-key-00000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    await db.prisma.topic.create({ data: { id: topicId, slug: "removal-topic", name: "Снятие" } });
    materials = assembleMaterials({ prisma: db.prisma, authorPolicy: { canManage: (id) => id === owner }, guideAccessHolders: grants });
  });
  afterAll(async () => db.dispose());

  async function guide(): Promise<string> {
    const slug = `removal-${randomUUID()}`;
    const created = await materials.authoring.createContentCollection({ actor: owner, kind: "guide", name: slug, slug, summary: "" });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }
  async function grant(terms: { readonly capabilities: AccessCapability[]; readonly validUntil: string | null; readonly contentScope?: { guideIds: string[]; materialIds: string[] } }) {
    const preview = await grants.previewBatch(owner, { operationId: randomUUID(), rows: [{ rowKey: "fixture", accountId: buyer, source: "manual", sourceRef: randomUUID(),
      terms: { capabilities: terms.capabilities, ...(terms.contentScope === undefined ? {} : { contentScope: terms.contentScope }), startsAt: "2030-01-01T00:00:00Z", validUntil: terms.validUntil, reason: "Синтетическое право" } }] });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, { operationId: randomUUID(), previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["fixture"] });
    if (!applied.ok) throw new Error(applied.error.code);
  }
  function metadata(seriesIds: readonly string[]) {
    return { title: `Материал ${randomUUID()}`, summary: "Шаг купленного руководства", access: "membership" as const, topicId,
      formatId: "guide", tagIds: [], difficulty: null, outcomes: [], seriesIds: [...seriesIds] };
  }
  async function publish(seriesIds: readonly string[]) {
    const meta = metadata(seriesIds);
    const created = await materials.authoring.createDraft({ actor: owner, idempotencyKey: randomUUID(), metadata: meta, body: representativeDocument(meta.title) });
    if (!created.ok) throw new Error(created.error.code);
    const saved = await materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion, publicationState: "published", metadata: meta, body: representativeDocument(meta.title) });
    if (!saved.ok) throw new Error(saved.error.code);
    return { materialId: saved.value.materialId, contentVersion: saved.value.contentVersion, meta };
  }
  function save(item: Awaited<ReturnType<typeof publish>>, change: { readonly seriesIds?: readonly string[]; readonly publicationState?: "published" | "unpublished"; readonly confirmedGuideRemovals?: readonly string[] }) {
    return materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: item.materialId, expectedContentVersion: item.contentVersion,
      publicationState: change.publicationState ?? "published", metadata: { ...item.meta, seriesIds: [...(change.seriesIds ?? item.meta.seriesIds)] },
      body: representativeDocument(item.meta.title), ...(change.confirmedGuideRemovals === undefined ? {} : { confirmedGuideRemovals: change.confirmedGuideRemovals }) });
  }
  async function publishedGuides(materialId: string) {
    return (await db.prisma.publishedMaterialGuideMembership.findMany({ where: { materialId }, orderBy: { seriesId: "asc" } })).map(({ seriesId }) => seriesId);
  }

  test("держателей считают в транзакции снятия, когда она держит весь пул", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const bought = await guide(); const unsold = await guide();
    await grant({ capabilities: [`guide:${bought}`], validUntil: null });
    const item = await publish([bought, unsold]);
    const order = await materials.authoring.loadSeriesOrder({ actor: owner, seriesId: bought });
    if (!order.ok) throw new Error(order.error.code);

    const [saved, reordered] = await withExhaustedPool(db, async (prisma) => {
      const pooled = assembleMaterials({ prisma, authorPolicy: { canManage: (id) => id === owner }, guideAccessHolders: assembleAccessGrants({
        prisma, accounts: assembleAccounts({ prisma, emailFingerprintKey: "synthetic-removal-fingerprint-key-00000" }), clock: () => now,
      }) });
      return [
        await pooled.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: item.materialId, expectedContentVersion: item.contentVersion,
          publicationState: "published", metadata: { ...item.meta, seriesIds: [unsold] }, body: representativeDocument(item.meta.title) }),
        await pooled.authoring.reorderSeries({ actor: owner, seriesId: bought, expectedOrderVersion: order.value.orderVersion, orderedMaterialIds: [] }),
      ] as const;
    });

    const held = { ok: false, error: { code: "guide_removal_confirmation_required", guides: [{ guideId: bought, holders: 1 }] } };
    expect(saved).toMatchObject(held);
    expect(reordered).toMatchObject(held);
  });

  test("сохранение убирает материал из купленного руководства только подтверждением и пишет журнал", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const bought = await guide(); const unsold = await guide();
    await grant({ capabilities: [`guide:${bought}`], validUntil: null });
    const item = await publish([bought, unsold]);

    const refused = await save(item, { seriesIds: [unsold] });
    expect(refused).toMatchObject({ ok: false, error: { code: "guide_removal_confirmation_required", guides: [{ guideId: bought, holders: 1 }] } });
    expect(await publishedGuides(item.materialId)).toEqual([bought, unsold].sort());
    expect(await db.prisma.guideMaterialRemoval.count({ where: { materialId: item.materialId } })).toBe(0);

    const confirmed = await save(item, { seriesIds: [unsold], confirmedGuideRemovals: [bought] });
    if (!confirmed.ok) throw new Error(confirmed.error.code);
    expect(await publishedGuides(item.materialId)).toEqual([unsold]);
    expect(await db.prisma.guideMaterialRemoval.findMany({ where: { materialId: item.materialId } })).toMatchObject([
      { guideId: bought, holders: 1, operation: "material_save", actorAccountId: owner },
    ]);

    // Из руководства без держателей материал уходит без подтверждения и без записи.
    const moved = await save({ ...item, contentVersion: confirmed.value.contentVersion, meta: { ...item.meta, seriesIds: [unsold] } }, { seriesIds: [bought] });
    expect(moved).toMatchObject({ ok: true });
    expect(await db.prisma.guideMaterialRemoval.count({ where: { materialId: item.materialId } })).toBe(1);
  });

  test("снятие с публикации материала купленного руководства тоже требует подтверждения", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const bought = await guide();
    await grant({ capabilities: [`guide:${bought}`], validUntil: null });
    const item = await publish([bought]);
    expect(await save(item, { publicationState: "unpublished" })).toMatchObject({ ok: false, error: { code: "guide_removal_confirmation_required" } });
    expect(await materials.authoring.transitionPublication({ actor: owner, idempotencyKey: randomUUID(), materialId: item.materialId,
      expectedContentVersion: item.contentVersion, publicationState: "unpublished" })).toMatchObject({ ok: false, error: { code: "guide_removal_confirmation_required" } });
    expect(await save(item, { publicationState: "unpublished", confirmedGuideRemovals: [bought] })).toMatchObject({ ok: true });
    expect(await publishedGuides(item.materialId)).toEqual([]);
  });

  test("состав руководства теряет опубликованный шаг только подтверждением", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const bought = await guide();
    // Материалы открывает тариф или оплаченный период с продуктом в составе, а не прямое право.
    const scoped = await grants.applyPaidPeriod({ eventRef: randomUUID(), periodRef: randomUUID(), accountId: buyer, revision: 1, revoked: false,
      terms: { capabilities: ["materials"], contentScope: { guideIds: [bought], materialIds: [] }, startsAt: "2030-01-01T00:00:00Z", validUntil: null, reason: "Синтетический состав" } });
    if (!scoped.ok) throw new Error("Scoped period fixture failed");
    const kept = await publish([bought]); const removed = await publish([bought]);
    const order = await materials.authoring.loadSeriesOrder({ actor: owner, seriesId: bought });
    if (!order.ok) throw new Error(order.error.code);
    const command = { actor: owner, seriesId: bought, expectedOrderVersion: order.value.orderVersion, orderedMaterialIds: [kept.materialId] };
    // Право через состав тарифа тоже делает руководство купленным.
    expect(await materials.authoring.reorderSeries(command)).toMatchObject({ ok: false, error: { code: "guide_removal_confirmation_required", guides: [{ guideId: bought, holders: 1 }] } });
    expect(await publishedGuides(removed.materialId)).toEqual([bought]);
    expect(await materials.authoring.reorderSeries({ ...command, confirmedGuideRemovals: [bought] })).toMatchObject({ ok: true });
    expect(await publishedGuides(removed.materialId)).toEqual([]);
    expect(await db.prisma.guideMaterialRemoval.findMany({ where: { guideId: bought } })).toMatchObject([
      { materialId: removed.materialId, holders: 1, operation: "guide_composition" },
    ]);
  });

  test("истёкшее право не делает руководство купленным", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const lapsed = await guide();
    await grant({ capabilities: [`guide:${lapsed}`], validUntil: "2030-01-02T00:00:00Z" });
    const item = await publish([lapsed]);
    now = new Date("2030-01-03T00:00:00Z");
    expect(await grants.countGuideHolders([lapsed])).toEqual(new Map([[lapsed, 0]]));
    expect(await save(item, { publicationState: "unpublished" })).toMatchObject({ ok: true });
    expect(await db.prisma.guideMaterialRemoval.count({ where: { guideId: lapsed } })).toBe(0);
  });
});
