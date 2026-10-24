export const name = "0106_learning_activity_provenance";
export const statement = `
CREATE TABLE reading_activity.learning_started_events (
  event_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  product_id uuid NOT NULL,
  command_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (account_id, product_id)
);
CREATE INDEX learning_started_activity_period ON reading_activity.learning_started_events (occurred_at, event_id, account_id);
CREATE INDEX reading_activity_period ON reading_activity.events (occurred_at, account_id, event_type);
`;
