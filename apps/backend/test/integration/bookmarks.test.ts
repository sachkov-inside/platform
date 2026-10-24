import { BookmarkActivityRetention } from "../../src/modules/bookmarks/index.js";
import { activityTestClock } from "./setup/activity-test-clock.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  Prisma,
  createPrismaClient,
  type PlatformPrisma,
} from "../../src/infrastructure/prisma/index.js";
import { accountId as checkedAccountId } from "../../src/modules/accounts/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
  PublishedMaterialSelection,
} from "../../src/modules/materials/index.js";
import {
  Bookmarks,
  BookmarkActivityFacts,
} from "../../src/modules/bookmarks/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = randomUUID();
const accountId = randomUUID();
const topicId = randomUUID();
const formatId = "note";

describe("Bookmarks on PostgreSQL", () => {
  let database: TestDatabase;
  let second: PlatformPrisma;
  let bookmarks: Bookmarks;
  let materials: ReturnType<typeof assembleMaterials>;
  let membership: ReturnType<typeof assemblePriorParticipantsFixture>;
  const closedProductId = randomUUID();

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    second = createPrismaClient(database.url);
    await database.prisma.topic.create({
      data: { id: topicId, name: "Bookmarks", slug: "bookmarks" },
    });
    // Закрытый материал публикуется только внутри продукта; доступ здесь даёт явный состав моста.
    await database.prisma.product.create({
      data: {
        id: closedProductId,
        slug: `bookmarks-${closedProductId}`,
        name: "Bookmarks closed product",
      },
    });
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    membership = assemblePriorParticipantsFixture({
      prisma: database.prisma,
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      clock: () => new Date(),
    });
    bookmarks = assembleBookmarks(database.prisma);
  });
  afterAll(async () => {
    await second.$disconnect();
    await database.dispose();
  });

  function assembleBookmarks(prisma: PlatformPrisma) {
    return new Bookmarks({
      prisma,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          materials.materialContent,
        ),
        accountPermissions: {
          hasMaterialsManage: () => Promise.resolve(false),
        },
        accountRights: membership,
      }),
      selection: new PublishedMaterialSelection(prisma),
      videos: {
        loadReadyDurations: () =>
          Promise.resolve({ ok: true as const, value: [] }),
      },
    });
  }
  async function material(access: "free" | "closed" = "free") {
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: `Material ${randomUUID()}`,
        summary: "Bookmark test",
        topicId,
        formatId,
        access,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: access === "closed" ? [closedProductId] : [],
      },
      body: representativeDocument("Bookmark me."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    return published.value.materialId;
  }
  async function transition(
    materialId: string,
    publicationState: "published" | "unpublished",
  ) {
    const loaded = await materials.authoring.loadMaterial({
      actor,
      materialId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const changed = await materials.authoring.transitionPublication({
      actor,
      materialId,
      publicationState,
      expectedContentVersion: loaded.value.contentVersion,
      idempotencyKey: randomUUID(),
    });
    if (!changed.ok) throw new Error(changed.error.code);
  }
  async function memberWithAccess() {
    const memberId = checkedAccountId(randomUUID());
    await membership.acceptEvidence({
      accountId: memberId,
      deliveryId: randomUUID(),
      source: "link_time",
      evidence: {
        contractVersion: "inside.membership-evidence.v1",
        principalRef: `principal-${memberId}`,
        decision: "member",
        reasonCode: "chat_member",
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        checkedAt: new Date().toISOString(),
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        validUntil: new Date(Date.now() + 240_000).toISOString(),
        telegramIdentityRef: `telegram-${memberId}`,
        evidenceRef: randomUUID(),
        evidenceVersion: 1,
      },
    });
    return memberId;
  }
  async function expireMembership(memberId: string, version: number) {
    await membership.acceptEvidence({
      accountId: checkedAccountId(memberId),
      deliveryId: randomUUID(),
      source: "member_status_event",
      evidence: {
        contractVersion: "inside.membership-evidence.v1",
        principalRef: `principal-${memberId}`,
        decision: "not_member",
        reasonCode: "chat_not_member",
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        checkedAt: new Date().toISOString(),
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        validUntil: new Date(Date.now() + 240_000).toISOString(),
        telegramIdentityRef: `telegram-${memberId}`,
        evidenceRef: randomUUID(),
        evidenceVersion: version,
      },
    });
  }

  test("add and remove are idempotent and isolated per Account", async () => {
    const id = await material();
    const first = await bookmarks.addBookmark({ accountId, materialId: id });
    if (!first.ok) throw new Error(first.error.code);
    const repeated = await bookmarks.addBookmark({ accountId, materialId: id });
    expect(repeated).toEqual(first);
    expect(
      await bookmarks.getBookmarkStates({ accountId, materialIds: [id] }),
    ).toEqual({
      ok: true,
      value: [
        {
          materialId: id,
          bookmarked: true,
          bookmarkedAt: first.value.bookmarkedAt,
        },
      ],
    });
    expect(
      await bookmarks.getBookmarkStates({
        accountId: randomUUID(),
        materialIds: [id],
      }),
    ).toMatchObject({
      ok: true,
      value: [{ bookmarked: false, bookmarkedAt: null }],
    });
    const listed = await bookmarks.listBookmarks({ accountId, first: 12 });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        items: [{ materialId: id, availability: "available" }],
        nextCursor: null,
      },
    });
    expect(
      await bookmarks.removeBookmark({ accountId, materialId: id }),
    ).toMatchObject({
      ok: true,
      value: { bookmarked: false, bookmarkedAt: null },
    });
    expect(
      await bookmarks.removeBookmark({ accountId, materialId: id }),
    ).toMatchObject({
      ok: true,
      value: { bookmarked: false, bookmarkedAt: null },
    });
    expect(
      await bookmarks.getBookmarkStates({ accountId, materialIds: [id] }),
    ).toMatchObject({ ok: true, value: [{ bookmarked: false }] });
    expect(
      await database.prisma.bookmarkedMaterial.count({
        where: { materialId: id },
      }),
    ).toBe(0);
  });

  test("protected Materials require current access and stay removable after access loss", async () => {
    const protectedId = await material("closed");
    expect(
      await bookmarks.addBookmark({ accountId, materialId: protectedId }),
    ).toEqual({ ok: false, error: { code: "access_denied" } });
    const memberId = await memberWithAccess();
    await database.prisma.legacyClassification.update({
      where: { accountId: memberId },
      data: {
        bridgeCoverage: { productIds: [], materialIds: [protectedId] },
      },
    });
    expect(
      await bookmarks.addBookmark({
        accountId: memberId,
        materialId: protectedId,
      }),
    ).toMatchObject({ ok: true, value: { bookmarked: true } });
    expect(
      await bookmarks.listBookmarks({ accountId: memberId, first: 12 }),
    ).toMatchObject({
      ok: true,
      value: {
        items: [{ materialId: protectedId, availability: "available" }],
      },
    });
    await expireMembership(memberId, 2);
    const locked = await bookmarks.listBookmarks({
      accountId: memberId,
      first: 12,
    });
    expect(locked).toMatchObject({
      ok: true,
      value: { items: [{ materialId: protectedId, availability: "locked" }] },
    });
    expect(
      await bookmarks.removeBookmark({
        accountId: memberId,
        materialId: protectedId,
      }),
    ).toMatchObject({ ok: true, value: { bookmarked: false } });
    expect(
      await bookmarks.listBookmarks({ accountId: memberId, first: 12 }),
    ).toMatchObject({ ok: true, value: { items: [], nextCursor: null } });
  });

  test("a full raw page of retained unpublished bookmarks continues to a published bookmark without leaking Accounts", async () => {
    const reader = randomUUID();
    const otherReader = randomUUID();
    const visible = await material();
    const unpublished: string[] = [];
    for (let index = 0; index < 12; index += 1)
      unpublished.push(await material());
    // Prepare all rows before observing the public list operation.
    for (const [index, id] of [visible, ...unpublished].entries()) {
      const added = await bookmarks.addBookmark({
        accountId: reader,
        materialId: id,
      });
      if (!added.ok) throw new Error(added.error.code);
      await database.prisma.bookmarkedMaterial.update({
        where: { accountId_materialId: { accountId: reader, materialId: id } },
        data: { bookmarkedAt: new Date(Date.UTC(2030, 0, 2, 0, 0, index)) },
      });
    }
    for (const id of unpublished) await transition(id, "unpublished");
    const first = await bookmarks.listBookmarks({
      accountId: reader,
      first: 12,
    });
    if (!first.ok) throw new Error(first.error.code);
    expect(first.value.items).toEqual([]);
    expect(first.value.nextCursor).not.toBeNull();
    const after = first.value.nextCursor ?? "";
    expect(
      await bookmarks.listBookmarks({ accountId: reader, first: 12, after }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ materialId: visible }], nextCursor: null },
    });
    expect(
      await bookmarks.listBookmarks({
        accountId: otherReader,
        first: 12,
        after,
      }),
    ).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
    // Republishing exposes the retained raw bookmark, not a recreated bookmark.
    const republished = unpublished.at(-1);
    if (republished === undefined)
      throw new Error("Unpublished fixture is required");
    await transition(republished, "published");
    expect(
      await bookmarks.listBookmarks({ accountId: reader, first: 12 }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ materialId: republished }] },
    });
  });

  test("list hides unpublished Materials, keeps the bookmark, orders newest first and paginates", async () => {
    const firstId = await material();
    const secondId = await material();
    const thirdId = await material();
    for (const [index, id] of [firstId, secondId, thirdId].entries()) {
      const added = await bookmarks.addBookmark({ accountId, materialId: id });
      if (!added.ok) throw new Error(added.error.code);
      await database.prisma.bookmarkedMaterial.update({
        where: { accountId_materialId: { accountId, materialId: id } },
        data: { bookmarkedAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index)) },
      });
    }
    const page = await bookmarks.listBookmarks({ accountId, first: 2 });
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.items.map((item) => item.materialId)).toEqual([
      thirdId,
      secondId,
    ]);
    expect(page.value.nextCursor).not.toBeNull();
    const next = await bookmarks.listBookmarks({
      accountId,
      first: 2,
      after: page.value.nextCursor ?? "",
    });
    expect(next).toMatchObject({
      ok: true,
      value: { items: [{ materialId: firstId }], nextCursor: null },
    });
    await transition(thirdId, "unpublished");
    expect(
      await bookmarks.listBookmarks({ accountId, first: 12 }),
    ).toMatchObject({
      ok: true,
      value: { items: [{ materialId: secondId }, { materialId: firstId }] },
    });
    expect(
      await database.prisma.bookmarkedMaterial.count({
        where: { accountId, materialId: thirdId },
      }),
    ).toBe(1);
    await transition(thirdId, "published");
    expect(
      await bookmarks.listBookmarks({ accountId, first: 12 }),
    ).toMatchObject({
      ok: true,
      value: {
        items: [
          { materialId: thirdId },
          { materialId: secondId },
          { materialId: firstId },
        ],
      },
    });
  });

  test("batch reads are bounded, deduplicated and validate their shape", async () => {
    const id = await material();
    await bookmarks.addBookmark({ accountId, materialId: id });
    expect(
      await bookmarks.getBookmarkStates({
        accountId,
        materialIds: [id, id.toUpperCase()],
      }),
    ).toMatchObject({
      ok: true,
      value: [{ materialId: id.toLowerCase(), bookmarked: true }],
    });
    expect(
      await bookmarks.getBookmarkStates({
        accountId,
        materialIds: Array.from({ length: 101 }, () => id),
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await bookmarks.getBookmarkStates({ accountId, materialIds: [] }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await bookmarks.addBookmark({ accountId, materialId: "not-a-uuid" }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await bookmarks.listBookmarks({ accountId, first: 0 })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(
      await bookmarks.listBookmarks({
        accountId,
        first: 12,
        after: "not-a-cursor",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
  });
  test("records only actual bookmark transitions under concurrent duplicate delivery", async () => {
    const clock = await activityTestClock(database.prisma);
    vi.setSystemTime(clock.at);
    const materialId = await material();
    const accountId = randomUUID();
    const facts = new BookmarkActivityFacts(database.prisma);
    const command = { accountId, materialId };
    await Promise.all([
      bookmarks.addBookmark(command),
      bookmarks.addBookmark(command),
    ]);
    await Promise.all([
      bookmarks.removeBookmark(command),
      bookmarks.removeBookmark(command),
    ]);
    const report = await facts.read(clock.window);
    if (!report.ok) throw new Error(report.error.code);
    expect(
      report.value.rows
        .filter((row) => row.accountId === accountId)
        .map(({ accountId, kind, eventCount }) => ({
          accountId,
          kind,
          eventCount,
        })),
    ).toEqual([
      { accountId, kind: "bookmark_added", eventCount: 1 },
      { accountId, kind: "bookmark_removed", eventCount: 1 },
    ]);
    expect(report.value.coverage).toMatchObject({
      status: "partial",
      collectionStartedAt: null,
      continuity: "not_proven",
    });
  });
  test("journal failure rolls back bookmark state and legacy state is not backfilled as activity", async () => {
    const clock = await activityTestClock(database.prisma);
    vi.setSystemTime(clock.at);
    const materialId = await material();
    const accountId = randomUUID();
    const command = { accountId, materialId };
    await database.prisma.$executeRaw(
      Prisma.sql`alter table bookmarks.activity_events add constraint fail_fixture check (event_type = 'never') not valid`,
    );
    try {
      expect(await bookmarks.addBookmark(command)).toMatchObject({ ok: false });
      expect(
        await bookmarks.getBookmarkStates({
          accountId,
          materialIds: [materialId],
        }),
      ).toMatchObject({ ok: true, value: [{ materialId, bookmarked: false }] });
    } finally {
      await database.prisma.$executeRaw(
        Prisma.sql`alter table bookmarks.activity_events drop constraint fail_fixture`,
      );
    }
    await database.prisma.bookmarkedMaterial.create({
      data: {
        accountId,
        materialId,
        bookmarkedAt: clock.at,
      },
    });
    await bookmarks.addBookmark(command);
    const report = await new BookmarkActivityFacts(database.prisma).read(
      clock.window,
    );
    if (!report.ok) throw new Error(report.error.code);
    expect(report.value.rows.some((row) => row.accountId === accountId)).toBe(
      false,
    );
  });

  test("retaining analytics copies preserves current bookmark dedup and genuine later transitions", async () => {
    const clock = await activityTestClock(database.prisma);
    vi.setSystemTime(clock.at);
    const id = await material();
    const account = randomUUID();
    const command = { accountId: account, materialId: id };
    expect(await bookmarks.addBookmark(command)).toMatchObject({ ok: true });
    const current = await database.prisma.bookmarkedMaterial.findMany({
      where: { accountId: account },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`update bookmarks.activity_events set occurred_at=transaction_timestamp()-interval '366 days' where account_id=${account}::uuid`,
    );
    expect(
      await new BookmarkActivityRetention(database.prisma).clean(),
    ).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(await bookmarks.addBookmark(command)).toMatchObject({ ok: true });
    expect(
      await database.prisma.bookmarkedMaterial.findMany({
        where: { accountId: account },
      }),
    ).toEqual(current);
    const empty = await new BookmarkActivityFacts(database.prisma).read(
      clock.window,
    );
    if (!empty.ok) throw new Error(empty.error.code);
    expect(empty.value.rows.some((row) => row.accountId === account)).toBe(
      false,
    );
    expect(await bookmarks.removeBookmark(command)).toMatchObject({ ok: true });
    expect(await bookmarks.removeBookmark(command)).toMatchObject({ ok: true });
    expect(await bookmarks.addBookmark(command)).toMatchObject({ ok: true });
    const report = await new BookmarkActivityFacts(database.prisma).read(
      clock.window,
    );
    if (!report.ok) throw new Error(report.error.code);
    expect(
      report.value.rows
        .filter((row) => row.accountId === account)
        .map(({ kind, eventCount }) => ({ kind, eventCount })),
    ).toEqual([
      { kind: "bookmark_added", eventCount: 1 },
      { kind: "bookmark_removed", eventCount: 1 },
    ]);
  });
});
