import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// The Trainer's Bank: topics and questions loaded by the owner's import command. A question
// keeps its identifier across imports and is withdrawn, never deleted: answers refer to it.
export const trainerBankMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table trainer_topics (
      code text primary key check (code ~ '^[0-9a-z]{1,16}$'),
      name text not null,
      position integer not null check (position >= 0),
      withdrawn_at timestamptz,
      updated_at timestamptz not null
    )`.execute(db);
    await sql`create table trainer_questions (
      id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
      topic_code text not null references trainer_topics(code),
      format text not null check (format in ('single', 'multiple')),
      text text not null,
      options jsonb not null check (jsonb_typeof(options) = 'array'),
      explanation text not null,
      source text not null,
      checked_on date not null,
      content_revision integer not null default 1 check (content_revision > 0),
      added_at timestamptz not null,
      updated_at timestamptz not null,
      withdrawn_at timestamptz
    )`.execute(db);
    await sql`create index trainer_questions_active_topic
      on trainer_questions(topic_code) where withdrawn_at is null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table trainer_questions`.execute(db);
    await sql`drop table trainer_topics`.execute(db);
  },
};
