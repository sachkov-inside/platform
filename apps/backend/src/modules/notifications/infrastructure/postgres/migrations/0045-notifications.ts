export const name = "0045_notifications";
export const statement = `
ALTER TABLE notifications.inbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON notifications.inbox(lane, completed_at, next_attempt_at);

CREATE TABLE notifications.preferences (
 account_id uuid PRIMARY KEY, revision integer NOT NULL CHECK(revision > 0),
 email boolean NOT NULL, telegram boolean NOT NULL, changed_at timestamptz NOT NULL
);
CREATE TABLE notifications.preference_revisions (
 account_id uuid NOT NULL, revision integer NOT NULL, operation_id uuid NOT NULL,
 fingerprint text NOT NULL, email boolean NOT NULL, telegram boolean NOT NULL,
 changed_at timestamptz NOT NULL, PRIMARY KEY(account_id, revision), UNIQUE(account_id, operation_id)
);
CREATE INDEX ON notifications.preference_revisions(account_id, changed_at);
CREATE TABLE notifications.notifications (
 id uuid PRIMARY KEY, kind text NOT NULL, occurrence_ref uuid NOT NULL, account_id uuid NOT NULL,
 event_payload text NOT NULL, source_revision integer NOT NULL,
 created_at timestamptz NOT NULL, UNIQUE(kind, occurrence_ref, account_id)
);
CREATE TABLE notifications.deliveries (
 id uuid PRIMARY KEY, notification_id uuid NOT NULL REFERENCES notifications.notifications(id),
 channel text NOT NULL CHECK(channel IN ('email', 'telegram')), command_revision integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'no_channel', reason text, result_revision integer NOT NULL DEFAULT 0,
 result_digest text, attempt_ref uuid, recovery_skipped boolean NOT NULL DEFAULT false,
 next_command_at timestamptz, updated_at timestamptz NOT NULL, UNIQUE(notification_id, channel)
);
CREATE INDEX ON notifications.deliveries(state, next_command_at);
CREATE INDEX ON notifications.notifications(account_id, id);
CREATE TABLE notifications.commands (
 operation_id uuid PRIMARY KEY, delivery_id uuid NOT NULL REFERENCES notifications.deliveries(id),
 revision integer NOT NULL, payload text NOT NULL CHECK(octet_length(payload) <= 16384), digest text NOT NULL,
 created_at timestamptz NOT NULL, UNIQUE(delivery_id, revision)
);
CREATE TABLE notifications.authorizations (
 channel text NOT NULL, operation_id uuid NOT NULL, digest text NOT NULL,
 delivery_id uuid NOT NULL, attempt_ref uuid NOT NULL, response text NOT NULL,
 created_at timestamptz NOT NULL, PRIMARY KEY(channel, operation_id)
);
CREATE INDEX ON notifications.authorizations(delivery_id, attempt_ref);
CREATE TABLE notifications.results (
 channel text NOT NULL, message_id uuid NOT NULL, delivery_id uuid NOT NULL,
 revision integer NOT NULL, digest text NOT NULL, payload text NOT NULL,
 recorded_at timestamptz NOT NULL, PRIMARY KEY(channel, message_id), UNIQUE(delivery_id, revision)
);
CREATE TABLE notifications.email_inbox (
 operation_id uuid PRIMARY KEY, delivery_id uuid NOT NULL, command_revision integer NOT NULL,
 payload text NOT NULL CHECK(octet_length(payload) <= 16384), digest text NOT NULL,
 received_at timestamptz NOT NULL, completed_at timestamptz, rejected boolean NOT NULL DEFAULT false,
 UNIQUE(delivery_id, command_revision)
);
CREATE TABLE notifications.email_effects (
 delivery_id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, command_revision integer NOT NULL,
 category text NOT NULL,
 state text NOT NULL, attempt_ref uuid, permit_ref uuid, result_revision integer NOT NULL DEFAULT 0,
 result_payload text, retries integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL
);
CREATE INDEX ON notifications.email_effects(category, state, next_attempt_at);
CREATE TABLE notifications.email_attempts (
 id uuid PRIMARY KEY, delivery_id uuid NOT NULL REFERENCES notifications.email_effects(delivery_id),
 operation_id uuid NOT NULL, permit_ref uuid NOT NULL, started_at timestamptz NOT NULL,
 state text NOT NULL, receipt_ref uuid, completed_at timestamptz
);
CREATE TABLE notifications.recovery_audit (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, delivery_id uuid NOT NULL,
 action text NOT NULL CHECK(action = 'skip'), fingerprint text NOT NULL, created_at timestamptz NOT NULL
);
`;
