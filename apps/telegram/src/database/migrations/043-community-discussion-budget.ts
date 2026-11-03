import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const communityDiscussionBudgetMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table community_discussion_schedule add column budget_blocked_limit bigint, add column budget_blocked_month text`.execute(
      db,
    );
    await sql`create table community_discussion_budget_months (
      bot_identity text not null, month text not null,
      cost_micro_usd bigint not null default 0 check(cost_micro_usd >= 0),
      notified boolean not null default false, notification_after_user bigint,
      primary key(bot_identity, month)
    )`.execute(db);
    await sql`create table community_discussion_model_calls (
      id uuid primary key, bot_identity text not null, month text not null,
      operation text not null check(operation in ('group','transcribe')),
      cost_micro_usd bigint not null check(cost_micro_usd > 0),
      state text not null check(state in ('reserved','completed','failed')),
      created_at timestamptz not null,
      foreign key(bot_identity, month) references community_discussion_budget_months(bot_identity, month)
    )`.execute(db);
    await sql`create index community_discussion_model_calls_month on community_discussion_model_calls(bot_identity, month)`.execute(
      db,
    );
    await sql`create table community_discussion_runs (
      bot_identity text primary key, finished_at timestamptz not null, status text not null,
      messages integer not null, transcriptions integer not null, discussions integer not null,
      errors integer not null, skips integer not null
    )`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table community_discussion_schedule drop column budget_blocked_limit, drop column budget_blocked_month`.execute(
      db,
    );
    await db.schema.dropTable("community_discussion_runs").execute();
    await db.schema.dropTable("community_discussion_model_calls").execute();
    await db.schema.dropTable("community_discussion_budget_months").execute();
  },
};
