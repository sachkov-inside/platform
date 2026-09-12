export const name = "0062_reader_guide_mode";

export const statement = `
CREATE TABLE reading_activity.reader_preferences (
  account_id uuid PRIMARY KEY,
  guide_mode text NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (guide_mode IN ('example', 'own'))
);
`;
