import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const communityTranscriptsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table community_messages drop constraint community_messages_kind_check`.execute(db);
    await sql`alter table community_messages add constraint community_messages_kind_check check(kind in ('text','photo','document','voice','video_note'))`.execute(db);
    await sql`alter table community_messages add column duration_seconds integer check(duration_seconds >= 0), add column transcript text`.execute(db);
    await sql`create index community_messages_transcription on community_messages(bot_identity, chat_id, message_id) where kind in ('voice','video_note') and transcript is null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`delete from community_messages where kind in ('voice','video_note')`.execute(db);
    await sql`drop index community_messages_transcription`.execute(db);
    await sql`alter table community_messages drop column transcript, drop column duration_seconds`.execute(db);
    await sql`alter table community_messages drop constraint community_messages_kind_check`.execute(db);
    await sql`alter table community_messages add constraint community_messages_kind_check check(kind in ('text','photo','document'))`.execute(db);
  },
};
