import { sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrateToLatest } from "../../src/migrations/index.js";
import * as materialAuthoringMigration from "../../src/modules/materials/infrastructure/postgres/migrations/0001_content_authoring.js";
import * as materialLifecycleMigration from "../../src/modules/materials/infrastructure/postgres/migrations/0002_material_lifecycle.js";
import * as materialsSchemaMigration from "../../src/modules/materials/infrastructure/postgres/migrations/0003_materials_schema.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("material authoring migrations", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("build an empty PostgreSQL database and replay without changes", async () => {
    const first = await migrateToLatest(testDatabase.database);
    const second = await migrateToLatest(testDatabase.database);

    expect(first).toEqual({
      appliedMigrations: [
        "0001_content_authoring",
        "0002_material_lifecycle",
        "0003_materials_schema",
      ],
    });
    expect(second).toEqual({ appliedMigrations: [] });

    const tables = await testDatabase.database.introspection.getTables();
    const contentTables = tables
      .map(({ name, schema }) => ({ name, schema }))
      .filter(({ name }) => !name.startsWith("kysely_"))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(contentTables).toEqual([
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
    ].map((name) => ({ name, schema: "materials" })));
    const functions = await sql<{ readonly schema: string }>`
      select namespace.nspname as schema
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where procedure.proname = 'reject_immutable_material_revision_change'
    `.execute(testDatabase.database);
    expect(functions.rows).toEqual([{ schema: "materials" }]);
    const crossSchemaForeignKeys = await sql<{ readonly name: string }>`
      select constraint_record.conname as name
      from pg_constraint as constraint_record
      join pg_class as source_table on source_table.oid = constraint_record.conrelid
      join pg_namespace as source_schema on source_schema.oid = source_table.relnamespace
      join pg_class as target_table on target_table.oid = constraint_record.confrelid
      join pg_namespace as target_schema on target_schema.oid = target_table.relnamespace
      where constraint_record.contype = 'f'
        and source_schema.nspname = 'materials'
        and source_schema.nspname <> target_schema.nspname
    `.execute(testDatabase.database);
    expect(crossSchemaForeignKeys.rows).toEqual([]);
    const applicationViews = await sql<{
      readonly name: string;
      readonly schema: string;
    }>`
      select table_schema as schema, table_name as name
      from information_schema.views
      where table_schema = 'materials'
    `.execute(testDatabase.database);
    expect(applicationViews.rows).toEqual([]);
  });

  test("move a representative existing Material without losing its rows", async () => {
    const database = await createTestDatabase();
    try {
      const preBoundaryMigrations: Record<string, Migration> = {
        "0001_content_authoring": materialAuthoringMigration,
        "0002_material_lifecycle": materialLifecycleMigration,
      };
      const provider: MigrationProvider = {
        getMigrations: () => Promise.resolve(preBoundaryMigrations),
      };
      const beforeBoundary = await new Migrator({
        db: database.database,
        provider,
      }).migrateTo("0002_material_lifecycle");
      if (beforeBoundary.error !== undefined) {
        // Kysely preserves the original migration failure as unknown.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw beforeBoundary.error;
      }

      await database.database.transaction().execute(async (transaction) => {
        await sql`
          insert into public.topics (id, slug, name)
          values ('10000000-0000-4000-8000-000000000001', 'architecture', 'Architecture');
          insert into public.formats (id, slug, name)
          values ('10000000-0000-4000-8000-000000000002', 'guide', 'Guide');
          insert into public.tags (id, name, normalized_name)
          values ('10000000-0000-4000-8000-000000000003', 'PostgreSQL', 'postgresql');
          insert into public.series (id, slug, name)
          values ('10000000-0000-4000-8000-000000000004', 'platform', 'Platform');
          insert into public.materials (id, slug, current_draft_revision_id)
          values (
            '10000000-0000-4000-8000-000000000005',
            'module-schemas',
            '10000000-0000-4000-8000-000000000006'
          );
          insert into public.material_revisions (
            id, material_id, title, summary, slug, topic_id, format_id,
            schema_version, body, created_by, access
          ) values (
            '10000000-0000-4000-8000-000000000006',
            '10000000-0000-4000-8000-000000000005',
            'Module schemas',
            'Representative migration row',
            'module-schemas',
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002',
            1,
            '{"type":"doc"}'::jsonb,
            '10000000-0000-4000-8000-000000000007',
            'free'
          );
          insert into public.material_tags (material_id, tag_id)
          values (
            '10000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000003'
          );
          insert into public.series_memberships (series_id, material_id, ordinal)
          values (
            '10000000-0000-4000-8000-000000000004',
            '10000000-0000-4000-8000-000000000005',
            1
          );
          insert into public.published_materials (
            material_id, revision_id, slug, title, summary, access, topic_id,
            format_id, published_by
          ) values (
            '10000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000006',
            'module-schemas',
            'Module schemas',
            'Representative migration row',
            'free',
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000007'
          );
          insert into public.material_search_documents (material_id, revision_id, plain_text)
          values (
            '10000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000006',
            'Module schemas'
          )
        `.execute(transaction);
      });

      expect(await migrateToLatest(database.database)).toEqual({
        appliedMigrations: ["0003_materials_schema"],
      });
      const preserved = await sql<{
        readonly materials: number;
        readonly projections: number;
        readonly relationships: number;
        readonly revisions: number;
      }>`
        select
          (select count(*)::int from materials.materials) as materials,
          (select count(*)::int from materials.material_revisions) as revisions,
          (select count(*)::int from materials.published_materials) as projections,
          (
            (select count(*) from materials.material_tags) +
            (select count(*) from materials.series_memberships)
          )::int as relationships
      `.execute(database.database);
      expect(preserved.rows[0]).toEqual({
        materials: 1,
        projections: 1,
        relationships: 2,
        revisions: 1,
      });
    } finally {
      await database.dispose();
    }
  });

  test("moves the complete Materials schema back in a disposable rollback", async () => {
    const database = await createTestDatabase();
    try {
      await migrateToLatest(database.database);
      const provider: MigrationProvider = {
        getMigrations: () =>
          Promise.resolve({
            "0001_content_authoring": materialAuthoringMigration,
            "0002_material_lifecycle": materialLifecycleMigration,
            "0003_materials_schema": materialsSchemaMigration,
          }),
      };
      const rollback = await new Migrator({
        db: database.database,
        provider,
      }).migrateDown();
      if (rollback.error !== undefined) {
        // Kysely preserves the original migration failure as unknown.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw rollback.error;
      }

      const tables = await database.database.introspection.getTables();
      const applicationTables = tables
        .filter(({ name }) => !name.startsWith("kysely_"))
        .map(({ name, schema }) => ({ name, schema }));
      expect(applicationTables.every(({ schema }) => schema === "public")).toBe(true);
      const functions = await sql<{ readonly schema: string }>`
        select namespace.nspname as schema
        from pg_proc as procedure
        join pg_namespace as namespace on namespace.oid = procedure.pronamespace
        where procedure.proname = 'reject_immutable_material_revision_change'
      `.execute(database.database);
      expect(functions.rows).toEqual([{ schema: "public" }]);
    } finally {
      await database.dispose();
    }
  });
});
