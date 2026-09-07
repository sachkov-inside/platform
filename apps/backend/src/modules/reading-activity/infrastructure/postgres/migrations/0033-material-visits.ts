export const name = "0033_material_visits";
export const statement = `
CREATE TABLE reading_activity.material_visits (
  account_id uuid NOT NULL,
  material_id uuid NOT NULL,
  first_opened_at timestamptz NOT NULL,
  last_opened_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, material_id),
  CHECK (last_opened_at >= first_opened_at)
);
CREATE INDEX material_visits_recent ON reading_activity.material_visits (account_id, last_opened_at DESC, material_id);
`;
