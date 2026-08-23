import { type Kysely, sql } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable("material_revisions")
    .addColumn("access", "text")
    .execute();
  await sql`update material_revisions set access = 'membership' where access is null`.execute(
    database,
  );
  await database.schema
    .alterTable("material_revisions")
    .alterColumn("access", (column) => column.setNotNull())
    .execute();
  await database.schema
    .alterTable("material_revisions")
    .addCheckConstraint(
      "material_revisions_access_check",
      sql`access in ('free', 'membership')`,
    )
    .execute();
  await database.schema
    .alterTable("material_revisions")
    .addColumn("restored_from_revision_id", "uuid")
    .execute();
  await database.schema
    .alterTable("material_revisions")
    .addForeignKeyConstraint(
      "material_revisions_restored_from_fk",
      ["material_id", "restored_from_revision_id"],
      "material_revisions",
      ["material_id", "id"],
    )
    .execute();

  await database.schema
    .alterTable("materials")
    .addColumn("current_published_revision_id", "uuid")
    .execute();
  await database.schema
    .alterTable("materials")
    .addForeignKeyConstraint(
      "materials_current_published_revision_fk",
      ["id", "current_published_revision_id"],
      "material_revisions",
      ["material_id", "id"],
    )
    .execute();

  await database.schema
    .createTable("published_materials")
    .addColumn("material_id", "uuid", (column) => column.primaryKey())
    .addColumn("revision_id", "uuid", (column) => column.notNull())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("access", "text", (column) => column.notNull())
    .addColumn("topic_id", "uuid", (column) => column.notNull())
    .addColumn("format_id", "uuid", (column) => column.notNull())
    .addColumn("published_by", "uuid", (column) => column.notNull())
    .addColumn("published_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("published_materials_material_revision_unique", [
      "material_id",
      "revision_id",
    ])
    .addUniqueConstraint("published_materials_slug_unique", ["slug"])
    .addForeignKeyConstraint(
      "published_materials_revision_fk",
      ["material_id", "revision_id"],
      "material_revisions",
      ["material_id", "id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "published_materials_topic_fk",
      ["topic_id"],
      "topics",
      ["id"],
    )
    .addForeignKeyConstraint(
      "published_materials_format_fk",
      ["format_id"],
      "formats",
      ["id"],
    )
    .addCheckConstraint(
      "published_materials_slug_normalized",
      sql`slug = lower(btrim(slug))`,
    )
    .addCheckConstraint(
      "published_materials_access_check",
      sql`access in ('free', 'membership')`,
    )
    .execute();

  await database.schema
    .createTable("published_material_tags")
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("tag_id", "uuid", (column) => column.notNull())
    .addPrimaryKeyConstraint("published_material_tags_primary", ["material_id", "tag_id"])
    .addForeignKeyConstraint(
      "published_material_tags_material_fk",
      ["material_id"],
      "published_materials",
      ["material_id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint("published_material_tags_tag_fk", ["tag_id"], "tags", ["id"])
    .execute();

  await database.schema
    .createTable("published_material_series_memberships")
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("series_id", "uuid", (column) => column.notNull())
    .addColumn("ordinal", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("published_material_series_primary", ["material_id", "series_id"])
    .addUniqueConstraint("published_material_series_ordinal_unique", ["series_id", "ordinal"])
    .addForeignKeyConstraint(
      "published_material_series_material_fk",
      ["material_id"],
      "published_materials",
      ["material_id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "published_material_series_series_fk",
      ["series_id"],
      "series",
      ["id"],
    )
    .addCheckConstraint("published_material_series_ordinal_positive", sql`ordinal > 0`)
    .execute();

  await database.schema
    .createTable("material_search_documents")
    .addColumn("material_id", "uuid", (column) => column.primaryKey())
    .addColumn("revision_id", "uuid", (column) => column.notNull())
    .addColumn("plain_text", "text", (column) => column.notNull())
    .addForeignKeyConstraint(
      "material_search_documents_publication_fk",
      ["material_id", "revision_id"],
      "published_materials",
      ["material_id", "revision_id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await database.schema
    .createTable("material_publication_events")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("revision_id", "uuid", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("actor_id", "uuid", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "material_publication_events_revision_fk",
      ["material_id", "revision_id"],
      "material_revisions",
      ["material_id", "id"],
    )
    .addCheckConstraint(
      "material_publication_events_kind_check",
      sql`kind in ('publish', 'unpublish')`,
    )
    .execute();

  await sql`
    create trigger material_publication_events_immutable
    before update or delete on material_publication_events
    for each row execute function reject_immutable_material_revision_change()
  `.execute(database);

  await database.schema
    .alterTable("authoring_idempotency")
    .dropConstraint("authoring_idempotency_operation_check")
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .addColumn("publication_event_id", "uuid")
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .addForeignKeyConstraint(
      "authoring_idempotency_publication_event_fk",
      ["publication_event_id"],
      "material_publication_events",
      ["id"],
    )
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .addCheckConstraint(
      "authoring_idempotency_operation_check",
      sql`operation in ('create_draft', 'revise_draft', 'publish_revision', 'unpublish_material', 'restore_revision')`,
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable("authoring_idempotency")
    .dropConstraint("authoring_idempotency_operation_check")
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .dropConstraint("authoring_idempotency_publication_event_fk")
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .dropColumn("publication_event_id")
    .execute();
  await database.schema
    .alterTable("authoring_idempotency")
    .addCheckConstraint(
      "authoring_idempotency_operation_check",
      sql`operation in ('create_draft', 'revise_draft')`,
    )
    .execute();
  await sql`drop trigger if exists material_publication_events_immutable on material_publication_events`.execute(
    database,
  );
  for (const table of [
    "material_publication_events",
    "material_search_documents",
    "published_material_series_memberships",
    "published_material_tags",
    "published_materials",
  ]) {
    await database.schema.dropTable(table).ifExists().execute();
  }
  await database.schema
    .alterTable("materials")
    .dropConstraint("materials_current_published_revision_fk")
    .execute();
  await database.schema
    .alterTable("materials")
    .dropColumn("current_published_revision_id")
    .execute();
  await database.schema
    .alterTable("material_revisions")
    .dropConstraint("material_revisions_restored_from_fk")
    .execute();
  await database.schema
    .alterTable("material_revisions")
    .dropColumn("restored_from_revision_id")
    .execute();
  await database.schema.alterTable("material_revisions").dropColumn("access").execute();
}
