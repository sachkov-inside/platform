import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
export const waitlistAudienceResultMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table communication_broadcasts
      add column waitlist_active_count integer,
      add column waitlist_excluded_count integer,
      add constraint communication_waitlist_counts check (
        (waitlist_active_count is null and waitlist_excluded_count is null) or
        (waitlist_active_count is not null and waitlist_excluded_count is not null
          and waitlist_active_count >= 0 and waitlist_excluded_count >= 0
          and waitlist_excluded_count <= waitlist_active_count)
      )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table communication_broadcasts drop column waitlist_active_count, drop column waitlist_excluded_count`.execute(db);
  },
};
