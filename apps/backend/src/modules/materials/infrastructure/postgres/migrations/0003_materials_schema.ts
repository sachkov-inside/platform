import { type Kysely, sql } from "kysely";

const MATERIALS_TABLES = [
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

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.createSchema("materials").execute();
  for (const table of MATERIALS_TABLES) {
    await database.schema
      .withSchema("public")
      .alterTable(table)
      .setSchema("materials")
      .execute();
  }
  await sql`
    alter function public.reject_immutable_material_revision_change()
    set schema materials
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter function materials.reject_immutable_material_revision_change()
    set schema public
  `.execute(database);
  for (const table of MATERIALS_TABLES) {
    await database.schema
      .withSchema("materials")
      .alterTable(table)
      .setSchema("public")
      .execute();
  }
  await database.schema.dropSchema("materials").execute();
}
