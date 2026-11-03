import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const communityDiscussionHistoryMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table community_discussions
      add column content_revision integer not null default 1 check(content_revision > 0),
      add column reviewed_revision integer not null default 0,
      add constraint community_discussions_reviewed_revision check(reviewed_revision >= 0 and reviewed_revision <= content_revision)`.execute(db);
    await sql`update community_discussions set reviewed_revision = 1 where status in ('reviewed', 'used')`.execute(db);
    await sql`alter table community_discussions add column question_search tsvector
      generated always as (to_tsvector('russian'::regconfig, question)) stored`.execute(db);
    await sql`create index community_discussions_question_search on community_discussions using gin(question_search)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table community_discussions drop column question_search`.execute(db);
    await sql`alter table community_discussions drop column reviewed_revision, drop column content_revision`.execute(db);
  },
};
