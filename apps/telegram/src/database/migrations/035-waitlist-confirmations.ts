import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
export const waitlistConfirmationsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table waitlist_confirmations (
      bot_identity text not null, event_id uuid not null, command jsonb not null,
      created_at timestamptz not null, available_at timestamptz not null, attempted_at timestamptz,
      attempt_count integer not null default 0, provider_message_id text, diagnostic_code text,
      state text not null check(state in ('pending','sending','delivered','suppressed','rejected','unknown')),
      primary key(bot_identity,event_id)
    )`.execute(db);
    await sql`create index waitlist_confirmations_due on waitlist_confirmations(available_at) where state='pending'`.execute(db);
  },
  async down(db: Kysely<unknown>) { await sql`drop table waitlist_confirmations`.execute(db); },
};
