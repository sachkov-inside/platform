import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPrismaClient, type PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import { accountId as checkedAccountId } from "../../src/modules/accounts/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleMaterialResourceFacts, assembleMaterials, PublishedMaterialSelection } from "../../src/modules/materials/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { Bookmarks } from "../../src/modules/bookmarks/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assembleLegacyCohortFixture } from "./setup/legacy-cohort.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = randomUUID();
const accountId = randomUUID();
const topicId = randomUUID();
const formatId = "note";

describe("Bookmarks on PostgreSQL", () => {
  let database: TestDatabase;
  let second: PlatformPrisma;
  let bookmarks: Bookmarks;
  let materials: ReturnType<typeof assembleMaterials>;
  let membership: ReturnType<typeof assembleLegacyCohortFixture>;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    second = createPrismaClient(database.url);
    await database.prisma.topic.create({ data: { id: topicId, name: "Bookmarks", slug: "bookmarks" } });
    materials = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    membership = assembleLegacyCohortFixture({
      prisma: database.prisma,
      clock: () => new Date(),
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: database.prisma }),
    });
    bookmarks = assembleBookmarks(database.prisma);
  });
  afterAll(async () => { await second.$disconnect(); await database.dispose(); });

  function assembleBookmarks(prisma: PlatformPrisma) {
    return new Bookmarks({
      prisma,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
        accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
        membershipEntitlements: membership,
      }),
      selection: new PublishedMaterialSelection(prisma),
      videos: { loadReadyDurations: () => Promise.resolve({ ok: true as const, value: [] }) },
    });
  }
  async function material(access: "free" | "membership" = "free") {
    const created = await materials.authoring.createDraft({
      actor, idempotencyKey: randomUUID(),
      metadata: { title: `Material ${randomUUID()}`, summary: "Bookmark test", topicId, formatId, access, tagIds: [], seriesIds: [] },
      body: representativeDocument("Bookmark me."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor, idempotencyKey: randomUUID(), materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion, publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    return published.value.materialId;
  }
  async function transition(materialId: string, publicationState: "published" | "unpublished") {
    const loaded = await materials.authoring.loadMaterial({ actor, materialId });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const changed = await materials.authoring.transitionPublication({
      actor, materialId, publicationState, expectedContentVersion: loaded.value.contentVersion, idempotencyKey: randomUUID(),
    });
    if (!changed.ok) throw new Error(changed.error.code);
  }
  async function memberWithAccess() {
    const memberId = checkedAccountId(randomUUID());
    await membership.acceptEvidence({ accountId: memberId, deliveryId: randomUUID(), source: "link_time", evidence: {
      contractVersion: "inside.membership-evidence.v1", principalRef: `principal-${memberId}`, decision: "member", reasonCode: "chat_member",
      checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 240_000).toISOString(),
      telegramIdentityRef: `telegram-${memberId}`, evidenceRef: randomUUID(), evidenceVersion: 1,
    } });
    return memberId;
  }
  async function expireMembership(memberId: string, version: number) {
    await membership.acceptEvidence({ accountId: checkedAccountId(memberId), deliveryId: randomUUID(), source: "member_status_event", evidence: {
      contractVersion: "inside.membership-evidence.v1", principalRef: `principal-${memberId}`, decision: "not_member", reasonCode: "chat_not_member",
      checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 240_000).toISOString(),
      telegramIdentityRef: `telegram-${memberId}`, evidenceRef: randomUUID(), evidenceVersion: version,
    } });
  }

  test("add and remove are idempotent and isolated per Account", async () => {
    const id = await material();
    const first = await bookmarks.addBookmark({ accountId, materialId: id });
    if (!first.ok) throw new Error(first.error.code);
    const repeated = await bookmarks.addBookmark({ accountId, materialId: id });
    expect(repeated).toEqual(first);
    expect(await bookmarks.getBookmarkStates({ accountId, materialIds: [id] })).toEqual({ ok: true, value: [{ materialId: id, bookmarked: true, bookmarkedAt: first.value.bookmarkedAt }] });
    expect(await bookmarks.getBookmarkStates({ accountId: randomUUID(), materialIds: [id] })).toMatchObject({ ok: true, value: [{ bookmarked: false, bookmarkedAt: null }] });
    const listed = await bookmarks.listBookmarks({ accountId, first: 12 });
    expect(listed).toMatchObject({ ok: true, value: { items: [{ materialId: id, availability: "available" }], nextCursor: null } });
    expect(await bookmarks.removeBookmark({ accountId, materialId: id })).toMatchObject({ ok: true, value: { bookmarked: false, bookmarkedAt: null } });
    expect(await bookmarks.removeBookmark({ accountId, materialId: id })).toMatchObject({ ok: true, value: { bookmarked: false, bookmarkedAt: null } });
    expect(await bookmarks.getBookmarkStates({ accountId, materialIds: [id] })).toMatchObject({ ok: true, value: [{ bookmarked: false }] });
    expect(await database.prisma.bookmarkedMaterial.count({ where: { materialId: id } })).toBe(0);
  });

  test("protected Materials require current access and stay removable after access loss", async () => {
    const protectedId = await material("membership");
    expect(await bookmarks.addBookmark({ accountId, materialId: protectedId })).toEqual({ ok: false, error: { code: "access_denied" } });
    const memberId = await memberWithAccess();
    expect(await bookmarks.addBookmark({ accountId: memberId, materialId: protectedId })).toMatchObject({ ok: true, value: { bookmarked: true } });
    expect(await bookmarks.listBookmarks({ accountId: memberId, first: 12 })).toMatchObject({ ok: true, value: { items: [{ materialId: protectedId, availability: "available" }] } });
    await expireMembership(memberId, 2);
    const locked = await bookmarks.listBookmarks({ accountId: memberId, first: 12 });
    expect(locked).toMatchObject({ ok: true, value: { items: [{ materialId: protectedId, availability: "locked" }] } });
    expect(await bookmarks.removeBookmark({ accountId: memberId, materialId: protectedId })).toMatchObject({ ok: true, value: { bookmarked: false } });
    expect(await bookmarks.listBookmarks({ accountId: memberId, first: 12 })).toMatchObject({ ok: true, value: { items: [], nextCursor: null } });
  });

  test("list hides unpublished Materials, keeps the bookmark, orders newest first and paginates", async () => {
    const firstId = await material();
    const secondId = await material();
    const thirdId = await material();
    for (const id of [firstId, secondId, thirdId]) {
      const added = await bookmarks.addBookmark({ accountId, materialId: id });
      if (!added.ok) throw new Error(added.error.code);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const page = await bookmarks.listBookmarks({ accountId, first: 2 });
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.items.map((item) => item.materialId)).toEqual([thirdId, secondId]);
    expect(page.value.nextCursor).not.toBeNull();
    const next = await bookmarks.listBookmarks({ accountId, first: 2, after: page.value.nextCursor ?? "" });
    expect(next).toMatchObject({ ok: true, value: { items: [{ materialId: firstId }], nextCursor: null } });
    await transition(thirdId, "unpublished");
    expect(await bookmarks.listBookmarks({ accountId, first: 12 })).toMatchObject({ ok: true, value: { items: [{ materialId: secondId }, { materialId: firstId }] } });
    expect(await database.prisma.bookmarkedMaterial.count({ where: { accountId, materialId: thirdId } })).toBe(1);
    await transition(thirdId, "published");
    expect(await bookmarks.listBookmarks({ accountId, first: 12 })).toMatchObject({ ok: true, value: { items: [{ materialId: thirdId }, { materialId: secondId }, { materialId: firstId }] } });
  });

  test("batch reads are bounded, deduplicated and validate their shape", async () => {
    const id = await material();
    await bookmarks.addBookmark({ accountId, materialId: id });
    expect(await bookmarks.getBookmarkStates({ accountId, materialIds: [id, id.toUpperCase()] })).toMatchObject({ ok: true, value: [{ materialId: id.toLowerCase(), bookmarked: true }] });
    expect(await bookmarks.getBookmarkStates({ accountId, materialIds: Array.from({ length: 101 }, () => id) })).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await bookmarks.getBookmarkStates({ accountId, materialIds: [] })).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await bookmarks.addBookmark({ accountId, materialId: "not-a-uuid" })).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await bookmarks.listBookmarks({ accountId, first: 0 })).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await bookmarks.listBookmarks({ accountId, first: 12, after: "not-a-cursor" })).toEqual({ ok: false, error: { code: "invalid_request" } });
  });
});
