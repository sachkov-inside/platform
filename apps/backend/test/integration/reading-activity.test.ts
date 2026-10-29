import { ReadingActivityRetention } from "../../src/modules/reading-activity/index.js";
import { activityTestClock } from "./setup/activity-test-clock.js";
import { everyAccountLinked } from "../support/telegram-links.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  Prisma,
  createPrismaClient,
  lockReadingPair,
  type PlatformPrisma,
} from "../../src/infrastructure/prisma/index.js";
import { accountId as checkedAccountId } from "../../src/modules/accounts/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { PublishedProductComposition } from "../../src/modules/products/index.js";
import {
  assembleMaterialResourceFacts,
  materialId,
  PublishedMaterialSelection,
} from "../../src/modules/materials/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";

import {
  PersonalHome,
  ReadingActivityFacts,
  ReadingActivity,
} from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = randomUUID();
const accountId = randomUUID();
const topicId = randomUUID();
const formatId = "note";

describe("ReadingActivity on PostgreSQL", () => {
  let database: TestDatabase;
  let second: PlatformPrisma;
  let reading: ReadingActivity;
  let materials: ReturnType<typeof assembleMaterials>;
  let membership: ReturnType<typeof assemblePriorParticipantsFixture>;
  let composition: PublishedProductComposition;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    second = createPrismaClient(database.url);
    await database.prisma.topic.create({
      data: { id: topicId, name: "Reading", slug: "reading" },
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
    composition = new PublishedProductComposition(
      database.prisma,
      assembleProductMaterialReading(database.prisma),
    );
    reading = assembleReading(database.prisma);
  });
  afterAll(async () => {
    await second.$disconnect();
    await database.dispose();
  });

  function assembleReading(prisma: PlatformPrisma) {
    return new ReadingActivity({
      prisma,
      materialContent: materials.materialContent,
      contentAccess: assembleContentAccess({
        telegramLinks: everyAccountLinked,
        materialResourceFacts: assembleMaterialResourceFacts(
          materials.materialContent,
        ),
        accountPermissions: {
          hasMaterialsManage: () => Promise.resolve(false),
        },
        accountRights: membership,
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        clock: () => new Date(),
      }),
      composition,
    });
  }
  /** Catalogue membership alone does not create a programme placement. */
  async function placeInProgramme(
    productIds: readonly string[],
    materialId: string,
  ) {
    for (const productId of productIds) {
      const last = await database.prisma.productProgrammePlacement.aggregate({
        where: { productId },
        _max: { ordinal: true },
      });
      await database.prisma.productProgrammePlacement.create({
        data: {
          id: randomUUID(),
          productId,
          materialId,
          chapterId: null,
          ordinal: (last._max.ordinal ?? 0) + 1,
        },
      });
    }
  }
  async function material(
    productIds: string[] = [],
    access: "free" | "closed" = "free",
  ) {
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: `Material ${randomUUID()}`,
        summary: "Reading test",
        topicId,
        formatId,
        access,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds,
      },
      body: representativeDocument("Read me."),
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
    await placeInProgramme(productIds, published.value.materialId);
    return published.value.materialId;
  }
  function command(materialId: string, isRead = true, expectedVersion = 0) {
    return {
      accountId,
      materialId,
      isRead,
      expectedVersion,
      commandId: randomUUID(),
    };
  }
  async function counts(materialId: string) {
    return Promise.all([
      database.prisma.readingMaterialState.count({ where: { materialId } }),
      database.prisma.readingEvent.count({ where: { materialId } }),
    ]);
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
  async function product() {
    const id = randomUUID();
    await database.prisma.product.create({
      data: { id, slug: `product-${id}`, name: "Reading product" },
    });
    return id;
  }

  test("no-op preserves timestamps/version, stale no-op conflicts, replay after unmark never resurrects a mark", async () => {
    const id = await material();
    const mark = command(id);
    const first = await reading.setReadingState(mark);
    expect(first).toMatchObject({
      ok: true,
      value: {
        changed: true,
        replayed: false,
        state: { isRead: true, version: 1 },
      },
    });
    const noOp = await reading.setReadingState(command(id, true, 1));
    if (!first.ok || !noOp.ok) throw new Error("Expected success");
    expect(noOp.value.state).toEqual(first.value.state);
    expect(noOp.value.changed).toBe(false);
    expect(await reading.setReadingState(command(id))).toMatchObject({
      ok: false,
      error: { code: "stale_version", current: { version: 1 } },
    });
    expect(await counts(id)).toEqual([1, 1]);
    expect(await reading.setReadingState(command(id, false, 1))).toMatchObject({
      ok: true,
      value: { state: { isRead: false, readAt: null, version: 2 } },
    });
    expect(await reading.setReadingState(mark)).toEqual({
      ok: true,
      value: { ...first.value, replayed: true },
    });
    expect(
      await reading.getReadingStates({ accountId, materialIds: [id] }),
    ).toMatchObject({ ok: true, value: [{ isRead: false, version: 2 }] });
    expect(await reading.setReadingState({ ...mark, isRead: false })).toEqual({
      ok: false,
      error: { code: "command_conflict" },
    });
    expect(await counts(id)).toEqual([1, 2]);
  });

  test("absent false state stays sparse, including durable no-op replay", async () => {
    const id = randomUUID();
    const noOp = command(id, false);
    expect(await reading.setReadingState(noOp)).toMatchObject({
      ok: true,
      value: { changed: false, state: { version: 0, updatedAt: null } },
    });
    expect(await reading.setReadingState(noOp)).toMatchObject({
      ok: true,
      value: { replayed: true },
    });
    expect(await counts(id)).toEqual([0, 0]);
  });

  test("two clients serialize first writes, identical commands and reused command IDs across materials", async () => {
    const other = assembleReading(second);
    const id = await material();
    const results = await Promise.all([
      reading.setReadingState(command(id)),
      other.setReadingState(command(id)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { code: "stale_version" },
    });
    expect(await counts(id)).toEqual([1, 1]);
    const shared = command(await material());
    const retries = await Promise.all([
      reading.setReadingState(shared),
      other.setReadingState(shared),
    ]);
    expect(
      retries.map((result) => result.ok && result.value.replayed).sort(),
    ).toEqual([false, true]);
    expect(await counts(shared.materialId)).toEqual([1, 1]);
    const reused = command(await material());
    const mismatches = await Promise.all([
      reading.setReadingState(reused),
      other.setReadingState({ ...reused, materialId: await material() }),
    ]);
    expect(mismatches.filter((result) => result.ok)).toHaveLength(1);
    expect(mismatches).toContainEqual({
      ok: false,
      error: { code: "command_conflict" },
    });
  });

  test("an event failure and a receipt failure roll back state, history and command together", async () => {
    const admin = new Pool({ connectionString: database.url });
    try {
      for (const table of ["events", "commands"] as const) {
        const id = await material();
        const request = command(id);
        await admin.query(
          `CREATE FUNCTION reading_activity.reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$`,
        );
        await admin.query(
          `CREATE TRIGGER reject_write BEFORE INSERT ON reading_activity.${table} FOR EACH ROW EXECUTE FUNCTION reading_activity.reject_write()`,
        );
        expect(await reading.setReadingState(request)).toEqual({
          ok: false,
          error: { code: "dependency_unavailable" },
        });
        expect(await counts(id)).toEqual([0, 0]);
        expect(
          await database.prisma.readingCommand.count({
            where: { commandId: request.commandId },
          }),
        ).toBe(0);
        await admin.query(
          `DROP TRIGGER reject_write ON reading_activity.${table}`,
        );
        await admin.query("DROP FUNCTION reading_activity.reject_write()");
        expect(await reading.setReadingState(request)).toMatchObject({
          ok: true,
          value: { state: { version: 1 } },
        });
      }
    } finally {
      await admin.end();
    }
  });

  test("free non-member and revoked member retain private marks; protected marks still require current access", async () => {
    const free = await material();
    // Закрытый материал публикуется только внутри продукта; доступ здесь даёт явный состав моста.
    const protectedId = await material([await product()], "closed");
    const memberId = checkedAccountId(randomUUID());
    expect(await reading.setReadingState(command(free))).toMatchObject({
      ok: true,
    });
    expect(await reading.setReadingState(command(protectedId))).toEqual({
      ok: false,
      error: { code: "access_denied" },
    });
    const products = await database.prisma.productMembership.findMany({
      where: { materialId: protectedId },
    });
    const productId = products[0]?.productId;
    if (productId === undefined) throw new Error("Missing Product fixture");
    const target = await grantProductFixture(
      database.prisma,
      memberId,
      productId,
    );
    expect(
      await reading.setReadingState({
        ...command(protectedId),
        accountId: memberId,
      }),
    ).toMatchObject({ ok: true });
    await revokeProductFixture(database.prisma, target);
    expect(
      await reading.getReadingStates({
        accountId: memberId,
        materialIds: [protectedId],
      }),
    ).toMatchObject({ ok: true, value: [{ isRead: true }] });
    expect(
      await reading.setReadingState({
        ...command(protectedId, true, 1),
        accountId: memberId,
      }),
    ).toMatchObject({ ok: false, error: { code: "access_denied" } });
    await transition(protectedId, "unpublished");
    expect(
      await reading.setReadingState({
        ...command(protectedId, false, 1),
        accountId: memberId,
      }),
    ).toMatchObject({ ok: true, value: { state: { isRead: false } } });
    expect(
      await reading.getReadingStates({ accountId, materialIds: [protectedId] }),
    ).toMatchObject({ ok: true, value: [{ version: 0 }] });
  });

  test("Material facts are rechecked after pair serialization and reject changed content or expired decisions without writes", async () => {
    const id = await material();
    const admin = new Pool({ connectionString: database.url });
    const session = await admin.connect();
    await session.query("BEGIN");
    await lockReadingPair(
      {
        async $executeRaw(query) {
          await session.query(query.text, query.values);
          return 0;
        },
      },
      accountId,
      id,
    );
    const access = assembleContentAccess({
      telegramLinks: everyAccountLinked,
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: membership,
    });
    const authorize = vi.fn((input: Parameters<typeof access.authorize>[0]) =>
      access.authorize(input),
    );
    const lockedReading = new ReadingActivity({
      prisma: database.prisma,
      materialContent: materials.materialContent,
      contentAccess: { ...access, authorize },
      composition,
    });
    const pending = lockedReading.setReadingState(command(id));
    await expect
      .poll(async () => {
        const result = await admin.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting",
        );
        return result.rows[0]?.waiting;
      })
      .toBe(true);
    // Access is decided before the transaction; the unpublication during the wait reaches the
    // command through the Material facts it rereads under the pair lock.
    expect(authorize).toHaveBeenCalledOnce();
    await transition(id, "unpublished");
    await session.query("COMMIT");
    session.release();
    await admin.end();
    expect(await pending).toEqual({
      ok: false,
      error: { code: "access_changed" },
    });
    await transition(id, "published");
    for (const mode of ["version", "expiry"] as const) {
      const raced = new ReadingActivity({
        prisma: database.prisma,
        composition,
        materialContent: materials.materialContent,
        contentAccess: {
          ...access,
          authorize: () =>
            Promise.resolve({
              effect: "allow",
              reason: "active_membership",
              policyVersion: "content-access-v1",
              decisionId: randomUUID(),
              // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
              decidedAt: new Date().toISOString(),
              checkedContentVersion: mode === "version" ? 1 : 4,
              validUntil: new Date(
                // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
                Date.now() + (mode === "expiry" ? -1_000 : 240_000),
              ).toISOString(),
            }),
        },
      });
      expect(await raced.setReadingState(command(id))).toEqual({
        ok: false,
        error: { code: "access_changed" },
      });
    }
    expect(await counts(id)).toEqual([0, 0]);
  });

  test("source lesson updates and withdrawal keep its identity and reader mark on republish", async () => {
    const product = await materials.authoring.reserveSourceProduct({
      actor,
      sourceId: "inside-content:source-mark-product",
      name: "Source mark product",
      slug: "source-mark-product",
      summary: "",
    });
    if (!product.ok) throw new Error(product.error.code);
    const source = {
      id: "inside-content:source-mark-lesson",
      path: "lessons/original.md",
      revision: "a".repeat(64),
      version: 2 as const,
    };
    const reserved = await materials.authoring.reserveSourceMaterial({
      actor,
      source,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const lesson = reserved.value.materialId;
    const command = {
      actor,
      source,
      materialId: lesson,
      expectedContentVersion: reserved.value.contentVersion,
      idempotencyKey: randomUUID(),
      publicationState: "published" as const,
      primaryVideoId: null,
      metadata: {
        title: "Source lesson",
        summary: "Imported lesson",
        access: "free" as const,
        topicId,
        formatId,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds: [product.value.id],
      },
      body: representativeDocument("Original text"),
    } satisfies Parameters<typeof materials.authoring.applySourceMaterial>[0];
    let applied = await materials.authoring.applySourceMaterial(command);
    if (!applied.ok) throw new Error(applied.error.code);
    await placeInProgramme([product.value.id], lesson);
    expect(
      await reading.setReadingState({
        accountId,
        materialId: lesson,
        isRead: true,
        expectedVersion: 0,
        commandId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const marks = await reading.getReadingStates({
      accountId,
      materialIds: [lesson],
    });
    expect(marks).toMatchObject({
      ok: true,
      value: [{ isRead: true, version: 1 }],
    });
    for (const [publicationState, revision] of [
      ["published", "b"],
      ["unpublished", "c"],
      ["published", "d"],
    ] as const) {
      const update = {
        ...command,
        source: {
          ...source,
          path: "lessons/renamed.md",
          revision: revision.repeat(64),
        },
        body: representativeDocument(`Edited text ${revision}`),
        expectedContentVersion: applied.value.contentVersion,
        publicationState,
        idempotencyKey: randomUUID(),
      };
      applied = await materials.authoring.applySourceMaterial(update);
      expect(applied).toMatchObject({
        ok: true,
        value: { materialId: lesson },
      });
      if (!applied.ok) throw new Error(applied.error.code);
      expect(await materials.authoring.applySourceMaterial(update)).toEqual(
        applied,
      );
      expect(
        await reading.getProductProgress({
          accountId,
          productId: product.value.id,
        }),
      ).toMatchObject({
        ok: true,
        value:
          publicationState === "unpublished"
            ? { read: 0, total: 0 }
            : { read: 1, total: 1 },
      });
    }
    expect(
      await reading.getReadingStates({ accountId, materialIds: [lesson] }),
    ).toEqual(marks);
    expect(
      await reading.getProductProgress({
        accountId: randomUUID(),
        productId: product.value.id,
      }),
    ).toMatchObject({ ok: true, value: { read: 0, total: 1 } });
  });

  test("a transferred Product keeps reader progress when its address changes", async () => {
    const productId = await product();
    const lesson = await material([productId]);
    // Imported Products accept only imported lessons, so the source is attached after composition.
    await database.prisma.product.update({
      where: { id: productId },
      data: { sourceId: "inside-content:progress-product" },
    });
    const reserved = await materials.authoring.reserveSourceProduct({
      actor,
      sourceId: "inside-content:progress-product",
      name: "Progress",
      slug: "progress-product",
      summary: "",
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    expect(await reading.setReadingState(command(lesson))).toMatchObject({
      ok: true,
    });
    const moved = await materials.authoring.updateSourceProduct({
      actor,
      sourceId: "inside-content:progress-product",
      collectionId: productId,
      expectedVersion: reserved.value.version,
      name: reserved.value.name,
      summary: "",
      source: {
        slug: "progress-product-moved",
        presentation: "default",
        page: null,
      },
    });
    expect(moved).toMatchObject({
      ok: true,
      value: { slug: "progress-product-moved" },
    });
    expect(
      await reading.getProductProgress({ accountId, productId }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 1, allRead: true } });
  });

  test("shared material, composition changes, publication and archive use the current Product set", async () => {
    const a = await product();
    const b = await product();
    expect(
      await reading.getProductProgress({ accountId, productId: a }),
    ).toMatchObject({ ok: true, value: { read: 0, total: 0, allRead: false } });
    const shared = await material([a, b]);
    expect(await reading.setReadingState(command(shared))).toMatchObject({
      ok: true,
    });
    for (const productId of [a, b])
      expect(
        await reading.getProductProgress({ accountId, productId }),
      ).toMatchObject({
        ok: true,
        value: { read: 1, total: 1, allRead: true },
      });
    const extra = await material([a], "closed");
    expect(
      await reading.getProductProgress({ accountId, productId: a }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 2, allRead: false } });
    const order = await materials.authoring.loadProductOrder({
      actor,
      productId: a,
    });
    if (!order.ok) throw new Error(order.error.code);
    const reordered = await materials.authoring.reorderProduct({
      actor,
      productId: a,
      expectedOrderVersion: order.value.orderVersion,
      orderedMaterialIds: [extra, shared],
    });
    expect(reordered).toMatchObject({ ok: true });
    expect(
      await reading.getProductProgress({ accountId, productId: a }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 2 } });
    await transition(shared, "unpublished");
    expect(
      await reading.getProductProgress({ accountId, productId: b }),
    ).toMatchObject({ ok: true, value: { total: 0, allRead: false } });
    await transition(shared, "published");
    expect(
      await reading.getProductProgress({ accountId, productId: b }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 1 } });
    const loaded = await materials.authoring.loadMaterial({
      actor,
      materialId: shared,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const saved = await materials.authoring.saveMaterial({
      actor,
      materialId: shared,
      idempotencyKey: randomUUID(),
      expectedContentVersion: loaded.value.contentVersion,
      publicationState: "published",
      body: representativeDocument("Edited text does not reset marks."),
      metadata: {
        title: "Edited title",
        summary: "Changed",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds: [b],
      },
    });
    expect(saved).toMatchObject({ ok: true });
    expect(
      await reading.getProductProgress({ accountId, productId: a }),
    ).toMatchObject({ ok: true, value: { read: 0, total: 1 } });
    expect(
      await reading.getProductProgress({ accountId, productId: b }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 1 } });
    await database.prisma.product.update({
      where: { id: b },
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      data: { archivedAt: new Date() },
    });
    expect(
      await reading.getProductProgress({ accountId, productId: b }),
    ).toEqual({ ok: false, error: { code: "product_not_found" } });
    expect(
      await reading.getReadingStates({ accountId, materialIds: [shared] }),
    ).toMatchObject({ ok: true, value: [{ isRead: true, version: 1 }] });
  });

  test("progress counts each published Programme Material once and excludes catalogue attachments and unpublished occurrences", async () => {
    const productId = await product();
    const first = await material([productId]);
    const second = await material([productId]);
    const attachment = await material([productId]);
    const hidden = await material([productId]);
    await database.prisma.productProgrammePlacement.deleteMany({
      where: { productId, materialId: attachment },
    });
    await placeInProgramme([productId], first);
    await transition(hidden, "unpublished");
    const chapterId = randomUUID();
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, name: "Chapter", ordinal: 1 },
    });
    await database.prisma.productChapterSupplementaryMaterial.create({
      data: { chapterId, productId, materialId: attachment, ordinal: 1 },
    });
    await reading.setReadingState(command(first));
    await reading.setReadingState(command(attachment));
    expect(
      await reading.getProductProgress({ accountId, productId: productId }),
    ).toEqual({
      ok: true,
      value: { productId: productId, total: 2, read: 1, allRead: false },
    });
    await reading.setReadingState(command(second));
    expect(
      await reading.getProductProgress({ accountId, productId: productId }),
    ).toEqual({
      ok: true,
      value: { productId: productId, total: 2, read: 2, allRead: true },
    });
    expect(await composition.read(productId)).toEqual({
      ok: true,
      value: [first, second],
    });
  });

  test("Product progress includes more than one catalog page and never exposes another Account's numerator", async () => {
    const productId = await product();
    let last = "";
    for (let index = 0; index < 101; index += 1)
      last = await material([productId]);
    await reading.setReadingState(command(last));
    expect(
      await reading.getProductProgress({ accountId, productId }),
    ).toMatchObject({ ok: true, value: { total: 101, read: 1 } });
    expect(
      await reading.getProductProgress({ accountId: randomUUID(), productId }),
    ).toMatchObject({ ok: true, value: { total: 101, read: 0 } });
  });

  test("batch Product learning uses the progress rule for many Accounts with a statement count independent of their number (#1718)", async () => {
    const productId = await product();
    const first = await material([productId]);
    const second = await material([productId]);
    const attachment = await material([productId]);
    await database.prisma.productProgrammePlacement.deleteMany({
      where: { productId, materialId: attachment },
    });
    const learner = randomUUID();
    const idle = randomUUID();
    const starter = randomUUID();
    for (const materialId of [first, attachment])
      await reading.setReadingState({
        ...command(materialId),
        accountId: learner,
      });
    const opened = new Date("2026-10-20T09:15:00.000Z");
    const later = new Date("2026-10-21T18:40:00.000Z");
    await database.prisma.readingMaterialVisit.createMany({
      data: [
        {
          accountId: learner,
          materialId: first,
          firstOpenedAt: opened,
          lastOpenedAt: opened,
        },
        {
          accountId: learner,
          materialId: second,
          firstOpenedAt: later,
          lastOpenedAt: later,
        },
        // Outside the programme: not learning activity in this Product.
        {
          accountId: starter,
          materialId: attachment,
          firstOpenedAt: later,
          lastOpenedAt: later,
        },
      ],
    });
    const started = new Date("2026-10-19T07:00:00.000Z");
    await database.prisma.productLearningStarted.create({
      data: { accountId: starter, productId, startedAt: started },
    });

    expect(
      await reading.readProductLearning({
        productId,
        accountIds: [learner.toUpperCase(), idle, starter, learner],
      }),
    ).toEqual({
      ok: true,
      value: [
        {
          accountId: learner,
          readCount: 1,
          totalCount: 2,
          startedAt: null,
          lastActivityAt: later.toISOString(),
        },
        {
          accountId: idle,
          readCount: 0,
          totalCount: 2,
          startedAt: null,
          lastActivityAt: null,
        },
        {
          accountId: starter,
          readCount: 0,
          totalCount: 2,
          startedAt: started.toISOString(),
          lastActivityAt: null,
        },
      ],
    });
    // The single-Account progress agrees on the numerator and the total.
    expect(
      await reading.getProductProgress({ accountId: learner, productId }),
    ).toMatchObject({ ok: true, value: { read: 1, total: 2 } });

    const observer = createQueryEventClient(database.url);
    try {
      const observed = new ReadingActivity({
        prisma: observer.prisma,
        materialContent: materials.materialContent,
        contentAccess: assembleContentAccess({
          telegramLinks: everyAccountLinked,
          materialResourceFacts: assembleMaterialResourceFacts(
            materials.materialContent,
          ),
          accountPermissions: {
            hasMaterialsManage: () => Promise.resolve(false),
          },
          accountRights: membership,
          // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
          clock: () => new Date(),
        }),
        composition: new PublishedProductComposition(
          observer.prisma,
          assembleProductMaterialReading(observer.prisma),
        ),
      });
      const measure = async (accountIds: readonly string[]) => {
        const { result, statements } = await observer.measure(() =>
          observed.readProductLearning({ productId, accountIds }),
        );
        expect(result).toMatchObject({ ok: true });
        return statements.length;
      };
      const one = await measure([learner]);
      const hundred = await measure([
        learner,
        idle,
        starter,
        ...Array.from({ length: 97 }, () => randomUUID()),
      ]);
      expect(hundred).toBe(one);
    } finally {
      await observer.prisma.$disconnect();
    }

    // An archived Product keeps its holders' learning readable for the owner.
    await database.prisma.product.update({
      where: { id: productId },
      data: { archivedAt: new Date("2026-10-22T00:00:00.000Z") },
    });
    expect(
      await reading.readProductLearning({ productId, accountIds: [learner] }),
    ).toMatchObject({ ok: true, value: [{ readCount: 1, totalCount: 2 }] });
    expect(
      await reading.readProductLearning({
        productId: randomUUID(),
        accountIds: [learner],
      }),
    ).toEqual({ ok: false, error: { code: "product_not_found" } });
    expect(
      await reading.readProductLearning({
        productId,
        accountIds: Array.from({ length: 101 }, () => randomUUID()),
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
  });

  test("the owner learning summary measures the published composition whatever the learner's access", async () => {
    const productId = await product();
    const archived = await product();
    const missing = randomUUID();
    const first = await material([productId], "closed");
    const second = await material([productId]);
    await material([archived]);
    await reading.setReadingState(command(second));
    const learner = randomUUID();
    await database.prisma.readingMaterialState.create({
      data: {
        accountId: learner,
        materialId: first,
        isRead: true,
        readAt: new Date("2030-01-02T00:00:00.000Z"),
        version: 1,
        updatedAt: new Date("2030-01-02T00:00:00.000Z"),
      },
    });
    await database.prisma.readingMaterialVisit.createMany({
      data: [
        {
          accountId: learner,
          materialId: first,
          firstOpenedAt: new Date("2030-01-01T00:00:00.000Z"),
          lastOpenedAt: new Date("2030-01-03T00:00:00.000Z"),
        },
        {
          accountId: learner,
          materialId: second,
          firstOpenedAt: new Date("2030-01-02T00:00:00.000Z"),
          lastOpenedAt: new Date("2030-01-04T00:00:00.000Z"),
        },
      ],
    });
    await database.prisma.productLearningStarted.create({
      data: {
        accountId: learner,
        productId,
        startedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    await database.prisma.product.update({
      where: { id: archived },
      data: { archivedAt: new Date("2030-01-05T00:00:00.000Z") },
    });
    // The learner holds no Product Access at all: the owner still sees the closed Material.
    expect(
      await reading.readLearningSummary(learner, [
        productId.toUpperCase(),
        archived,
        missing,
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          productId: productId.toUpperCase(),
          startedAt: "2030-01-01T00:00:00.000Z",
          progress: {
            state: "measured",
            read: 1,
            total: 2,
            lastActivityAt: "2030-01-04T00:00:00.000Z",
          },
        },
        {
          productId: archived,
          startedAt: null,
          progress: { state: "unavailable" },
        },
        {
          productId: missing,
          startedAt: null,
          progress: { state: "unavailable" },
        },
      ],
    });
    expect(
      await reading.readLearningSummary(randomUUID(), [productId]),
    ).toEqual({
      ok: true,
      value: [
        {
          productId,
          startedAt: null,
          progress: {
            state: "measured",
            read: 0,
            total: 2,
            lastActivityAt: null,
          },
        },
      ],
    });
    expect(
      await reading.readLearningSummary(
        learner,
        Array.from({ length: 51 }, () => randomUUID()),
      ),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });

    const idle = randomUUID();
    expect(
      await reading.readLastActivity([learner.toUpperCase(), idle]),
    ).toEqual({
      ok: true,
      accounts: new Map([
        [learner.toUpperCase(), "2030-01-04T00:00:00.000Z"],
        [idle, null],
      ]),
    });
    expect(
      await reading.readLastActivity(
        Array.from({ length: 51 }, () => randomUUID()),
      ),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
  });

  test("database constraints reject invalid state and duplicate event versions", async () => {
    const id = await material();
    await reading.setReadingState(command(id));
    await expect(
      database.prisma.readingMaterialState.update({
        where: { accountId_materialId: { accountId, materialId: id } },
        data: { readAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.readingMaterialState.update({
        where: { accountId_materialId: { accountId, materialId: id } },
        data: { version: 0 },
      }),
    ).rejects.toThrow();
    const event = await database.prisma.readingEvent.findFirstOrThrow({
      where: { materialId: id },
    });
    await expect(
      database.prisma.readingEvent.create({
        data: { ...event, eventId: randomUUID() },
      }),
    ).rejects.toThrow();
    expect(await counts(id)).toEqual([1, 1]);
  });

  test("batch reads are bounded, deduplicated, sparse and isolated by Account", async () => {
    const id = await material();
    await reading.setReadingState(command(id));
    expect(
      await reading.getReadingStates({
        accountId,
        materialIds: [id, id.toUpperCase()],
      }),
    ).toMatchObject({ ok: true, value: [{ isRead: true }] });
    expect(
      await reading.getReadingStates({
        accountId: randomUUID(),
        materialIds: [id],
      }),
    ).toMatchObject({ ok: true, value: [{ isRead: false, version: 0 }] });
    expect(
      await reading.getReadingStates({
        accountId,
        materialIds: Array.from({ length: 101 }, () => id),
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await reading.getReadingStates({ accountId, materialIds: [] }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
  });

  test("records an open and a read mark while its transaction holds the whole pool", async () => {
    const id = await material();
    const facts = await materials.materialContent.findAccessFacts(
      materialId(id),
    );
    if (!facts.ok || facts.value === null)
      throw new Error("Expected published Material facts");
    const contentVersion = facts.value.contentVersion;

    const [opened, marked] = await withExhaustedPool(
      database,
      async (prisma) => {
        const pooled = assembleMaterials({
          prisma,
          authorPolicy: { canManage: () => false },
        });
        const contentAccess = assembleContentAccess({
          telegramLinks: everyAccountLinked,
          materialResourceFacts: assembleMaterialResourceFacts(
            pooled.materialContent,
          ),
          accountPermissions: {
            hasMaterialsManage: () => Promise.resolve(false),
          },
          accountRights: assembleAccountRights({
            prisma,
          }),
        });
        const home = new PersonalHome({
          prisma,
          contentAccess,
          materialContent: pooled.materialContent,
          composition: new PublishedProductComposition(
            prisma,
            assembleProductMaterialReading(prisma),
          ),
          reader: pooled.publishedMaterialReader,
          selection: new PublishedMaterialSelection({
            prisma: prisma,
            products: new ProductDiscovery(prisma),
          }),
          videos: {
            loadProgressMany: () =>
              Promise.reject(new Error("not used by this scenario")),
            loadReadyDurations: () =>
              Promise.reject(new Error("not used by this scenario")),
          },
        });
        const reading = new ReadingActivity({
          prisma,
          contentAccess,
          materialContent: pooled.materialContent,
          composition: new PublishedProductComposition(
            prisma,
            assembleProductMaterialReading(prisma),
          ),
        });
        return [
          await home.recordOpen({
            accountId,
            materialId: id,
            contentVersion,
            commandId: randomUUID(),
          }),
          await reading.setReadingState(command(id)),
        ] as const;
      },
    );

    expect(opened).toMatchObject({ ok: true, value: { replayed: false } });
    expect(marked).toMatchObject({
      ok: true,
      value: { changed: true, state: { isRead: true } },
    });
  });
  test("reads genuine learning-start and manual transition events without reconstructing legacy opens", async () => {
    const clock = await activityTestClock(database.prisma);
    vi.setSystemTime(clock.at);
    const productId = await product();
    const id = await material([productId]);
    const account = randomUUID();
    const contentAccess = assembleContentAccess({
      telegramLinks: everyAccountLinked,
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: membership,
    });
    const home = new PersonalHome({
      prisma: database.prisma,
      contentAccess,
      materialContent: materials.materialContent,
      composition,
      reader: materials.publishedMaterialReader,
      selection: new PublishedMaterialSelection({
        prisma: database.prisma,
        products: new ProductDiscovery(database.prisma),
      }),
      videos: {
        loadProgressMany: () => Promise.reject(new Error("not used")),
        loadReadyDurations: () => Promise.reject(new Error("not used")),
      },
    });
    const facts = await materials.materialContent.findAccessFacts(
      materialId(id),
    );
    if (!facts.ok || facts.value === null)
      throw new Error("Expected published Material");
    const open = {
      accountId: account,
      materialId: id,
      commandId: randomUUID(),
      contentVersion: facts.value.contentVersion,
    };
    const opened = await Promise.all([
      home.recordOpen(open),
      home.recordOpen(open),
    ]);
    expect(opened).toEqual([
      {
        ok: true,
        value: { openedAt: expect.any(String), replayed: expect.any(Boolean) },
      },
      {
        ok: true,
        value: { openedAt: expect.any(String), replayed: expect.any(Boolean) },
      },
    ]);
    expect(
      opened.filter((result) => result.ok && !result.value.replayed),
    ).toHaveLength(1);
    const other = await material([productId]);
    const otherFacts = await materials.materialContent.findAccessFacts(
      materialId(other),
    );
    if (!otherFacts.ok || otherFacts.value === null)
      throw new Error("Expected second Material");
    await Promise.all([
      home.recordOpen({ ...open, commandId: randomUUID() }),
      home.recordOpen({
        ...open,
        materialId: other,
        contentVersion: otherFacts.value.contentVersion,
        commandId: randomUUID(),
      }),
    ]);
    const mark = {
      accountId: account,
      materialId: id,
      commandId: randomUUID(),
      isRead: true,
      expectedVersion: 0,
    };
    await Promise.all([
      reading.setReadingState(mark),
      reading.setReadingState(mark),
    ]);
    await reading.setReadingState({
      ...mark,
      commandId: randomUUID(),
      expectedVersion: 1,
    });
    await reading.setReadingState({
      ...mark,
      commandId: randomUUID(),
      expectedVersion: 1,
      isRead: false,
    });
    const report = await new ReadingActivityFacts(database.prisma).read(
      clock.window,
    );
    if (!report.ok) throw new Error(report.error.code);
    expect(
      report.value.rows
        .filter((row) => row.accountId === account)
        .map(({ kind, eventCount }) => ({ kind, eventCount })),
    ).toEqual([
      { kind: "learning_started", eventCount: 1 },
      { kind: "material_marked_read", eventCount: 1 },
      { kind: "material_marked_unread", eventCount: 1 },
    ]);
    const legacy = randomUUID();
    await database.prisma.productLearningStarted.create({
      data: {
        accountId: legacy,
        productId: productId,
        startedAt: clock.at,
      },
    });
    await home.recordOpen({
      ...open,
      accountId: legacy,
      commandId: randomUUID(),
    });
    const failedAccount = randomUUID();
    await database.prisma.$executeRaw(
      Prisma.sql`alter table reading_activity.learning_started_events add constraint fail_fixture check (account_id is null) not valid`,
    );
    try {
      expect(
        await home.recordOpen({
          ...open,
          accountId: failedAccount,
          commandId: randomUUID(),
        }),
      ).toMatchObject({ ok: false });
      expect(
        await database.prisma.productLearningStarted.findUnique({
          where: {
            accountId_productId: {
              accountId: failedAccount,
              productId: productId,
            },
          },
        }),
      ).toBeNull();
      expect(
        await database.prisma.readingMaterialVisit.findUnique({
          where: {
            accountId_materialId: { accountId: failedAccount, materialId: id },
          },
        }),
      ).toBeNull();
    } finally {
      await database.prisma.$executeRaw(
        Prisma.sql`alter table reading_activity.learning_started_events drop constraint fail_fixture`,
      );
    }
    const after = await new ReadingActivityFacts(database.prisma).read(
      clock.window,
    );
    if (!after.ok) throw new Error(after.error.code);
    expect(after.value.rows.some((row) => row.accountId === legacy)).toBe(
      false,
    );

    const originalReceipt = await home.recordOpen(open);
    const primaryStart =
      await database.prisma.productLearningStarted.findUniqueOrThrow({
        where: {
          accountId_productId: { accountId: account, productId: productId },
        },
      });
    await database.prisma.$executeRaw(
      Prisma.sql`update reading_activity.events set occurred_at=transaction_timestamp()-interval '366 days' where account_id=${account}::uuid`,
    );
    const originalStates = await database.prisma.readingMaterialState.findMany({
      where: { accountId: account },
      orderBy: { materialId: "asc" },
    });
    const originalCommands = await database.prisma.readingCommand.findMany({
      where: { accountId: account },
      orderBy: { commandId: "asc" },
    });
    const originalVisits = await database.prisma.readingMaterialVisit.findMany({
      where: { accountId: account },
      orderBy: { materialId: "asc" },
    });
    const originalEvents = await database.prisma.readingEvent.findMany({
      where: { accountId: account },
      orderBy: { eventId: "asc" },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`update reading_activity.learning_started_events set occurred_at=transaction_timestamp()-interval '366 days' where account_id=${account}::uuid`,
    );
    expect(
      await new ReadingActivityRetention(database.prisma).clean(),
    ).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(
      await database.prisma.readingMaterialState.findMany({
        where: { accountId: account },
        orderBy: { materialId: "asc" },
      }),
    ).toEqual(originalStates);
    expect(
      await database.prisma.readingCommand.findMany({
        where: { accountId: account },
        orderBy: { commandId: "asc" },
      }),
    ).toEqual(originalCommands);
    expect(
      await database.prisma.readingMaterialVisit.findMany({
        where: { accountId: account },
        orderBy: { materialId: "asc" },
      }),
    ).toEqual(originalVisits);
    expect(await home.recordOpen(open)).toEqual(originalReceipt);
    expect(
      await home.recordOpen({ ...open, commandId: randomUUID() }),
    ).toMatchObject({ ok: true });
    expect(
      await database.prisma.productLearningStarted.findUniqueOrThrow({
        where: {
          accountId_productId: { accountId: account, productId: productId },
        },
      }),
    ).toEqual(primaryStart);
    expect(
      await database.prisma.readingEvent.findMany({
        where: { accountId: account },
        orderBy: { eventId: "asc" },
      }),
    ).toEqual(originalEvents);
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select event_id from reading_activity.learning_started_events where account_id=${account}::uuid`,
      ),
    ).toEqual([]);
  });
});
