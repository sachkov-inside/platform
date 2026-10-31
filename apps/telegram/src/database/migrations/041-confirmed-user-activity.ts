import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** No historical replay: the collector begins with the additive deployment. */
export const confirmedUserActivityMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table sign_in_requests add column decision_update_id bigint null`.execute(db);
    await sql`create table telegram_user_activity (
      bot_identity text not null,
      update_id bigint not null,
      telegram_user_id bigint not null,
      kind text not null check (kind in ('marketing_preference', 'marketing_entry', 'template_saved', 'sign_in_decision')),
      occurred_at timestamptz not null,
      primary key (bot_identity, update_id)
    )`.execute(db);
    await sql`create index telegram_user_activity_window on telegram_user_activity (bot_identity, occurred_at, telegram_user_id)`.execute(db);
    await sql`create index telegram_user_activity_retention on telegram_user_activity (occurred_at)`.execute(db);
    await sql`create table telegram_activity_collection (
      singleton boolean primary key default true check (singleton),
      started_at timestamptz not null default clock_timestamp()
    )`.execute(db);
    await sql`insert into telegram_activity_collection (singleton) values (true)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table sign_in_requests drop column decision_update_id`.execute(db);
    await sql`drop table telegram_user_activity`.execute(db);
    await sql`drop table telegram_activity_collection`.execute(db);
  },
};
