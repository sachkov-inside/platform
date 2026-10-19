export const name = "0106_bookmark_activity_provenance";
export const statement = `
CREATE TABLE bookmarks.activity_events (
  event_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  material_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('bookmark_added', 'bookmark_removed')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX bookmark_activity_period ON bookmarks.activity_events (occurred_at, event_id, account_id, event_type);
`;
