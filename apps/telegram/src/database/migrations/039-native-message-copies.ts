import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Opaque native references never expose the author's private Telegram identifiers to Platform. */
export const nativeMessageCopiesMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table communication_native_copies (
      archive_id uuid primary key,
      bot_identity text not null,
      owner_account_ref text not null,
      telegram_user_id bigint not null,
      telegram_identity_ref text not null,
      context_kind text not null check(context_kind in ('template','admin')),
      context_hash text not null,
      media_group_id text,
      sources jsonb not null,
      copied_message_ids jsonb not null default '[]'::jsonb,
      state text not null check(state in ('collecting','pending','sending','ready','unknown','rejected')),
      created_at timestamptz not null,
      attempted_at timestamptz,
      available_at timestamptz not null,
      attempt_count integer not null default 0,
      diagnostic_code text,
      unique(bot_identity, telegram_user_id, context_kind, context_hash)
    )`.execute(db);
    await sql`create index communication_native_copies_owner on communication_native_copies(bot_identity,owner_account_ref)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    // A release rollback cannot reconstruct native snapshots from the legacy wire representation.
    await sql`do $$ begin
      if exists (select 1 from communication_native_copies) then
        raise exception 'Native copies exist. Preserve the archive and roll forward; see communications recovery.';
      end if;
    end $$`.execute(db);
    await sql`drop table communication_native_copies`.execute(db);
  },
};
