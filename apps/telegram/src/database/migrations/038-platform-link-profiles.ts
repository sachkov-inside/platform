import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * The last observed Telegram name and username of a current link, for author search. A row
 * belongs to the link confirmed by `link_transaction_ref`; a transfer deletes it.
 */
export const platformLinkProfilesMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`create table platform_link_profiles (
      telegram_identity_ref text primary key
        references platform_links(telegram_identity_ref) on delete cascade,
      link_transaction_ref text not null,
      display_name varchar(160),
      username varchar(64),
      search_text text not null,
      observed_at timestamptz not null
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table platform_link_profiles`.execute(db);
  },
};
