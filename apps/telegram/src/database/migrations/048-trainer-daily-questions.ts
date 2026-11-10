import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// The Daily question of the Trainer: which question belongs to which Moscow day, and which
// round of one question is a person's Daily question of that day.
export const trainerDailyQuestionsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    // One row per Moscow day, written by the first request of that day; the primary key lets
    // only one of several first requests choose. `cycle` counts the passes over the Bank: a
    // question is not chosen twice within one cycle.
    await sql`create table trainer_daily_questions (
      bot_identity text not null,
      day date not null,
      question_id text not null references trainer_questions(id),
      cycle integer not null check (cycle > 0),
      chosen_at timestamptz not null,
      primary key (bot_identity, day)
    )`.execute(db);
    await sql`create index trainer_daily_questions_by_cycle
      on trainer_daily_questions (bot_identity, cycle, question_id)`.execute(
      db,
    );

    // The Moscow day of a Daily question round. No round was stored before this migration
    // shipped with the mode.
    await sql`alter table trainer_rounds
      add column daily_day date,
      add constraint trainer_rounds_daily_day
        check ((mode = 'daily') = (daily_day is not null))`.execute(db);
    // A person has one Daily question round per day; the same index finds the answers of a day.
    await sql`create unique index trainer_rounds_daily_of_day
      on trainer_rounds (bot_identity, daily_day, telegram_user_id)
      where daily_day is not null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop index trainer_rounds_daily_of_day`.execute(db);
    await sql`alter table trainer_rounds
      drop constraint trainer_rounds_daily_day,
      drop column daily_day`.execute(db);
    await sql`drop table trainer_daily_questions`.execute(db);
  },
};
