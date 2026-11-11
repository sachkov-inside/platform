import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Content revisions are append-only: issued answers must not read a later edit's options. */
export const trainerQuestionVersionsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table trainer_question_versions (
      question_id text not null references trainer_questions(id),
      content_revision integer not null check (content_revision > 0),
      text text not null,
      options jsonb not null check (jsonb_typeof(options) = 'array'),
      explanation text not null,
      primary key (question_id, content_revision)
    )`.execute(db);
    // Earlier overwritten revisions cannot be reconstructed from the live Bank.
    await sql`insert into trainer_question_versions
      (question_id, content_revision, text, options, explanation)
      select id, content_revision, text, options, explanation from trainer_questions`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`lock table trainer_question_versions in access exclusive mode`.execute(db);
    const { rows } = await sql<{ retained: boolean }>`select exists (
      select from trainer_question_versions as version
      join trainer_questions as question on question.id = version.question_id
      where version.content_revision <> question.content_revision
    ) as retained`.execute(db);
    if (rows[0]?.retained === true)
      throw new Error("Trainer question history cannot be discarded; restore the pre-migration backup to roll back");
    await sql`drop table trainer_question_versions`.execute(db);
  },
};
