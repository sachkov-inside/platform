import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const trainerOpeningsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    // One row per request to open the Trainer. `source_code` is the label of a Trainer link;
    // null means the person came without a label. `delivery` is the fate of the widget message.
    await sql`create table trainer_openings (
      opening_id uuid primary key,
      bot_identity text not null,
      update_id bigint not null,
      telegram_user_id bigint not null,
      entry text not null check (entry in ('command', 'menu', 'link')),
      source_code text check (source_code ~ '^[A-Za-z0-9_-]{1,64}$'),
      opened_at timestamptz not null,
      delivery text not null
        check (delivery in ('sending', 'retry', 'delivered', 'rejected', 'unknown')),
      provider_message_id bigint,
      unique (bot_identity, update_id)
    )`.execute(db);
    await sql`create index trainer_openings_by_day
      on trainer_openings (bot_identity, opened_at)`.execute(db);
    await sql`create index trainer_openings_by_contact
      on trainer_openings (bot_identity, telegram_user_id)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_openings`.execute(db);
  },
};
