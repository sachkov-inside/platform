import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** A round earns statistical credit once, when its last answer is accepted. */
export const trainerRoundCompletionMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table trainer_rounds add column completed_at timestamptz`.execute(
      db,
    );
    await sql`update trainer_rounds as round set completed_at = answered.completed_at
      from (select round_id, count(*) as size, count(answered_at) as answered,
        max(answered_at) as completed_at from trainer_issues group by round_id) as answered
      where answered.round_id = round.id and answered.size = round.size
        and answered.answered = round.size`.execute(db);
    await sql`create index trainer_rounds_completed_person
      on trainer_rounds(bot_identity, telegram_user_id, completed_at)
      where completed_at is not null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop index trainer_rounds_completed_person`.execute(db);
    await sql`alter table trainer_rounds drop column completed_at`.execute(db);
  },
};
