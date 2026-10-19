import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
export const waitlistNotificationsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table communication_waitlist_openings (
      bot_identity text not null, intake_id uuid not null,
      broadcast_id uuid not null unique references communication_broadcasts(broadcast_id) on delete cascade,
      primary key(bot_identity, intake_id)
    )`.execute(db);
    await sql`create table communication_waitlist_recipients (
      broadcast_id uuid not null references communication_broadcasts(broadcast_id) on delete cascade,
      contact_id uuid not null references communication_contacts(contact_id),
      account_ref text not null, telegram_identity_ref text not null,
      primary key(broadcast_id, contact_id)
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table communication_waitlist_recipients`.execute(db);
    await sql`drop table communication_waitlist_openings`.execute(db);
  },
};
