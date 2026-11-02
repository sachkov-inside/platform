import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const communityDiscussionsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table community_messages add column processed_at timestamptz`.execute(db);
    await sql`create index community_messages_pending on community_messages(bot_identity, chat_id, message_id) where processed_at is null`.execute(db);
    await sql`create table community_discussions (
      id uuid primary key, bot_identity text not null, chat_id bigint not null,
      status text not null check(status in ('new','awaiting_answer','reviewed','used')),
      question text not null, answers text not null, conclusion text not null,
      material_urls jsonb not null default '[]', created_at timestamptz not null, updated_at timestamptz not null
    )`.execute(db);
    await sql`create index community_discussions_list on community_discussions(bot_identity, chat_id, created_at, id)`.execute(db);
    // Source references deliberately have no foreign key to expiring raw messages.
    await sql`create table community_discussion_sources (
      discussion_id uuid not null references community_discussions(id), bot_identity text not null, chat_id bigint not null,
      message_id bigint not null, thread_id bigint, reply_to_message_id bigint, sent_at timestamptz not null,
      role text not null, kind text not null, source_url text not null,
      primary key(bot_identity, chat_id, message_id)
    )`.execute(db);
    await sql`create index community_discussion_sources_discussion on community_discussion_sources(discussion_id, message_id)`.execute(db);
    await sql`create table community_discussion_schedule (
      bot_identity text primary key, next_run_at timestamptz not null,
      lease_token uuid, lease_until timestamptz
    )`.execute(db);
    await sql`create table community_discussion_mark_receipts (
      bot_identity text not null, account_ref text not null, request_id text not null,
      fingerprint text not null, response jsonb not null, primary key(bot_identity, account_ref, request_id)
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    for (const table of ["community_discussion_mark_receipts", "community_discussion_schedule", "community_discussion_sources", "community_discussions"]) await db.schema.dropTable(table).execute();
    await db.schema.alterTable("community_messages").dropColumn("processed_at").execute();
  },
};
