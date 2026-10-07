import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  migrateToLatest,
  platformMigrations,
} from "../../src/migrations/index.js";
import { createTestDatabase } from "./setup/test-database.js";

// The upgrade starts with the production vocabulary, not the already-renamed Prisma mappings.
test("upgrades persisted product rights, tariff snapshots and closed access without losing rows", async () => {
  const database = await createTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    const index = platformMigrations.findIndex(
      ({ name }) => name === "0082_domain_names",
    );
    await runMigrationsToLatest(
      database.url,
      index < 0 ? platformMigrations : platformMigrations.slice(0, index),
    );
    const productId = randomUUID();
    const grantId = randomUUID();
    const assignmentId = randomUUID();
    const accountId = randomUUID();
    const offerId = randomUUID();
    const materialId = randomUUID();
    const coverage = {
      guideIds: [productId],
      materialIds: [],
      allGuides: true,
    };
    const authoredBody = {
      type: "doc",
      guide: { guideId: "authored-example", contentScope: "lesson text" },
    };
    await pool.query(
      "insert into materials.series(id, slug, name) values ($1, 'migration-course', 'Course')",
      [productId],
    );
    await pool.query(
      `insert into membership_entitlements.access_grants
      (id, account_id, source, source_ref, capabilities, content_scope, starts_at, revision, reason)
      values ($1, $2, 'manual', 'migration-grant', $3, $4, '2030-01-01', 1, 'Existing right')`,
      [grantId, accountId, [`guide:${productId}`, "community"], coverage],
    );
    await pool.query(
      `insert into billing.offers(id, name, benefits, revision, content_scope)
      values ($1, 'Existing tariff', $2, 1, $3)`,
      [offerId, [`guide:${productId}`, "community"], coverage],
    );
    await pool.query(
      `insert into membership_entitlements.subscription_enrollments
      (id, account_id, tier_id, tier_revision, snapshot, origin, source_ref, starts_at, end_policy, revision, reason)
      values ($1, $2, $3, 1, $4, 'manual', 'migration-assignment', '2030-01-01', 'fixed', 1, 'Existing assignment')`,
      [
        assignmentId,
        accountId,
        offerId,
        {
          id: offerId,
          revision: 1,
          name: "Existing tariff",
          benefits: [`guide:${productId}`, "community"],
          contentScope: coverage,
        },
      ],
    );
    await pool.query(
      `insert into materials.materials(id, title, format_id, schema_version, body, created_by, access, publication_state, content_version)
      values ($1, 'Existing closed lesson', 'guide', 1, $3, $2, 'membership', 'draft', 1)`,
      [materialId, accountId, authoredBody],
    );
    await migrateToLatest(database.url);
    expect(
      await database.prisma.accessGrant.findUnique({ where: { id: grantId } }),
    ).toMatchObject({
      id: grantId,
      accountId,
      capabilities: [`product:${productId}`, "community"],
      coverage: {
        productIds: [productId],
        materialIds: [],
        wholePlatform: true,
      },
      revision: 1,
      revokedAt: null,
    });
    expect(
      await database.prisma.tariffAssignment.findUnique({
        where: { id: assignmentId },
      }),
    ).toMatchObject({
      id: assignmentId,
      accountId,
      tierId: offerId,
      snapshot: {
        benefits: [`product:${productId}`, "community"],
        coverage: {
          productIds: [productId],
          materialIds: [],
          wholePlatform: true,
        },
      },
    });
    expect(
      await database.prisma.material.findUnique({ where: { id: materialId } }),
    ).toMatchObject({
      access: "closed",
      formatId: "guide",
      body: authoredBody,
    });
    expect(
      await database.prisma.product.findUnique({ where: { id: productId } }),
    ).toMatchObject({ name: "Course", slug: "migration-course" });
    expect(
      (
        await pool.query(
          "select to_regnamespace('membership_entitlements') as old_schema, to_regclass('account_rights.subscription_enrollments') as old_table",
        )
      ).rows,
    ).toEqual([{ old_schema: null, old_table: null }]);
    // The upgraded late-fulfillment trigger still fills coverage from the frozen baseline.
    const lateId = randomUUID();
    await database.prisma.accessGrant.create({
      data: {
        id: lateId,
        accountId,
        source: "manual",
        sourceRef: "late-migration-grant",
        capabilities: ["materials"],
        startsAt: new Date("2030-01-01Z"),
        revision: 1,
        reason: "Late fulfillment",
      },
    });
    expect(
      (await database.prisma.accessGrant.findUnique({ where: { id: lateId } }))
        ?.coverage,
    ).toMatchObject({
      productIds: [],
      materialIds: [],
    });
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
  } finally {
    await pool.end();
    await database.dispose();
  }
});
