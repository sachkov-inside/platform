import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Rating participation is automatic. Keep historical choices intact; they are not current policy.
export const trainerRatingProfilesMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table trainer_rating_profiles (
      bot_identity text not null,
      telegram_user_id bigint not null,
      display_name text not null check (char_length(display_name) between 1 and 24),
      observed_at timestamptz not null,
      primary key (bot_identity, telegram_user_id),
      foreign key (bot_identity, telegram_user_id)
        references bot_contacts(bot_identity, telegram_user_id)
    )`.execute(db);
    await sql`insert into trainer_rating_profiles
      (bot_identity, telegram_user_id, display_name, observed_at)
      select bot_identity, telegram_user_id, display_name, decided_at
      from trainer_rating_consents where display_name is not null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_rating_profiles`.execute(db);
  },
};
