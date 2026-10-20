import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
export const materialAnnouncementsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table communication_material_announcements (
      bot_identity text not null, announcement_ref uuid not null, audience_key text not null,
      broadcast_id uuid not null unique references communication_broadcasts(broadcast_id),
      snapshot jsonb not null,
      primary key(bot_identity, announcement_ref, audience_key)
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`update communication_broadcasts set state = 'cancelled' where broadcast_id in (select broadcast_id from communication_material_announcements)`.execute(db);
    await sql`drop table communication_material_announcements`.execute(db);
  },
};
