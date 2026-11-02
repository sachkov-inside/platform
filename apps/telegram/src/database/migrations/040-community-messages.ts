import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const communityMessagesMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table community_messages (
      bot_identity text not null,
      chat_id bigint not null,
      message_id bigint not null,
      thread_id bigint,
      reply_to_message_id bigint,
      sent_at timestamptz not null,
      edited_at timestamptz,
      sender_telegram_user_id bigint not null,
      is_author boolean,
      kind text not null check(kind in ('text','photo','document')),
      text text not null,
      file_id text,
      last_update_id bigint not null,
      primary key(bot_identity, chat_id, message_id)
    )`.execute(db);
    await sql`create index community_messages_retention on community_messages(sent_at)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table community_messages`.execute(db);
  },
};
