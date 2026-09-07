export const name = "0032_reading_activity";
export const statement = `
CREATE SCHEMA reading_activity;
CREATE TABLE reading_activity.material_states (
  account_id uuid NOT NULL,
  material_id uuid NOT NULL,
  is_read boolean NOT NULL,
  read_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, material_id),
  CHECK (is_read = (read_at IS NOT NULL))
);
CREATE TABLE reading_activity.events (
  event_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  material_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('material_marked_read', 'material_marked_unread')),
  state_version integer NOT NULL CHECK (state_version > 0),
  occurred_at timestamptz NOT NULL,
  command_id uuid NOT NULL,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  UNIQUE (account_id, material_id, state_version)
);
CREATE INDEX reading_events_account_history ON reading_activity.events (account_id, occurred_at, event_id);
CREATE TABLE reading_activity.commands (
  account_id uuid NOT NULL,
  command_id uuid NOT NULL,
  fingerprint text NOT NULL,
  outcome jsonb NOT NULL,
  PRIMARY KEY (account_id, command_id)
);
`;
