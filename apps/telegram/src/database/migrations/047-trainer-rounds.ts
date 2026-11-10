import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Rounds of the Trainer and the questions issued in them. One table pair serves every mode:
// «Проверить себя», Тренировка по теме and Вопрос дня (a round of one question).
export const trainerRoundsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    // One row per started round. `update_id` is the Telegram update that started it, so a
    // repeated run of that update finds the round instead of starting a second one.
    await sql`create table trainer_rounds (
      id bigserial primary key,
      bot_identity text not null,
      telegram_user_id bigint not null,
      mode text not null check (mode in ('check', 'topic', 'daily')),
      topic_code text references trainer_topics(code),
      size integer not null check (size > 0),
      started_at timestamptz not null,
      update_id bigint not null,
      foreign key (bot_identity, telegram_user_id)
        references bot_contacts(bot_identity, telegram_user_id),
      unique (bot_identity, update_id),
      check ((mode = 'topic') = (topic_code is not null))
    )`.execute(db);
    await sql`create index trainer_rounds_by_contact
      on trainer_rounds (bot_identity, telegram_user_id, id)`.execute(db);

    // One row per step of a round, written when the round starts. `issued_at` is set when the
    // person is shown the question, the answer columns when the person answers; each is set
    // once. `option_count` and `correct_mask` are the question as it was at the start of the
    // round: an answer is judged against what the person saw. `picked_mask` 0 is «Не знаю».
    // `first_answer` marks the person's first answer to the question, in any round and mode.
    await sql`create table trainer_issues (
      id bigserial primary key,
      round_id bigint not null references trainer_rounds(id),
      position integer not null check (position > 0),
      bot_identity text not null,
      telegram_user_id bigint not null,
      question_id text not null references trainer_questions(id),
      content_revision integer not null,
      option_count integer not null check (option_count between 2 and 4),
      correct_mask integer not null
        check (correct_mask > 0 and correct_mask < (1 << option_count)),
      issued_at timestamptz,
      answered_at timestamptz,
      picked_mask integer
        check (picked_mask >= 0 and picked_mask < (1 << option_count)),
      correct boolean,
      first_answer boolean,
      foreign key (bot_identity, telegram_user_id)
        references bot_contacts(bot_identity, telegram_user_id),
      unique (round_id, position),
      check (answered_at is null or issued_at is not null),
      check (
        (answered_at is null and picked_mask is null and correct is null
          and first_answer is null)
        or (answered_at is not null and picked_mask is not null and correct is not null
          and first_answer is not null)
      ),
      check (correct is null or correct = (picked_mask = correct_mask))
    )`.execute(db);
    // A person's history of one question: the choice of questions and the first answer.
    await sql`create index trainer_issues_by_contact_question
      on trainer_issues (bot_identity, telegram_user_id, question_id)`.execute(
      db,
    );
    await sql`create unique index trainer_issues_first_answer
      on trainer_issues (bot_identity, telegram_user_id, question_id)
      where first_answer`.execute(db);
    // Answers by time: a person's days and the reports by day.
    await sql`create index trainer_issues_by_answer_time
      on trainer_issues (bot_identity, answered_at)
      where answered_at is not null`.execute(db);
    await sql`create index trainer_issues_by_question
      on trainer_issues (question_id) where answered_at is not null`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_issues`.execute(db);
    await sql`drop table trainer_rounds`.execute(db);
  },
};
