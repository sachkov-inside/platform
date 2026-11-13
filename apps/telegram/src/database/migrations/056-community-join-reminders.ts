import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * A person with a current community right who has not joined the group gets a private reminder
 * with a personal link (#2086). People already waiting when this ships are due at once.
 */
export const communityJoinRemindersMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table community_desired_states
      add column join_reminder_due_at timestamptz,
      add column join_reminder_requested_at timestamptz,
      add column join_reminders_sent integer not null default 0
        check (join_reminders_sent >= 0),
      add column join_reminder_last_at timestamptz`.execute(db);
    await sql`update community_desired_states
      set join_reminder_due_at = now()
      where welcome_state = 'offered'
        and status = 'waiting_for_join'
        and observed_membership = 'not_member'
        and admission_restriction = 'none'`.execute(db);
    await sql`create index community_desired_states_join_reminder_idx
      on community_desired_states (bot_identity, join_reminder_due_at)
      where join_reminder_due_at is not null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop index community_desired_states_join_reminder_idx`.execute(
      db,
    );
    await sql`alter table community_desired_states
      drop column join_reminder_due_at,
      drop column join_reminder_requested_at,
      drop column join_reminders_sent,
      drop column join_reminder_last_at`.execute(db);
  },
};
