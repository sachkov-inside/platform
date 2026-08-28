import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import {
  name as materialsMigrationName,
  statement as materialsMigrationStatement,
} from "../../src/modules/materials/infrastructure/postgres/migrations/0001_materials.js";
import {
  name as identityPrincipalsMigrationName,
  statement as identityPrincipalsMigrationStatement,
} from "../../src/modules/identity-principals/infrastructure/postgres/migrations/0002_identity_principals.js";
import {
  name as cursorMigrationName,
  statement as cursorMigrationStatement,
} from "../../src/modules/materials/infrastructure/postgres/migrations/0003_published_materials_cursor_index.js";
import {
  name as accountsMigrationName,
  statement as accountsMigrationStatement,
} from "../../src/modules/accounts/infrastructure/postgres/migrations/0004_accounts.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const materialTables = [
  "authoring_idempotency",
  "formats",
  "material_access_audit_events",
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

const membershipEntitlementTables = [
  "account_bindings",
  "current_projections",
  "evidence_receipts",
] as const;

const legacyMigrations = [
  { name: materialsMigrationName, statement: materialsMigrationStatement },
  {
    name: identityPrincipalsMigrationName,
    statement: identityPrincipalsMigrationStatement,
  },
  { name: cursorMigrationName, statement: cursorMigrationStatement },
  { name: accountsMigrationName, statement: accountsMigrationStatement },
] as const;

