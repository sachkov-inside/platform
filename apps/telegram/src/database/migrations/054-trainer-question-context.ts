import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** The context of a question: null for a question whose whole condition is its text. */
export const trainerQuestionContextMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table trainer_questions add column context text`.execute(
      db,
    );
    await sql`alter table trainer_question_versions add column context text`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table trainer_question_versions drop column context`.execute(
      db,
    );
    await sql`alter table trainer_questions drop column context`.execute(db);
  },
};
