import { type Kysely, sql } from "kysely";

const IDENTITY_SCHEMA = "identity_principals";

export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema.createSchema(IDENTITY_SCHEMA).execute();
  const schema = database.schema.withSchema(IDENTITY_SCHEMA);

  await schema
    .createTable("principals")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("state", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn("security_version", "integer", (column) => column.notNull().defaultTo(1))
    .addCheckConstraint("principals_kind_check", sql`kind in ('human', 'service')`)
    .addCheckConstraint("principals_state_check", sql`state in ('active', 'disabled')`)
    .addCheckConstraint("principals_security_version_positive", sql`security_version > 0`)
    .execute();

  await schema
    .createTable("external_identities")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("principal_id", "uuid", (column) => column.notNull())
    .addColumn("issuer", "text", (column) => column.notNull())
    .addColumn("subject", "text", (column) => column.notNull())
    .addColumn("email_fingerprint", "varchar(67)")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("external_identities_issuer_subject_unique", ["issuer", "subject"])
    .addUniqueConstraint("external_identities_email_fingerprint_unique", ["email_fingerprint"])
    .addForeignKeyConstraint(
      "external_identities_principal_fk",
      ["principal_id"],
      "principals",
      ["id"],
    )
    .addCheckConstraint("external_identities_issuer_https", sql`issuer like 'https://%'`)
    .addCheckConstraint("external_identities_subject_nonempty", sql`length(subject) between 1 and 500`)
    .addCheckConstraint(
      "external_identities_email_fingerprint_v1",
      sql`email_fingerprint is null or email_fingerprint ~ '^v1:[0-9a-f]{64}$'`,
    )
    .execute();

  await schema
    .createTable("principal_permissions")
    .addColumn("principal_id", "uuid", (column) => column.notNull())
    .addColumn("permission", "text", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("principal_permissions_primary", ["principal_id", "permission"])
    .addForeignKeyConstraint(
      "principal_permissions_principal_fk",
      ["principal_id"],
      "principals",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addCheckConstraint(
      "principal_permissions_value_check",
      sql`permission in ('materials:author', 'materials:publish', 'identity:admin')`,
    )
    .execute();

  await schema
    .createTable("platform_sessions")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("principal_id", "uuid", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull())
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("authenticated_at", "timestamptz", (column) => column.notNull())
    .addColumn("ended_at", "timestamptz")
    .addColumn("security_version", "integer", (column) => column.notNull())
    .addForeignKeyConstraint(
      "platform_sessions_principal_fk",
      ["principal_id"],
      "principals",
      ["id"],
    )
    .addCheckConstraint("platform_sessions_finite", sql`expires_at > created_at`)
    .addCheckConstraint(
      "platform_sessions_max_lifetime",
      sql`expires_at <= created_at + interval '7 days'`,
    )
    .addCheckConstraint(
      "platform_sessions_end_after_creation",
      sql`ended_at is null or ended_at >= created_at`,
    )
    .addCheckConstraint("platform_sessions_security_version_positive", sql`security_version > 0`)
    .execute();

  await schema
    .createTable("identity_idempotency")
    .addColumn("operation", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "varchar(200)", (column) => column.notNull())
    .addColumn("request_fingerprint", "char(64)", (column) => column.notNull())
    .addColumn("principal_id", "uuid")
    .addColumn("session_id", "uuid")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("identity_idempotency_primary", ["operation", "idempotency_key"])
    .addForeignKeyConstraint(
      "identity_idempotency_principal_fk",
      ["principal_id"],
      "principals",
      ["id"],
    )
    .addForeignKeyConstraint(
      "identity_idempotency_session_fk",
      ["session_id"],
      "platform_sessions",
      ["id"],
    )
    .addCheckConstraint(
      "identity_idempotency_effect_complete",
      sql`(principal_id is null) = (session_id is null)`,
    )
    .execute();

  await schema
    .createTable("identity_reauthentication_attempts")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("session_id", "uuid", (column) => column.notNull())
    .addColumn("created_at", "timestamptz", (column) => column.notNull())
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("consumed_at", "timestamptz")
    .addColumn("token_fingerprint", "char(64)", (column) => column.unique())
    .addColumn("begin_idempotency_key", "varchar(200)", (column) => column.notNull().unique())
    .addColumn("begin_request_fingerprint", "char(64)", (column) => column.notNull())
    .addColumn("complete_idempotency_key", "varchar(200)", (column) => column.unique())
    .addColumn("complete_request_fingerprint", "char(64)")
    .addForeignKeyConstraint(
      "identity_reauthentication_session_fk",
      ["session_id"],
      "platform_sessions",
      ["id"],
    )
    .addCheckConstraint(
      "identity_reauthentication_finite",
      sql`expires_at > created_at and expires_at <= created_at + interval '5 minutes'`,
    )
    .addCheckConstraint(
      "identity_reauthentication_completion_complete",
      sql`(consumed_at is null and token_fingerprint is null and complete_idempotency_key is null and complete_request_fingerprint is null) or (consumed_at is not null and token_fingerprint is not null and complete_idempotency_key is not null and complete_request_fingerprint is not null)`,
    )
    .execute();

  await schema
    .createTable("identity_audit_events")
    .addColumn("id", "uuid", (column) => column.primaryKey())
    .addColumn("operation", "text", (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("principal_id", "uuid")
    .addColumn("session_id", "uuid")
    .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      "identity_audit_principal_fk",
      ["principal_id"],
      "principals",
      ["id"],
    )
    .addForeignKeyConstraint(
      "identity_audit_session_fk",
      ["session_id"],
      "platform_sessions",
      ["id"],
    )
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  const schema = database.schema.withSchema(IDENTITY_SCHEMA);
  for (const table of [
    "identity_audit_events",
    "identity_reauthentication_attempts",
    "identity_idempotency",
    "platform_sessions",
    "principal_permissions",
    "external_identities",
    "principals",
  ]) {
    await schema.dropTable(table).ifExists().execute();
  }
  await database.schema.dropSchema(IDENTITY_SCHEMA).ifExists().execute();
}
