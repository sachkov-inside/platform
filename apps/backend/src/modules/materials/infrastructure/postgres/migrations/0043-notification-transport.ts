export const name = "0043_materials_notification_transport";
export const statement = `
CREATE TABLE materials.notification_outbox (
  scope text NOT NULL, message_id uuid NOT NULL, lane text NOT NULL,
  payload text NOT NULL CHECK (octet_length(payload) <= 16384), digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  last_failure text, PRIMARY KEY (scope, message_id)
);
CREATE INDEX ON materials.notification_outbox(lane, published_at, next_attempt_at);
`;
