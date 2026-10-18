import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** A private send is never retried automatically, including after a process crash. */
export const activationAnnouncementMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table activation_announcement_deliveries (
      operation_id text primary key,
      fingerprint text not null unique,
      status text not null check (status in ('pending', 'sent', 'not_sent', 'unknown')),
      created_at timestamptz not null default now()
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table activation_announcement_deliveries`.execute(db);
  },
};