const migratedMaterialRowsSchema = z.array(
  z
    .object({
      access: z.string(),
      body: z.unknown(),
      content_version: z.bigint(),
      first_published_at: z.date().nullable(),
      publication_state: z.string(),
      published_at: z.date().nullable(),
      slug: z.string(),
      title: z.string(),
    })
    .strict(),
);
const migratedTagRowsSchema = z.array(
  z.object({ tag_id: z.uuid() }).strict(),
);
const migratedSearchRowsSchema = z.array(
  z
    .object({ content_version: z.bigint(), plain_text: z.string() })
    .strict(),
);
const migratedSeriesRowsSchema = z.array(
  z
    .object({ material_id: z.uuid(), ordinal: z.number().int() })
    .strict(),
);

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
        "0005_mutable_materials",
        "0006_membership_entitlements",
      ],
    });
    expect(second).toEqual({ appliedMigrations: [] });

    await expectTables(testDatabase, "materials", materialTables);
    await expectTables(testDatabase, "accounts", accountTables);
    await expectTables(testDatabase, "identity_principals", []);
    await expectTables(
      testDatabase,
      "membership_entitlements",
      membershipEntitlementTables,
    );

    const functions = await testDatabase.prisma.$queryRaw<
      readonly { readonly schema: string }[]
    >(Prisma.sql`
      select namespace.nspname as schema
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where procedure.proname = 'reject_published_material_slug_change'
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
        and source_schema.nspname in ('materials', 'membership_entitlements')
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

  test("moves the visible published revision into the current Material", async () => {
    const database = await createTestDatabase();
    try {
      await runMigrationsToLatest(database.url, legacyMigrations);
      await database.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`
          insert into materials.topics (id, slug, name)
          values ('20000000-0000-4000-8000-000000000001', 'platform', 'Platform');
          insert into materials.formats (id, slug, name)
          values ('30000000-0000-4000-8000-000000000001', 'guide', 'Guide');
          insert into materials.tags (id, name, normalized_name)
          values ('40000000-0000-4000-8000-000000000001', 'Migration', 'migration');
          insert into materials.series (id, slug, name)
          values ('50000000-0000-4000-8000-000000000001', 'foundation', 'Foundation');

          insert into materials.materials (
            id,
            slug,
            current_draft_revision_id,
            current_published_revision_id
          ) values (
            '60000000-0000-4000-8000-000000000001',
            'future-draft',
            '70000000-0000-4000-8000-000000000002',
            null
          );

          insert into materials.material_revisions (
            id,
            material_id,
            title,
            summary,
            slug,
            topic_id,
            format_id,
            schema_version,
            body,
            created_by,
            access
          ) values
          (
            '70000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            'Visible title',
            'Visible summary',
            'visible-material',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            1,
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"visible body"}]}]}'::jsonb,
            '10000000-0000-4000-8000-000000000001',
            'membership'
          ),
          (
            '70000000-0000-4000-8000-000000000002',
            '60000000-0000-4000-8000-000000000001',
            'Future draft title',
            'Future draft summary',
            'future-draft',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            1,
            '{"type":"doc","content":[]}'::jsonb,
            '10000000-0000-4000-8000-000000000001',
            'free'
          );

          update materials.materials
          set current_published_revision_id = '70000000-0000-4000-8000-000000000001'
          where id = '60000000-0000-4000-8000-000000000001';

          insert into materials.material_revision_tags (revision_id, material_id, tag_id)
          values (
            '70000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001'
          );
          insert into materials.material_revision_series_memberships (
            revision_id,
            material_id,
            series_id,
            ordinal
          ) values (
            '70000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            1
          );
          insert into materials.material_publication_events (
            id,
            material_id,
            revision_id,
            kind,
            actor_id,
            created_at
          ) values (
            '80000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'publish',
            '10000000-0000-4000-8000-000000000001',
            '2026-08-27T08:00:00.000Z'
          );
          insert into materials.published_materials (
            material_id,
            revision_id,
            slug,
            title,
            summary,
            access,
            topic_id,
            format_id,
            published_by,
            published_at
          ) values (
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'visible-material',
            'Visible title',
            'Visible summary',
            'membership',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '2026-08-27T08:01:00.000Z'
          );
          insert into materials.published_material_series_memberships (
            material_id,
            series_id,
            ordinal
          ) values (
            '60000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            1
          );
          insert into materials.material_search_documents (material_id, revision_id, plain_text)
          values (
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'visible body'
          );

          insert into materials.materials (
            id,
            slug,
            current_draft_revision_id,
            current_published_revision_id
          ) values
          (
            '60000000-0000-4000-8000-000000000002',
            'visible-material',
            '70000000-0000-4000-8000-000000000003',
            null
          ),
          (
            '60000000-0000-4000-8000-000000000003',
            'current-unpublished',
            '70000000-0000-4000-8000-000000000005',
            null
          );
          insert into materials.material_revisions (
            id,
            material_id,
            title,
            summary,
            slug,
            topic_id,
            format_id,
            schema_version,
            body,
            created_by,
            access
          ) values
          (
            '70000000-0000-4000-8000-000000000003',
            '60000000-0000-4000-8000-000000000002',
            'Draft title',
            'Draft summary',
            'visible-material',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            1,
            '{"type":"doc","content":[]}'::jsonb,
            '10000000-0000-4000-8000-000000000001',
            'free'
          ),
          (
            '70000000-0000-4000-8000-000000000004',
            '60000000-0000-4000-8000-000000000003',
            'Old published title',
            'Old published summary',
            'current-unpublished',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            1,
            '{"type":"doc","content":[]}'::jsonb,
            '10000000-0000-4000-8000-000000000001',
            'free'
          ),
          (
            '70000000-0000-4000-8000-000000000005',
            '60000000-0000-4000-8000-000000000003',
            'Current unpublished title',
            'Current unpublished summary',
            'current-unpublished',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            1,
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"current unpublished body"}]}]}'::jsonb,
            '10000000-0000-4000-8000-000000000001',
            'membership'
          );
          insert into materials.material_revision_series_memberships (
            revision_id,
            material_id,
            series_id,
            ordinal
          ) values (
            '70000000-0000-4000-8000-000000000003',
            '60000000-0000-4000-8000-000000000002',
            '50000000-0000-4000-8000-000000000001',
            1
          );
          insert into materials.series_memberships (
            series_id,
            material_id,
            ordinal
          ) values (
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000002',
            1
          );
          insert into materials.material_publication_events (
            id,
            material_id,
            revision_id,
            kind,
            actor_id,
            created_at
          ) values
          (
            '80000000-0000-4000-8000-000000000002',
            '60000000-0000-4000-8000-000000000003',
            '70000000-0000-4000-8000-000000000004',
            'publish',
            '10000000-0000-4000-8000-000000000001',
            '2026-08-27T07:00:00.000Z'
          ),
          (
            '80000000-0000-4000-8000-000000000003',
            '60000000-0000-4000-8000-000000000003',
            '70000000-0000-4000-8000-000000000004',
            'unpublish',
            '10000000-0000-4000-8000-000000000001',
            '2026-08-27T09:00:00.000Z'
          );
        `);
      });

      expect(await migrateToLatest(database.url)).toEqual({
        appliedMigrations: [
          "0005_mutable_materials",
          "0006_membership_entitlements",
        ],
      });

      const materials = migratedMaterialRowsSchema.parse(
        await database.prisma.$queryRaw(Prisma.sql`
        select
          access,
          body,
          content_version,
          first_published_at,
          publication_state,
          published_at,
          slug,
          title
        from materials.materials
        order by id
      `),
      );
      expect(materials).toEqual([
        {
          access: "membership",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "visible body" }],
              },
            ],
          },
          content_version: 1n,
          first_published_at: new Date("2026-08-27T08:00:00.000Z"),
          publication_state: "published",
          published_at: new Date("2026-08-27T08:01:00.000Z"),
          slug: "visible-material",
          title: "Visible title",
        },
        {
          access: "free",
          body: { type: "doc", content: [] },
          content_version: 1n,
          first_published_at: null,
          publication_state: "draft",
          published_at: null,
          slug: "visible-material-migrated-1",
          title: "Draft title",
        },
        {
          access: "membership",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "current unpublished body" },
                ],
              },
            ],
          },
          content_version: 1n,
          first_published_at: new Date("2026-08-27T07:00:00.000Z"),
          publication_state: "unpublished",
          published_at: new Date("2026-08-27T07:00:00.000Z"),
          slug: "current-unpublished",
          title: "Current unpublished title",
        },
      ]);

      const tags = migratedTagRowsSchema.parse(
        await database.prisma.$queryRaw(
          Prisma.sql`select tag_id from materials.material_tags`,
        ),
      );
      expect(tags).toEqual([
        { tag_id: "40000000-0000-4000-8000-000000000001" },
      ]);
      const seriesMemberships = migratedSeriesRowsSchema.parse(
        await database.prisma.$queryRaw(Prisma.sql`
          select material_id, ordinal
          from materials.series_memberships
          order by material_id
        `),
      );
      expect(seriesMemberships).toEqual([
        {
          material_id: "60000000-0000-4000-8000-000000000001",
          ordinal: 1,
        },
        {
          material_id: "60000000-0000-4000-8000-000000000002",
          ordinal: 2,
        },
      ]);
      const search = migratedSearchRowsSchema.parse(
        await database.prisma.$queryRaw(Prisma.sql`
          select content_version, plain_text
          from materials.material_search_documents
        `),
      );
      expect(search).toEqual([
        { content_version: 1n, plain_text: "visible body" },
      ]);
    } finally {
      await database.dispose();
    }
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
        values ('9999_unknown', 7, repeat('0', 64))
      `);

      await expect(migrateToLatest(database.url)).rejects.toThrow(
        "Migration ledger is not an exact registry prefix at position 7",
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
  schema:
    | "accounts"
    | "identity_principals"
    | "materials"
    | "membership_entitlements",
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
