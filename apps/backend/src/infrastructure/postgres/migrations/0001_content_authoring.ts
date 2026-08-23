import { type Kysely, sql } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable("topics")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addUniqueConstraint("topics_slug_unique", ["slug"])
    .addCheckConstraint("topics_slug_normalized", sql`slug = lower(btrim(slug))`)
    .execute();

  await database.schema
    .createTable("formats")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addUniqueConstraint("formats_slug_unique", ["slug"])
    .addCheckConstraint("formats_slug_normalized", sql`slug = lower(btrim(slug))`)
    .execute();

  await database.schema
    .createTable("tags")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("normalized_name", "text", (column) => column.notNull())
    .addUniqueConstraint("tags_normalized_name_unique", ["normalized_name"])
    .addCheckConstraint(
      "tags_normalized_name_canonical",
      sql`normalized_name = lower(btrim(normalized_name))`,
    )
    .execute();

  await database.schema
    .createTable("series")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addUniqueConstraint("series_slug_unique", ["slug"])
    .addCheckConstraint("series_slug_normalized", sql`slug = lower(btrim(slug))`)
    .execute();

  await database.schema
    .createTable("materials")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("current_draft_revision_id", "uuid", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("materials_slug_unique", ["slug"])
    .addCheckConstraint("materials_slug_normalized", sql`slug = lower(btrim(slug))`)
    .execute();

  await database.schema
    .createTable("material_revisions")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("topic_id", "uuid", (column) => column.notNull())
    .addColumn("format_id", "uuid", (column) => column.notNull())
    .addColumn("schema_version", "smallint", (column) => column.notNull())
    .addColumn("body", "jsonb", (column) => column.notNull())
    .addColumn("created_by", "uuid", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("material_revisions_material_and_id_unique", ["material_id", "id"])
    .addForeignKeyConstraint(
      "material_revisions_material_fk",
      ["material_id"],
      "materials",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "material_revisions_topic_fk",
      ["topic_id"],
      "topics",
      ["id"],
    )
    .addForeignKeyConstraint(
      "material_revisions_format_fk",
      ["format_id"],
      "formats",
      ["id"],
    )
    .addCheckConstraint("material_revisions_schema_version_check", sql`schema_version = 1`)
    .addCheckConstraint("material_revisions_slug_normalized", sql`slug = lower(btrim(slug))`)
    .execute();

  await database.schema
    .alterTable("materials")
    .addForeignKeyConstraint(
      "materials_current_draft_revision_fk",
      ["id", "current_draft_revision_id"],
      "material_revisions",
      ["material_id", "id"],
    )
    .deferrable()
    .initiallyDeferred()
    .execute();

  await database.schema
    .createTable("material_tags")
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("tag_id", "uuid", (column) => column.notNull())
    .addPrimaryKeyConstraint("material_tags_primary", ["material_id", "tag_id"])
    .addForeignKeyConstraint("material_tags_material_fk", ["material_id"], "materials", ["id"], (constraint) =>
      constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint("material_tags_tag_fk", ["tag_id"], "tags", ["id"])
    .execute();

  await database.schema
    .createTable("series_memberships")
    .addColumn("series_id", "uuid", (column) => column.notNull())
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("ordinal", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("series_memberships_primary", ["series_id", "material_id"])
    .addUniqueConstraint("series_memberships_ordinal_unique", ["series_id", "ordinal"])
    .addForeignKeyConstraint("series_memberships_series_fk", ["series_id"], "series", ["id"])
    .addForeignKeyConstraint(
      "series_memberships_material_fk",
      ["material_id"],
      "materials",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addCheckConstraint("series_memberships_ordinal_positive", sql`ordinal > 0`)
    .execute();

  await database.schema
    .createTable("material_revision_tags")
    .addColumn("revision_id", "uuid", (column) => column.notNull())
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("tag_id", "uuid", (column) => column.notNull())
    .addPrimaryKeyConstraint("material_revision_tags_primary", ["revision_id", "tag_id"])
    .addForeignKeyConstraint(
      "material_revision_tags_revision_fk",
      ["material_id", "revision_id"],
      "material_revisions",
      ["material_id", "id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint("material_revision_tags_tag_fk", ["tag_id"], "tags", ["id"])
    .execute();

  await database.schema
    .createTable("material_revision_series_memberships")
    .addColumn("revision_id", "uuid", (column) => column.notNull())
    .addColumn("material_id", "uuid", (column) => column.notNull())
    .addColumn("series_id", "uuid", (column) => column.notNull())
    .addColumn("ordinal", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("material_revision_series_primary", ["revision_id", "series_id"])
    .addForeignKeyConstraint(
      "material_revision_series_revision_fk",
      ["material_id", "revision_id"],
      "material_revisions",
      ["material_id", "id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "material_revision_series_series_fk",
      ["series_id"],
      "series",
      ["id"],
    )
    .addCheckConstraint("material_revision_series_ordinal_positive", sql`ordinal > 0`)
    .execute();

  await database.schema
    .createTable("authoring_idempotency")
    .addColumn("actor_id", "uuid", (column) => column.notNull())
    .addColumn("operation", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("request_fingerprint", "char(64)", (column) => column.notNull())
    .addColumn("material_id", "uuid")
    .addColumn("revision_id", "uuid")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("authoring_idempotency_primary", [
      "actor_id",
      "operation",
      "idempotency_key",
    ])
    .addForeignKeyConstraint(
      "authoring_idempotency_effect_fk",
      ["material_id", "revision_id"],
      "material_revisions",
      ["material_id", "id"],
    )
    .addCheckConstraint(
      "authoring_idempotency_operation_check",
      sql`operation in ('create_draft', 'revise_draft')`,
    )
    .addCheckConstraint(
      "authoring_idempotency_effect_complete",
      sql`(material_id is null) = (revision_id is null)`,
    )
    .execute();

  await sql`
    create function reject_immutable_material_revision_change()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'material revision data is immutable' using errcode = '55000';
    end;
    $$
  `.execute(database);

  for (const table of [
    "material_revisions",
    "material_revision_tags",
    "material_revision_series_memberships",
  ]) {
    await sql.raw(`
      create trigger ${table}_immutable
      before update or delete on ${table}
      for each row execute function reject_immutable_material_revision_change()
    `).execute(database);
  }
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop function if exists reject_immutable_material_revision_change() cascade`.execute(database);
  for (const table of [
    "authoring_idempotency",
    "material_revision_series_memberships",
    "material_revision_tags",
    "series_memberships",
    "material_tags",
  ]) {
    await database.schema.dropTable(table).ifExists().execute();
  }
  await database.schema
    .alterTable("materials")
    .dropConstraint("materials_current_draft_revision_fk")
    .execute();
  for (const table of ["material_revisions", "materials", "series", "tags", "formats", "topics"]) {
    await database.schema.dropTable(table).ifExists().execute();
  }
}
