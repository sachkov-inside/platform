import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  platformMigrations,
  migrateToLatest,
} from "../../src/migrations/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";

async function previousDatabase() {
  const database = await createTestDatabase();
  const index = platformMigrations.findIndex(
    ({ name }) => name === "0081_remove_workshop",
  );
  await runMigrationsToLatest(
    database.url,
    index < 0 ? platformMigrations : platformMigrations.slice(0, index),
  );
  return database;
}

test("removes the cancelled Workshop and its derived projection without changing Membership evidence", async () => {
  const database = await previousDatabase();
  try {
    const id = randomUUID();
    await database.prisma.$executeRaw(Prisma.sql`
      insert into workshop.membership_entitlement_projections
        (account_id, principal_ref, decision, evidence_ref, evidence_version, evidence_fingerprint, checked_at, valid_until, updated_at)
      values (${id}::uuid, 'removal-fixture', 'member', 'removal-evidence', 1, ${"a".repeat(64)}, now(), now() + interval '5 minutes', now())
    `);
    await database.prisma.$executeRaw(
      Prisma.sql`insert into membership_entitlements.account_bindings(account_id, principal_ref, linked_at) values (${id}::uuid, 'removal-fixture', now())`,
    );
    await database.prisma.$executeRaw(Prisma.sql`
      insert into membership_entitlements.current_projections
        (account_id, principal_ref, decision, evidence_ref, evidence_version, evidence_fingerprint, checked_at, valid_until, updated_at)
      values (${id}::uuid, 'removal-fixture', 'member', 'removal-evidence', 1, ${"a".repeat(64)}, now(), now() + interval '5 minutes', now())
    `);
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: ["0081_remove_workshop", "0082_domain_names"],
    });
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select schema_name from information_schema.schemata where schema_name = 'workshop'`,
      ),
    ).toEqual([]);
    expect(
      await database.prisma.membershipProjection.findUnique({
        where: { accountId: id },
      }),
    ).toMatchObject({ decision: "member", evidenceVersion: 1n });
    const constraints = await database.prisma.$queryRaw(Prisma.sql`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where conname in ('materials_access_check', 'published_materials_access_check', 'videos_access_check')
    `);
    expect(constraints).toHaveLength(3);
    expect(JSON.stringify(constraints)).not.toContain("workshop");
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
  } finally {
    await database.dispose();
  }
});

test("refuses to remove Workshop business data added after the production inspection", async () => {
  const database = await previousDatabase();
  try {
    await database.prisma.$executeRaw(Prisma.sql`
      insert into workshop.cases (id, slug, workshop_scope, lifecycle, created_at, updated_at)
      values (${randomUUID()}::uuid, 'unexpected-case', 'fixture', 'draft', now(), now())
    `);
    await expect(migrateToLatest(database.url)).rejects.toThrow(
      "Workshop business data requires an owner decision",
    );
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select slug from workshop.cases`,
      ),
    ).toEqual([{ slug: "unexpected-case" }]);
  } finally {
    await database.dispose();
  }
});
