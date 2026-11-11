import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const trainerQuestionReactionsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table trainer_question_reactions (
      bot_identity text not null,
      telegram_user_id bigint not null,
      question_id text not null references trainer_questions(id),
      reaction smallint not null check (reaction between 0 and 2),
      observed_at timestamptz not null,
      primary key (bot_identity, telegram_user_id, question_id),
      foreign key (bot_identity, telegram_user_id)
        references bot_contacts(bot_identity, telegram_user_id)
    )`.execute(db);
    await sql`create index trainer_question_reactions_question
      on trainer_question_reactions(question_id, reaction)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_question_reactions`.execute(db);
  },
};
