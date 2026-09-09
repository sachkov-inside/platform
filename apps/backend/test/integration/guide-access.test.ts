import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts, accountId } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants, assembleMembershipEntitlements, type AccessCapability } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleMaterials, assembleMaterialResourceFacts } from "../../src/modules/materials/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

// Every access read and write uses production facets over real PostgreSQL.
// No bank payment, Telegram link, public offer or production grant is created.
describe("independent guide, library, support and shared chat rights", () => {
  let db: TestDatabase;
  const owner = randomUUID(), buyer = randomUUID(), guideA = randomUUID(), guideB = randomUUID(), topicId = randomUUID();
  let now = new Date("2030-01-01T00:00:00Z");
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let materials: ReturnType<typeof assembleMaterials>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, buyer]) await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.test", logtoSubject: id } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-scoped-access-fingerprint-key" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    membership = assembleMembershipEntitlements({ prisma: db.prisma, clock: () => now, workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma, clock: () => now }) });
    await db.prisma.topic.create({ data: { id: topicId, slug: "scoped-topic", name: "Synthetic scope" } });
    for (const id of [guideA, guideB]) await db.prisma.guide.create({ data: { id, slug: id, name: `Synthetic ${id}` } });
    materials = assembleMaterials({ prisma: db.prisma, authorPolicy: { canManage: id => id === owner } });
  });
  afterAll(async () => db.dispose());
  async function grant(capabilities: AccessCapability[], validUntil: string | null, source: "manual" | "legacy" = "manual") {
    const preview = await grants.previewBatch(owner, { operationId: randomUUID(), rows: [{ rowKey: "fixture", accountId: buyer, source, sourceRef: randomUUID(), terms: { capabilities, startsAt: "2030-01-01T00:00:00Z", validUntil, reason: "Controlled #407 fixture" } }] });
    if (!preview.ok) throw new Error(preview.error.code);
    const result = await grants.applyBatch(owner, { operationId: randomUUID(), previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["fixture"] });
    if (!result.ok || !result.rows[0]?.result.ok) throw new Error("Grant fixture failed");
    return result.rows[0].result;
  }
  async function material(seriesIds: string[], publicationState: "draft" | "published" = "published") {
    const id = randomUUID(); const metadata = { title: id, summary: "Controlled guide access", access: "membership" as const, topicId, formatId: "guide", tagIds: [], seriesIds };
    const created = await materials.authoring.createDraft({ actor: owner, idempotencyKey: randomUUID(), metadata, body: representativeDocument("Protected content") });
    if (!created.ok) throw new Error(created.error.code);
    if (publicationState === "published") {
      const saved = await materials.authoring.saveMaterial({ actor: owner, idempotencyKey: randomUUID(), materialId: created.value.materialId, expectedContentVersion: 1, publicationState, metadata, body: representativeDocument("Protected content") });
      if (!saved.ok) throw new Error(saved.error.code);
    }
    return materialId(created.value.materialId);
  }
  test("guide A allows its shared Material and direct resource only; B, draft and forged guide context stay denied", async () => {
    const [a, shared, b, draft] = await Promise.all([material([guideA]), material([guideA, guideB]), material([guideB]), material([guideA], "draft")]);
    const guide = await grant([`guide:${guideA}`], null);
    const access = assembleContentAccess({ materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
      accountPermissions: { hasMaterialsManage: id => Promise.resolve(id === owner) }, membershipEntitlements: membership });
    const context = { enforcementPoint: "published_material_read" as const, correlationId: randomUUID() };
    const subject = { kind: "account" as const, accountId: accountId(buyer) };
    for (const id of [a, shared]) expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: id } })).toMatchObject({ effect: "allow", validUntil: null });
    for (const id of [b, draft]) expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: id } })).toMatchObject({ effect: "deny" });
    const forged = { ...context, subject, action: "read" as const, resource: { kind: "material" as const, materialId: b }, guideId: guideA };
    expect(await access.authorize(forged)).toMatchObject({ effect: "deny" });
    expect(await access.checkAvailabilityMany({ ...context, subject, operations: [{ itemId: "A", action: "read", resource: { kind: "material", materialId: a } }, { itemId: "B", action: "read", resource: { kind: "material", materialId: b } }] })).toMatchObject({ ok: true, items: [{ availability: "available" }, { availability: "locked" }] });
    expect(await membership.resolveForAccess(accountId(buyer))).toEqual({ kind: "required" });
    // A library subscription expires independently of a lifetime guide grant.
    await grant(["materials"], "2030-02-01T00:00:00Z");
    expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: b } })).toMatchObject({ effect: "allow" });
    now = new Date("2030-02-02T00:00:00Z");
    expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: b } })).toMatchObject({ effect: "deny" });
    expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: shared } })).toMatchObject({ effect: "allow" });
    const revoke = { action: "revoke" as const, operationId: randomUUID(), grantRef: guide.grantRef, expectedRevision: 1, reason: "Controlled revocation" };
    const results = await Promise.all([grants.changeGrant(owner, revoke), grants.changeGrant(owner, revoke)]);
    expect(results[0]).toEqual(results[1]);
    expect(await access.authorize({ ...context, subject, action: "read", resource: { kind: "material", materialId: a } })).toMatchObject({ effect: "deny" });
  });
  test("two sources of the single chat survive one revocation; support expires separately and legacy lifetime remains", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const first = await grant(["community"], null);
    await grant(["community"], null, "legacy");
    await grant(["support"], "2030-01-02T00:00:00Z");
    expect(await grants.changeGrant(owner, { action: "revoke", operationId: randomUUID(), grantRef: first.grantRef, expectedRevision: 1, reason: "Controlled one-source revocation" })).toMatchObject({ ok: true });
    now = new Date("2030-01-03T00:00:00Z");
    const resolved = await grants.resolveCapabilities(buyer);
    if (!resolved.ok) throw new Error(resolved.error.code);
    expect(resolved.capabilities).toContainEqual({ capability: "community", validUntil: null });
    expect(resolved.capabilities.some(value => value.capability === "support")).toBe(false);
  });
});
