import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// The Rating of the Trainer: a person's own choice to be shown in the tables, and the Telegram
// name the tables show for them.
export const trainerRatingConsentsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    // One row per person who has chosen; a person without a row has not chosen yet and is not
    // shown. The name is kept only while the person is shown: turning the display off clears
    // it in the same statement. 24 is the name length of the widget's Rating row.
    await sql`create table trainer_rating_consents (
      bot_identity text not null,
      telegram_user_id bigint not null,
      shown boolean not null,
      display_name text check (char_length(display_name) between 1 and 24),
      decided_at timestamptz not null,
      primary key (bot_identity, telegram_user_id),
      foreign key (bot_identity, telegram_user_id)
        references bot_contacts(bot_identity, telegram_user_id),
      check (shown = (display_name is not null))
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_rating_consents`.execute(db);
  },
};
