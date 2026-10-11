import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Extends the existing attempt journal; stable subjects and reservations stay unchanged. */
export const miniAppSignInMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable("sign_in_requests")
      .addColumn("source", "text", (column) => column.notNull().defaultTo("bot"))
      .addColumn("mini_app_proof_digest", "text")
      .addColumn("mini_app_oidc_context_digest", "text")
      .addColumn("mini_app_launch_browser_digest", "text")
      .addColumn("mini_app_bound_at", "timestamptz")
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .addCheckConstraint("sign_in_requests_source_check", sql`source in ('bot', 'mini-app')`)
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .addCheckConstraint("sign_in_requests_mini_app_proof_check", sql`
        mini_app_proof_digest is null or
        (source = 'mini-app' and mini_app_proof_digest ~ '^[A-Za-z0-9_-]{43}$')
      `)
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .addCheckConstraint("sign_in_requests_mini_app_context_check", sql`
        (source = 'bot' and mini_app_oidc_context_digest is null and mini_app_bound_at is null
          and mini_app_launch_browser_digest is null) or
        (source = 'mini-app' and mini_app_oidc_context_digest is not null
          and mini_app_oidc_context_digest ~ '^[A-Za-z0-9_-]{43}$'
          and mini_app_launch_browser_digest is not null
          and mini_app_launch_browser_digest ~ '^[A-Za-z0-9_-]{43}$')
      `)
      .execute();
    await db.schema.createIndex("sign_in_requests_mini_app_proof_unique")
      .on("sign_in_requests").column("mini_app_proof_digest").unique().execute();
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex("sign_in_requests_mini_app_proof_unique").execute();
    await db.schema.alterTable("sign_in_requests")
      .dropConstraint("sign_in_requests_mini_app_proof_check")
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .dropConstraint("sign_in_requests_source_check")
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .dropConstraint("sign_in_requests_mini_app_context_check")
      .execute();
    await db.schema.alterTable("sign_in_requests")
      .dropColumn("mini_app_proof_digest").dropColumn("mini_app_oidc_context_digest")
      .dropColumn("mini_app_bound_at")
      .dropColumn("mini_app_launch_browser_digest")
      .dropColumn("source").execute();
  },
};
