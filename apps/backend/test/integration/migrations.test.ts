import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const materialTables = [
  "authoring_idempotency",
  "formats",
  "material_access_audit_events",
  "material_publication_events",
  "material_revision_series_memberships",
  "material_revision_tags",
  "material_revisions",
  "material_search_documents",
  "material_tags",
  "materials",
  "published_material_series_memberships",
  "published_material_tags",
  "published_materials",
  "series",
  "series_memberships",
  "tags",
  "topics",
] as const;

const accountTables = [
  "account_audit_events",
  "account_permissions",
  "accounts",
] as const;

describe("Platform migrations", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("build an empty PostgreSQL database and replay without changes", async () => {
    const first = await migrateToLatest(testDatabase.url);
    const second = await migrateToLatest(testDatabase.url);

    expect(first).toEqual({
      appliedMigrations: [
        "0001_materials",
        "0002_identity_principals",
        "0003_published_materials_cursor_index",
        "0004_accounts",
      ],
    });
    expect(second).toEqual({ appliedMigrations: [] });

    await expectTables(testDatabase, "materials", materialTables);
    await expectTables(testDatabase, "accounts", accountTables);
    await expectTables(testDatabase, "identity_principals", []);

    const functions = await testDatabase.prisma.$queryRaw<
      readonly { readonly schema: string }[]
    >(Prisma.sql`
      select namespace.nspname as schema
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where procedure.proname = 'reject_immutable_material_revision_change'
    `);
    expect(functions).toEqual([{ schema: "materials" }]);

    const crossSchemaForeignKeys = await testDatabase.prisma.$queryRaw<
      readonly { readonly name: string }[]
    >(Prisma.sql`
      select constraint_record.conname as name
      from pg_constraint as constraint_record
      join pg_class as source_table on source_table.oid = constraint_record.conrelid
      join pg_namespace as source_schema on source_schema.oid = source_table.relnamespace
      join pg_class as target_table on target_table.oid = constraint_record.confrelid
      join pg_namespace as target_schema on target_schema.oid = target_table.relnamespace
      where constraint_record.contype = 'f'
        and source_schema.nspname = 'materials'
        and source_schema.nspname <> target_schema.nspname
    `);
    expect(crossSchemaForeignKeys).toEqual([]);

    const cursorIndexes = await testDatabase.prisma.$queryRaw<
      readonly { readonly definition: string }[]
    >(Prisma.sql`
      select indexdef as definition
      from pg_indexes
      where schemaname = 'materials'
        and indexname = 'published_materials_cursor_idx'
    `);
    expect(cursorIndexes).toHaveLength(1);
    expect(cursorIndexes[0]?.definition).toContain(
      "(published_at DESC, material_id DESC)",
    );
  });

  test("rejects drift in an already applied migration", async () => {
    const database = await createTestDatabase();
    try {
      await migrateToLatest(database.url);
      await database.prisma.$executeRaw(Prisma.sql`
        update public.platform_migrations
        set checksum = repeat('0', 64)
        where name = '0001_materials'
      `);

      await expect(migrateToLatest(database.url)).rejects.toThrow(
        "Migration checksum mismatch: 0001_materials",
      );
    } finally {
      await database.dispose();
    }
  });

  test("rejects a ledger that is not an exact registry prefix", async () => {
    const database = await createTestDatabase();
    try {
      await migrateToLatest(database.url);
      await database.prisma.$executeRaw(Prisma.sql`
        delete from public.platform_migrations
        where name = '0002_identity_principals'
      `);

      await expect(migrateToLatest(database.url)).rejects.toThrow(
        "Migration ledger is not an exact registry prefix at position 2",
      );
    } finally {
      await database.dispose();
    }
  });

  test("rejects migrations unknown to the running registry", async () => {
    const database = await createTestDatabase();
    try {
      await migrateToLatest(database.url);
      await database.prisma.$executeRaw(Prisma.sql`
        insert into public.platform_migrations (name, position, checksum)
        values ('9999_unknown', 5, repeat('0', 64))
      `);

      await expect(migrateToLatest(database.url)).rejects.toThrow(
        "Migration ledger is not an exact registry prefix at position 5",
      );
    } finally {
      await database.dispose();
    }
  });

  test("rejects the checksum-less pre-Prisma ledger", async () => {
    const database = await createTestDatabase();
    try {
      await database.prisma.$executeRaw(Prisma.sql`
        create table public.platform_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )
      `);

      await expect(migrateToLatest(database.url)).rejects.toThrow(
        "Migration ledger format mismatch; recreate the pre-Prisma database",
      );
    } finally {
      await database.dispose();
    }
  });
});

async function expectTables(
  database: TestDatabase,
  schema: "accounts" | "identity_principals" | "materials",
  expected: readonly string[],
): Promise<void> {
  const tables = await database.prisma.$queryRaw<
    readonly { readonly name: string }[]
  >(Prisma.sql`
    select table_name as name
    from information_schema.tables
    where table_schema = ${schema}
      and table_type = 'BASE TABLE'
    order by table_name
  `);
  expect(tables.map(({ name }) => name)).toEqual(expected);
}
