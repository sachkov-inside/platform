export const name = "0044_notifications_notification_transport";
export const statement = `
CREATE SCHEMA notifications;
CREATE TABLE notifications.notification_outbox (
  scope text NOT NULL, message_id uuid NOT NULL, lane text NOT NULL,
  payload text NOT NULL CHECK (octet_length(payload) <= 16384), digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  last_failure text, PRIMARY KEY (scope, message_id)
);
CREATE INDEX ON notifications.notification_outbox(lane, published_at, next_attempt_at);
CREATE TABLE notifications.inbox (
  scope text NOT NULL, message_id uuid NOT NULL, lane text NOT NULL,
  payload text NOT NULL CHECK (octet_length(payload) <= 16384), digest text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (scope, message_id)
);
CREATE INDEX ON notifications.inbox(lane, completed_at, received_at);
CREATE TABLE notifications.quarantine (
  key text PRIMARY KEY, lane text NOT NULL, reason text NOT NULL, digest text NOT NULL,
  payload text CHECK (octet_length(payload) <= 21848),
  received_at timestamptz NOT NULL DEFAULT now(), payload_expires_at timestamptz NOT NULL
);
CREATE INDEX ON notifications.quarantine(payload_expires_at);
`;
