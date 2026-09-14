import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { platformMigrations, migrateToLatest } from "../../src/migrations/index.js";
import { statement } from "../../src/modules/membership-entitlements/infrastructure/postgres/migrations/0063-subscription-enrollments.js";
import { accountId } from "../../src/modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { createTestDatabase } from "./setup/test-database.js";

test("preview, transaction rollback, preserved legacy scope and late fulfillment exclude new products", async () => {
  const db = await createTestDatabase(); const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await runMigrationsToLatest(db.url, platformMigrations.slice(0, -1));
    const owner = randomUUID(), included = randomUUID(), excluded = randomUUID(), grant = randomUUID();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://migration.example.test", logtoSubject: owner } });
    await db.prisma.guide.create({ data: { id: included, name: "Обещанный гайд", slug: included } });
    await pool.query(`INSERT INTO membership_entitlements.access_grants(id, account_id, source, source_ref, capabilities, starts_at, valid_until, revision, reason) VALUES ($1,$2,'manual','historical',ARRAY['materials','support','reviews'],'2030-01-01',NULL,1,'Historical promise')`, [grant, owner]);
    const before = (await pool.query("SELECT * FROM membership_entitlements.access_grants WHERE id=$1", [grant])).rows;
    // Read-only preview names the whole current Guide cohort before schema changes.
    expect((await pool.query("SELECT id FROM materials.series WHERE archived_at IS NULL ORDER BY id")).rows).toEqual([{ id: included }]);
    const connection = await pool.connect();
    try { await connection.query("BEGIN"); await connection.query(statement); await connection.query("ROLLBACK"); }
    finally { connection.release(); }
    expect((await pool.query("SELECT to_regclass('membership_entitlements.subscription_enrollments') AS table")).rows).toEqual([{ table: null }]);
    expect((await pool.query("SELECT * FROM membership_entitlements.access_grants WHERE id=$1", [grant])).rows).toEqual(before);
    await migrateToLatest(db.url);
    expect(await db.prisma.accessGrant.findUnique({ where: { id: grant } })).toMatchObject({ id: grant, capabilities: ["materials", "support", "reviews"], startsAt: new Date("2030-01-01Z"), validUntil: null, revision: 1, contentScope: { guideIds: [included], materialIds: [] } });
    await db.prisma.guide.create({ data: { id: excluded, name: "Новый отдельный продукт", slug: excluded } });
    // Old-format outbox is delivered after the separate product appeared.
    await db.prisma.accessGrant.create({ data: { id: randomUUID(), accountId: owner, source: "paid", sourceRef: "late-historical", capabilities: ["materials"], startsAt: new Date("2030-01-01Z"), validUntil: null, revision: 1, reason: "Late historical fulfillment" } });
    const membership = assembleMembershipEntitlements({ prisma: db.prisma, clock: () => new Date("2030-01-02Z"), workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma }) });
    expect(await membership.resolveForAccess(accountId(owner), [included])).toMatchObject({ kind: "active" });
    expect(await membership.resolveForAccess(accountId(owner), [excluded])).not.toMatchObject({ kind: "active" });
    expect(await db.prisma.billingPurchase.count()).toBe(0);
    expect(await db.prisma.billingConsentEvidence.count()).toBe(0);
  } finally { await pool.end(); await db.dispose(); }
});
