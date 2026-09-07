import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createPrismaClient, type PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import { accountId as checkedAccountId } from "../../src/modules/accounts/index.js";
import { assembleMaterials, assembleMaterialResourceFacts, PublishedSeriesComposition } from "../../src/modules/materials/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { ReadingActivity } from "../../src/modules/reading-activity/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = randomUUID();
const accountId = randomUUID();
const topicId = randomUUID();
const formatId = randomUUID();

describe("ReadingActivity on PostgreSQL", () => {
  let database: TestDatabase;
  let second: PlatformPrisma;
  let reading: ReadingActivity;
  let materials: ReturnType<typeof assembleMaterials>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let composition: PublishedSeriesComposition;
  let membershipNow: Date | undefined;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    second = createPrismaClient(database.url);
    await database.prisma.topic.create({ data: { id: topicId, name: "Reading", slug: "reading" } });
    await database.prisma.format.create({ data: { id: formatId, name: "Text", slug: "text" } });
    materials = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
    membership = assembleMembershipEntitlements({
      prisma: database.prisma,
      clock: () => membershipNow ?? new Date(),
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: database.prisma }),
    });
    composition = new PublishedSeriesComposition(database.prisma);
    reading = assembleReading(database.prisma);
  });
  afterAll(async () => { await second.$disconnect(); await database.dispose(); });

  function assembleReading(prisma: PlatformPrisma) {
    return new ReadingActivity({
      prisma,
      materialContent: materials.materialContent,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
        accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
        membershipEntitlements: membership,
        clock: () => membershipNow ?? new Date(),
      }),
      composition,
    });
  }
  async function material(seriesIds: string[] = [], access: "free" | "membership" = "free") {
    const created = await materials.authoring.createDraft({
      actor, idempotencyKey: randomUUID(),
      metadata: { title: `Material ${randomUUID()}`, summary: "Reading test", topicId, formatId, access, tagIds: [], seriesIds },
      body: representativeDocument("Read me."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor, idempotencyKey: randomUUID(), materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion, publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    return published.value.materialId;
  }
  function command(materialId: string, isRead = true, expectedVersion = 0) {
    return { accountId, materialId, isRead, expectedVersion, commandId: randomUUID() };
  }
  async function counts(materialId: string) {
    return Promise.all([
      database.prisma.readingMaterialState.count({ where: { materialId } }),
      database.prisma.readingEvent.count({ where: { materialId } }),
    ]);
  }
  async function transition(materialId: string, publicationState: "published" | "unpublished") {
    const loaded = await materials.authoring.loadMaterial({ actor, materialId });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const changed = await materials.authoring.transitionPublication({
      actor, materialId, publicationState, expectedContentVersion: loaded.value.contentVersion, idempotencyKey: randomUUID(),
    });
    if (!changed.ok) throw new Error(changed.error.code);
  }
  async function series() {
    const id = randomUUID();
    await database.prisma.series.create({ data: { id, slug: `series-${id}`, name: "Reading series" } });
    return id;
  }

  test("no-op preserves timestamps/version, stale no-op conflicts, replay after unmark never resurrects a mark", async () => {
    const id = await material();
    const mark = command(id);
    const first = await reading.setReadingState(mark);
    expect(first).toMatchObject({ ok: true, value: { changed: true, replayed: false, state: { isRead: true, version: 1 } } });
    const noOp = await reading.setReadingState(command(id, true, 1));
    if (!first.ok || !noOp.ok) throw new Error("Expected success");
    expect(noOp.value.state).toEqual(first.value.state);
    expect(noOp.value.changed).toBe(false);
    expect(await reading.setReadingState(command(id))).toMatchObject({ ok: false, error: { code: "stale_version", current: { version: 1 } } });
    expect(await counts(id)).toEqual([1, 1]);
    expect(await reading.setReadingState(command(id, false, 1))).toMatchObject({ ok: true, value: { state: { isRead: false, readAt: null, version: 2 } } });
    expect(await reading.setReadingState(mark)).toEqual({ ok: true, value: { ...first.value, replayed: true } });
    expect(await reading.getReadingStates({ accountId, materialIds: [id] })).toMatchObject({ ok: true, value: [{ isRead: false, version: 2 }] });
    expect(await reading.setReadingState({ ...mark, isRead: false })).toEqual({ ok: false, error: { code: "command_conflict" } });
    expect(await counts(id)).toEqual([1, 2]);
  });

  test("absent false state stays sparse, including durable no-op replay", async () => {
    const id = randomUUID();
    const noOp = command(id, false);
    expect(await reading.setReadingState(noOp)).toMatchObject({ ok: true, value: { changed: false, state: { version: 0, updatedAt: null } } });
    expect(await reading.setReadingState(noOp)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await counts(id)).toEqual([0, 0]);
  });

  test("two clients serialize first writes, identical commands and reused command IDs across materials", async () => {
    const other = assembleReading(second);
    const id = await material();
    const results = await Promise.all([reading.setReadingState(command(id)), other.setReadingState(command(id))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: "stale_version" } });
    expect(await counts(id)).toEqual([1, 1]);
    const shared = command(await material());
    const retries = await Promise.all([reading.setReadingState(shared), other.setReadingState(shared)]);
    expect(retries.map((result) => result.ok && result.value.replayed).sort()).toEqual([false, true]);
    expect(await counts(shared.materialId)).toEqual([1, 1]);
    const reused = command(await material());
    const mismatches = await Promise.all([
      reading.setReadingState(reused), other.setReadingState({ ...reused, materialId: await material() }),
    ]);
    expect(mismatches.filter((result) => result.ok)).toHaveLength(1);
    expect(mismatches).toContainEqual({ ok: false, error: { code: "command_conflict" } });
  });

  test("an event failure and a receipt failure roll back state, history and command together", async () => {
    const admin = new Pool({ connectionString: database.url });
    try {
      for (const table of ["events", "commands"] as const) {
        const id = await material();
        const request = command(id);
        await admin.query(`CREATE FUNCTION reading_activity.reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$`);
        await admin.query(`CREATE TRIGGER reject_write BEFORE INSERT ON reading_activity.${table} FOR EACH ROW EXECUTE FUNCTION reading_activity.reject_write()`);
        expect(await reading.setReadingState(request)).toEqual({ ok: false, error: { code: "dependency_unavailable" } });
        expect(await counts(id)).toEqual([0, 0]);
        expect(await database.prisma.readingCommand.count({ where: { commandId: request.commandId } })).toBe(0);
        await admin.query(`DROP TRIGGER reject_write ON reading_activity.${table}`);
        await admin.query("DROP FUNCTION reading_activity.reject_write()");
        expect(await reading.setReadingState(request)).toMatchObject({ ok: true, value: { state: { version: 1 } } });
      }
    } finally { await admin.end(); }
  });

  test("free non-member and revoked member retain private marks; protected marks still require current access", async () => {
    const free = await material();
    const protectedId = await material([], "membership");
    const memberId = checkedAccountId(randomUUID());
    expect(await reading.setReadingState(command(free))).toMatchObject({ ok: true });
    expect(await reading.setReadingState(command(protectedId))).toEqual({ ok: false, error: { code: "access_denied" } });
    for (const [version, decision] of [[1, "member"], [2, "not_member"]] as const) {
      const accepted = await membership.acceptEvidence({ accountId: memberId, deliveryId: randomUUID(), source: version === 1 ? "link_time" : "member_status_event", evidence: {
        contractVersion: "inside.membership-evidence.v1", principalRef: `principal-${memberId}`, decision,
        reasonCode: decision === "member" ? "chat_member" : "chat_not_member", checkedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 240_000).toISOString(), telegramIdentityRef: `telegram-${memberId}`,
        evidenceRef: randomUUID(), evidenceVersion: version,
      } });
      expect(accepted).toMatchObject({ ok: true });
      if (version === 1) expect(await reading.setReadingState({ ...command(protectedId), accountId: memberId })).toMatchObject({ ok: true });
    }
    expect(await reading.getReadingStates({ accountId: memberId, materialIds: [protectedId] })).toMatchObject({ ok: true, value: [{ isRead: true }] });
    expect(await reading.setReadingState({ ...command(protectedId, true, 1), accountId: memberId })).toMatchObject({ ok: false, error: { code: "access_denied" } });
    await transition(protectedId, "unpublished");
    expect(await reading.setReadingState({ ...command(protectedId, false, 1), accountId: memberId })).toMatchObject({ ok: true, value: { state: { isRead: false } } });
    expect(await reading.getReadingStates({ accountId, materialIds: [protectedId] })).toMatchObject({ ok: true, value: [{ version: 0 }] });
  });

  test("positive Membership evidence expires by time without deleting previous marks", async () => {
    const memberId = checkedAccountId(randomUUID());
    const id = await material([], "membership");
    const checkedAt = new Date();
    const validUntil = new Date(checkedAt.getTime() + 240_000);
    const accepted = await membership.acceptEvidence({ accountId: memberId, deliveryId: randomUUID(), source: "link_time", evidence: {
      contractVersion: "inside.membership-evidence.v1", principalRef: `principal-${memberId}`, decision: "member", reasonCode: "chat_member",
      checkedAt: checkedAt.toISOString(), validUntil: validUntil.toISOString(), telegramIdentityRef: `telegram-${memberId}`, evidenceRef: randomUUID(), evidenceVersion: 1,
    } });
    expect(accepted).toMatchObject({ ok: true });
    expect(await reading.setReadingState({ ...command(id), accountId: memberId })).toMatchObject({ ok: true });
    try {
      membershipNow = new Date(validUntil.getTime() + 1);
      expect(await reading.setReadingState({ ...command(id, true, 1), accountId: memberId })).toEqual({ ok: false, error: { code: "access_denied" } });
      expect(await reading.getReadingStates({ accountId: memberId, materialIds: [id] })).toMatchObject({ ok: true, value: [{ isRead: true, version: 1 }] });
      expect(await reading.setReadingState({ ...command(id, false, 1), accountId: memberId })).toMatchObject({ ok: true, value: { state: { isRead: false, version: 2 } } });
    } finally { membershipNow = undefined; }
  });

  test("access is checked after pair serialization and rejects changed content or expired decisions without writes", async () => {
    const id = await material();
    const admin = new Pool({ connectionString: database.url });
    const session = await admin.connect();
    await session.query("BEGIN");
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0::bigint))", [`reading-pair:${accountId}:${id}`]);
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) }, membershipEntitlements: membership,
    });
    const authorize = vi.fn((input: Parameters<typeof access.authorize>[0]) => access.authorize(input));
    const lockedReading = new ReadingActivity({ prisma: database.prisma, materialContent: materials.materialContent, contentAccess: { authorize }, composition });
    const pending = lockedReading.setReadingState(command(id));
    await expect.poll(async () => {
      const result = await admin.query<{ waiting: boolean }>("select exists(select 1 from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting");
      return result.rows[0]?.waiting;
    }).toBe(true);
    expect(authorize).not.toHaveBeenCalled();
    await transition(id, "unpublished");
    await session.query("COMMIT");
    session.release();
    await admin.end();
    expect(await pending).toEqual({ ok: false, error: { code: "access_denied" } });
    await transition(id, "published");
    for (const mode of ["version", "expiry"] as const) {
      const raced = new ReadingActivity({
        prisma: database.prisma, composition, materialContent: materials.materialContent,
        contentAccess: { authorize: () => Promise.resolve({
          effect: "allow", reason: "active_membership", policyVersion: "content-access-v1", decisionId: randomUUID(),
          decidedAt: new Date().toISOString(), checkedContentVersion: mode === "version" ? 1 : 4,
          validUntil: new Date(Date.now() + (mode === "expiry" ? -1_000 : 240_000)).toISOString(),
        }) },
      });
      expect(await raced.setReadingState(command(id))).toEqual({ ok: false, error: { code: "access_changed" } });
    }
    expect(await counts(id)).toEqual([0, 0]);
  });

  test("shared material, composition changes, publication and archive use the current Series set", async () => {
    const a = await series(); const b = await series();
    expect(await reading.getSeriesProgress({ accountId, seriesId: a })).toMatchObject({ ok: true, value: { read: 0, total: 0, allRead: false } });
    const shared = await material([a, b]);
    expect(await reading.setReadingState(command(shared))).toMatchObject({ ok: true });
    for (const seriesId of [a, b]) expect(await reading.getSeriesProgress({ accountId, seriesId })).toMatchObject({ ok: true, value: { read: 1, total: 1, allRead: true } });
    const extra = await material([a], "membership");
    expect(await reading.getSeriesProgress({ accountId, seriesId: a })).toMatchObject({ ok: true, value: { read: 1, total: 2, allRead: false } });
    const order = await materials.authoring.loadSeriesOrder({ actor, seriesId: a });
    if (!order.ok) throw new Error(order.error.code);
    const reordered = await materials.authoring.reorderSeries({ actor, seriesId: a, expectedOrderVersion: order.value.orderVersion, orderedMaterialIds: [extra, shared] });
    expect(reordered).toMatchObject({ ok: true });
    expect(await reading.getSeriesProgress({ accountId, seriesId: a })).toMatchObject({ ok: true, value: { read: 1, total: 2 } });
    await transition(shared, "unpublished");
    expect(await reading.getSeriesProgress({ accountId, seriesId: b })).toMatchObject({ ok: true, value: { total: 0, allRead: false } });
    await transition(shared, "published");
    expect(await reading.getSeriesProgress({ accountId, seriesId: b })).toMatchObject({ ok: true, value: { read: 1, total: 1 } });
    const loaded = await materials.authoring.loadMaterial({ actor, materialId: shared });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const saved = await materials.authoring.saveMaterial({
      actor, materialId: shared, idempotencyKey: randomUUID(), expectedContentVersion: loaded.value.contentVersion,
      publicationState: "published", body: representativeDocument("Edited text does not reset marks."),
      metadata: { title: "Edited title", summary: "Changed", access: "free", topicId, formatId, tagIds: [], seriesIds: [b] },
    });
    expect(saved).toMatchObject({ ok: true });
    expect(await reading.getSeriesProgress({ accountId, seriesId: a })).toMatchObject({ ok: true, value: { read: 0, total: 1 } });
    expect(await reading.getSeriesProgress({ accountId, seriesId: b })).toMatchObject({ ok: true, value: { read: 1, total: 1 } });
    await database.prisma.series.update({ where: { id: b }, data: { archivedAt: new Date() } });
    expect(await reading.getSeriesProgress({ accountId, seriesId: b })).toEqual({ ok: false, error: { code: "series_not_found" } });
    expect(await reading.getReadingStates({ accountId, materialIds: [shared] })).toMatchObject({ ok: true, value: [{ isRead: true, version: 1 }] });
  });

  test("Series progress includes more than one catalog page and never exposes another Account's numerator", async () => {
    const seriesId = await series();
    let last = "";
    for (let index = 0; index < 101; index += 1) last = await material([seriesId]);
    await reading.setReadingState(command(last));
    expect(await reading.getSeriesProgress({ accountId, seriesId })).toMatchObject({ ok: true, value: { total: 101, read: 1 } });
    expect(await reading.getSeriesProgress({ accountId: randomUUID(), seriesId })).toMatchObject({ ok: true, value: { total: 101, read: 0 } });
  }, 20_000);

  test("database constraints reject invalid state and duplicate event versions", async () => {
    const id = await material();
    await reading.setReadingState(command(id));
    await expect(database.prisma.readingMaterialState.update({ where: { accountId_materialId: { accountId, materialId: id } }, data: { readAt: null } })).rejects.toThrow();
    await expect(database.prisma.readingMaterialState.update({ where: { accountId_materialId: { accountId, materialId: id } }, data: { version: 0 } })).rejects.toThrow();
    const event = await database.prisma.readingEvent.findFirstOrThrow({ where: { materialId: id } });
    await expect(database.prisma.readingEvent.create({ data: { ...event, eventId: randomUUID() } })).rejects.toThrow();
    expect(await counts(id)).toEqual([1, 1]);
  });

  test("batch reads are bounded, deduplicated, sparse and isolated by Account", async () => {
    const id = await material();
    await reading.setReadingState(command(id));
    expect(await reading.getReadingStates({ accountId, materialIds: [id, id.toUpperCase()] })).toMatchObject({ ok: true, value: [{ isRead: true }] });
    expect(await reading.getReadingStates({ accountId: randomUUID(), materialIds: [id] })).toMatchObject({ ok: true, value: [{ isRead: false, version: 0 }] });
    expect(await reading.getReadingStates({ accountId, materialIds: Array.from({ length: 101 }, () => id) })).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await reading.getReadingStates({ accountId, materialIds: [] })).toEqual({ ok: false, error: { code: "invalid_request" } });
  });
});
